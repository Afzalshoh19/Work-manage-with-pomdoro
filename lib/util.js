import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function todayLocal(offsetMinutes = new Date().getTimezoneOffset()) {
  const d = new Date(Date.now() - offsetMinutes * 60000);
  return d.toISOString().slice(0, 10);
}

export function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function str(v, max = 500) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max).trim();
}

/** "09:00" -> 540 daqiqa */
export function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return 9 * 60;
  return clamp(+m[1], 0, 23) * 60 + clamp(+m[2], 0, 59);
}

/** 540 -> "09:00" (24 soatdan oshsa keyingi kunga o'tadi) */
export function minutesToTime(mins) {
  const total = Math.round(mins);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
