import { getDb, persist, userSettings, daySetup, setDaySetup, TASK_STATUSES, STATUS_LABELS, userWorkSchedule } from '../lib/db.js';
import { buildSchedule } from '../lib/plan.js';
import { withActuals } from '../lib/actuals.js';
import { uid, isDate, clamp, str, addDays } from '../lib/util.js';

const CATEGORIES = ['ish', 'oqish', 'loyiha', 'uy', 'sport', 'boshqa'];

function normCategory(c) {
  c = str(c, 20).toLowerCase();
  return CATEGORIES.includes(c) ? c : 'ish';
}

/**
 * Kun vazifalari. Bajarilganlari ro'yxat oxiriga tushadi — kun davomida
 * ko'z oldida faqat qolgan ishlar turadi. Vazifaning `order` maydoni
 * o'zgarmaydi, faqat ko'rsatish tartibi shunday.
 */
function dayTasks(userId, date) {
  return getDb().tasks
    .filter(t => t.userId === userId && t.date === date)
    .sort((a, b) => {
      const ad = a.status === 'bajarildi' ? 1 : 0;
      const bd = b.status === 'bajarildi' ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return (a.order ?? 0) - (b.order ?? 0);
    });
}

/**
 * Vazifani jadval hisoblagichiga tayyorlash: haqiqiy boshlanish vaqti va
 * jamlangan pauza qo'shiladi, shunda jadval rejadan emas — haqiqatdan quriladi.
 */
export function getPlan({ query, user }) {
  const date = isDate(query.date) ? query.date : new Date().toISOString().slice(0, 10);
  const setup = daySetup(user.id, date);
  const tasks = dayTasks(user.id, date).map(t => withActuals(t, date));
  const plan = buildSchedule(tasks, userSettings(user.id), setup);
  return { date, setup, ...plan };
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t) => String(t).trim().padStart(5, '0');
const mins = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };

/**
 * Tushlik oralig'i to'g'rimi va ish vaqti ichidami — tekshiradi.
 * Xato bo'lsa matn qaytaradi, to'g'ri bo'lsa null.
 */
export function checkLunch(lunchStart, lunchEnd, workStart, workEnd) {
  if (!HHMM.test(lunchStart)) return 'Tushlik boshlanish vaqti notogri (soat:daqiqa)';
  if (!HHMM.test(lunchEnd)) return 'Tushlik tugash vaqti notogri (soat:daqiqa)';

  const ls = mins(lunchStart);
  let le = mins(lunchEnd);
  if (le <= ls) le += 1440;
  if (le - ls > 240) return 'Tushlik 4 soatdan uzun bo\'lmasligi kerak';

  const ws = mins(workStart);
  let we = mins(workEnd);
  if (we <= ws) we += 1440;

  let s = ls, e = le;
  while (s < ws) { s += 1440; e += 1440; }
  if (s < ws || e > we) {
    return `Tushlik ish vaqti ichida bo'lishi kerak (${workStart}–${workEnd})`;
  }
  return null;
}

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

  if (body.lunchEnabled !== undefined) patch.lunchEnabled = !!body.lunchEnabled;
  if (body.lunchStart !== undefined || body.lunchEnd !== undefined) {
    const cur = daySetup(user.id, date);
    const ls = pad(str(body.lunchStart ?? cur.lunchStart, 5));
    const le = pad(str(body.lunchEnd ?? cur.lunchEnd, 5));
    const err = checkLunch(ls, le, patch.startTime ?? cur.startTime, patch.endTime ?? cur.endTime);
    if (err) return { error: err, status: 400 };
    patch.lunchStart = ls;
    patch.lunchEnd = le;
  }

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

/* Bajarilgan vazifada o'zgartirib bo'lmaydigan maydonlar */
const FROZEN_FIELDS = ['title', 'note', 'category', 'priority', 'plannedPomodoros', 'completedPomodoros', 'date'];

