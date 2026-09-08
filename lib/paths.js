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

/** HTTPS orqali xizmat qilinayotganda cookie'ga Secure bayrog'i qo'yiladi */
export const SECURE_COOKIES =
  process.env.SECURE_COOKIES === '1' ||
  process.env.SECURE_COOKIES === 'true' ||
  (process.env.SECURE_COOKIES === undefined && process.env.NODE_ENV === 'production');
