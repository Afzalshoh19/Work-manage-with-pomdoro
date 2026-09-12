import { getDb, persist, userSettings, userStateOf, daySetup } from '../lib/db.js';
import { uid, isDate, clamp } from '../lib/util.js';
import { isMeet } from './tasks.js';

/** Uchrashuv davomiyligi (daqiqa) — tanaffus chiqarilgan holda */
function meetMinutes(task) {
  if (!task?.meetStart || !task?.meetEnd) return null;
  const m = (t) => { const [h, x] = String(t).split(':'); return (+h || 0) * 60 + (+x || 0); };
  let d = m(task.meetEnd) - m(task.meetStart);
  if (d <= 0) d += 1440;
  const br = task.meetBreak;
  if (br?.enabled && br.minutes > 0 && br.minutes < d) d -= br.minutes;
  return d > 0 ? d : null;
}

const MODES = ['work', 'short', 'long'];

function modeMinutes(mode, s) {
  if (mode === 'short') return s.shortBreakMinutes;
  if (mode === 'long') return s.longBreakMinutes;
  return s.workMinutes;
}

function elapsedOf(timer) {
  if (!timer) return 0;
  const running = timer.status === 'running' ? (Date.now() - timer.segmentStart) / 1000 : 0;
  return Math.max(0, timer.elapsedSec + running);
}

/** Jamlangan pauza vaqti — davom etayotgan pauza ham qo'shiladi */
function pausedOf(timer) {
  if (!timer) return 0;
  const ongoing = timer.status === 'paused' && timer.pauseStart ? (Date.now() - timer.pauseStart) / 1000 : 0;
  return Math.max(0, (timer.pausedSec || 0) + ongoing);
}

/**
 * Pauzani vazifaga yozadi: jami vaqt + qaysi pomodoroda bo'lgani.
 * Indeks tufayli jadvalda pauza aynan o'sha pomodorodan keyin ko'rinadi.
 */
function creditPause(db, userId, timer, seconds) {
  if (!(seconds > 0) || !timer.taskId) return false;
  const task = db.tasks.find(t => t.id === timer.taskId && t.userId === userId);
  if (!task) return false;

  const idx = Math.max(0, timer.pomodoroIndex || 0);
  if (!Array.isArray(task.pauses)) task.pauses = [];
  const rec = task.pauses.find(p => p.index === idx);
  if (rec) {
    rec.seconds += seconds;
    rec.count = (rec.count || 1) + 1;
  } else {
    task.pauses.push({ index: idx, seconds, count: 1, at: new Date().toISOString() });
  }
  task.pausedSeconds = task.pauses.reduce((a, p) => a + p.seconds, 0);
  return true;
}

export function snapshot(userId) {
  const db = getDb();
  const t = db.timers[userId] || null;
  const state = userStateOf(userId);
  if (!t) {
    return { timer: null, serverTime: Date.now(), cycle: state.pomodorosSinceLongBreak, nextMode: 'work' };
  }
  const elapsed = elapsedOf(t);
  return {
    timer: {
      id: t.id,
      mode: t.mode,
      taskId: t.taskId,
      taskTitle: t.taskTitle,
      status: t.status,
      durationSec: t.durationSec,
      elapsedSec: Math.round(elapsed),
      remainingSec: Math.max(0, Math.round(t.durationSec - elapsed)),
      pausedSec: Math.round(pausedOf(t)),
      pauseCount: t.pauseCount || 0,
      startedAtIso: t.startedAtIso
    },
    serverTime: Date.now(),
    cycle: state.pomodorosSinceLongBreak,
    nextMode: t.mode
  };
}

function rollCycleIfNewDay(userId, date) {
  const state = userStateOf(userId);
  if (state.lastCycleDate !== date) {
    state.lastCycleDate = date;
    state.pomodorosSinceLongBreak = 0;
  }
}

export function getTimer({ user }) {
  return snapshot(user.id);
}

