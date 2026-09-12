/** Ro'yxatdan o'tish, kirish va OAuth (Google / GitHub) */
import { getDb, persist, findUserByEmail, findUserById, claimLegacyData, DEFAULT_SETTINGS, DEFAULT_INTEGRATIONS, defaultWorkSchedule } from '../lib/db.js';
import { hashPassword, verifyPassword, passwordProblem, randomToken, decryptSecret, encryptSecret } from '../lib/crypto.js';
import {
  createSession, destroySession, destroyAllSessions, sessionCookie, clearCookie,
  publicUser, loginBlocked, noteLoginFailure, clearLoginFailures,
  listSessions, revokeSession
} from '../lib/auth.js';
import { uid, str } from '../lib/util.js';
import { issueCode, checkCode, issueResetCode, checkResetCode, smtpReady } from '../lib/verify.js';
import { smtpConfig, saveSmtp, sendMail } from '../lib/mailer.js';
import { clientIp } from '../lib/net.js';
import { lockedFor, noteFailure, clearFailures, lockMessage } from '../lib/ratelimit.js';
import {
  newSecret, groupSecret, otpauthUri, verifyTotp,
  newBackupCodes, useBackupCode, BACKUP_COUNT, PERIOD, DIGITS
} from '../lib/totp.js';

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
    // Google/GitHub emailni o'zi tasdiqlagan; oddiy ro'yxatdan o'tishda kod yuboriladi
    emailVerified: provider !== 'local',
    emailVerifiedAt: provider !== 'local' ? new Date().toISOString() : null,
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

export async function register({ body, req }) {
  const email = str(body.email, 200);
  const name = str(body.name, 80);
  const password = String(body.password || '');
  const ip = clientIp(req);

  // Bitta tarmoqdan ommaviy hisob ochishga cheklov
  const ipLock = lockedFor('register-ip', ip);
  if (ipLock) return { error: `Juda ko'p hisob ochildi. ${lockMessage(ipLock)}`, status: 429 };

  if (!isEmail(email)) return { error: 'Email manzili noto\'g\'ri', status: 400 };
  if (!name) return { error: 'Ismingizni kiriting', status: 400 };
  const pw = passwordProblem(password);
  if (pw) return { error: pw, status: 400 };
  if (findUserByEmail(email)) return { error: 'Bu email allaqachon ro\'yxatdan o\'tgan', status: 409 };

  noteFailure('register-ip', ip);   // har bir yangi hisob shu IP hisobiga yoziladi
  const user = newUser({ email, name, provider: 'local', password });

  // Pochta serveri sozlanmagan bo'lsa kodni yetkazib bo'lmaydi — bunday holatda
  // tasdiqlash talab qilinmaydi, aks holda hech kim ro'yxatdan o'ta olmaydi.
  if (!smtpReady()) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    persist();
    const token = createSession(user.id, req);
    return { user: publicUser(user), __cookie: sessionCookie(token, req), verificationSkipped: true };
  }

  // Email tasdiqlanmaguncha sessiya ochilmaydi
  const res = await issueCode(user);
  return {
    pendingVerification: true,
    email: user.email,
    sent: !!res.sent,
    smtpReady: smtpReady(),
    message: res.sent
      ? `Tasdiqlash kodi ${user.email} manziliga yuborildi`
      : 'Pochta serveri sozlanmagan — kod server jurnaliga yozildi'
  };
}

/* ═══════════ Email tasdiqlash ═══════════ */

/** Kiritilgan kodni tekshiradi va sessiyani ochadi */
export function verifyEmail({ body, req }) {
  const ip = clientIp(req);
  const ipLock = lockedFor('code-ip', ip);
  if (ipLock) return { error: `Juda ko'p urinish. ${lockMessage(ipLock)}`, status: 429 };

  const email = str(body.email, 200);
  const user = findUserByEmail(email);
  if (!user) return { error: 'Bunday hisob topilmadi', status: 404 };
  if (user.emailVerified) return { error: 'Email allaqachon tasdiqlangan', status: 400 };

  const res = checkCode(user, body.code);
  if (!res.ok) {
    noteFailure('code-ip', ip);
    return { error: res.error, status: 400 };
  }
  clearFailures('code-ip', ip);

  user.lastLoginAt = new Date().toISOString();
  persist();
  const token = createSession(user.id, req);
  return { user: publicUser(user), __cookie: sessionCookie(token, req) };
}

