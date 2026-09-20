/**
 * Maxfiy kalitlar muhit o'zgaruvchilaridan.
 *
 * Nega kerak: kalit bazada shifrlangan holda tursa ham, shifrlash kaliti
 * (`data/.secret`) o'sha papkada yotadi. Ya'ni `data/` ni nusxalagan odam —
 * zaxira nusxa, disk surati, `data/backups/*.json` — shifrni ham, kalitni
 * ham birga oladi. Muhit o'zgaruvchisida esa kalit umuman diskka tushmaydi.
 *
 * Ustuvorlik: muhit o'zgaruvchisi > bazadagi qiymat.
 * Bazada faqat «yoqilgan/o'chirilgan» bayrog'i qoladi.
 *
 * `.env` fayli Node'ning o'z vositasi bilan o'qiladi (`process.loadEnvFile`),
 * shuning uchun `dotenv` kabi bog'liqlik kerak emas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Bo'sh satr berilmagan bilan barobar */
const env = (name) => {
  const v = process.env[name];
  return v === undefined || String(v).trim() === '' ? null : String(v).trim();
};

/**
 * `.env` ni bir marta o'qiydi. Fayl bo'lmasa jimgina o'tadi —
 * sozlamalarni to'g'ridan-to'g'ri muhitdan berish ham mumkin.
 */
export function loadEnvFile(file = process.env.ENV_FILE || path.join(here, '..', '.env')) {
  try {
    if (!fs.existsSync(file)) return { loaded: false, file };
    process.loadEnvFile(file);
    return { loaded: true, file };
  } catch (err) {
    console.error('  .env o\'qilmadi:', err.message);
    return { loaded: false, file, error: err.message };
  }
}

/* ═══════════ Pochta serveri ═══════════ */

/**
 * SMTP sozlamasining muhitdan keladigan qismi.
 * Berilmagan maydonlar `null` — ularni baza to'ldiradi.
 */
export function envSmtp() {
  const port = env('SMTP_PORT');
  const secure = env('SMTP_SECURE');
  return {
    host: env('SMTP_HOST'),
    port: port === null ? null : Math.min(65535, Math.max(1, Number(port) || 587)),
    // Ko'rsatilmasa 465-port odatda to'g'ridan-to'g'ri TLS bo'ladi
    secure: secure === null
      ? (port !== null && Number(port) === 465 ? true : null)
      : /^(1|true|yes|ha)$/i.test(secure),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('SMTP_FROM')
  };
}

/** Qaysi SMTP maydonlari muhitdan boshqarilyapti — interfeys shuni ko'rsatadi */
export function smtpFromEnv() {
  const e = envSmtp();
  return {
    host: e.host !== null,
    port: e.port !== null,
    secure: e.secure !== null,
    user: e.user !== null,
    pass: e.pass !== null,
    from: e.from !== null,
    any: Object.values(e).some(v => v !== null)
  };
}

/* ═══════════ Kirish usullari ═══════════ */

const OAUTH_ENV = {
  google: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  github: { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' }
};

export function envOauth(provider) {
  const names = OAUTH_ENV[provider];
  if (!names) return { clientId: null, clientSecret: null };
  return { clientId: env(names.id), clientSecret: env(names.secret) };
}

export function oauthFromEnv(provider) {
  const e = envOauth(provider);
  return { clientId: e.clientId !== null, clientSecret: e.clientSecret !== null, any: !!(e.clientId || e.clientSecret) };
}

/* ═══════════ Ilova manzili ═══════════ */

/**
 * Tashqi manzil. Berilsa OAuth qaytish manzili shundan quriladi —
 * proksi orqasida `Host` sarlavhasi haqiqiy domendan farq qilishi mumkin.
 * Berilmasa avvalgidek so'rovning o'zidan aniqlanadi.
 */
export const appBaseUrl = () => {
  const v = env('APP_BASE_URL');
  return v ? v.replace(/\/+$/, '') : null;
};

/* ═══════════ Tashxis ═══════════ */

/**
 * Muhitda berilgan maxfiy kalitlarning **nomlari**.
 * Ishga tushirish jurnalida ko'rsatish uchun — qiymatlar hech qachon
 * qaytarilmaydi, aks holda parol jurnal faylida qolib ketardi.
 */
export function envNames() {
  return [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
    'APP_BASE_URL'
  ].filter((n) => env(n) !== null);
}
