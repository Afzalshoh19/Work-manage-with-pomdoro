/** Ro'yxatdan o'tish, kirish va OAuth (Google / GitHub) */
import { getDb, persist, findUserByEmail, findUserById, claimLegacyData, DEFAULT_SETTINGS, DEFAULT_INTEGRATIONS, defaultWorkSchedule } from '../lib/db.js';
import { hashPassword, verifyPassword, passwordProblem, randomToken, decryptSecret, encryptSecret } from '../lib/crypto.js';
import {
  createSession, destroySession, destroyAllSessions, sessionCookie, clearCookie,
  publicUser, loginLocked, noteLoginFailure, clearLoginFailures
} from '../lib/auth.js';
import { uid, str } from '../lib/util.js';

const EMOJI = ['🍅', '🚀', '🎯', '⚡', '🌟', '🦊', '🐼', '🦉', '🌊', '🔥', '🌱', '🎨'];
const COLORS = ['#ff5f56', '#4a9eff', '#35c88f', '#f6b73c', '#a77dff', '#ff8a80'];

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());

/* ═══════════ Foydalanuvchi yaratish ═══════════ */

function newUser({ email, name, provider, providerId, password }) {
  const db = getDb();
  const isFirst = db.users.length === 0;
  const user = {
    id: uid(),
    email: String(email).trim(),
    emailLower: String(email).trim().toLowerCase(),
    name: str(name, 80) || String(email).split('@')[0],
    avatar: EMOJI[db.users.length % EMOJI.length],
    color: COLORS[db.users.length % COLORS.length],
    jobTitle: '',
    company: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    provider,
    providerIds: providerId ? { [provider]: String(providerId) } : {},
    passwordHash: null,
    passwordSalt: null,
    role: isFirst ? 'owner' : 'user',
    settings: { ...DEFAULT_SETTINGS },
    workSchedule: defaultWorkSchedule(),
    onboardedAt: null,
    integrations: structuredClone(DEFAULT_INTEGRATIONS),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };
  if (password) {
    const { salt, hash } = hashPassword(password);
    user.passwordSalt = salt;
    user.passwordHash = hash;
  }
  db.users.push(user);
  if (isFirst) claimLegacyData(user.id);
  persist();
  return user;
}

/* ═══════════ Email + parol ═══════════ */

export function register({ body, req }) {
  const email = str(body.email, 200);
  const name = str(body.name, 80);
  const password = String(body.password || '');

  if (!isEmail(email)) return { error: 'Email manzili noto\'g\'ri', status: 400 };
  if (!name) return { error: 'Ismingizni kiriting', status: 400 };
  const pw = passwordProblem(password);
  if (pw) return { error: pw, status: 400 };
  if (findUserByEmail(email)) return { error: 'Bu email allaqachon ro\'yxatdan o\'tgan', status: 409 };

  const user = newUser({ email, name, provider: 'local', password });
  const token = createSession(user.id, req);
  return { user: publicUser(user), __cookie: sessionCookie(token) };
}

export function login({ body, req }) {
  const email = str(body.email, 200);
  const password = String(body.password || '');

  const lockedFor = loginLocked(email);
  if (lockedFor) return { error: `Juda ko'p urinish. ${lockedFor} daqiqadan keyin qayta urining`, status: 429 };

  const user = findUserByEmail(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    noteLoginFailure(email);
    return { error: 'Email yoki parol noto\'g\'ri', status: 401 };
  }
  clearLoginFailures(email);
  user.lastLoginAt = new Date().toISOString();
  persist();
  const token = createSession(user.id, req);
  return { user: publicUser(user), __cookie: sessionCookie(token) };
}

export function logout({ authToken }) {
  if (authToken) destroySession(authToken);
  return { ok: true, __cookie: clearCookie() };
}

export function me({ user }) {
  if (!user) return { user: null };
  return {
    user: publicUser(user),
    settings: { ...DEFAULT_SETTINGS, ...(user.settings || {}) },
    onboarded: !!user.onboardedAt
  };
}

export function changePassword({ user, body, authToken }) {
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  const problem = passwordProblem(next);
  if (problem) return { error: problem, status: 400 };

  if (user.passwordHash && !verifyPassword(current, user.passwordSalt, user.passwordHash)) {
    return { error: 'Joriy parol noto\'g\'ri', status: 401 };
  }
  const { salt, hash } = hashPassword(next);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  persist();
  destroyAllSessions(user.id, authToken);
  return { ok: true, message: 'Parol yangilandi. Boshqa qurilmalardagi seanslar yopildi.' };
}

/* ═══════════ OAuth ═══════════ */

const pending = new Map();   // state -> { provider, createdAt, redirect }

function cleanPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > 10 * 60000) pending.delete(k);
}

