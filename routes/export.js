import { getDb, persist, userSettings, DEFAULT_SETTINGS } from '../lib/db.js';
import { isDate, addDays, uid, todayLocal } from '../lib/util.js';

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvRow = (arr) => arr.map(csvCell).join(';');

export function exportData({ query, user }) {
  const db = getDb();
  const to = isDate(query.to) ? query.to : todayLocal();
  const from = isDate(query.from) ? query.from : addDays(to, -364);
  const format = query.format === 'csv' ? 'csv' : 'json';

  const tasks = db.tasks.filter(t => t.userId === user.id && t.date >= from && t.date <= to);
  const sessions = db.sessions.filter(s => s.userId === user.id && s.date >= from && s.date <= to);
  const stamp = `${from}_${to}`;

  if (format === 'json') {
    return {
      __raw: {
        contentType: 'application/json; charset=utf-8',
        filename: `pomodoro-${stamp}.json`,
        body: JSON.stringify({
          exportedAt: new Date().toISOString(),
          user: { name: user.name, email: user.email },
          from, to,
          settings: userSettings(user.id),
          tasks, sessions
        }, null, 2)
      }
    };
  }

  const lines = [];
  lines.push(csvRow(['TUR', 'Sana', 'Vazifa', 'Kategoriya', 'Rejalashtirilgan', 'Bajarilgan', 'Holat', 'Fokus (daq)', 'Manba']));
  for (const t of tasks) {
    lines.push(csvRow(['VAZIFA', t.date, t.title, t.category, t.plannedPomodoros, t.completedPomodoros,
      t.done ? 'Bajarildi' : 'Bajarilmadi', Math.round((t.focusSeconds || 0) / 60),
      t.source ? `${t.source.type}:${t.source.key || ''}` : '']));
  }
  lines.push('');
  lines.push(csvRow(['TUR', 'Sana', 'Vazifa', 'Rejim', 'Boshlandi', 'Tugadi', 'Reja (daq)', 'Amalda (daq)', 'Holat']));
  const modeUz = { work: 'Ish', short: 'Qisqa tanaffus', long: 'Uzun tanaffus' };
  for (const s of sessions) {
    lines.push(csvRow(['SESSIYA', s.date, s.taskTitle || '-', modeUz[s.mode] || s.mode,
      new Date(s.startedAt).toLocaleTimeString('uz-UZ'), new Date(s.endedAt).toLocaleTimeString('uz-UZ'),
      Math.round(s.plannedSec / 60), Math.round(s.actualSec / 60), s.completed ? 'Tugallandi' : 'Uzildi']));
  }

  return {
    __raw: {
      contentType: 'text/csv; charset=utf-8',
      filename: `pomodoro-${stamp}.csv`,
      body: '﻿' + lines.join('\r\n')
    }
  };
}

export function importData({ body, user }) {
  const db = getDb();
  if (!body || !Array.isArray(body.tasks)) return { error: 'Noto\'g\'ri fayl formati', status: 400 };
  const mode = body.mode === 'replace' ? 'replace' : 'merge';

  if (mode === 'replace') {
    db.tasks = db.tasks.filter(t => t.userId !== user.id);
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
  }
  const taskIds = new Set(db.tasks.filter(t => t.userId === user.id).map(t => t.id));
  const sessionIds = new Set(db.sessions.filter(s => s.userId === user.id).map(s => s.id));
  const idMap = new Map();
  let addedTasks = 0, addedSessions = 0;

  for (const t of body.tasks) {
    if (!t || !t.title) continue;
    const id = t.id && !taskIds.has(t.id) ? t.id : uid();
    if (t.id) idMap.set(t.id, id);
    db.tasks.push({ ...t, id, userId: user.id });
    taskIds.add(id);
    addedTasks++;
  }
  for (const s of (body.sessions || [])) {
    if (!s || !s.date) continue;
    const id = s.id && !sessionIds.has(s.id) ? s.id : uid();
    db.sessions.push({ ...s, id, userId: user.id, taskId: idMap.get(s.taskId) || s.taskId });
    sessionIds.add(id);
    addedSessions++;
  }
  if (body.settings && mode === 'replace') {
    user.settings = { ...DEFAULT_SETTINGS, ...(user.settings || {}), ...body.settings };
  }
  persist();
  return { addedTasks, addedSessions, mode };
}

export function clearData({ body, user }) {
  const db = getDb();
  const scope = body?.scope;
  if (scope === 'all') {
    db.tasks = db.tasks.filter(t => t.userId !== user.id);
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
    db.dayPlans = db.dayPlans.filter(d => d.userId !== user.id);
    delete db.timers[user.id];
    db.userState[user.id] = { pomodorosSinceLongBreak: 0, lastCycleDate: null };
  } else if (scope === 'sessions') {
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
  } else if (isDate(scope)) {
    db.tasks = db.tasks.filter(t => !(t.userId === user.id && t.date === scope));
    db.sessions = db.sessions.filter(s => !(s.userId === user.id && s.date === scope));
  } else {
    return { error: 'scope: "all" | "sessions" | "YYYY-MM-DD"', status: 400 };
  }
  persist();
  return { ok: true };
}
