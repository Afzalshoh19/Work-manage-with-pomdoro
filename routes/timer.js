import { getDb, persist, userSettings, userStateOf, daySetup } from '../lib/db.js';
import { uid, isDate, clamp } from '../lib/util.js';

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

  let taskId = null, taskTitle = '';
  if (mode === 'work' && body.taskId) {
    const task = db.tasks.find(t => t.id === body.taskId && t.userId === user.id);
    if (task) {
      taskId = task.id;
      taskTitle = task.title;
      // Ish boshlangani bilan vazifa "jarayonda" holatiga o'tadi
      if (task.status === 'reja' || !task.status) task.status = 'jarayonda';
    }
  }

  // Davomiylik shu kunning sozlamasidan olinadi (kunlik o'zgartirish bo'lsa — undan)
  const setup = daySetup(user.id, date);
  const minutes = body.durationMinutes !== undefined
    ? clamp(body.durationMinutes, 1, 180)
    : modeMinutes(mode, setup);

  db.timers[user.id] = {
    id: uid(),
    mode,
    date,
    taskId,
    taskTitle,
    durationSec: Math.round(minutes * 60),
    elapsedSec: 0,
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
  persist();
  return snapshot(user.id);
}

export function resumeTimer({ user }) {
  const db = getDb();
  const t = db.timers[user.id];
  if (!t || t.status !== 'paused') return { error: 'Pauzadagi taymer yo\'q', status: 400 };
  t.segmentStart = Date.now();
  t.status = 'running';
  persist();
  return snapshot(user.id);
}

function recordSession(db, userId, timer, { completed }) {
  const elapsed = Math.round(elapsedOf(timer));
  db.sessions.push({
    id: uid(),
    userId,
    date: timer.date,
    mode: timer.mode,
    taskId: timer.taskId,
    taskTitle: timer.taskTitle,
    plannedSec: timer.durationSec,
    actualSec: elapsed,
    completed,
    startedAt: timer.startedAtIso,
    endedAt: new Date().toISOString()
  });
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
    state.pomodorosSinceLongBreak = (state.pomodorosSinceLongBreak || 0) + 1;
    const task = db.tasks.find(t => t.id === timer.taskId && t.userId === user.id);
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
  let nextMode = 'work';
  if (timer.mode === 'work') {
    nextMode = (state.pomodorosSinceLongBreak % interval === 0) ? 'long' : 'short';
  }
  delete db.timers[user.id];
  persist();

  const auto = timer.mode === 'work' ? settings.autoStartBreaks : settings.autoStartWork;
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
  if (timer.mode === 'work' && elapsed >= 60) {
    recordSession(db, user.id, timer, { completed: false });
    const task = db.tasks.find(t => t.id === timer.taskId && t.userId === user.id);
    if (task) task.focusSeconds = (task.focusSeconds || 0) + elapsed;
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