export function updateTask({ params, body, user }) {
  const task = ownTask(user, params.id);
  if (!task) return { error: 'Vazifa topilmadi', status: 404 };

  // Bajarilgan vazifa qulflanadi. Holatni o'zgartirish (qayta ochish) mumkin —
  // shunda foydalanuvchi avval ↩ bosib, keyin tahrirlaydi.
  if (task.status === 'bajarildi' && FROZEN_FIELDS.some(f => body[f] !== undefined)) {
    return {
      error: 'Bajarilgan vazifani tahrirlab bo\'lmaydi. Avval «Qayta ochish» (↩) tugmasini bosing.',
      status: 409
    };
  }

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

/* Hisobotni to'g'rlash sabablari */
export const CORRECTION_REASONS = {
  tizim: 'Tizim ishlamadi',
  unutdim: 'Taymerni bosish esdan chiqdi',
  yigilish: 'Yig\'ilish / uchrashuv',
  oflayn: 'Kompyuterdan tashqarida ishladim',
  boshqa: 'Boshqa sabab'
};

export function correctionReasons() {
  return { reasons: Object.entries(CORRECTION_REASONS).map(([key, label]) => ({ key, label })) };
}

/**
 * Bajarilgan pomodoroni qo'lda yozish — hisobotni to'g'rlash.
 * Taymer ishlamay qolgan, tizim o'chgan yoki ▶ bosish esdan chiqqan holatlar uchun.
 * Har bir pomodoro uchun seans yozuvi yaratiladi va sababi bilan birga saqlanadi,
 * shunda hisobotda qaysi raqam qo'lda kiritilgani va nega kiritilgani ko'rinadi.
 */
export function logPomodoros({ params, body, user }) {
  const db = getDb();
  const task = ownTask(user, params.id);
  if (!task) return { error: 'Vazifa topilmadi', status: 404 };

  // Bajarilgan vazifa qulflangan — uning hisoboti ham o'zgarmaydi
  if (task.status === 'bajarildi') {
    return {
      error: 'Bajarilgan vazifa hisobotini to\'g\'rlab bo\'lmaydi. Avval «Qayta ochish» tugmasini bosing.',
      status: 409,
      code: 'TASK_LOCKED'
    };
  }

  const reasonKey = CORRECTION_REASONS[body.reason] ? body.reason : null;
  if (!reasonKey) {
    return { error: 'To\'g\'rlash sababini tanlang', status: 400 };
  }
  const note = str(body.reasonNote, 300);
  if (reasonKey === 'boshqa' && !note) {
    return { error: '«Boshqa sabab» tanlansa, izoh yozilishi shart', status: 400 };
  }
  const reasonLabel = CORRECTION_REASONS[reasonKey];

  const count = clamp(body.pomodoros ?? 1, 1, 20);
  const setup = daySetup(user.id, task.date);
  const minutes = clamp(body.minutes ?? setup.workMinutes, 1, 180);

  // Boshlanish vaqti: berilgan bo'lsa o'sha, aks holda hozirdan orqaga hisoblanadi
  let start = body.startedAt ? new Date(body.startedAt) : null;
  if (!start || Number.isNaN(start.getTime())) {
    start = new Date(Date.now() - count * minutes * 60000);
  }

  const created = [];
  for (let i = 0; i < count; i++) {
    const from = new Date(start.getTime() + i * minutes * 60000);
    const to = new Date(from.getTime() + minutes * 60000);
    const rec = {
      id: uid(),
      userId: user.id,
      date: task.date,
      mode: 'work',
      taskId: task.id,
      taskTitle: task.title,
      plannedSec: minutes * 60,
      actualSec: minutes * 60,
      pausedSec: 0,
      pauseCount: 0,
      completed: true,
      manual: true,                       // qo'lda kiritilgani belgilanadi
      reason: reasonKey,
      reasonLabel,
      reasonNote: note,
      startedAt: from.toISOString(),
      endedAt: to.toISOString()
    };
    db.sessions.push(rec);
    created.push(rec);
  }

  task.completedPomodoros = (task.completedPomodoros || 0) + count;
  task.focusSeconds = (task.focusSeconds || 0) + count * minutes * 60;
  if (!task.startedAt) task.startedAt = start.toISOString();

  // Tuzatishlar tarixi — hisobotda vazifa yonida ko'rsatiladi
  if (!Array.isArray(task.corrections)) task.corrections = [];
  task.corrections.push({
    at: new Date().toISOString(),
    pomodoros: count,
    minutes,
    reason: reasonKey,
    reasonLabel,
    reasonNote: note,
    from: created[0].startedAt,
    to: created[created.length - 1].endedAt
  });

  // Holat taymerdagi kabi o'zgaradi: hammasi bajarilsa "qabul qilishga"
  if (task.status !== 'bajarildi') {
    task.status = task.completedPomodoros >= task.plannedPomodoros ? 'qabulga' : 'jarayonda';
    task.done = false;
  }

  persist();
  return {
    logged: count,
    minutes,
    reason: reasonKey,
    reasonLabel,
    reasonNote: note,
    task: { id: task.id, title: task.title, completedPomodoros: task.completedPomodoros, status: task.status },
    from: created[0].startedAt,
    to: created[created.length - 1].endedAt
  };
}

/**
 * Alohida vazifa(lar)ni boshqa kunga nusxalash.
 * Asl vazifa joyida qoladi, nusxa toza holatda ("reja", 0 pomodoro) yaratiladi.
 */
export function copyTasks({ body, user }) {
  const db = getDb();
  const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
  if (!ids.length) return { error: 'Nusxalanadigan vazifa tanlanmadi', status: 400 };

  const to = isDate(body.to) ? body.to : addDays(new Date().toISOString().slice(0, 10), 1);

  // Tartibni asl ko'rinishida saqlaymiz
  const source = ids
    .map(id => db.tasks.find(t => t.id === id && t.userId === user.id))
    .filter(Boolean)
    .sort((a, b) => (a.date + String(a.order ?? 0)).localeCompare(b.date + String(b.order ?? 0)));

  if (!source.length) return { error: 'Vazifa topilmadi', status: 404 };

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
    pausedSeconds: 0,
    pauses: [],
    startedAt: null,
    status: 'reja',
    done: false,
    order: order++,
    source: t.source || null,
    createdAt: new Date().toISOString(),
    completedAt: null
  }));

  db.tasks.push(...created);
  persist();
  return { created: created.length, to, titles: created.map(t => t.title) };
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
      workableMinutes: summary.workableMinutes,
      lunch: summary.lunch,
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
