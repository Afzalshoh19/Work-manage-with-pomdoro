/**
 * Vazifaga haqiqatda bajarilgan pomodorolarni biriktirish.
 *
 * Foydalanuvchi vazifalarni ro'yxatdagi tartib bilan emas, almashtirib
 * bajarishi mumkin. Shuning uchun jadval rejadan emas, seans yozuvlaridan
 * quriladi: har bir pomodoroning o'z boshlanish va tugash vaqti bor.
 *
 * Vazifa oralig'i = birinchi pomodoro boshlanishi ... oxirgisining tugashi.
 * Pomodorolar davomiyliklari yig'indisi esa oraliqdan mustaqil — u o'zgarmaydi.
 */
import { getDb } from './db.js';

/** ISO vaqtni kun boshidan hisoblangan daqiqaga aylantiradi */
export function minutesOfDay(iso, baseDate) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let m = d.getHours() * 60 + d.getMinutes();
  // Yarim tundan oshgan seans keyingi kunga tegishli — kun o'qida davom etadi
  const dayStr = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (baseDate && dayStr > baseDate) m += 1440;
  return m;
}

/**
 * Pauzalarni soniyadan daqiqaga o'tkazadi. Har birini alohida yaxlitlash
 * jamini buzadi (3 ta 40 soniya = 0 daqiqa), shuning uchun eng katta qoldiq
 * usuli bilan taqsimlaymiz — yig'indi umumiy daqiqaga aniq teng chiqadi.
 */
export function splitPauseMinutes(pauses, totalMinutes) {
  const list = (pauses || []).filter(p => p && p.seconds > 0);
  if (!list.length || totalMinutes <= 0) return [];

  const totalSec = list.reduce((a, p) => a + p.seconds, 0);
  const shares = list.map(p => {
    const exact = (p.seconds / totalSec) * totalMinutes;
    const whole = Math.floor(exact);
    return { index: p.index ?? 0, count: p.count || 1, minutes: whole, rest: exact - whole };
  });

  let left = totalMinutes - shares.reduce((a, s) => a + s.minutes, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    s.minutes++;
    left--;
  }
  return shares.map(({ index, count, minutes }) => ({ index, count, minutes }));
}

/** Vazifaning bajarilgan pomodorolari, vaqti bo'yicha tartiblangan */
export function donePomodorosOf(userId, taskId, date) {
  return getDb().sessions
    .filter(s => s.userId === userId && s.taskId === taskId && s.mode === 'work' && s.completed)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .map(s => {
      const startMin = minutesOfDay(s.startedAt, date);
      if (startMin === null) return null;
      const minutes = Math.max(1, Math.round(s.actualSec / 60));
      return {
        startMin,
        endMin: startMin + minutes,
        minutes,
        startIso: s.startedAt,
        endIso: s.endedAt,
        manual: !!s.manual,
        reasonLabel: s.reasonLabel || ''
      };
    })
    .filter(Boolean);
}

/** Jadval hisoblagichi uchun vazifani tayyorlaydi */
export function withActuals(task, date) {
  const total = Math.round((task.pausedSeconds || 0) / 60);
  const out = {
    ...task,
    pausedMinutes: total,
    pauseList: splitPauseMinutes(task.pauses, total),
    donePomodoros: donePomodorosOf(task.userId, task.id, date)
  };
  if (task.startedAt) {
    const mins = minutesOfDay(task.startedAt, date);
    const d = new Date(task.startedAt);
    if (mins !== null && d.toISOString().slice(0, 10) <= date) out.actualStartMinutes = mins;
  }
  return out;
}
