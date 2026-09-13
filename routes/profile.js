/** Foydalanuvchi profili va integratsiya sozlamalari */
import { forgetUser } from '../lib/ratelimit.js';
import { getDb, persist, DEFAULT_INTEGRATIONS, userWorkSchedule, WEEKDAYS, defaultWorkSchedule } from '../lib/db.js';
import { checkLunch } from './tasks.js';
import { encryptSecret, decryptSecret, maskSecret, verifyPassword } from '../lib/crypto.js';
import { publicUser, destroyAllSessions, clearCookie } from '../lib/auth.js';
import { str, clamp } from '../lib/util.js';
import { saveAvatar, readAvatar, removeAvatar, MAX_BYTES } from '../lib/avatars.js';

const AVATARS = ['🍅', '🚀', '🎯', '⚡', '🌟', '🦊', '🐼', '🦉', '🌊', '🔥', '🌱', '🎨', '📚', '💼', '🧠', '☕'];
const COLORS = ['#ff5f56', '#4a9eff', '#35c88f', '#f6b73c', '#a77dff', '#ff8a80', '#00bcd4', '#8bc34a'];

function ensureIntegrations(user) {
  if (!user.integrations) user.integrations = structuredClone(DEFAULT_INTEGRATIONS);
  for (const k of Object.keys(DEFAULT_INTEGRATIONS)) {
    user.integrations[k] = { ...DEFAULT_INTEGRATIONS[k], ...(user.integrations[k] || {}) };
  }
  return user.integrations;
}

/* ═══════════ Profil rasmi ═══════════ */

/** Rasmni yuklash — mijoz uni 256x256 ga keltirib yuboradi */
export function uploadAvatar({ user, body }) {
  const res = saveAvatar(user.id, body.image);
  if (!res.ok) return { error: res.error, status: 400 };

  user.photo = { ext: res.ext, version: Date.now() };
  persist();
  return { ok: true, user: publicUser(user) };
}

/** Rasmni olib tashlash — emoji avatarga qaytadi */
export function deleteAvatar({ user }) {
  removeAvatar(user.id);
  delete user.photo;
  persist();
  return { ok: true, user: publicUser(user) };
}

/**
 * Rasmni berish. Tizimga kirgan har qanday foydalanuvchi ko'ra oladi —
 * jamoa ichida bir-birining rasmini ko'rish uchun kerak.
 */
export function getAvatar({ params }) {
  const db = getDb();
  const owner = db.users.find(u => u.id === params.id);
  if (!owner?.photo?.ext) return { error: 'Rasm yo\'q', status: 404 };

  const img = readAvatar(owner.id, owner.photo.ext);
  if (!img) return { error: 'Rasm topilmadi', status: 404 };

  return {
    __raw: {
      inline: true,
      contentType: img.contentType,
      // Manzilda ?v= bor, shuning uchun uzoq keshlash xavfsiz
      cacheControl: 'private, max-age=604800',
      body: img.buffer
    }
  };
}

export const avatarLimitKb = () => MAX_BYTES / 1024;

/* ═══════════ Profil ═══════════ */

