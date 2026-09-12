/**
 * Oddiy, tashqi kutubxonasiz JSON fayl ma'lumotlar bazasi.
 * Yozuv atomik: avval .tmp faylga yoziladi, keyin rename qilinadi.
 * v2 — ko'p foydalanuvchili sxema.
 */
import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR, DB_FILE, TMP_FILE, BACKUP_DIR } from './paths.js';

export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,      // necha pomodorodan keyin uzun tanaffus
  autoStartBreaks: true,     // ish tugagach tanaffus avtomat boshlansinmi
  autoStartWork: true,       // tanaffus tugagach ish avtomat boshlansinmi
  soundEnabled: true,
  volume: 0.6,
  notificationsEnabled: true,
  tickingEnabled: false,
  dayStartTime: '09:00',     // ish kuni boshlanish vaqti (standart)
  dayEndTime: '18:00',       // ish kuni tugash vaqti (standart)
  lunchEnabled: true,        // tushlik tanaffusi hisobga olinsinmi
  lunchStart: '13:00',       // tushlik boshlanishi
  lunchEnd: '14:00',         // tushlik tugashi
  dailyGoal: 8,              // kunlik maqsad (pomodoro)
  theme: 'dark',
  lang: 'uz'
};

/* Vazifa holatlari: reja -> jarayonda -> qabulga -> bajarildi */
export const TASK_STATUSES = ['reja', 'jarayonda', 'qabulga', 'bajarildi'];
export const STATUS_LABELS = {
  reja: 'Rejalashtirilgan',
  jarayonda: 'Jarayonda',
  qabulga: 'Qabul qilishga',
  bajarildi: 'Bajarildi'
};

export const DEFAULT_INTEGRATIONS = {
  notion:     { enabled: false, tokenEnc: null, parentPageId: '', databaseId: '', lastExportAt: null, lastError: null },
  confluence: { enabled: false, baseUrl: '', email: '', tokenEnc: null, spaceKey: '', parentPageId: '', lastExportAt: null, lastError: null },
  jira:       { enabled: false, baseUrl: '', email: '', tokenEnc: null, jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC',
                defaultPomodoros: 2, minutesPerPomodoro: 25, lastImportAt: null, lastError: null }
};

const EMPTY = {
  version: SCHEMA_VERSION,
  users: [],
  authSessions: [],
  loginAttempts: {},
  tasks: [],
  sessions: [],
  dayPlans: [],      // { userId, date, startTime, endTime } — kunlik ish vaqti oralig'i
  timers: {},        // { userId: timer }
  userState: {},     // { userId: { pomodorosSinceLongBreak, lastCycleDate } }
  smtp: null,        // pochta serveri sozlamasi (egasi tomonidan)
  oauth: {
    google: { enabled: false, clientId: '', clientSecretEnc: null },
    github: { enabled: false, clientId: '', clientSecretEnc: null }
  }
};

let db = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** v1 (bitta foydalanuvchi) → v2 (ko'p foydalanuvchi) ko'chirish */
function migrate(parsed) {
  if ((parsed.version || 1) >= SCHEMA_VERSION) return parsed;

  const out = structuredClone(EMPTY);
  out.tasks = (parsed.tasks || []).map(t => ({ ...t, userId: t.userId || 'legacy' }));
  out.sessions = (parsed.sessions || []).map(s => ({ ...s, userId: s.userId || 'legacy' }));
  out.legacySettings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
  if (parsed.state) out.userState.legacy = parsed.state;
  if (parsed.timer) out.timers.legacy = parsed.timer;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    ensureDirs();
    fs.writeFileSync(path.join(BACKUP_DIR, `v1-migratsiya-${stamp}.json`), JSON.stringify(parsed, null, 2), 'utf8');
  } catch { /* zaxira muvaffaqiyatsiz bo'lsa ham davom etamiz */ }

  console.log('[db] v1 -> v2 ko\'chirildi. Eski ma\'lumotlar birinchi ro\'yxatdan o\'tgan foydalanuvchiga biriktiriladi.');
  return out;
}

