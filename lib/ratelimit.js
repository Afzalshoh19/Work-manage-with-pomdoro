/**
 * Umumiy urinish cheklovchisi.
 *
 * Har bir cheklov "savat" (bucket) va "kalit" juftligi bilan aniqlanadi:
 * `login:email` va `login-ip:1.2.3.4` — alohida hisoblanadi. Shuning uchun
 * bitta IP'dan minglab turli emailga urinish ham, bitta emailga minglab
 * IP'dan urinish ham to'siladi.
 *
 * Hisoblagichlar bazada saqlanadi — server qayta ishga tushsa ham yo'qolmaydi.
 */
import { getDb, persist } from './db.js';

/** Tayyor cheklov qoidalari — bir joyda turgani sozlashni osonlashtiradi */
export const RULES = {
  'login':        { max: 8,  windowSec: 15 * 60, lockSec: 15 * 60 },
  'login-ip':     { max: 30, windowSec: 15 * 60, lockSec: 30 * 60 },
  'register-ip':  { max: 20, windowSec: 60 * 60, lockSec: 60 * 60 },
  'forgot':       { max: 3,  windowSec: 60 * 60, lockSec: 60 * 60 },
  'forgot-ip':    { max: 12, windowSec: 60 * 60, lockSec: 60 * 60 },
  'code-ip':      { max: 20, windowSec: 15 * 60, lockSec: 15 * 60 },
  'twofa':        { max: 6,  windowSec: 15 * 60, lockSec: 15 * 60 }
};

/**
 * IP savati faqat haqiqiy mijoz manzili ma'lum bo'lgandagina ishlaydi.
 * Loopback — bu yo TRUST_PROXY yoqilmagan proksi, yo bitta kompyuterdagi
 * ish: ikkalasida ham IP bo'yicha ajratish ma'nosiz, hisob bo'yicha
 * cheklovlar esa o'z kuchida qoladi.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', 'nomalum', '']);
const isIpBucket = (bucket) => String(bucket).endsWith('-ip');
const skip = (bucket, key) => isIpBucket(bucket) && LOOPBACK.has(String(key || '').toLowerCase());

const store = () => {
  const db = getDb();
  if (!db.rateLimits || typeof db.rateLimits !== 'object') db.rateLimits = {};
  return db.rateLimits;
};

const keyOf = (bucket, key) => `${bucket}:${String(key || '').toLowerCase()}`;

/**
 * Cheklov holatini tekshiradi — hisoblagichga tegmaydi.
 * @returns {number} qulf tugashiga qolgan soniya (0 — ochiq)
 */
export function lockedFor(bucket, key) {
  if (skip(bucket, key)) return 0;
  const rec = store()[keyOf(bucket, key)];
  if (!rec?.until) return 0;
  const left = rec.until - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Qulf tugashiga qolgan vaqtni odam o'qiydigan ko'rinishda beradi */
export function lockMessage(seconds) {
  if (seconds <= 90) return `${seconds} soniyadan keyin qayta urining`;
  return `${Math.ceil(seconds / 60)} daqiqadan keyin qayta urining`;
}

/**
 * Muvaffaqiyatsiz urinishni yozadi. Chegaradan oshsa — qulflaydi.
 * @returns {number} qulflangan bo'lsa qolgan soniya, aks holda 0
 */
export function noteFailure(bucket, key) {
  const rule = RULES[bucket];
  if (!rule || skip(bucket, key)) return 0;

  const s = store();
  const k = keyOf(bucket, key);
  const now = Date.now();
  let rec = s[k];

  // Oyna tugagan bo'lsa hisob noldan boshlanadi
  if (!rec || (rec.first && now - rec.first > rule.windowSec * 1000 && !(rec.until > now))) {
    rec = { count: 0, first: now, until: 0 };
  }
  rec.count++;
  if (rec.count >= rule.max) {
    rec.until = now + rule.lockSec * 1000;
    rec.count = 0;
    rec.first = now;
  }
  s[k] = rec;
  persist();
  return rec.until > now ? Math.ceil((rec.until - now) / 1000) : 0;
}

/** Muvaffaqiyatli amaldan keyin hisobni tozalaydi */
export function clearFailures(bucket, key) {
  const s = store();
  const k = keyOf(bucket, key);
  if (s[k]) { delete s[k]; persist(); }
}

/**
 * Bir nechta cheklovni birdan tekshiradi.
 * @param {Array<[string, string]>} pairs — [bucket, key] juftliklari
 * @returns {{locked: boolean, seconds: number, bucket: string|null}}
 */
export function checkAll(pairs) {
  for (const [bucket, key] of pairs) {
    const sec = lockedFor(bucket, key);
    if (sec) return { locked: true, seconds: sec, bucket };
  }
  return { locked: false, seconds: 0, bucket: null };
}

/** Bir nechta savatga birdan xato yozadi */
export function noteAll(pairs) {
  let worst = 0;
  for (const [bucket, key] of pairs) worst = Math.max(worst, noteFailure(bucket, key));
  return worst;
}

/** Bir nechta savatni birdan tozalaydi */
export function clearAll(pairs) {
  for (const [bucket, key] of pairs) clearFailures(bucket, key);
}

/** Eskirgan yozuvlarni olib tashlaydi — baza shishib ketmasin */
export function sweep() {
  const db = getDb();
  const s = store();
  const now = Date.now();
  let removed = 0;

  for (const [k, rec] of Object.entries(s)) {
    const dead = (!rec.until || rec.until < now) &&
                 (!rec.first || now - rec.first > 24 * 3600 * 1000);
    if (dead) { delete s[k]; removed++; }
  }

  // Muddati o'tgan OAuth va 2FA holatlari
  for (const [k, v] of Object.entries(db.oauthStates || {})) {
    if (!v?.createdAt || now - v.createdAt > 10 * 60000) { delete db.oauthStates[k]; removed++; }
  }
  for (const [k, v] of Object.entries(db.twoFactorPending || {})) {
    if (!v?.createdAt || now - v.createdAt > 5 * 60000) { delete db.twoFactorPending[k]; removed++; }
  }

  if (removed) persist();
  return removed;
}

/** Hisob o'chirilganda unga tegishli barcha qoldiqlarni olib tashlaydi */
export function forgetUser(userId, email) {
  const db = getDb();
  const s = store();
  let n = 0;

  const mail = String(email || '').toLowerCase();
  for (const k of Object.keys(s)) {
    if (mail && k.endsWith(':' + mail)) { delete s[k]; n++; }
    if (k === 'twofa:' + String(userId).toLowerCase()) { delete s[k]; n++; }
  }
  for (const [k, v] of Object.entries(db.twoFactorPending || {})) {
    if (v?.userId === userId) { delete db.twoFactorPending[k]; n++; }
  }
  if (n) persist();
  return n;
}