/** Kodni qayta yuborish */
export async function resendCode({ body }) {
  const email = str(body.email, 200);
  const user = findUserByEmail(email);
  // Mavjud bo'lmagan hisob haqida ma'lumot bermaymiz
  if (!user || user.emailVerified) {
    return { ok: true, sent: false, message: 'Agar bunday hisob bo\'lsa, kod yuborildi' };
  }
  const res = await issueCode(user);
  if (!res.ok) return { error: res.error, status: 429 };
  return {
    ok: true,
    sent: !!res.sent,
    smtpReady: smtpReady(),
    message: res.sent ? 'Yangi kod yuborildi' : 'Pochta serveri sozlanmagan — kod server jurnaliga yozildi'
  };
}

/* ═══════════ SMTP sozlamalari (faqat egasi) ═══════════ */

export function getSmtpSettings({ user }) {
  if (user.role !== 'owner') return { error: 'Faqat tizim egasi ko\'ra oladi', status: 403 };
  const c = smtpConfig();
  return {
    enabled: c.enabled, host: c.host, port: c.port, secure: c.secure,
    user: c.user, from: c.from, hasPass: !!c.passEnc,
    ready: smtpReady(), lastError: c.lastError, lastSentAt: c.lastSentAt
  };
}

export function saveSmtpSettings({ user, body }) {
  if (user.role !== 'owner') return { error: 'Faqat tizim egasi o\'zgartira oladi', status: 403 };
  saveSmtp(body || {});
  return getSmtpSettings({ user });
}

/** Sinov xati — sozlash to'g'riligini tekshirish uchun */
export async function testSmtp({ user, body }) {
  if (user.role !== 'owner') return { error: 'Faqat tizim egasi', status: 403 };
  if (!smtpReady()) return { error: 'Avval SMTP ma\'lumotlarini to\'ldiring va yoqing', status: 400 };
  const to = str(body.to, 200) || user.email;
  const res = await sendMail({
    to,
    subject: 'Pomodoro — sinov xati',
    text: 'Bu sinov xati. Agar buni o\'qiyotgan bo\'lsangiz, pochta sozlamasi to\'g\'ri ishlayapti.'
  });
  return res.sent ? { ok: true, to } : { error: res.error || 'Yuborilmadi', status: 502 };
}

export function login({ body, req }) {
  const email = str(body.email, 200);
  const password = String(body.password || '');
  const ip = clientIp(req);

  const blocked = loginBlocked(email, ip);
  if (blocked) return { error: blocked, status: 429 };

  const user = findUserByEmail(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    noteLoginFailure(email, ip);
    return { error: 'Email yoki parol noto\'g\'ri', status: 401 };
  }
  clearLoginFailures(email, ip);

  // Tasdiqlanmagan hisob — kod so'raladi. Pochta sozlanmagan bo'lsa
  // kodni yetkazib bo'lmaydi, shuning uchun to'sib qo'yilmaydi.
  if (user.provider === 'local' && user.emailVerified === false && smtpReady()) {
    return { pendingVerification: true, email: user.email, error: 'Avval emailingizni tasdiqlang', status: 403 };
  }

  // Ikki bosqichli tasdiqlash yoqilgan bo'lsa — sessiya hali ochilmaydi
  if (user.totp?.enabled) {
    return {
      twoFactorRequired: true,
      ticket: newTicket(user.id),
      email: user.email,
      backupLeft: (user.totp.backupHashes || []).length
    };
  }

  return finishLogin(user, req);
}

/** Parol (va kerak bo'lsa 2FA) tekshirilgandan keyingi umumiy qism */
function finishLogin(user, req) {
  user.lastLoginAt = new Date().toISOString();
  persist();
  const token = createSession(user.id, req);
  return { user: publicUser(user), __cookie: sessionCookie(token, req) };
}