export function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    db = structuredClone(EMPTY);
    persist();
    return db;
  }
  try {
    const parsed = migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    db = {
      ...structuredClone(EMPTY),
      ...parsed,
      oauth: {
        google: { ...EMPTY.oauth.google, ...(parsed.oauth?.google || {}) },
        github: { ...EMPTY.oauth.github, ...(parsed.oauth?.github || {}) }
      },
      version: SCHEMA_VERSION
    };
    // Tasdiqlash joriy qilinishidan oldingi hisoblar tasdiqlangan hisoblanadi
    for (const u of db.users) {
      if (u.emailVerified === undefined) {
        u.emailVerified = true;
        u.emailVerifiedAt = u.createdAt || new Date().toISOString();
      }
    }
    if (!db.smtp) db.smtp = null;   // sozlanmagunicha bo'sh

    // Eski vazifalarga holat maydonini qo'shamiz
    for (const t of db.tasks) {
      if (!t.status) {
        t.status = t.done ? 'bajarildi'
          : (t.completedPomodoros >= t.plannedPomodoros && t.completedPomodoros > 0) ? 'qabulga'
          : t.completedPomodoros > 0 ? 'jarayonda' : 'reja';
      }
    }
    persist();
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `buzilgan-${stamp}.json`)); } catch {}
    console.error('[db] db.json o\'qib bo\'lmadi, zaxiralandi:', err.message);
    db = structuredClone(EMPTY);
    persist();
  }
  return db;
}

export function getDb() {
  if (!db) load();
  return db;
}

export function persist() {
  ensureDirs();
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);
}

export function commit(fn) {
  const result = fn(getDb());
  persist();
  return result;
}

/* ═══════════ Foydalanuvchi yordamchilari ═══════════ */

export function findUserById(id) {
  return getDb().users.find(u => u.id === id) || null;
}

export function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return getDb().users.find(u => u.emailLower === e) || null;
}

export function userSettings(userId) {
  const u = findUserById(userId);
  return { ...DEFAULT_SETTINGS, ...(u?.settings || {}) };
}

/* ═══════════ Haftalik ish jadvali ═══════════ */

export const WEEKDAYS = [
  { key: 1, short: 'Du', name: 'Dushanba' },
  { key: 2, short: 'Se', name: 'Seshanba' },
  { key: 3, short: 'Ch', name: 'Chorshanba' },
  { key: 4, short: 'Pa', name: 'Payshanba' },
  { key: 5, short: 'Ju', name: 'Juma' },
  { key: 6, short: 'Sh', name: 'Shanba' },
  { key: 0, short: 'Ya', name: 'Yakshanba' }
];

/** Standart: dushanba–juma 09:00–18:00, tushlik 13:00–14:00, dam olish kunlari yopiq */
export function defaultWorkSchedule(start = '09:00', end = '18:00', lunch = {}) {
  const out = {};
  for (const d of WEEKDAYS) {
    out[d.key] = {
      enabled: d.key >= 1 && d.key <= 5,
      start,
      end,
      lunchEnabled: lunch.lunchEnabled !== false,
      lunchStart: lunch.lunchStart || '13:00',
      lunchEnd: lunch.lunchEnd || '14:00'
    };
  }
  return out;
}

export function userWorkSchedule(userId) {
  const u = findUserById(userId);
  const s = userSettings(userId);
  const base = defaultWorkSchedule(s.dayStartTime, s.dayEndTime, s);
  if (!u?.workSchedule) return base;
  const out = {};
  for (const d of WEEKDAYS) {
    out[d.key] = { ...base[d.key], ...(u.workSchedule[d.key] || u.workSchedule[String(d.key)] || {}) };
  }
  return out;
}

const weekdayOf = (date) => new Date(date + 'T12:00:00').getDay();   // 0 = yakshanba

/* ═══════════ Kunlik sozlama ═══════════ */

const DAY_FIELDS = ['startTime', 'endTime', 'workMinutes', 'shortBreakMinutes', 'longBreakMinutes',
  'longBreakInterval', 'lunchEnabled', 'lunchStart', 'lunchEnd'];

/**
 * Shu kun uchun amaldagi to'liq sozlama.
 * Ustuvorlik: kunlik o'zgartirish → haftalik jadval → umumiy sozlama.
 */