export function startTimer({ body, user }) {
  const db = getDb();
  const settings = userSettings(user.id);
  const mode = MODES.includes(body.mode) ? body.mode : 'work';
  const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  rollCycleIfNewDay(user.id, date);

  let taskId = null, taskTitle = '', pomodoroIndex = 0;
  if (mode === 'work' && body.taskId) {
    const task = db.tasks.find(t => t.id === body.taskId && t.userId === user.id);
    // Bajarilgan vazifa ustida ishlashni boshlab bo'lmaydi — avval qayta ochilishi kerak
    if (task && task.status === 'bajarildi') {
      return { error: 'Bajarilgan vazifa ustida ishlab bo\'lmaydi. Avval «Qayta ochish» (↩) tugmasini bosing.', status: 409 };
    }
    if (task) {
      taskId = task.id;
      taskTitle = task.title;
      // Ish boshlangani bilan vazifa "jarayonda" holatiga o'tadi
      if (task.status === 'reja' || !task.status) task.status = 'jarayonda';
      // Birinchi marta ▶ bosilgan haqiqiy vaqt — jadval shunga qarab qayta hisoblanadi
      if (!task.startedAt) task.startedAt = new Date().toISOString();
      // Nechanchi pomodoro ustida ishlanyapti — pauza aynan shu blokdan keyin ko'rsatiladi
      pomodoroIndex = Math.max(0, task.completedPomodoros || 0);
    }
  }

  // Davomiylik shu kunning sozlamasidan olinadi (kunlik o'zgartirish bo'lsa — undan).
  // Uchrashuvda esa pomodoro emas — uchrashuvning o'z davomiyligi ishlatiladi.
  const setup = daySetup(user.id, date);
  const meetTask = taskId ? db.tasks.find(t => t.id === taskId && t.userId === user.id) : null;
  const meetLen = mode === 'work' && meetTask && isMeet(meetTask.category) ? meetMinutes(meetTask) : null;
  const minutes = body.durationMinutes !== undefined
    ? clamp(body.durationMinutes, 1, 720)
    : (meetLen ?? modeMinutes(mode, setup));

  db.timers[user.id] = {
    id: uid(),
    mode,
    date,
    taskId,
    taskTitle,
    pomodoroIndex,
    durationSec: Math.round(minutes * 60),
    elapsedSec: 0,
    pausedSec: 0,
    pauseStart: null,
    pauseCount: 0,
    pausedCommitted: 0,
    segmentStart: Date.now(),
    startedAtIso: new Date().toISOString(),
    status: 'running'
  };
  persist();
  return snapshot(user.id);
}

export function pauseTimer({ user }) {
  const db = getDb();
  const t = db.timers[user.id];
  if (!t || t.status !== 'running') return { error: 'Ishlayotgan taymer yo\'q', status: 400 };
  t.elapsedSec = elapsedOf(t);
  t.status = 'paused';
  t.pauseStart = Date.now();                 // pauza vaqti shu paytdan sanaladi
  t.pauseCount = (t.pauseCount || 0) + 1;
  persist();
  return snapshot(user.id);
}

export function resumeTimer({ user }) {
  const db = getDb();
  const t = db.timers[user.id];
  if (!t || t.status !== 'paused') return { error: 'Pauzadagi taymer yo\'q', status: 400 };
  // Pauzada turgan vaqt jamlanadi va darhol vazifaga yoziladi —
  // shunda jadval pomodoro tugashini kutmasdan suriladi
  if (t.pauseStart) {
    const seg = (Date.now() - t.pauseStart) / 1000;
    t.pausedSec = (t.pausedSec || 0) + seg;
    if (creditPause(db, user.id, t, seg)) {
      t.pausedCommitted = (t.pausedCommitted || 0) + seg;     // ikki marta sanalmasin
    }
  }
  t.pauseStart = null;
  t.segmentStart = Date.now();
  t.status = 'running';
  persist();
  return snapshot(user.id);
}

function recordSession(db, userId, timer, { completed }) {
  const elapsed = Math.round(elapsedOf(timer));
  const paused = Math.round(pausedOf(timer));
  db.sessions.push({
    id: uid(),
    userId,
    date: timer.date,
    mode: timer.mode,
    taskId: timer.taskId,
    taskTitle: timer.taskTitle,
    plannedSec: timer.durationSec,
    actualSec: elapsed,
    pausedSec: paused,
    pauseCount: timer.pauseCount || 0,
    completed,
    startedAt: timer.startedAtIso,
    endedAt: new Date().toISOString()
  });
  // Hali yozilmagan pauza qoldig'i (oxirgi pauzadan resume qilinmagan bo'lsa)
  creditPause(db, userId, timer, Math.round(paused - (timer.pausedCommitted || 0)));
  return elapsed;
}