const PROVIDERS = {
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async profile(accessToken) {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (!r.ok) throw new Error('Google profilini olishda xato (' + r.status + ')');
      const p = await r.json();
      return { id: p.sub, email: p.email, name: p.name || p.given_name, verified: p.email_verified };
    }
  },
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(accessToken) {
      const h = { Authorization: 'Bearer ' + accessToken, Accept: 'application/vnd.github+json', 'User-Agent': 'pomodoro-app' };
      const r = await fetch('https://api.github.com/user', { headers: h });
      if (!r.ok) throw new Error('GitHub profilini olishda xato (' + r.status + ')');
      const p = await r.json();
      let email = p.email;
      if (!email) {
        const re = await fetch('https://api.github.com/user/emails', { headers: h });
        if (re.ok) {
          const list = await re.json();
          email = (list.find(e => e.primary && e.verified) || list.find(e => e.verified) || list[0])?.email;
        }
      }
      return { id: String(p.id), email, name: p.name || p.login, verified: true };
    }
  }
};

/** Qaysi kirish usullari yoqilgan */
export function authConfig() {
  const db = getDb();
  return {
    providers: {
      google: { enabled: !!(db.oauth.google.enabled && db.oauth.google.clientId), name: 'Google' },
      github: { enabled: !!(db.oauth.github.enabled && db.oauth.github.clientId), name: 'GitHub' }
    },
    hasUsers: db.users.length > 0
  };
}

function redirectUri(req, provider) {
  const host = req.headers.host || '127.0.0.1:4123';
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${host}/api/auth/callback/${provider}`;
}

export function oauthStart({ params, req }) {
  const provider = params.provider;
  const cfg = PROVIDERS[provider];
  const db = getDb();
  const conf = db.oauth[provider];
  if (!cfg || !conf?.enabled || !conf.clientId) {
    return { error: `${cfg?.name || provider} orqali kirish sozlanmagan`, status: 400 };
  }
  cleanPending();
  const state = randomToken(16);
  pending.set(state, { provider, createdAt: Date.now() });

  const url = new URL(cfg.authUrl);
  url.searchParams.set('client_id', conf.clientId);
  url.searchParams.set('redirect_uri', redirectUri(req, provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  if (provider === 'google') {
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }
  return { __redirect: url.toString() };
}

export async function oauthCallback({ params, query, req }) {
  const provider = params.provider;
  const cfg = PROVIDERS[provider];
  const fail = (msg) => ({ __redirect: '/login.html?error=' + encodeURIComponent(msg) });

  if (!cfg) return fail('Noma\'lum provayder');
  if (query.error) return fail(`${cfg.name}: ${query.error}`);
  const rec = pending.get(query.state);
  pending.delete(query.state);
  if (!rec || rec.provider !== provider) return fail('Sessiya eskirgan, qaytadan urining');
  if (!query.code) return fail('Kod olinmadi');

  const db = getDb();
  const conf = db.oauth[provider];
  const clientSecret = decryptSecret(conf.clientSecretEnc);
  if (!conf.clientId || !clientSecret) return fail(`${cfg.name} sozlamalari to'liq emas`);

  try {
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: conf.clientId,
        client_secret: clientSecret,
        code: query.code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(req, provider)
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return fail(`${cfg.name} token xatosi: ${tokenData.error_description || tokenData.error || tokenRes.status}`);
    }

    const profile = await cfg.profile(tokenData.access_token);
    if (!profile.email) return fail(`${cfg.name} hisobingizda ochiq email topilmadi`);

    let user = getDb().users.find(u => u.providerIds?.[provider] === profile.id) || findUserByEmail(profile.email);
    if (user) {
      user.providerIds = { ...(user.providerIds || {}), [provider]: profile.id };
      user.lastLoginAt = new Date().toISOString();
      persist();
    } else {
      user = newUser({ email: profile.email, name: profile.name, provider, providerId: profile.id });
    }
    const token = createSession(user.id, req);
    return { __redirect: '/', __cookie: sessionCookie(token) };
  } catch (err) {
    return fail(err.message || 'OAuth xatosi');
  }
}

/* ═══════════ OAuth sozlamalari (faqat egasi) ═══════════ */

export function getOauthSettings({ user }) {
  if (user.role !== 'owner') return { error: 'Faqat tizim egasi o\'zgartira oladi', status: 403 };
  const db = getDb();
  const view = (p) => ({
    enabled: !!db.oauth[p].enabled,
    clientId: db.oauth[p].clientId || '',
    hasSecret: !!db.oauth[p].clientSecretEnc
  });
  return { google: view('google'), github: view('github') };
}

export function saveOauthSettings({ user, body, req }) {
  if (user.role !== 'owner') return { error: 'Faqat tizim egasi o\'zgartira oladi', status: 403 };
  const db = getDb();
  const provider = body.provider === 'github' ? 'github' : 'google';
  const conf = db.oauth[provider];

  if (body.clientId !== undefined) conf.clientId = str(body.clientId, 300);
  if (body.clientSecret) {
    // Bo'sh qoldirilsa eskisi saqlanadi; "__clear__" — o'chirish
    conf.clientSecretEnc = body.clientSecret === '__clear__' ? null : encryptSecret(String(body.clientSecret).trim());
  }
  if (body.enabled !== undefined) conf.enabled = !!body.enabled;
  persist();
  return { ...getOauthSettings({ user }), redirectUri: redirectUri(req, provider) };
}
