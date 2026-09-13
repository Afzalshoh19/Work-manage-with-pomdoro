/**
 * Ish kartasi — profildagi «Umumiy» bo'limining yuqori qismi.
 *
 * Hozirgi holat, kun chizig'i, bugungi yuklama va seriya bir joyda
 * hisoblanadi. Jamoa qo'shilganda aynan shu ma'lumot hamkasblarga
 * ko'rinadigan bo'ladi, shuning uchun mantiq alohida modulda turibdi.
 */
import { getDb, daySetup, userWorkSchedule } from './db.js';
import { isMeet } from '../routes/tasks.js';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':');
  return (+h || 0) * 60 + (+m || 0);
};
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min) % 60)}`;

/** Mahalliy sana — server va foydalanuvchi bir vaqt mintaqasida deb olinadi */
const dateStr = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const shiftDate = (date, days) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateStr(d);
};

/* ═══════════ Holat ═══════════ */

export const STATUS = {
  ishlayapti:  { label: 'Ishlayapti',            tone: 'work' },
  pauzada:     { label: 'Pauzada',               tone: 'pause' },
  tanaffus:    { label: 'Tanaffusda',            tone: 'break' },
  uchrashuv:   { label: 'Uchrashuvda',           tone: 'meet' },
  tushlik:     { label: 'Tushlikda',             tone: 'lunch' },
  bosh:        { label: 'Ish vaqtida, bo\'sh',   tone: 'idle' },
  tashqarida:  { label: 'Ish vaqtidan tashqari', tone: 'off' }
};

/**
 * Hozirgi holatni taymer va ish jadvalidan aniqlaydi.
 * Taymer ustuvor: ishlayotgan odam tushlik vaqtida ham "ishlayapti".
 */
function currentStatus(userId, setup, nowMin, date) {
  const db = getDb();
  const t = db.timers[userId];

  if (t) {
    const task = t.taskId ? db.tasks.find(x => x.id === t.taskId && x.userId === userId) : null;
    const paused = t.status === 'paused';
    const elapsed = t.elapsedSec + (t.status === 'running' ? (Date.now() - t.segmentStart) / 1000 : 0);
    const left = Math.max(0, Math.round(t.durationSec - elapsed));

    let key;
    if (paused) key = 'pauzada';
    else if (t.mode !== 'work') key = 'tanaffus';
    else if (task && isMeet(task.category)) key = 'uchrashuv';
    else key = 'ishlayapti';

    return { key, taskTitle: task?.title || '', remainingSec: left, mode: t.mode };
  }

  if (!setup.isWorkday) return { key: 'tashqarida', taskTitle: '', remainingSec: null, mode: null };

  const start = toMin(setup.startTime);
  const end = toMin(setup.endTime);
  const inWork = nowMin >= start && nowMin < end;
  if (!inWork) return { key: 'tashqarida', taskTitle: '', remainingSec: null, mode: null };

  if (setup.lunchEnabled) {
    const ls = toMin(setup.lunchStart), le = toMin(setup.lunchEnd);
    if (nowMin >= ls && nowMin < le) {
      return { key: 'tushlik', taskTitle: '', remainingSec: (le - nowMin) * 60, mode: null };
    }
  }
  return { key: 'bosh', taskTitle: '', remainingSec: null, mode: null };
}

/* ═══════════ Seriya ═══════════ */

/**
 * Ketma-ket ish kunlari.
 *
 * Dam olish kunlari seriyani uzmaydi — ular shunchaki o'tkazib yuboriladi.
 * Bugun hali pomodoro qilinmagan bo'lsa ham seriya uzilmaydi: hisob
 * kechagi kundan boshlanadi, aks holda har kuni ertalab nol ko'rinardi.
 */
export function streakOf(userId, today = dateStr()) {
  const db = getDb();
  const week = userWorkSchedule(userId);
  const weekday = (d) => new Date(d + 'T12:00:00').getDay();
  const isWorkday = (d) => !!week[weekday(d)]?.enabled;

  const active = new Set(
    db.sessions
      .filter(s => s.userId === userId && s.mode === 'work' && s.completed)
      .map(s => s.date)
  );

  let current = 0;
  let day = active.has(today) ? today : shiftDate(today, -1);

  // Bir yildan uzoq orqaga qaramaymiz — bu yetarli va tez
  for (let i = 0; i < 400; i++) {
    if (!isWorkday(day)) { day = shiftDate(day, -1); continue; }
    if (!active.has(day)) break;
    current++;
    day = shiftDate(day, -1);
  }

  // Eng uzun seriya — barcha faol kunlar bo'yicha
  const sorted = [...active].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    if (prev === null) { run = 1; }
    else {
      // Oradagi kunlar faqat dam olish bo'lsa seriya davom etadi
      let gapOk = true;
      let x = shiftDate(prev, 1);
      let guard = 0;
      while (x !== d && guard++ < 31) {
        if (isWorkday(x)) { gapOk = false; break; }
        x = shiftDate(x, 1);
      }
      run = gapOk ? run + 1 : 1;
    }
    best = Math.max(best, run);
    prev = d;
  }

  return { current, best: Math.max(best, current) };
}

/* ═══════════ Karta ═══════════ */

export function workCard(userId, today = dateStr()) {
  const db = getDb();
  const setup = daySetup(userId, today);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const myTasks = db.tasks.filter(t => t.userId === userId && t.date === today);
  const planned = myTasks.reduce((a, t) => a + (t.meetStart ? 0 : (t.plannedPomodoros || 0)), 0);
  const done = myTasks.reduce((a, t) => a + (t.completedPomodoros || 0), 0);

  const todaySessions = db.sessions.filter(s => s.userId === userId && s.date === today && s.mode === 'work');
  const focusSec = todaySessions.reduce((a, s) => a + (s.actualSec || 0), 0);

  const allWork = db.sessions.filter(s => s.userId === userId && s.mode === 'work' && s.completed);

  const status = currentStatus(userId, setup, nowMin, today);

  return {
    date: today,
    status: { ...status, ...STATUS[status.key] },

    day: {
      isWorkday: setup.isWorkday,
      weekdayName: setup.weekdayName,
      start: setup.startTime,
      end: setup.endTime,
      startMin: toMin(setup.startTime),
      endMin: toMin(setup.endTime),
      lunchEnabled: !!setup.lunchEnabled,
      lunchStart: setup.lunchStart,
      lunchEnd: setup.lunchEnd,
      lunchStartMin: toMin(setup.lunchStart),
      lunchEndMin: toMin(setup.lunchEnd),
      nowMin,
      now: toHHMM(nowMin)
    },

    today: {
      plannedPomodoros: planned,
      donePomodoros: done,
      tasks: myTasks.length,
      doneTasks: myTasks.filter(t => (t.status || (t.done ? 'bajarildi' : 'reja')) === 'bajarildi').length,
      focusMinutes: Math.round(focusSec / 60)
    },

    streak: streakOf(userId, today),

    totals: {
      pomodoros: allWork.length,
      focusHours: Math.round(allWork.reduce((a, s) => a + (s.actualSec || 0), 0) / 360) / 10,
      activeDays: new Set(allWork.map(s => s.date)).size
    }
  };
}
