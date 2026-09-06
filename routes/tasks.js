import { getDb, persist, userSettings, daySetup, setDaySetup, TASK_STATUSES, STATUS_LABELS, userWorkSchedule } from '../lib/db.js';
import { buildSchedule } from '../lib/plan.js';
import { uid, isDate, clamp, str, addDays } from '../lib/util.js';

const CATEGORIES = ['ish', 'oqish', 'loyiha', 'uy', 'sport', 'boshqa'];

function normCategory(c) {
  c = str(c, 20).toLowerCase();
  return CATEGORIES.includes(c) ? c : 'ish';
}

function dayTasks(userId, date) {
  return getDb().tasks
    .filter(t => t.userId === userId && t.date === date)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getPlan({ query, user }) {
  const date = isDate(query.date) ? query.date : new Date().toISOString().slice(0, 10);
  const setup = daySetup(user.id, date);
  const plan = buildSchedule(dayTasks(user.id, date), userSettings(user.id), setup);
  return { date, setup, ...plan };
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t) => String(t).trim().padStart(5, '0');

/**
 * Shu kunning sozlamasi: ish vaqti oralig'i, pomodoro va tanaffus davomiyligi,
 * uzun tanaffus oralig'i. Faqat yuborilgan maydonlar o'zgaradi.
 */
export function setPlanWindow({ body, user }) {
  const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);

  if (body.reset) {
    setDaySetup(user.id, date, null);
    return getPlan({ query: { date }, user });
  }

  const patch = {};

  if (body.startTime !== undefined || body.endTime !== undefined) {
    const current = daySetup(user.id, date);
    const start = pad(str(body.startTime ?? current.startTime, 5));
    const end = pad(str(body.endTime ?? current.endTime, 5));
    if (!HHMM.test(start)) return { error: 'Boshlanish vaqti notogri (soat:daqiqa ko\'rinishida)', status: 400 };
    if (!HHMM.test(end)) return { error: 'Tugash vaqti notogri (soat:daqiqa ko\'rinishida)', status: 400 };
    if (start === end) return { error: 'Boshlanish va tugash vaqti bir xil bo\'lmasligi kerak', status: 400 };
    patch.startTime = start;
    patch.endTime = end;
  }

  if (body.workMinutes !== undefined) patch.workMinutes = clamp(body.workMinutes, 1, 180);
  if (body.shortBreakMinutes !== undefined) patch.shortBreakMinutes = clamp(body.shortBreakMinutes, 0, 60);
  if (body.longBreakMinutes !== undefined) patch.longBreakMinutes = clamp(body.longBreakMinutes, 0, 120);
  if (body.longBreakInterval !== undefined) patch.longBreakInterval = clamp(body.longBreakInterval, 2, 12);

  if (!Object.keys(patch).length) return { error: 'O\'zgartirish uchun maydon yuborilmadi', status: 400 };

  setDaySetup(user.id, date, patch);
  return getPlan({ query: { date }, user });
}

