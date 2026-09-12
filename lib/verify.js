/**
 * Email tasdiqlash: 6 xonali kod yaratish, yuborish va tekshirish.
 *
 * Kod ochiq saqlanmaydi — faqat xeshi yoziladi. Urinishlar soni va
 * amal qilish muddati cheklangan, qayta yuborishda kutish vaqti bor.
 */
import crypto from 'node:crypto';
import { getDb, persist } from './db.js';
import { sendMail, smtpReady } from './mailer.js';

export const CODE_TTL_MIN = 15;      // kod necha daqiqa amal qiladi
export const MAX_ATTEMPTS = 5;       // necha marta xato kiritish mumkin
export const RESEND_WAIT_SEC = 60;   // qayta yuborishgacha kutish

const hash = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Foydalanuvchiga yangi kod yaratib, xat yuboradi */
export async function issueCode(user) {
  const now = Date.now();
  const prev = user.emailVerify;

  // Juda tez-tez so'ralmasin
  if (prev?.sentAt && now - prev.sentAt < RESEND_WAIT_SEC * 1000) {
    const wait = Math.ceil((RESEND_WAIT_SEC * 1000 - (now - prev.sentAt)) / 1000);
    return { ok: false, wait, error: `Yangi kod ${wait} soniyadan keyin so'ralsin` };
  }

  const code = newCode();
  user.emailVerify = {
    codeHash: hash(code),
    expiresAt: now + CODE_TTL_MIN * 60000,
    sentAt: now,
    attempts: 0
  };
  persist();

  const text = [
    `Assalomu alaykum, ${user.name}!`,
    '',
    `Pomodoro tizimida emailingizni tasdiqlash kodi: ${code}`,
    '',
    `Kod ${CODE_TTL_MIN} daqiqa amal qiladi.`,
    "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang."
  ].join('\n');

  const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:420px">
    <p>Assalomu alaykum, <b>${escapeHtml(user.name)}</b>!</p>
    <p>Pomodoro tizimida emailingizni tasdiqlash kodi:</p>
    <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
    <p style="color:#666;font-size:13px">Kod ${CODE_TTL_MIN} daqiqa amal qiladi.
    Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.</p>
  </div>`;

  const res = await sendMail({
    to: user.email,
    subject: `Tasdiqlash kodi: ${code}`,
    text, html
  });

  // SMTP sozlanmagan bo'lsa kodni logga chiqaramiz — tizim baribir ishlaydi
  if (!res.sent) {
    console.log(`\n  [tasdiqlash] ${user.email} uchun kod: ${code}  (${res.error})\n`);
  }
  return { ok: true, sent: res.sent, error: res.error || null };
}

/** Kiritilgan kodni tekshiradi */
export function checkCode(user, input) {
  const v = user.emailVerify;
  if (!v?.codeHash) return { ok: false, error: 'Avval kod so\'rang' };
  if (Date.now() > v.expiresAt) return { ok: false, error: 'Kod muddati tugagan — yangisini so\'rang' };
  if (v.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Juda ko\'p xato urinish — yangi kod so\'rang' };

  const given = String(input || '').replace(/\D/g, '');
  if (given.length !== 6 || hash(given) !== v.codeHash) {
    v.attempts++;
    persist();
    const left = Math.max(0, MAX_ATTEMPTS - v.attempts);
    return { ok: false, error: left ? `Kod noto'g'ri — ${left} ta urinish qoldi` : 'Urinishlar tugadi, yangi kod so\'rang' };
  }

  user.emailVerified = true;
  user.emailVerifiedAt = new Date().toISOString();
  delete user.emailVerify;
  persist();
  return { ok: true };
}

export { smtpReady };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
