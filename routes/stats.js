import { getDb, userSettings } from '../lib/db.js';
import { isDate, addDays, daysBetween, clamp } from '../lib/util.js';

const round1 = (n) => Math.round(n * 10) / 10;

export function getStats({ query, user }) {
  const db = getDb();
  const date = isDate(query.date) ? query.date : new Date().toISOString().slice(0, 10);
  const days = clamp(query.days ?? 30, 7, 365);
  const from = addDays(date, -(days - 1));

  const mine = db.sessions.filter(s => s.userId === user.id);
  const myTasks = db.tasks.filter(t => t.userId === user.id);
  const settings = userSettings(user.id);
  const work = mine.filter(s => s.mode === 'work');
  const inRange = work.filter(s => s.date >= from && s.date <= date);

  // Kunlik qator
  const byDay = new Map(daysBetween(from, date).map(d => [d, { date: d, pomodoros: 0, focusMinutes: 0, interruptions: 0 }]));
  for (const s of inRange) {
    const row = byDay.get(s.date);
    if (!row) continue;
    if (s.completed) { row.pomodoros++; row.focusMinutes += s.actualSec / 60; }
    else row.interruptions++;
  }
  const series = [...byDay.values()].map(r => ({ ...r, focusMinutes: Math.round(r.focusMinutes) }));

  // Bugun
  const todaySessions = work.filter(s => s.date === date);
  const todayDone = todaySessions.filter(s => s.completed);
  const breaks = mine.filter(s => s.date === date && s.mode !== 'work' && s.completed);
  const todayTasks = myTasks.filter(t => t.date === date);
  const planned = todayTasks.reduce((a, t) => a + (t.plannedPomodoros || 0), 0);

  const today = {
    date,
    pomodoros: todayDone.length,
    focusMinutes: Math.round(todayDone.reduce((a, s) => a + s.actualSec, 0) / 60),
    breakMinutes: Math.round(breaks.reduce((a, s) => a + s.actualSec, 0) / 60),
    interruptions: todaySessions.length - todayDone.length,
    tasksTotal: todayTasks.length,
    tasksDone: todayTasks.filter(t => t.done).length,
    plannedPomodoros: planned,
    planPercent: planned ? Math.round((todayDone.length / planned) * 100) : 0,
    goal: settings.dailyGoal,
    goalPercent: Math.round((todayDone.length / Math.max(1, settings.dailyGoal)) * 100)
  };

  // Kategoriyalar
  const taskById = new Map(myTasks.map(t => [t.id, t]));
  const catMap = new Map();
  for (const s of inRange.filter(x => x.completed)) {
    const cat = taskById.get(s.taskId)?.category || 'boshqa';
    const row = catMap.get(cat) || { category: cat, pomodoros: 0, minutes: 0 };
    row.pomodoros++; row.minutes += s.actualSec / 60;
    catMap.set(cat, row);
  }
  const categories = [...catMap.values()]
    .map(c => ({ ...c, minutes: Math.round(c.minutes) }))
    .sort((a, b) => b.pomodoros - a.pomodoros);

  // Eng ko'p vaqt ketgan vazifalar
  const taskMap = new Map();
  for (const s of inRange.filter(x => x.completed)) {
    const key = s.taskTitle || '(vazifasiz)';
    const row = taskMap.get(key) || { title: key, pomodoros: 0, minutes: 0 };
    row.pomodoros++; row.minutes += s.actualSec / 60;
    taskMap.set(key, row);
  }
  const topTasks = [...taskMap.values()]
    .map(t => ({ ...t, minutes: Math.round(t.minutes) }))
    .sort((a, b) => b.pomodoros - a.pomodoros).slice(0, 8);

  // Soatlar bo'yicha taqsimot
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, pomodoros: 0 }));
  for (const s of inRange.filter(x => x.completed)) {
    const h = new Date(s.startedAt).getHours();
    if (hourly[h]) hourly[h].pomodoros++;
  }

  // Ketma-ket kunlar (streak)
  const doneDays = new Set(work.filter(s => s.completed).map(s => s.date));
  let streak = 0, cur = date;
  if (!doneDays.has(cur)) cur = addDays(cur, -1);
  while (doneDays.has(cur) && streak < 1000) { streak++; cur = addDays(cur, -1); }

  const allDone = work.filter(s => s.completed);
  const activeDays = new Set(allDone.map(s => s.date)).size;
  const best = series.reduce((m, r) => (r.pomodoros > (m?.pomodoros ?? -1) ? r : m), null);

  return {
    today,
    series,
    categories,
    topTasks,
    hourly,
    streak,
    totals: {
      pomodoros: allDone.length,
      focusHours: round1(allDone.reduce((a, s) => a + s.actualSec, 0) / 3600),
      activeDays,
      avgPerActiveDay: activeDays ? round1(allDone.length / activeDays) : 0,
      bestDay: best && best.pomodoros ? best : null,
      rangePomodoros: series.reduce((a, r) => a + r.pomodoros, 0),
      rangeFocusMinutes: series.reduce((a, r) => a + r.focusMinutes, 0)
    },
    range: { from, to: date, days }
  };
}

export function getHistory({ query, user }) {
  const db = getDb();
  const to = isDate(query.to) ? query.to : new Date().toISOString().slice(0, 10);
  const from = isDate(query.from) ? query.from : addDays(to, -29);

  const dates = new Set([
    ...db.sessions.filter(s => s.userId === user.id && s.date >= from && s.date <= to).map(s => s.date),
    ...db.tasks.filter(t => t.userId === user.id && t.date >= from && t.date <= to).map(t => t.date)
  ]);

  const days = [...dates].sort().reverse().map(date => {
    const sessions = db.sessions.filter(s => s.userId === user.id && s.date === date);
    const workDone = sessions.filter(s => s.mode === 'work' && s.completed);
    const tasks = db.tasks.filter(t => t.userId === user.id && t.date === date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
      date,
      pomodoros: workDone.length,
      focusMinutes: Math.round(workDone.reduce((a, s) => a + s.actualSec, 0) / 60),
      breakMinutes: Math.round(sessions.filter(s => s.mode !== 'work' && s.completed).reduce((a, s) => a + s.actualSec, 0) / 60),
      interruptions: sessions.filter(s => s.mode === 'work' && !s.completed).length,
      tasks: tasks.map(t => ({
        id: t.id, title: t.title, category: t.category,
        plannedPomodoros: t.plannedPomodoros, completedPomodoros: t.completedPomodoros,
        done: t.done, focusMinutes: Math.round((t.focusSeconds || 0) / 60)
      }))
    };
  });

  return { from, to, days };
}