export function logout({ authToken, req }) {
  if (authToken) destroySession(authToken);
  return { ok: true, __cookie: clearCookie(req) };
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

/**
 * OAuth oqimidagi `state` bazada saqlanadi.
 * Xotirada tursa, server qayta yuklanganda yoki ikkinchi nusxa ishga
 * tushganda o'sha paytda kirayotgan odam xatolikka uchrardi.
 */
const STATE_TTL_MS = 10 * 60000;

function oauthStates() {
  const db = getDb();
  if (!db.oauthStates || typeof db.oauthStates !== 'object') db.oauthStates = {};
  return db.oauthStates;
}

function cleanPending() {
  const st = oauthStates();
  const now = Date.now();
  let n = 0;
  for (const [k, v] of Object.entries(st)) {
    if (!v?.createdAt || now - v.createdAt > STATE_TTL_MS) { delete st[k]; n++; }
  }
  if (n) persist();
}

function putState(state, provider) {
  oauthStates()[state] = { provider, createdAt: Date.now() };
  persist();
}

/** state bir marta ishlatiladi — o'qilgach darhol o'chiriladi */
function takeState(state) {
  const st = oauthStates();
  const rec = st[String(state || '')];
  if (!rec) return null;
  delete st[String(state)];
  persist();
  if (Date.now() - rec.createdAt > STATE_TTL_MS) return null;
  return rec;
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
  putState(state, provider);

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
  const rec = takeState(query.state);
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
    // OAuth bilan kirganda ham ikki bosqichli tasdiqlash so'raladi
    if (user.totp?.enabled) {
      return { __redirect: '/login.html?twofa=' + encodeURIComponent(newTicket(user.id)) };
    }
    const token = createSession(user.id, req);
    return { __redirect: '/', __cookie: sessionCookie(token, req) };
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


/* ═══════════ Parolni unutdim ═══════════ */

/**
 * Tiklash kodini so'rash.
 * Javob har doim bir xil — bunday email bor-yo'qligini bildirmaydi.
 */
export async function forgotPassword({ body, req }) {
  const email = str(body.email, 200);
  const ip = clientIp(req);

  const ipLock = lockedFor('forgot-ip', ip);
  if (ipLock) return { error: `Juda ko'p so'rov. ${lockMessage(ipLock)}`, status: 429 };
  const mailLock = lockedFor('forgot', email);
  if (mailLock) return { error: `Juda ko'p so'rov. ${lockMessage(mailLock)}`, status: 429 };

  const neutral = {
    ok: true,
    smtpReady: smtpReady(),
    message: smtpReady()
      ? 'Agar bunday hisob mavjud bo\'lsa, tiklash kodi emailga yuborildi'
      : 'Pochta serveri sozlanmagan — kod server jurnaliga yozildi'
  };

  // Hisoblagich hisob bor-yo'qligidan qat'i nazar oshiriladi: aks holda
  // tasodifiy manzillarga cheksiz so'rov yuborib, endpointni charchatish mumkin
  noteFailure('forgot-ip', ip);
  noteFailure('forgot', email);

  const user = findUserByEmail(email);
  if (!user) return neutral;

  // Faqat parol bilan kiradigan hisoblar uchun ma'noga ega
  if (!user.passwordHash && user.provider !== 'local') {
    return {
      ...neutral,
      message: `Bu hisob ${user.provider} orqali ochilgan — o'sha xizmat orqali kiring`
    };
  }

  const res = await issueResetCode(user);
  if (!res.ok) return { error: res.error, status: 429 };
  return neutral;
}

/** Kod bilan yangi parol o'rnatish */
export function resetPassword({ body, req }) {
  const ip = clientIp(req);
  const ipLock = lockedFor('code-ip', ip);
  if (ipLock) return { error: `Juda ko'p urinish. ${lockMessage(ipLock)}`, status: 429 };

  const email = str(body.email, 200);
  const password = String(body.password || '');
  const problem = passwordProblem(password);
  if (problem) return { error: problem, status: 400 };

  const user = findUserByEmail(email);
  if (!user) {
    noteFailure('code-ip', ip);
    return { error: 'Kod yoki email noto\'g\'ri', status: 400 };
  }

  const res = checkResetCode(user, body.code);
  if (!res.ok) {
    noteFailure('code-ip', ip);
    return { error: res.error, status: 400 };
  }
  clearFailures('code-ip', ip);
  clearFailures('login', email);
  clearFailures('login-ip', ip);

  const { salt, hash } = hashPassword(password);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  // Parol tiklangach eski seanslar ishonchsiz — hammasi yopiladi
  destroyAllSessions(user.id);
  // Kodni emailga yetkaza olgan bo'lsak, email egasi ekani tasdiqlangan
  if (!user.emailVerified) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
  }
  user.lastLoginAt = new Date().toISOString();
  persist();

  // 2FA yoqilgan bo'lsa parol yetarli emas
  if (user.totp?.enabled) {
    return {
      passwordChanged: true,
      twoFactorRequired: true,
      ticket: newTicket(user.id),
      email: user.email,
      backupLeft: (user.totp.backupHashes || []).length
    };
  }

  const token = createSession(user.id, req);
  return {
    user: publicUser(user),
    passwordChanged: true,
    message: 'Parol yangilandi. Barcha qurilmalardagi seanslar yopildi.',
    __cookie: sessionCookie(token, req)
  };
}

/* ═══════════ Qurilmalar (ochiq seanslar) ═══════════ */

export function mySessions({ user, authToken }) {
  return { sessions: listSessions(user.id, authToken) };
}

export function revokeMySession({ user, params, authToken }) {
  const res = revokeSession(user.id, params.id, authToken);
  if (res === 'topilmadi') return { error: 'Bunday seans topilmadi', status: 404 };
  if (res === 'joriy') {
    return { error: 'Joriy qurilmani shu yerdan yopib bo\'lmaydi — «Chiqish» tugmasini bosing', status: 400 };
  }
  return { ok: true, sessions: listSessions(user.id, authToken) };
}

/** Joriy qurilmadan tashqari hammasini yopish */
export function revokeOtherSessions({ user, authToken }) {
  const before = listSessions(user.id, authToken).length;
  destroyAllSessions(user.id, authToken);
  const after = listSessions(user.id, authToken).length;
  return { ok: true, closed: before - after, sessions: listSessions(user.id, authToken) };
}

/* ═══════════ Ikki bosqichli tasdiqlash (2FA) ═══════════ */

const TICKET_TTL_MS = 5 * 60000;

function tickets() {
  const db = getDb();
  if (!db.twoFactorPending || typeof db.twoFactorPending !== 'object') db.twoFactorPending = {};
  return db.twoFactorPending;
}

/** Parol to'g'ri, endi kod kutilyapti — shu holat uchun qisqa muddatli chipta */
function newTicket(userId) {
  const t = tickets();
  const now = Date.now();
  for (const [k, v] of Object.entries(t)) if (now - (v?.createdAt || 0) > TICKET_TTL_MS) delete t[k];
  const ticket = randomToken(24);
  t[ticket] = { userId, createdAt: now };
  persist();
  return ticket;
}

function takeTicket(ticket, { consume = true } = {}) {
  const t = tickets();
  const rec = t[String(ticket || '')];
  if (!rec) return null;
  if (Date.now() - rec.createdAt > TICKET_TTL_MS) { delete t[String(ticket)]; persist(); return null; }
  if (consume) { delete t[String(ticket)]; persist(); }
  return rec;
}

/** Kirish jarayonidagi 2FA kodini tekshirish */
export function twoFactorVerify({ body, req }) {
  const ip = clientIp(req);
  const rec = takeTicket(body.ticket, { consume: false });
  if (!rec) return { error: 'Tasdiqlash muddati tugadi — qaytadan kiring', status: 401, code: 'TICKET_EXPIRED' };

  const user = findUserById(rec.userId);
  if (!user?.totp?.enabled) return { error: 'Ikki bosqichli tasdiqlash yoqilmagan', status: 400 };

  const lock = Math.max(lockedFor('twofa', user.id), lockedFor('code-ip', ip));
  if (lock) return { error: `Juda ko'p urinish. ${lockMessage(lock)}`, status: 429 };

  const input = String(body.code || '').trim();
  const result = consumeTwoFactor(user, input);
  if (!result.ok) {
    noteFailure('twofa', user.id);
    noteFailure('code-ip', ip);
    return { error: result.error, status: 401 };
  }

  clearFailures('twofa', user.id);
  clearFailures('code-ip', ip);
  takeTicket(body.ticket);          // chipta ishlatildi
  const out = finishLogin(user, req);
  return { ...out, usedBackupCode: result.backup, backupLeft: result.left };
}

/**
 * TOTP kodini yoki zaxira kodni tekshiradi.
 * Muvaffaqiyatda ishlatilgan oyna/zaxira kod hisobdan chiqariladi.
 */
function consumeTwoFactor(user, input) {
  const t = user.totp;
  const secret = decryptSecret(t.secretEnc);
  if (!secret) return { ok: false, error: 'Kalit o\'qilmadi — 2FA ni qaytadan sozlang' };

  const digits = String(input).replace(/\D/g, '');
  if (digits.length === DIGITS) {
    const r = verifyTotp(secret, digits, { lastStep: t.lastStep ?? null });
    if (r.ok) {
      t.lastStep = r.step;          // shu oyna qayta ishlatilmaydi
      persist();
      return { ok: true, backup: false, left: (t.backupHashes || []).length };
    }
    return { ok: false, error: 'Kod noto\'g\'ri yoki muddati o\'tgan' };
  }

  // Zaxira kod
  const b = useBackupCode(t.backupHashes, input);
  if (b.ok) {
    persist();
    return { ok: true, backup: true, left: b.left };
  }
  return { ok: false, error: 'Kod noto\'g\'ri' };
}

/** 1-qadam: kalit yaratish (hali yoqilmaydi) */
export function twoFactorSetup({ user }) {
  if (user.totp?.enabled) return { error: 'Ikki bosqichli tasdiqlash allaqachon yoqilgan', status: 400 };
  const secret = newSecret();
  user.totp = { enabled: false, secretEnc: encryptSecret(secret), backupHashes: [], lastStep: null };
  persist();
  return {
    secret,
    secretGrouped: groupSecret(secret),
    otpauth: otpauthUri(secret, user.email),
    account: user.email,
    issuer: 'Pomodoro',
    digits: DIGITS,
    period: PERIOD
  };
}

/** 2-qadam: ilovadagi kod bilan tasdiqlash va yoqish */
export function twoFactorEnable({ user, body, authToken }) {
  const t = user.totp;
  if (!t?.secretEnc) return { error: 'Avval «Sozlashni boshlash» tugmasini bosing', status: 400 };
  if (t.enabled) return { error: 'Allaqachon yoqilgan', status: 400 };

  const lock = lockedFor('twofa', user.id);
  if (lock) return { error: `Juda ko'p urinish. ${lockMessage(lock)}`, status: 429 };

  const secret = decryptSecret(t.secretEnc);
  const r = verifyTotp(secret, String(body.code || ''));
  if (!r.ok) {
    noteFailure('twofa', user.id);
    return { error: 'Kod noto\'g\'ri. Telefon soati to\'g\'ri ekanini tekshiring', status: 400 };
  }
  clearFailures('twofa', user.id);

  const { codes, hashes } = newBackupCodes();
  t.enabled = true;
  t.confirmedAt = new Date().toISOString();
  t.backupHashes = hashes;
  t.lastStep = r.step;
  persist();
  // Boshqa qurilmalardagi eski seanslar 2FA'siz ochilgan — yopiladi
  destroyAllSessions(user.id, authToken);

  return {
    ok: true,
    enabled: true,
    backupCodes: codes,
    message: 'Ikki bosqichli tasdiqlash yoqildi. Zaxira kodlarni saqlab qo\'ying — ular boshqa ko\'rsatilmaydi.'
  };
}

/** O'chirish — joriy parol yoki amaldagi kod bilan tasdiqlanadi */
export function twoFactorDisable({ user, body }) {
  if (!user.totp?.enabled) return { error: 'Ikki bosqichli tasdiqlash yoqilmagan', status: 400 };

  const lock = lockedFor('twofa', user.id);
  if (lock) return { error: `Juda ko'p urinish. ${lockMessage(lock)}`, status: 429 };

  const ok = confirmIdentity(user, body);
  if (!ok) {
    noteFailure('twofa', user.id);
    return { error: 'Parol yoki kod noto\'g\'ri', status: 401 };
  }
  clearFailures('twofa', user.id);

  delete user.totp;
  persist();
  return { ok: true, enabled: false, message: 'Ikki bosqichli tasdiqlash o\'chirildi' };
}

/** Zaxira kodlarni yangilash — eskilari darhol kuchini yo'qotadi */
export function twoFactorBackupCodes({ user, body }) {
  if (!user.totp?.enabled) return { error: 'Ikki bosqichli tasdiqlash yoqilmagan', status: 400 };

  const lock = lockedFor('twofa', user.id);
  if (lock) return { error: `Juda ko'p urinish. ${lockMessage(lock)}`, status: 429 };

  if (!confirmIdentity(user, body)) {
    noteFailure('twofa', user.id);
    return { error: 'Parol yoki kod noto\'g\'ri', status: 401 };
  }
  clearFailures('twofa', user.id);

  const { codes, hashes } = newBackupCodes();
  user.totp.backupHashes = hashes;
  persist();
  return {
    ok: true,
    backupCodes: codes,
    count: BACKUP_COUNT,
    message: 'Yangi zaxira kodlar yaratildi. Eskilari endi ishlamaydi.'
  };
}

/** Joriy holat — sozlamalar oynasi uchun */
export function twoFactorStatus({ user }) {
  const t = user.totp;
  const pending = !!(t?.secretEnc && !t.enabled);
  const out = {
    enabled: !!t?.enabled,
    pending,
    confirmedAt: t?.confirmedAt || null,
    backupLeft: t?.enabled ? (t.backupHashes || []).length : 0,
    backupTotal: BACKUP_COUNT
  };

  // Sozlash tugallanmagan bo'lsa kalit egasiga qaytariladi — sahifa
  // yangilangandan keyin ham davom ettirish imkoni bo'lsin.
  // Yoqilgandan keyin kalit boshqa hech qachon berilmaydi.
  if (pending) {
    const secret = decryptSecret(t.secretEnc);
    if (secret) {
      out.secret = secret;
      out.secretGrouped = groupSecret(secret);
      out.otpauth = otpauthUri(secret, user.email);
      out.account = user.email;
      out.digits = DIGITS;
      out.period = PERIOD;
    }
  }
  return out;
}

/** Tugallanmagan sozlashni bekor qiladi */
export function twoFactorCancel({ user }) {
  if (user.totp?.enabled) return { error: 'Yoqilgan tasdiqlashni bekor qilib bo\'lmaydi', status: 400 };
  if (user.totp) { delete user.totp; persist(); }
  return { ok: true, enabled: false, pending: false };
}

/**
 * Nozik amallar uchun shaxsni tasdiqlash: parol yoki amaldagi TOTP kodi.
 * OAuth orqali kirgan, paroli yo'q foydalanuvchilar kod bilan tasdiqlaydi.
 */
function confirmIdentity(user, body) {
  const password = String(body?.password || '');
  if (user.passwordHash && password && verifyPassword(password, user.passwordSalt, user.passwordHash)) return true;

  const code = String(body?.code || '').trim();
  if (code && user.totp?.secretEnc) {
    const secret = decryptSecret(user.totp.secretEnc);
    if (verifyTotp(secret, code).ok) return true;
    if (user.totp.enabled && useBackupCode(user.totp.backupHashes, code).ok) { persist(); return true; }
  }
  return false;
}
