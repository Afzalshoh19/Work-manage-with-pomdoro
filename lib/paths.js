/**
 * Ma'lumotlar papkasi bitta joydan aniqlanadi.
 *
 * Deploy qilishda ma'lumotlar odatda alohida diskda (volume) turadi —
 * shuning uchun yo'l DATA_DIR muhit o'zgaruvchisi orqali o'zgartiriladi.
 * Berilmasa, loyiha yonidagi `data/` papkasi ishlatiladi.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(here, '..', 'data');

export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const TMP_FILE = path.join(DATA_DIR, 'db.tmp.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const SECRET_FILE = path.join(DATA_DIR, '.secret');

const flag = (name, fallback = false) => {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
};

/**
 * Cookie'ga Secure bayrog'ini majburan qo'yish.
 * Odatda kerak emas: ulanish HTTPS ekani so'rovning o'zidan aniqlanadi
 * (lib/net.js). Bu o'zgaruvchi faqat majburlash uchun.
 */
export const SECURE_COOKIES = flag('SECURE_COOKIES', process.env.NODE_ENV === 'production');

/**
 * Server teskari proksi (nginx, Caddy, Traefik) orqasida turganda
 * X-Forwarded-Proto va X-Forwarded-For sarlavhalariga ishoniladi.
 * To'g'ridan-to'g'ri internetga chiqarilgan serverda YOQILMASIN —
 * aks holda mijoz o'z IP'sini o'zi yozib, cheklovlarni aylanib o'tadi.
 */
export const TRUST_PROXY = flag('TRUST_PROXY', false);

/** O'z sertifikati bilan HTTPS: TLS_KEY va TLS_CERT — fayl yo'llari */
export const TLS_KEY = process.env.TLS_KEY || '';
export const TLS_CERT = process.env.TLS_CERT || '';
export const TLS_CA = process.env.TLS_CA || '';
export const TLS_ENABLED = !!(TLS_KEY && TLS_CERT);

/** HTTP bilan kelganlarni HTTPS'ga yo'naltirish va HSTS sarlavhasi */
export const FORCE_HTTPS = flag('FORCE_HTTPS', TLS_ENABLED);
export const HSTS_DAYS = Number(process.env.HSTS_DAYS || 180);
