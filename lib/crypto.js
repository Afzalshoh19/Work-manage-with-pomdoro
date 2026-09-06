/**
 * Parol xeshlash, sessiya tokenlari va integratsiya kalitlarini shifrlash.
 * Faqat Node.js standart `node:crypto` moduli ishlatiladi.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '..', 'data', '.secret');

let KEY = null;

/** Server maxfiy kaliti — birinchi ishga tushishda yaratiladi */
function key() {
  if (KEY) return KEY;
  const dir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    KEY = Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
    if (KEY.length !== 32) KEY = null;
  }
  if (!KEY) {
    KEY = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, KEY.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  }
  return KEY;
}

/* ═══════════ Parol ═══════════ */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const test = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    const known = Buffer.from(hash, 'hex');
    return test.length === known.length && crypto.timingSafeEqual(test, known);
  } catch {
    return false;
  }
}

/** Parol talablari */
export function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < 8) return 'Parol kamida 8 ta belgidan iborat bo\'lishi kerak';
  if (!/[a-zA-Z]/.test(p)) return 'Parolda kamida bitta harf bo\'lishi kerak';
  if (!/[0-9]/.test(p)) return 'Parolda kamida bitta raqam bo\'lishi kerak';
  if (p.length > 200) return 'Parol juda uzun';
  return null;
}

/* ═══════════ Tokenlar ═══════════ */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/* ═══════════ Integratsiya kalitlarini shifrlash ═══════════ */

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, dataHex] = String(payload).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Interfeysda ko'rsatish uchun niqoblangan ko'rinish */
export function maskSecret(plain) {
  if (!plain) return '';
  const s = String(plain);
  if (s.length <= 8) return '••••••••';
  return s.slice(0, 4) + '••••••••' + s.slice(-4);
}
