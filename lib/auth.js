/** Sessiyalar, cookie'lar va kirishni cheklash */
import { getDb, persist, findUserById } from './db.js';
import { randomToken } from './crypto.js';

export const COOKIE = 'pmd_sid';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSec = SESSION_DAYS * 86400) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  return parts.join('; ');
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function createSession(userId, req) {
  const db = getDb();
  const token = randomToken(32);
  const now = Date.now();
  db.authSessions.push({
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString(),
    userAgent: String(req?.headers['user-agent'] || '').slice(0, 200)
  });
  // eskirganlarini tozalaymiz
  db.authSessions = db.authSessions.filter(s => new Date(s.expiresAt).getTime() > now);
  persist();
  return token;
}

export function destroySession(token) {
  const db = getDb();
  const before = db.authSessions.length;
  db.authSessions = db.authSessions.filter(s => s.token !== token);
  if (db.authSessions.length !== before) persist();
}

export function destroyAllSessions(userId, exceptToken = null) {
  const db = getDb();
  db.authSessions = db.authSessions.filter(s => s.userId !== userId || s.token === exceptToken);
  persist();
}

/** So'rovdan foydalanuvchini aniqlash */
export function userFromRequest(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return { user: null, token: null };
  const s = getDb().authSessions.find(x => x.token === token);
  if (!s || new Date(s.expiresAt).getTime() < Date.now()) return { user: null, token: null };
  const user = findUserById(s.userId);
  return user ? { user, token } : { user: null, token: null };
}

/* ═══════════ Kirishni cheklash ═══════════ */

export function loginLocked(email) {
  const db = getDb();
  const rec = db.loginAttempts[String(email || '').toLowerCase()];
  if (!rec) return 0;
  if (rec.until && rec.until > Date.now()) return Math.ceil((rec.until - Date.now()) / 60000);
  return 0;
}

export function noteLoginFailure(email) {
  const db = getDb();
  const key = String(email || '').toLowerCase();
  const rec = db.loginAttempts[key] || { count: 0, until: 0 };
  rec.count++;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.until = Date.now() + LOCK_MINUTES * 60000;
    rec.count = 0;
  }
  db.loginAttempts[key] = rec;
  persist();
}

export function clearLoginFailures(email) {
  const db = getDb();
  delete db.loginAttempts[String(email || '').toLowerCase()];
  persist();
}

/* ═══════════ Ommaviy foydalanuvchi ko'rinishi ═══════════ */

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    color: u.color,
    jobTitle: u.jobTitle || '',
    company: u.company || '',
    timezone: u.timezone || '',
    provider: u.provider,
    hasPassword: !!u.passwordHash,
    linkedProviders: Object.keys(u.providerIds || {}),
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  };
}