export function getProfile({ user }) {
  const db = getDb();
  const myTasks = db.tasks.filter(t => t.userId === user.id);
  const myWork = db.sessions.filter(s => s.userId === user.id && s.mode === 'work' && s.completed);
  const activeDays = new Set(myWork.map(s => s.date));

  return {
    user: publicUser(user),
    avatars: AVATARS,
    colors: COLORS,
    photoMaxKb: MAX_BYTES / 1024,
    stats: {
      totalTasks: myTasks.length,
      doneTasks: myTasks.filter(t => t.done).length,
      totalPomodoros: myWork.length,
      focusHours: Math.round(myWork.reduce((a, s) => a + s.actualSec, 0) / 360) / 10,
      activeDays: activeDays.size,
      memberSince: user.createdAt
    },
    sessions: db.authSessions
      .filter(s => s.userId === user.id)
      .map(s => ({ createdAt: s.createdAt, expiresAt: s.expiresAt, userAgent: s.userAgent }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}

export function updateProfile({ user, body }) {
  if (body.name !== undefined) {
    const n = str(body.name, 80);
    if (!n) return { error: 'Ism bo\'sh bo\'lmasligi kerak', status: 400 };
    user.name = n;
  }
  if (body.jobTitle !== undefined) user.jobTitle = str(body.jobTitle, 100);
  if (body.company !== undefined) user.company = str(body.company, 100);
  if (body.timezone !== undefined) user.timezone = str(body.timezone, 60);
  if (body.avatar !== undefined && AVATARS.includes(body.avatar)) user.avatar = body.avatar;
  if (body.color !== undefined && COLORS.includes(body.color)) user.color = body.color;
  persist();
  return { user: publicUser(user) };
}

export function deleteAccount({ user, body, req }) {
  const db = getDb();
  if (user.passwordHash && !verifyPassword(String(body.password || ''), user.passwordSalt, user.passwordHash)) {
    return { error: 'Parol noto\'g\'ri', status: 401 };
  }
  if (user.role === 'owner' && db.users.filter(u => u.role === 'owner').length === 1 && db.users.length > 1) {
    return { error: 'Tizim egasi hisobini o\'chirishdan oldin boshqa foydalanuvchiga egalik bering', status: 400 };
  }
  db.tasks = db.tasks.filter(t => t.userId !== user.id);
  db.sessions = db.sessions.filter(s => s.userId !== user.id);
  forgetUser(user.id, user.email);
  removeAvatar(user.id);
  db.dayPlans = db.dayPlans.filter(d => d.userId !== user.id);
  delete db.timers[user.id];
  delete db.userState[user.id];
  db.users = db.users.filter(u => u.id !== user.id);
  destroyAllSessions(user.id);
  persist();
  return { ok: true, __cookie: clearCookie(req) };
}

/* ═══════════ Integratsiya sozlamalari ═══════════ */

export function getIntegrations({ user }) {
  const it = ensureIntegrations(user);
  return {
    notion: {
      enabled: it.notion.enabled,
      parentPageId: it.notion.parentPageId,
      databaseId: it.notion.databaseId,
      tokenMask: it.notion.tokenEnc ? maskSecret(decryptSecret(it.notion.tokenEnc)) : '',
      hasToken: !!it.notion.tokenEnc,
      lastExportAt: it.notion.lastExportAt,
      lastError: it.notion.lastError
    },
    confluence: {
      enabled: it.confluence.enabled,
      baseUrl: it.confluence.baseUrl,
      email: it.confluence.email,
      spaceKey: it.confluence.spaceKey,
      parentPageId: it.confluence.parentPageId,
      tokenMask: it.confluence.tokenEnc ? maskSecret(decryptSecret(it.confluence.tokenEnc)) : '',
      hasToken: !!it.confluence.tokenEnc,
      lastExportAt: it.confluence.lastExportAt,
      lastError: it.confluence.lastError
    },
    jira: {
      enabled: it.jira.enabled,
      baseUrl: it.jira.baseUrl,
      email: it.jira.email,
      jql: it.jira.jql,
      defaultPomodoros: it.jira.defaultPomodoros,
      minutesPerPomodoro: it.jira.minutesPerPomodoro,
      tokenMask: it.jira.tokenEnc ? maskSecret(decryptSecret(it.jira.tokenEnc)) : '',
      hasToken: !!it.jira.tokenEnc,
      lastImportAt: it.jira.lastImportAt,
      lastError: it.jira.lastError
    }
  };
}

export function saveIntegration({ user, params, body }) {
  const it = ensureIntegrations(user);
  const name = params.name;
  if (!it[name]) return { error: 'Bunday integratsiya yo\'q', status: 404 };
  const cfg = it[name];

  const setToken = (val) => {
    if (val === undefined || val === '') return;             // o'zgarmasin
    cfg.tokenEnc = val === '__clear__' ? null : encryptSecret(String(val).trim());
  };

  if (name === 'notion') {
    if (body.parentPageId !== undefined) cfg.parentPageId = str(body.parentPageId, 300);
    if (body.databaseId !== undefined) cfg.databaseId = str(body.databaseId, 300);
    setToken(body.token);
  } else if (name === 'confluence') {
    if (body.baseUrl !== undefined) cfg.baseUrl = str(body.baseUrl, 300);
    if (body.email !== undefined) cfg.email = str(body.email, 200);
    if (body.spaceKey !== undefined) cfg.spaceKey = str(body.spaceKey, 60).toUpperCase();
    if (body.parentPageId !== undefined) cfg.parentPageId = str(body.parentPageId, 60);
    setToken(body.token);
  } else if (name === 'jira') {
    if (body.baseUrl !== undefined) cfg.baseUrl = str(body.baseUrl, 300);
    if (body.email !== undefined) cfg.email = str(body.email, 200);
    if (body.jql !== undefined) cfg.jql = str(body.jql, 1000);
    if (body.defaultPomodoros !== undefined) cfg.defaultPomodoros = clamp(body.defaultPomodoros, 1, 20);
    if (body.minutesPerPomodoro !== undefined) cfg.minutesPerPomodoro = clamp(body.minutesPerPomodoro, 5, 120);
    setToken(body.token);
  }
  if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
  cfg.lastError = null;
  persist();
  return getIntegrations({ user });
}

/** Shifrlangan kalitlar ochilgan holdagi konfiguratsiya (faqat server ichida) */
export function resolvedConfig(user, name) {
  const it = ensureIntegrations(user);
  const cfg = it[name];
  if (!cfg) return null;
  return { ...cfg, token: decryptSecret(cfg.tokenEnc) };
}

export function noteIntegrationResult(user, name, { error = null, exportedAt = null, importedAt = null }) {
  const it = ensureIntegrations(user);
  it[name].lastError = error;
  if (exportedAt) it[name].lastExportAt = exportedAt;
  if (importedAt) it[name].lastImportAt = importedAt;
  persist();
}

/* ═══════════ Haftalik ish jadvali ═══════════ */

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t) => String(t).trim().padStart(5, '0');

export function getWorkSchedule({ user }) {
  return {
    schedule: userWorkSchedule(user.id),
    weekdays: WEEKDAYS,
    onboarded: !!user.onboardedAt
  };
}

export function saveWorkSchedule({ user, body }) {
  const incoming = body.schedule;
  if (!incoming || typeof incoming !== 'object') {
    return { error: 'Jadval yuborilmadi', status: 400 };
  }

  const out = {};
  let enabledCount = 0;
  for (const d of WEEKDAYS) {
    const raw = incoming[d.key] ?? incoming[String(d.key)] ?? {};
    const start = pad(str(raw.start, 5) || '09:00');
    const end = pad(str(raw.end, 5) || '18:00');
    if (!HHMM.test(start) || !HHMM.test(end)) {
      return { error: `${d.name} uchun vaqt noto'g'ri kiritilgan`, status: 400 };
    }
    if (start === end) {
      return { error: `${d.name}: boshlanish va tugash vaqti bir xil bo'lmasligi kerak`, status: 400 };
    }
    const enabled = !!raw.enabled;
    if (enabled) enabledCount++;

    // Tushlik — shu kunning ish vaqti ichida bo'lishi shart
    const lunchEnabled = raw.lunchEnabled !== false;
    const lunchStart = pad(str(raw.lunchStart, 5) || '13:00');
    const lunchEnd = pad(str(raw.lunchEnd, 5) || '14:00');
    if (enabled && lunchEnabled) {
      const err = checkLunch(lunchStart, lunchEnd, start, end);
      if (err) return { error: `${d.name}: ${err}`, status: 400 };
    }

    out[d.key] = { enabled, start, end, lunchEnabled, lunchStart, lunchEnd };
  }
  if (!enabledCount) return { error: 'Kamida bitta ish kuni belgilanishi kerak', status: 400 };

  user.workSchedule = out;
  if (body.markOnboarded) user.onboardedAt = new Date().toISOString();
  persist();
  return { schedule: userWorkSchedule(user.id), weekdays: WEEKDAYS, onboarded: !!user.onboardedAt };
}

export { AVATARS, COLORS };