export function createTask({ body, user }) {
  const db = getDb();
  const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const title = str(body.title, 200);
  if (!title) return { error: 'Vazifa nomi bo\'sh bo\'lmasligi kerak', status: 400 };

  const siblings = dayTasks(user.id, date);
  const task = {
    id: uid(),
    userId: user.id,
    date,
    title,
    note: str(body.note, 1000),
    category: normCategory(body.category),
    priority: ['past', 'orta', 'yuqori'].includes(body.priority) ? body.priority : 'orta',
    plannedPomodoros: clamp(body.plannedPomodoros ?? 1, 1, 30),
    completedPomodoros: 0,
    focusSeconds: 0,
    status: 'reja',
    done: false,
    order: siblings.length ? Math.max(...siblings.map(t => t.order ?? 0)) + 1 : 0,
    source: body.source || null,          // masalan: { type:'jira', key:'PRJ-12', url:'...' }
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  db.tasks.push(task);
  persist();
  return { task };
}

/** Holatni o'zgartirish — done bayrog'i bilan mos saqlanadi */
export function setStatus(task, status) {
  task.status = status;
  task.done = status === 'bajarildi';
  task.completedAt = task.done ? (task.completedAt || new Date().toISOString()) : null;
  return task;
}

export function statusList() {
  return { statuses: TASK_STATUSES.map(s => ({ key: s, label: STATUS_LABELS[s] })) };
}

function ownTask(user, id) {
  return getDb().tasks.find(t => t.id === id && t.userId === user.id);
}

export function updateTask({ params, body, user }) {
  const task = ownTask(user, params.id);
  if (!task) return { error: 'Vazifa topilmadi', status: 404 };

  if (body.title !== undefined) {
    const t = str(body.title, 200);
    if (t) task.title = t;
  }
  if (body.note !== undefined) task.note = str(body.note, 1000);
  if (body.category !== undefined) task.category = normCategory(body.category);
  if (body.priority !== undefined && ['past', 'orta', 'yuqori'].includes(body.priority)) task.priority = body.priority;
  if (body.plannedPomodoros !== undefined) task.plannedPomodoros = clamp(body.plannedPomodoros, 1, 30);
  if (body.completedPomodoros !== undefined) task.completedPomodoros = clamp(body.completedPomodoros, 0, 99);
  if (body.date !== undefined && isDate(body.date)) task.date = body.date;
  if (body.status !== undefined && TASK_STATUSES.includes(body.status)) {
    setStatus(task, body.status);
  }
  if (body.done !== undefined) {
    setStatus(task, body.done ? 'bajarildi' : (task.completedPomodoros > 0 ? 'jarayonda' : 'reja'));
  }
  persist();
  return { task };
}

export function deleteTask({ params, user }) {
  const db = getDb();
  const i = db.tasks.findIndex(t => t.id === params.id && t.userId === user.id);
  if (i === -1) return { error: 'Vazifa topilmadi', status: 404 };
  const [removed] = db.tasks.splice(i, 1);
  const timer = db.timers[user.id];
  if (timer && timer.taskId === removed.id) timer.taskId = null;
  persist();
  return { ok: true };
}

export function reorderTasks({ body, user }) {
  const db = getDb();
  const ids = Array.isArray(body.ids) ? body.ids : [];
  ids.forEach((id, idx) => {
    const t = db.tasks.find(x => x.id === id && x.userId === user.id);
    if (t) t.order = idx;
  });
  persist();
  return { ok: true };
}

/** Boshqa kundagi rejani shu kunga nusxalash */
export function copyPlan({ body, user }) {
  const db = getDb();
  const to = isDate(body.to) ? body.to : new Date().toISOString().slice(0, 10);
  const from = isDate(body.from) ? body.from : addDays(to, -1);
  const source = dayTasks(user.id, from);
  if (!source.length) return { error: `${from} sanasida vazifa topilmadi`, status: 400 };

  const existing = dayTasks(user.id, to);
  let order = existing.length ? Math.max(...existing.map(t => t.order ?? 0)) + 1 : 0;
  const created = source.map(t => ({
    id: uid(),
    userId: user.id,
    date: to,
    title: t.title,
    note: t.note,
    category: t.category,
    priority: t.priority,
    plannedPomodoros: t.plannedPomodoros,
    completedPomodoros: 0,
    focusSeconds: 0,
    status: 'reja',
    done: false,
    order: order++,
    source: t.source || null,
    createdAt: new Date().toISOString(),
    completedAt: null
  }));
  db.tasks.push(...created);
  persist();
  return { created: created.length };
}

/** Bajarilmagan vazifalarni ertangi kunga ko'chirish */
export function carryOver({ body, user }) {
  const from = isDate(body.from) ? body.from : new Date().toISOString().slice(0, 10);
  const to = isDate(body.to) ? body.to : addDays(from, 1);
  const pending = dayTasks(user.id, from).filter(t => !t.done);
  if (!pending.length) return { error: 'Ko\'chiriladigan bajarilmagan vazifa yo\'q', status: 400 };

  const existing = dayTasks(user.id, to);
  let order = existing.length ? Math.max(...existing.map(t => t.order ?? 0)) + 1 : 0;
  for (const t of pending) {
    t.date = to;
    t.order = order++;
  }
  persist();
  return { moved: pending.length, to };
}

/* ═══════════ Ko'p kunlik (haftalik) reja ═══════════ */

/** Bir necha kunning yuklamasi — haftalik rejalashtirish oynasi uchun */
export function getPlanRange({ query, user }) {
  const from = isDate(query.from) ? query.from : new Date().toISOString().slice(0, 10);
  const to = isDate(query.to) ? query.to : addDays(from, 6);
  const settings = userSettings(user.id);

  const days = [];
  let cur = from, guard = 0;
  while (cur <= to && guard++ < 60) {
    const setup = daySetup(user.id, cur);
    const tasks = dayTasks(user.id, cur);
    const { summary } = buildSchedule(tasks, settings, setup);
    days.push({
      date: cur,
      isWorkday: setup.isWorkday,
      weekdayName: setup.weekdayName,
      startTime: setup.startTime,
      endTime: setup.endTime,
      availableMinutes: summary.availableMinutes,
      capacityPomodoros: summary.capacityPomodoros,
      totalPomodoros: summary.totalPomodoros,
      completedPomodoros: summary.completedPomodoros,
      totalMinutes: summary.totalMinutes,
      freeMinutes: summary.freeMinutes,
      fits: summary.fits,
      utilizationPercent: summary.utilizationPercent,
      tasks: tasks.map(t => ({
        id: t.id, title: t.title, category: t.category, priority: t.priority,
        plannedPomodoros: t.plannedPomodoros, completedPomodoros: t.completedPomodoros,
        status: t.status || 'reja', done: !!t.done
      }))
    });
    cur = addDays(cur, 1);
  }
  return { from, to, days };
}

/** Bitta vazifani bir necha kunga birdaniga qo'shish */
export function bulkAddTasks({ body, user }) {
  const db = getDb();
  const dates = Array.isArray(body.dates) ? body.dates.filter(isDate) : [];
  const items = Array.isArray(body.items) ? body.items : (body.title ? [body] : []);

  if (!dates.length) return { error: 'Kamida bitta kun tanlang', status: 400 };
  if (!items.length) return { error: 'Kamida bitta vazifa kiriting', status: 400 };

  const created = [];
  for (const date of dates.slice(0, 60)) {
    const existing = dayTasks(user.id, date);
    let order = existing.length ? Math.max(...existing.map(t => t.order ?? 0)) + 1 : 0;

    for (const item of items.slice(0, 30)) {
      const title = str(item.title, 200);
      if (!title) continue;
      created.push({
        id: uid(),
        userId: user.id,
        date,
        title,
        note: str(item.note, 1000),
        category: normCategory(item.category),
        priority: ['past', 'orta', 'yuqori'].includes(item.priority) ? item.priority : 'orta',
        plannedPomodoros: clamp(item.plannedPomodoros ?? 1, 1, 30),
        completedPomodoros: 0,
        focusSeconds: 0,
        status: 'reja',
        done: false,
        order: order++,
        source: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
    }
  }

  if (!created.length) return { error: 'Vazifa nomi bo\'sh bo\'lmasligi kerak', status: 400 };
  db.tasks.push(...created);
  persist();
  return { created: created.length, days: dates.length };
}

/** Haftalik jadvaldagi ish kunlarini oraliqdan ajratib beradi */
export function workdaysInRange({ query, user }) {
  const from = isDate(query.from) ? query.from : new Date().toISOString().slice(0, 10);
  const to = isDate(query.to) ? query.to : addDays(from, 6);
  const week = userWorkSchedule(user.id);
  const out = [];
  let cur = from, guard = 0;
  while (cur <= to && guard++ < 60) {
    const wd = new Date(cur + 'T12:00:00').getDay();
    out.push({ date: cur, weekday: wd, isWorkday: !!week[wd]?.enabled });
    cur = addDays(cur, 1);
  }
  return { from, to, days: out };
}

export { CATEGORIES, dayTasks };
