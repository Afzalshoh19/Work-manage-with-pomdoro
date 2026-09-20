/**
 * Oddiy SMTP mijozi — tashqi kutubxonasiz, faqat `node:net` va `node:tls`.
 *
 * Qo'llab-quvvatlanadi: to'g'ridan-to'g'ri TLS (465-port) va STARTTLS (587-port),
 * AUTH LOGIN / AUTH PLAIN. Gmail, Yandex va odatdagi korporativ serverlar uchun yetarli.
 *
 * SMTP sozlanmagan bo'lsa xat yuborilmaydi — chaqiruvchi buni `sent: false`
 * bo'yicha biladi va kodni boshqa yo'l bilan ko'rsatadi.
 */
import net from 'node:net';
import tls from 'node:tls';
import { getDb, persist } from './db.js';
import { envSmtp, smtpFromEnv } from './secrets.js';
import { encryptSecret, decryptSecret } from './crypto.js';

const TIMEOUT = 15000;

export const DEFAULT_SMTP = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,        // true — 465-portda to'g'ridan-to'g'ri TLS
  user: '',
  passEnc: null,
  from: '',             // "Pomodoro <bot@kompaniya.uz>"; bo'sh bo'lsa user ishlatiladi
  lastError: null,
  lastSentAt: null
};

/**
 * Amaldagi SMTP sozlamasi.
 *
 * Ustuvorlik: muhit o'zgaruvchisi > bazadagi qiymat. Muhitdan kelgan parol
 * bazaga umuman yozilmaydi — u faqat xotirada turadi.
 */
export function smtpConfig() {
  const db = getDb();
  if (!db.smtp) db.smtp = { ...DEFAULT_SMTP };
  const saved = { ...DEFAULT_SMTP, ...db.smtp };
  const e = envSmtp();

  const out = { ...saved };
  for (const k of ['host', 'port', 'secure', 'user', 'from']) {
    if (e[k] !== null) out[k] = e[k];
  }
  // Muhitdagi parol ochiq holda keladi — shifrlangan maydon o'rniga alohida saqlanadi
  out.passPlain = e.pass;
  out.fromEnv = smtpFromEnv();
  return out;
}

/** Amaldagi parol: muhitdan yoki bazadagi shifrdan */
export function smtpPassword() {
  const c = smtpConfig();
  return c.passPlain || decryptSecret(c.passEnc);
}

/**
 * Sozlamani saqlaydi.
 * Muhit o'zgaruvchisi boshqaradigan maydonlar e'tiborga olinmaydi —
 * ularni bazaga yozish faqat chalkashlik tug'dirardi (baribir muhit ustun).
 */
export function saveSmtp(patch) {
  const db = getDb();
  if (!db.smtp) db.smtp = { ...DEFAULT_SMTP };
  const c = db.smtp;
  const env = smtpFromEnv();

  if (patch.host !== undefined && !env.host) c.host = String(patch.host || '').trim();
  if (patch.port !== undefined && !env.port) c.port = Math.min(65535, Math.max(1, Number(patch.port) || 587));
  if (patch.secure !== undefined && !env.secure) c.secure = !!patch.secure;
  if (patch.user !== undefined && !env.user) c.user = String(patch.user || '').trim();
  if (patch.from !== undefined && !env.from) c.from = String(patch.from || '').trim();
  if (patch.enabled !== undefined) c.enabled = !!patch.enabled;
  if (patch.pass && !env.pass) c.passEnc = patch.pass === '__clear__' ? null : encryptSecret(String(patch.pass).trim());
  c.lastError = null;
  persist();
  return smtpConfig();
}

export function smtpReady() {
  const c = smtpConfig();
  return !!(c.enabled && c.host && c.user && (c.passPlain || c.passEnc));
}

/** Sarlavhadagi lotin bo'lmagan belgilar uchun RFC 2047 kodlash */
function encodeHeader(text) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}

