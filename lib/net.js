/**
 * So'rov haqidagi tarmoq ma'lumotlari: ulanish shifrlanganmi va mijoz IP'si.
 *
 * Server odatda nginx yoki Caddy orqasida turadi — u holda haqiqiy protokol va
 * IP faqat sarlavhalarda keladi. Bu sarlavhalarni har kimga ishonib bo'lmaydi
 * (mijoz o'zi yozib yuborishi mumkin), shuning uchun ular faqat TRUST_PROXY
 * yoqilgandagina o'qiladi.
 */
import { TRUST_PROXY } from './paths.js';

/** Ulanish HTTPS ustidanmi */
export function isSecureRequest(req) {
  if (req?.socket?.encrypted) return true;
  if (!TRUST_PROXY) return false;
  const proto = String(req?.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** Mijozning IP manzili — cheklovlar shu bo'yicha hisoblanadi */
export function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req?.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return normalizeIp(fwd);
  }
  return normalizeIp(req?.socket?.remoteAddress || '');
}

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) odatiy ko'rinishga keltiriladi */
function normalizeIp(ip) {
  const s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s || 'nomalum';
}

/** Qurilma nomini brauzer satridan taxminlaymiz — ro'yxatda o'qish uchun */
export function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Noma\'lum qurilma';

  const os =
    /Windows NT 10|Windows NT 11/i.test(ua) ? 'Windows' :
    /Windows/i.test(ua)                     ? 'Windows' :
    /Android/i.test(ua)                     ? 'Android' :
    /iPhone|iPad|iPod/i.test(ua)            ? 'iOS' :
    /Mac OS X/i.test(ua)                    ? 'macOS' :
    /Linux/i.test(ua)                       ? 'Linux' : '';

  const browser =
    /Edg\//i.test(ua)                    ? 'Edge' :
    /OPR\/|Opera/i.test(ua)              ? 'Opera' :
    /YaBrowser/i.test(ua)                ? 'Yandex' :
    /Firefox\//i.test(ua)                ? 'Firefox' :
    /Chrome\//i.test(ua)                 ? 'Chrome' :
    /Safari\//i.test(ua)                 ? 'Safari' : '';

  if (os && browser) return `${browser} · ${os}`;
  return browser || os || 'Noma\'lum qurilma';
}