/** Taymer to'liq tugadi */
export function completeTimer({ user }) {
  const db = getDb();
  const timer = db.timers[user.id];
  if (!timer) return { error: 'Faol taymer yo\'q', status: 400 };
  const settings = userSettings(user.id);
  const state = userStateOf(user.id);

  const elapsed = recordSession(db, user.id, timer, { completed: true });

  if (timer.mode === 'work') {
    const t0 = db.tasks.find(t => t.id === timer.taskId && t.userId === user.id);
    // Uchrashuv pomodoro siklini surmaydi
    if (!t0 || !isMeet(t0.category)) {
      state.pomodorosSinceLongBreak = (state.pomodorosSinceLongBreak || 0) + 1;
    }
    const task = t0;
    if (task) {
      task.completedPomodoros = (task.completedPomodoros || 0) + 1;
      task.focusSeconds = (task.focusSeconds || 0) + elapsed;
      // Holat avtomatik: jarayonda -> hamma pomodoro bajarilsa "qabul qilishga".
      // "Bajarildi" holatiga faqat foydalanuvchi o'tkazadi.
      if (task.status !== 'bajarildi') {
        task.status = (task.completedPomodoros >= task.plannedPomodoros) ? 'qabulga' : 'jarayonda';
        task.done = false;
      }
    }
  }

  const setup = daySetup(user.id, timer.date);
  const interval = Math.max(1, setup.longBreakInterval);
  const doneTask = db.tasks.find(t => t.id === timer.taskId && t.userId === user.id);
  const wasMeet = !!doneTask && isMeet(doneTask.category);

  let nextMode = 'work';
  if (timer.mode === 'work' && !wasMeet) {
    nextMode = (state.pomodorosSinceLongBreak % interval === 0) ? 'long' : 'short';
  }
  delete db.timers[user.id];
  persist();

  // Uchrashuvdan keyin tanaffus avtomatik boshlanmaydi
  const auto = wasMeet ? false
    : timer.mode === 'work' ? settings.autoStartBreaks : settings.autoStartWork;
  return {
    ...snapshot(user.id),
    finishedMode: timer.mode,
    nextMode,
    nextMinutes: modeMinutes(nextMode, setup),
    autoStart: !!auto
  };
}

/** Bekor qilish */
export function stopTimer({ user }) {
  const db = getDb();
  const timer = db.timers[user.id];
  if (!timer) return { error: 'Faol taymer yo\'q', status: 400 };
  const elapsed = Math.round(elapsedOf(timer));
  const paused = Math.round(pausedOf(timer));
  if (timer.mode === 'work' && elapsed >= 60) {
    recordSession(db, user.id, timer, { completed: false });
    const task = db.tasks.find(t => t.id === timer.taskId && t.userId === user.id);
    if (task) task.focusSeconds = (task.focusSeconds || 0) + elapsed;
  } else if (timer.mode === 'work') {
    // Seans juda qisqa — lekin pauzada o'tgan vaqt haqiqatda ketgan
    creditPause(db, user.id, timer, Math.round(paused - (timer.pausedCommitted || 0)));
  }
  delete db.timers[user.id];
  persist();
  return { ...snapshot(user.id), finishedMode: timer.mode, nextMode: 'work', autoStart: false };
}

/** Tanaffusni o'tkazib yuborish */
export function skipTimer({ user }) {
  const db = getDb();
  const timer = db.timers[user.id];
  if (!timer) return { error: 'Faol taymer yo\'q', status: 400 };
  delete db.timers[user.id];
  persist();
  return { ...snapshot(user.id), finishedMode: timer.mode, nextMode: 'work', autoStart: false };
}

export function resetCycle({ user }) {
  const state = userStateOf(user.id);
  state.pomodorosSinceLongBreak = 0;
  persist();
  return snapshot(user.id);
}
