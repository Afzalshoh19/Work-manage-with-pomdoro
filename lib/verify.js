/**
 * Bir martalik kodlar: emailni tasdiqlash va parolni tiklash.
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

/* ═══════════ Umumiy mexanizm ═══════════ */

/**
 * Foydalanuvchiga yangi kod yozadi va xat yuboradi.
 * @param {object} user
 * @param {string} field — kod saqlanadigan maydon nomi
 * @param {(code:string)=>{subject:string,text:string,html:string}} compose
 */
async function issue(user, field, compose, tag) {
  const now = Date.now();
  const prev = user[field];

  // Juda tez-tez so'ralmasin
  if (prev?.sentAt && now - prev.sentAt < RESEND_WAIT_SEC * 1000) {
    const wait = Math.ceil((RESEND_WAIT_SEC * 1000 - (now - prev.sentAt)) / 1000);
    return { ok: false, wait, error: `Yangi kod ${wait} soniyadan keyin so'ralsin` };
  }

  const code = newCode();
  user[field] = {
    codeHash: hash(code),
    expiresAt: now + CODE_TTL_MIN * 60000,
    sentAt: now,
    attempts: 0
  };
  persist();

  const mail = compose(code);
  const res = await sendMail({ to: user.email, ...mail });

  // SMTP sozlanmagan bo'lsa kodni logga chiqaramiz — tizim baribir ishlaydi
  if (!res.sent) {
    console.log(`\n  [${tag}] ${user.email} uchun kod: ${code}  (${res.error})\n`);
  }
  return { ok: true, sent: res.sent, error: res.error || null };
}

/**
 * Kiritilgan kodni tekshiradi. To'g'ri bo'lsa kod o'chiriladi.
 * @returns {{ok: boolean, error?: string}}
 */
function check(user, field, input) {
  const v = user[field];
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

  delete user[field];
  persist();
  return { ok: true };
}

/* ═══════════ Emailni tasdiqlash ═══════════ */

export function issueCode(user) {
  return issue(user, 'emailVerify', (code) => ({
    subject: `Tasdiqlash kodi: ${code}`,
    text: [
      `Assalomu alaykum, ${user.name}!`,
      '',
      `Pomodoro tizimida emailingizni tasdiqlash kodi: ${code}`,
      '',
      `Kod ${CODE_TTL_MIN} daqiqa amal qiladi.`,
      "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang."
    ].join('\n'),
    html: codeMail({
      name: user.name,
      lead: 'Pomodoro tizimida emailingizni tasdiqlash kodi:',
      code,
      foot: `Kod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.`
    })
  }), 'tasdiqlash');
}

export function checkCode(user, input) {
  const res = check(user, 'emailVerify', input);
  if (res.ok) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    persist();
  }
  return res;
}

/* ═══════════ Parolni tiklash ═══════════ */

export function issueResetCode(user) {
  return issue(user, 'passwordReset', (code) => ({
    subject: `Parolni tiklash kodi: ${code}`,
    text: [
      `Assalomu alaykum, ${user.name}!`,
      '',
      `Pomodoro tizimida parolni tiklash kodi: ${code}`,
      '',
      `Kod ${CODE_TTL_MIN} daqiqa amal qiladi.`,
      "Agar parolni tiklashni siz so'ramagan bo'lsangiz, bu xatga e'tibor bermang —",
      'parolingiz o\'zgarmaydi.'
    ].join('\n'),
    html: codeMail({
      name: user.name,
      lead: 'Pomodoro tizimida parolni tiklash kodi:',
      code,
      foot: `Kod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar parolni tiklashni siz so'ramagan bo'lsangiz, ` +
            'bu xatga e\'tibor bermang — parolingiz o\'zgarmaydi.'
    })
  }), 'parol tiklash');
}

export const checkResetCode = (user, input) => check(user, 'passwordReset', input);

/* ═══════════ Xat qolipi ═══════════ */

function codeMail({ name, lead, code, foot }) {
  return `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:420px">
    <p>Assalomu alaykum, <b>${escapeHtml(name)}</b>!</p>
    <p>${escapeHtml(lead)}</p>
    <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
    <p style="color:#666;font-size:13px">${escapeHtml(foot)}</p>
  </div>`;
}

export { smtpReady };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
