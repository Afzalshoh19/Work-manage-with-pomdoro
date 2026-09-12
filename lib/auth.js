/** Sessiyalar, cookie'lar, qurilmalar ro'yxati va kirishni cheklash */
import crypto from 'node:crypto';
import { getDb, persist, findUserById } from './db.js';
import { randomToken } from './crypto.js';
import { SECURE_COOKIES } from './paths.js';
import { isSecureRequest, clientIp, describeDevice } from './net.js';
import { lockedFor, noteAll, clearAll, lockMessage } from './ratelimit.js';

export const COOKIE = 'pmd_sid';
const SESSION_DAYS = 30;
/** lastSeenAt shu oraliqdan tez-tez yangilanmaydi — har so'rovda yozish qimmat */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

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

/** Shu so'rov uchun Secure bayrog'i kerakmi */
const wantSecure = (req) => SECURE_COOKIES || isSecureRequest(req);

export function sessionCookie(token, req = null, maxAgeSec = SESSION_DAYS * 86400) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  // Shifrlangan ulanishda cookie faqat HTTPS orqali qaytariladi
  if (wantSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookie = (req = null) =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (wantSecure(req) ? '; Secure' : '');

export function createSession(userId, req) {
  const db = getDb();
  const token = randomToken(32);
  const now = Date.now();
  const ua = String(req?.headers['user-agent'] || '').slice(0, 200);
  db.authSessions.push({
    // Token maxfiy — ro'yxatda ko'rsatish va o'chirish uchun alohida ochiq id
    id: crypto.randomUUID(),
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString(),
    userAgent: ua,
    device: describeDevice(ua),
    ip: clientIp(req)
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
  if (!user) return { user: null, token: null };
  touchSession(s, req);
  return { user, token };
}

/** Sessiyaning oxirgi faolligini belgilaydi — qurilmalar ro'yxati uchun */
function touchSession(s, req) {
  const now = Date.now();
  const last = s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0;
  if (now - last < TOUCH_EVERY_MS) return;
  s.lastSeenAt = new Date(now).toISOString();
  const ip = clientIp(req);
  if (ip) s.ip = ip;
  if (!s.id) s.id = crypto.randomUUID();
  if (!s.device) s.device = describeDevice(s.userAgent);
  persist();
}

/* ═══════════ Qurilmalar ro'yxati ═══════════ */

/** Foydalanuvchining ochiq seanslari — token hech qachon qaytarilmaydi */
export function listSessions(userId, currentToken = null) {
  const now = Date.now();
  return getDb().authSessions
    .filter(s => s.userId === userId && new Date(s.expiresAt).getTime() > now)
    .map(s => ({
      id: s.id || null,
      device: s.device || describeDevice(s.userAgent),
      userAgent: s.userAgent || '',
      ip: s.ip || '',
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt || s.createdAt,
      expiresAt: s.expiresAt,
      current: !!currentToken && s.token === currentToken
    }))
    .sort((x, y) => new Date(y.lastSeenAt) - new Date(x.lastSeenAt));
}

/**
 * Bitta seansni yopadi.
 * @returns {'ok'|'topilmadi'|'joriy'}
 */
export function revokeSession(userId, sessionId, currentToken = null) {
  const db = getDb();
  const s = db.authSessions.find(x => x.userId === userId && x.id === sessionId);
  if (!s) return 'topilmadi';
  if (currentToken && s.token === currentToken) return 'joriy';
  db.authSessions = db.authSessions.filter(x => x !== s);
  persist();
  return 'ok';
}

/* ═══════════ Kirishni cheklash ═══════════
   Hisob ham, IP ham alohida sanaladi: bitta IP'dan ko'p emailga urinish
   ham, bitta emailga ko'p IP'dan urinish ham to'siladi. */

const loginKeys = (email, ip) => [['login', email], ['login-ip', ip]];

/** Qulflangan bo'lsa xabar matnini qaytaradi, aks holda null */
export function loginBlocked(email, ip) {
  const byEmail = lockedFor('login', email);
  const byIp = lockedFor('login-ip', ip);
  const sec = Math.max(byEmail, byIp);
  if (!sec) return null;
  return byIp > byEmail
    ? `Bu tarmoqdan juda ko'p urinish bo'ldi. ${lockMessage(sec)}`
    : `Juda ko'p urinish. ${lockMessage(sec)}`;
}

export const noteLoginFailure = (email, ip) => noteAll(loginKeys(email, ip));
export const clearLoginFailures = (email, ip) => clearAll(loginKeys(email, ip));

/** Eski nom — moslik uchun qoldirildi (daqiqada qaytaradi) */
export function loginLocked(email) {
  const sec = lockedFor('login', email);
  return sec ? Math.ceil(sec / 60) : 0;
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
    twoFactor: !!u.totp?.enabled,
    backupCodesLeft: u.totp?.enabled ? (u.totp.backupHashes || []).length : 0,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  };
}
