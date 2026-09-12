/**
 * Ikki bosqichli tasdiqlash — TOTP (RFC 6238).
 *
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password —
 * hammasi shu standartda ishlaydi: 30 soniyalik oyna, HMAC-SHA1, 6 xona.
 * Tashqi kutubxona kerak emas, hammasi `node:crypto` ustida.
 */
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PERIOD = 30;      // bir kod necha soniya amal qiladi
export const DIGITS = 6;
export const WINDOW = 1;       // oldingi/keyingi oynaga ham ruxsat (soat farqi uchun)

/* ═══════════ Base32 ═══════════ */

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ═══════════ Kod hisoblash ═══════════ */

/** Hisoblagich asosidagi kod — HOTP (RFC 4226) */
export function hotp(secretBuf, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 4294967296), 0);
  msg.writeUInt32BE(counter >>> 0, 4);

  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin =
    ((h[off] & 0x7f) << 24) |
    ((h[off + 1] & 0xff) << 16) |
    ((h[off + 2] & 0xff) << 8) |
    (h[off + 3] & 0xff);

  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Vaqt asosidagi kod */
export function totp(secretBase32, atMs = Date.now(), digits = DIGITS) {
  const step = Math.floor(atMs / 1000 / PERIOD);
  return hotp(base32Decode(secretBase32), step, digits);
}

/**
 * Kiritilgan kodni tekshiradi.
 * Bir marta ishlatilgan oyna qayta qabul qilinmasligi uchun mos kelgan
 * qadam raqami qaytariladi — chaqiruvchi uni saqlab, takrorni to'sadi.
 * @returns {{ok: boolean, step: number|null}}
 */
export function verifyTotp(secretBase32, code, { atMs = Date.now(), window = WINDOW, lastStep = null } = {}) {
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== DIGITS) return { ok: false, step: null };

  const secret = base32Decode(secretBase32);
  if (!secret.length) return { ok: false, step: null };

  const now = Math.floor(atMs / 1000 / PERIOD);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (lastStep !== null && step <= lastStep) continue;   // takroriy kod
    const expect = hotp(secret, step);
    // Vaqt bo'yicha farq qilmaydigan solishtirish
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(given))) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: null };
}

/* ═══════════ Sozlash ═══════════ */

/** Yangi maxfiy kalit — 20 bayt (160 bit), standart tavsiya */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

/** Kalitni qo'lda kiritish uchun 4 talab bo'lib ajratamiz */
export const groupSecret = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();

/** Authenticator ilovasi o'qiydigan manzil */
export function otpauthUri(secretBase32, account, issuer = 'Pomodoro') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD)
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* ═══════════ Zaxira kodlar ═══════════ */

export const BACKUP_COUNT = 10;
const backupHash = (code) =>
  crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/** Telefon yo'qolganda kirish uchun bir martalik kodlar */
export function newBackupCodes(count = BACKUP_COUNT) {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // chalkashadiganlari (O/0, I/1) yo'q
  const codes = [];
  for (let i = 0; i < count; i++) {
    let c = '';
    for (let j = 0; j < 10; j++) c += ALPHA[crypto.randomInt(0, ALPHA.length)];
    codes.push(c.slice(0, 5) + '-' + c.slice(5));
  }
  return { codes, hashes: codes.map(backupHash) };
}

/**
 * Zaxira kodni tekshiradi va ishlatilganini ro'yxatdan o'chiradi.
 * @returns {{ok: boolean, left: number}}
 */
export function useBackupCode(hashes, code) {
  const h = backupHash(code);
  const i = (hashes || []).indexOf(h);
  if (i === -1) return { ok: false, left: (hashes || []).length };
  hashes.splice(i, 1);
  return { ok: true, left: hashes.length };
}