/** SMTP suhbatini olib boradigan kichik yordamchi */
function conversation(socket, steps) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
      socket.removeAllListeners('data');
      err ? reject(err) : resolve(val);
    };

    const timer = setTimeout(() => finish(new Error('SMTP javob bermadi (vaqt tugadi)')), TIMEOUT);
    socket.setTimeout(TIMEOUT);
    socket.on('error', (e) => { clearTimeout(timer); finish(e); });
    socket.on('timeout', () => { clearTimeout(timer); finish(new Error('SMTP ulanishi uzildi')); });

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // To'liq javob: oxirgi qator "250 " ko'rinishida (defis emas, bo'shliq)
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || /^\d{3}-/.test(last)) return;

      const code = Number(last.slice(0, 3));
      const text = buf.trim();
      buf = '';

      const step = steps.shift();
      if (!step) { clearTimeout(timer); return finish(null, text); }
      if (!step.expect.includes(code)) {
        clearTimeout(timer);
        return finish(new Error(`SMTP ${code}: ${text.slice(0, 200)}`));
      }
      const next = typeof step.send === 'function' ? step.send(text) : step.send;
      if (next === null) { clearTimeout(timer); return finish(null, text); }
      socket.write(next + '\r\n');
    });
  });
}

/**
 * Xat yuboradi.
 * @returns {Promise<{sent: boolean, error?: string}>}
 */
export async function sendMail({ to, subject, text, html }) {
  const c = smtpConfig();
  if (!smtpReady()) return { sent: false, error: 'SMTP sozlanmagan' };

  const pass = smtpPassword();
  const from = c.from || c.user;
  const fromAddr = /<(.+)>/.exec(from)?.[1] || from;

  const boundary = 'b' + Date.now().toString(36);
  const body = html
    ? [
        `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64', '', Buffer.from(text, 'utf8').toString('base64'),
        `--${boundary}`, 'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64', '', Buffer.from(html, 'utf8').toString('base64'),
        `--${boundary}--`
      ].join('\r\n')
    : ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
       Buffer.from(text, 'utf8').toString('base64')].join('\r\n');

  const message = [
    `From: ${encodeHeader(from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    body
  ].join('\r\n');

  // Nuqta bilan boshlanadigan qatorlar ikkilantiriladi (SMTP talabi)
  const safeMessage = message.replace(/\r\n\./g, '\r\n..');

  const auth = Buffer.from('\0' + c.user + '\0' + pass, 'utf8').toString('base64');
  const host = c.host;

  async function talk(socket, afterTls) {
    const steps = [];
    if (!afterTls) steps.push({ expect: [220], send: `EHLO ${hostName()}` });

    if (!c.secure && !afterTls) {
      // STARTTLS bilan shifrlangan kanalga o'tamiz
      steps.push({ expect: [250], send: 'STARTTLS' });
      steps.push({ expect: [220], send: null });
      await conversation(socket, steps);
      const secured = tls.connect({ socket, servername: host, rejectUnauthorized: true });
      await new Promise((res, rej) => {
        secured.once('secureConnect', res);
        secured.once('error', rej);
      });
      secured.write(`EHLO ${hostName()}\r\n`);
      return talk(secured, true);
    }

    steps.push({ expect: [250], send: 'AUTH PLAIN ' + auth });
    steps.push({ expect: [235], send: `MAIL FROM:<${fromAddr}>` });
    steps.push({ expect: [250], send: `RCPT TO:<${to}>` });
    steps.push({ expect: [250, 251], send: 'DATA' });
    steps.push({ expect: [354], send: safeMessage + '\r\n.' });
    steps.push({ expect: [250], send: 'QUIT' });
    steps.push({ expect: [221], send: null });
    const out = await conversation(socket, steps);
    socket.end();
    return out;
  }

  try {
    const socket = c.secure
      ? tls.connect({ host, port: c.port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port: c.port });

    await new Promise((res, rej) => {
      socket.once(c.secure ? 'secureConnect' : 'connect', res);
      socket.once('error', rej);
    });

    if (c.secure) socket.write(`EHLO ${hostName()}\r\n`);
    await talk(socket, c.secure);

    const db = getDb();
    db.smtp.lastSentAt = new Date().toISOString();
    db.smtp.lastError = null;
    persist();
    return { sent: true };
  } catch (err) {
    const msg = err.message || String(err);
    try {
      const db = getDb();
      if (db.smtp) { db.smtp.lastError = msg; persist(); }
    } catch { /* yozib bo'lmasa ham davom etamiz */ }
    console.error('[mail] yuborilmadi:', msg);
    return { sent: false, error: msg };
  }
}

function hostName() {
  const f = smtpConfig().from || smtpConfig().user || 'localhost';
  return f.split('@')[1] || 'localhost';
}