export function daySetup(userId, date) {
  const s = userSettings(userId);
  const week = userWorkSchedule(userId);
  const day = week[weekdayOf(date)] || { enabled: true, start: s.dayStartTime, end: s.dayEndTime };
  const rec = getDb().dayPlans.find(d => d.userId === userId && d.date === date) || {};

  const cfg = {
    startTime: rec.startTime || day.start || s.dayStartTime,
    endTime: rec.endTime || day.end || s.dayEndTime,
    workMinutes: rec.workMinutes ?? s.workMinutes,
    shortBreakMinutes: rec.shortBreakMinutes ?? s.shortBreakMinutes,
    longBreakMinutes: rec.longBreakMinutes ?? s.longBreakMinutes,
    longBreakInterval: rec.longBreakInterval ?? s.longBreakInterval,
    lunchEnabled: rec.lunchEnabled ?? day.lunchEnabled ?? s.lunchEnabled,
    lunchStart: rec.lunchStart || day.lunchStart || s.lunchStart,
    lunchEnd: rec.lunchEnd || day.lunchEnd || s.lunchEnd,
    isWorkday: !!day.enabled,
    weekday: weekdayOf(date),
    weekdayName: WEEKDAYS.find(w => w.key === weekdayOf(date))?.name || '',
    custom: DAY_FIELDS.some(f => rec[f] !== undefined && rec[f] !== null),
    overridden: DAY_FIELDS.filter(f => rec[f] !== undefined && rec[f] !== null)
  };
  return cfg;
}

/** Kunlik sozlamani saqlash. patch = null bo'lsa — kunlik o'zgartirish o'chiriladi */
export function setDaySetup(userId, date, patch) {
  const d = getDb();
  const i = d.dayPlans.findIndex(x => x.userId === userId && x.date === date);

  if (patch === null) {
    if (i !== -1) d.dayPlans.splice(i, 1);
    persist();
    return daySetup(userId, date);
  }

  const rec = i === -1 ? { userId, date } : d.dayPlans[i];
  for (const f of DAY_FIELDS) {
    if (patch[f] !== undefined) rec[f] = patch[f];
  }
  if (i === -1) d.dayPlans.push(rec);
  persist();
  return daySetup(userId, date);
}

/** Eskirgan nom — mos kelishi uchun saqlab qo'yilgan */
export const dayWindow = daySetup;

export function userStateOf(userId) {
  const d = getDb();
  if (!d.userState[userId]) d.userState[userId] = { pomodorosSinceLongBreak: 0, lastCycleDate: null };
  return d.userState[userId];
}

/** Birinchi ro'yxatdan o'tgan foydalanuvchiga v1 ma'lumotlarini biriktirish */
export function claimLegacyData(userId) {
  const d = getDb();
  let claimed = 0;
  for (const t of d.tasks) if (t.userId === 'legacy') { t.userId = userId; claimed++; }
  for (const s of d.sessions) if (s.userId === 'legacy') s.userId = userId;
  if (d.userState.legacy) { d.userState[userId] = d.userState.legacy; delete d.userState.legacy; }
  if (d.timers.legacy) { d.timers[userId] = d.timers.legacy; delete d.timers.legacy; }
  if (d.legacySettings) {
    const u = findUserById(userId);
    if (u) u.settings = { ...DEFAULT_SETTINGS, ...d.legacySettings };
    delete d.legacySettings;
  }
  if (claimed) console.log(`[db] ${claimed} ta eski vazifa ${userId} foydalanuvchisiga biriktirildi`);
  return claimed;
}

/* ═══════════ Zaxira ═══════════ */

export function dailyBackup() {
  ensureDirs();
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `db-${day}.json`);
  if (fs.existsSync(file)) return;
  try {
    fs.writeFileSync(file, JSON.stringify(getDb(), null, 2), 'utf8');
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-')).sort();
    while (files.length > 14) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
    }
  } catch (err) {
    console.error('[db] zaxira xatosi:', err.message);
  }
}

export const paths = { DATA_DIR, DB_FILE, BACKUP_DIR };
