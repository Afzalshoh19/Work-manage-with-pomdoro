/**
 * Hisobot modeli va uni turli formatlarga aylantirish:
 * HTML (chop etish / PDF), Markdown, CSV, JSON, Confluence storage, Notion bloklari.
 */
import { getDb, userSettings, daySetup } from './db.js';
import { buildSchedule } from './plan.js';
import { addDays, daysBetween, isDate } from './util.js';

const CAT_LABELS = { ish: 'Ish', oqish: "O'qish", loyiha: 'Loyiha', uy: 'Uy ishlari', sport: 'Sport', boshqa: 'Boshqa' };
const CAT_COLORS = { ish: '#ff5f56', oqish: '#4a9eff', loyiha: '#a77dff', uy: '#f6b73c', sport: '#35c88f', boshqa: '#8a97a8' };
const MODE_LABELS = { work: 'Ish', short: 'Qisqa tanaffus', long: 'Uzun tanaffus' };
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtDate(d) {
  const dt = new Date(d + 'T12:00:00');
  return `${dt.getDate()}-${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
export function fmtDateFull(d) {
  const dt = new Date(d + 'T12:00:00');
  return `${fmtDate(d)}, ${WEEKDAYS[dt.getDay()]}`;
}
export function fmtDur(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}
const hhmm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ═══════════════ Model ═══════════════ */

export function periodRange(type, date) {
  const d = isDate(date) ? date : new Date().toISOString().slice(0, 10);
  if (type === 'weekly') {
    const dt = new Date(d + 'T12:00:00');
    const dow = (dt.getDay() + 6) % 7;          // dushanba = 0
    const from = addDays(d, -dow);
    return { type, from, to: addDays(from, 6), label: `Haftalik hisobot (${fmtDate(from)} – ${fmtDate(addDays(from, 6))})` };
  }
  if (type === 'monthly') {
    const from = d.slice(0, 8) + '01';
    const dt = new Date(d + 'T12:00:00');
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    return { type, from, to: d.slice(0, 8) + String(last).padStart(2, '0'), label: `Oylik hisobot (${MONTHS[dt.getMonth()]} ${dt.getFullYear()})` };
  }
  return { type: 'daily', from: d, to: d, label: `Kunlik hisobot — ${fmtDateFull(d)}` };
}

export function buildReport(user, { type = 'daily', date, from, to } = {}) {
  const db = getDb();
  const settings = userSettings(user.id);
  const period = (isDate(from) && isDate(to))
    ? { type: 'custom', from, to, label: `Hisobot (${fmtDate(from)} – ${fmtDate(to)})` }
    : periodRange(type, date);

  const inRange = (x) => x.userId === user.id && x.date >= period.from && x.date <= period.to;
  const tasks = db.tasks.filter(inRange).sort((a, b) => (a.date + String(a.order ?? 0)).localeCompare(b.date + String(b.order ?? 0)));
  const sessions = db.sessions.filter(inRange).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const workDone = sessions.filter(s => s.mode === 'work' && s.completed);

  // Bitta kunlik hisobotda jadval vaqtlarini va ish vaqti oralig'ini ham beramiz
  let scheduled = tasks;
  let workday = null;
  if (period.from === period.to) {
    const win = daySetup(user.id, period.from);
    const built = buildSchedule(tasks.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), settings, win);
    scheduled = built.tasks;
    const b = built.summary;
    workday = {
      start: b.workdayStart,
      end: b.workdayEnd,
      endsNextDay: b.workdayEndOffset > 0,
      availableMinutes: b.availableMinutes,
      plannedMinutes: b.totalMinutes,
      freeMinutes: b.freeMinutes,
      fits: b.fits,
      overflowMinutes: b.overflowMinutes,
      capacityPomodoros: b.capacityPomodoros,
      utilizationPercent: b.utilizationPercent
    };
  }

  const plannedPomodoros = tasks.reduce((a, t) => a + (t.plannedPomodoros || 0), 0);
  const focusMinutes = Math.round(workDone.reduce((a, s) => a + s.actualSec, 0) / 60);
  const breakMinutes = Math.round(sessions.filter(s => s.mode !== 'work' && s.completed).reduce((a, s) => a + s.actualSec, 0) / 60);
  const dayCount = daysBetween(period.from, period.to).length;

  // Kategoriyalar
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const catMap = new Map();
  for (const s of workDone) {
    const cat = taskById.get(s.taskId)?.category || 'boshqa';
    const row = catMap.get(cat) || { category: cat, label: CAT_LABELS[cat] || cat, color: CAT_COLORS[cat] || CAT_COLORS.boshqa, pomodoros: 0, minutes: 0 };
    row.pomodoros++; row.minutes += s.actualSec / 60;
    catMap.set(cat, row);
  }
  const categories = [...catMap.values()]
    .map(c => ({ ...c, minutes: Math.round(c.minutes), percent: workDone.length ? Math.round((c.pomodoros / workDone.length) * 100) : 0 }))
    .sort((a, b) => b.pomodoros - a.pomodoros);

  // Kunlar bo'yicha
  const days = daysBetween(period.from, period.to).map(d => {
    const dayWork = workDone.filter(s => s.date === d);
    return {
      date: d,
      pomodoros: dayWork.length,
      focusMinutes: Math.round(dayWork.reduce((a, s) => a + s.actualSec, 0) / 60),
      tasksDone: tasks.filter(t => t.date === d && t.done).length,
      tasksTotal: tasks.filter(t => t.date === d).length
    };
  });

  // Soatlar
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, pomodoros: 0 }));
  for (const s of workDone) hourly[new Date(s.startedAt).getHours()].pomodoros++;
  const bestHour = hourly.reduce((m, h) => (h.pomodoros > (m?.pomodoros ?? 0) ? h : m), null);

  // Oldingi davr bilan taqqoslash
  const span = daysBetween(period.from, period.to).length;
  const prevTo = addDays(period.from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));
  const prevDone = db.sessions.filter(s => s.userId === user.id && s.mode === 'work' && s.completed && s.date >= prevFrom && s.date <= prevTo);
  const delta = prevDone.length ? Math.round(((workDone.length - prevDone.length) / prevDone.length) * 100) : null;

  const tasksDone = tasks.filter(t => t.done).length;
  const interruptions = sessions.filter(s => s.mode === 'work' && !s.completed).length;
  const goal = settings.dailyGoal * dayCount;

  const summary = {
    plannedPomodoros,
    completedPomodoros: workDone.length,
    planPercent: plannedPomodoros ? Math.round((workDone.length / plannedPomodoros) * 100) : 0,
    focusMinutes,
    breakMinutes,
    totalMinutes: focusMinutes + breakMinutes,
    interruptions,
    tasksTotal: tasks.length,
    tasksDone,
    taskPercent: tasks.length ? Math.round((tasksDone / tasks.length) * 100) : 0,
    goal,
    goalPercent: goal ? Math.round((workDone.length / goal) * 100) : 0,
    dayCount,
    avgPerDay: dayCount ? Math.round((workDone.length / dayCount) * 10) / 10 : 0,
    prevPomodoros: prevDone.length,
    deltaPercent: delta,
    bestHour: bestHour && bestHour.pomodoros ? bestHour.hour : null
  };

  // Avtomatik xulosalar
  const highlights = [];
  if (summary.completedPomodoros === 0) {
    highlights.push('Bu davrda yakunlangan pomodoro yo\'q.');
  } else {
    highlights.push(`Jami ${summary.completedPomodoros} ta pomodoro yakunlandi — sof fokus vaqti ${fmtDur(focusMinutes)}.`);
    if (plannedPomodoros) {
      highlights.push(summary.planPercent >= 100
        ? `Reja to'liq bajarildi (${summary.planPercent}%).`
        : `Reja ${summary.planPercent}% bajarildi (${summary.completedPomodoros}/${plannedPomodoros}).`);
    }
    if (categories.length) {
      highlights.push(`Eng ko'p vaqt "${categories[0].label}" yo'nalishiga sarflandi — ${categories[0].percent}%.`);
    }
    if (summary.bestHour !== null) {
      highlights.push(`Eng samarali vaqt: ${String(summary.bestHour).padStart(2, '0')}:00 atrofi.`);
    }
    if (delta !== null) {
      highlights.push(delta >= 0
        ? `Oldingi davrga nisbatan ${delta}% ko'p ish bajarildi.`
        : `Oldingi davrga nisbatan ${Math.abs(delta)}% kam ish bajarildi.`);
    }
    if (interruptions) highlights.push(`${interruptions} ta pomodoro yakunlanmay uzilgan.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    workday,
    user: { name: user.name, email: user.email, jobTitle: user.jobTitle || '', company: user.company || '', avatar: user.avatar },
    period,
    settings: { workMinutes: settings.workMinutes, dailyGoal: settings.dailyGoal, dayStartTime: settings.dayStartTime },
    summary,
    highlights,
    categories,
    days,
    hourly,
    tasks: scheduled.map(t => ({
      date: t.date,
      title: t.title,
      category: t.category,
      categoryLabel: CAT_LABELS[t.category] || t.category,
      priority: t.priority,
      plannedPomodoros: t.plannedPomodoros,
      completedPomodoros: t.completedPomodoros,
      focusMinutes: Math.round((t.focusSeconds || 0) / 60),
      done: t.done,
      startTime: t.startTime || null,
      endTime: t.endTime || null,
      timeRange: t.startTime
        ? `${t.startTime}${t.startDayOffset > 0 ? '+1' : ''}–${t.endTime}${t.endDayOffset > 0 ? '+1' : ''}`
        : null,
      note: t.note || '',
      source: t.source || null
    })),
    sessions: sessions.map(s => ({
      date: s.date,
      mode: s.mode,
      modeLabel: MODE_LABELS[s.mode] || s.mode,
      taskTitle: s.taskTitle || '',
      start: hhmm(s.startedAt),
      end: hhmm(s.endedAt),
      minutes: Math.round(s.actualSec / 60),
      completed: s.completed
    }))
  };
}

/* ═══════════════ HTML (chop etish / PDF) ═══════════════ */

function barChartSvg(days) {
  if (days.length < 2) return '';
  const W = 720, H = 170, PAD_L = 34, PAD_B = 26, PAD_T = 10;
  const max = Math.max(1, ...days.map(d => d.pomodoros));
  const plotH = H - PAD_B - PAD_T;
  const step = (W - PAD_L - 10) / days.length;
  const bw = Math.min(38, step * 0.6);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const t of [0, Math.ceil(max / 2), max]) {
    const y = PAD_T + plotH - (t / max) * plotH;
    svg += `<line x1="${PAD_L}" y1="${y}" x2="${W - 6}" y2="${y}" stroke="#e3e8f0"/>`;
    svg += `<text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#8a97a8">${t}</text>`;
  }
  days.forEach((d, i) => {
    const x = PAD_L + i * step + (step - bw) / 2;
    const h = (d.pomodoros / max) * plotH;
    svg += `<rect x="${x}" y="${PAD_T + plotH - h}" width="${bw}" height="${Math.max(2, h)}" rx="3" fill="#ff5f56"/>`;
    const dt = new Date(d.date + 'T12:00:00');
    svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#8a97a8">${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}</text>`;
  });
  return svg + '</svg>';
}

export function renderHtml(r) {
  const s = r.summary;
  const kpi = (val, lbl, sub = '') =>
    `<div class="kpi"><div class="v">${esc(val)}</div><div class="l">${esc(lbl)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

  const taskRows = r.tasks.length ? r.tasks.map(t => `
    <tr class="${t.done ? 'done' : ''}">
      <td>${t.done ? '✔' : '○'}</td>
      <td>${esc(t.title)}${t.source ? ` <span class="src">${esc(t.source.type)}${t.source.key ? ' · ' + esc(t.source.key) : ''}</span>` : ''}</td>
      <td><span class="tag" style="background:${CAT_COLORS[t.category] || '#8a97a8'}22;color:${CAT_COLORS[t.category] || '#8a97a8'}">${esc(t.categoryLabel)}</span></td>
      <td class="num">${t.completedPomodoros}/${t.plannedPomodoros}</td>
      <td class="num">${fmtDur(t.focusMinutes)}</td>
      <td class="num">${t.timeRange ? esc(t.timeRange) : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Vazifa kiritilmagan</td></tr>';

  const sessionRows = r.sessions.filter(x => x.mode === 'work').slice(0, 60).map(x => `
    <tr>
      <td class="num">${esc(x.start)}–${esc(x.end)}</td>
      <td>${esc(x.taskTitle || '—')}</td>
      <td class="num">${x.minutes} daq</td>
      <td>${x.completed ? '<span class="ok">Tugallandi</span>' : '<span class="bad">Uzildi</span>'}</td>
    </tr>`).join('');

  const catRows = r.categories.map(c => `
    <div class="cat">
      <span class="cat-n">${esc(c.label)}</span>
      <span class="cat-b"><i style="width:${c.percent}%;background:${c.color}"></i></span>
      <span class="cat-v">${c.pomodoros} 🍅 · ${fmtDur(c.minutes)} · ${c.percent}%</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.period.label)} — ${esc(r.user.name)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 13px/1.55 "Segoe UI", system-ui, sans-serif; color: #1b2430; background: #f4f6fa; margin: 0; padding: 24px; }
  .sheet { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 32px 34px; box-shadow: 0 6px 24px rgba(20,35,60,.08); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid #ff5f56; padding-bottom: 16px; margin-bottom: 22px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 26px 0 12px; padding-bottom: 7px; border-bottom: 1px solid #e3e8f0; }
  .muted { color: #5c6a7d; font-size: 12px; }
  .who { text-align: right; font-size: 12px; }
  .who b { font-size: 14px; display: block; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { background: #f7f9fc; border: 1px solid #e3e8f0; border-radius: 10px; padding: 12px 13px; }
  .kpi .v { font-size: 22px; font-weight: 650; color: #ff5f56; line-height: 1.15; }
  .kpi .l { font-size: 11px; color: #5c6a7d; margin-top: 3px; }
  .kpi .s { font-size: 10.5px; color: #8a97a8; margin-top: 3px; }
  ul.hl { margin: 12px 0 0; padding-left: 18px; }
  ul.hl li { margin: 4px 0; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8a97a8; border-bottom: 1px solid #e3e8f0; padding: 7px 8px; }
  td { padding: 8px; border-bottom: 1px solid #eef1f6; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.done td { color: #5c6a7d; }
  .tag { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
  .src { font-size: 10px; color: #8a97a8; border: 1px solid #e3e8f0; border-radius: 4px; padding: 1px 5px; }
  .ok { color: #23a06f; } .bad { color: #d9534f; }
  .empty { text-align: center; color: #8a97a8; padding: 18px; }
  .cat { display: grid; grid-template-columns: 100px 1fr 190px; gap: 10px; align-items: center; margin: 7px 0; font-size: 12px; }
  .cat-b { height: 8px; background: #eef1f6; border-radius: 99px; overflow: hidden; }
  .cat-b i { display: block; height: 100%; border-radius: 99px; }
  .cat-v { text-align: right; color: #5c6a7d; font-size: 11.5px; }
  footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e3e8f0; font-size: 11px; color: #8a97a8; display: flex; justify-content: space-between; }
  .print { position: fixed; top: 16px; right: 16px; background: #ff5f56; color: #fff; border: 0; border-radius: 9px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(255,95,86,.35); }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; } .print { display: none; } }
</style></head>
<body>
<button class="print" onclick="window.print()">🖨 Chop etish / PDF</button>
<div class="sheet">
  <header>
    <div>
      <h1>${esc(r.period.label)}</h1>
      <div class="muted">${esc(fmtDate(r.period.from))}${r.period.from !== r.period.to ? ' – ' + esc(fmtDate(r.period.to)) : ''} · Pomodoro tizimi</div>
    </div>
    <div class="who">
      <b>${esc(r.user.avatar || '')} ${esc(r.user.name)}</b>
      ${r.user.jobTitle ? esc(r.user.jobTitle) + '<br>' : ''}
      ${r.user.company ? esc(r.user.company) + '<br>' : ''}
      <span class="muted">${esc(r.user.email)}</span>
    </div>
  </header>

  <div class="kpis">
    ${kpi(s.completedPomodoros + (s.plannedPomodoros ? ' / ' + s.plannedPomodoros : ''), 'Pomodorolar', `Reja: ${s.planPercent}%`)}
    ${kpi(fmtDur(s.focusMinutes), 'Sof fokus vaqti', `Tanaffus: ${fmtDur(s.breakMinutes)}`)}
    ${kpi(s.tasksDone + ' / ' + s.tasksTotal, 'Bajarilgan vazifalar', s.taskPercent + '%')}
    ${kpi(s.goalPercent + '%', 'Maqsad bajarilishi', `Maqsad: ${s.goal} 🍅`)}
  </div>

  ${r.workday ? `<div class="kpis" style="margin-top:10px">
    ${kpi(r.workday.start + ' – ' + r.workday.end + (r.workday.endsNextDay ? '+1' : ''), 'Ish vaqti', fmtDur(r.workday.availableMinutes) + ' mavjud')}
    ${kpi(fmtDur(r.workday.plannedMinutes), 'Rejalashtirilgan yuklama', 'Bandlik: ' + r.workday.utilizationPercent + '%')}
    ${kpi(r.workday.fits ? fmtDur(r.workday.freeMinutes) : '−' + fmtDur(r.workday.overflowMinutes),
          r.workday.fits ? 'Bo\'sh vaqt' : 'Ish vaqtidan oshdi',
          'Sig\'adi: ' + r.workday.capacityPomodoros + ' 🍅')}
  </div>` : ''}

  <h2>Qisqacha xulosa</h2>
  <ul class="hl">${r.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>

  ${r.days.length > 1 ? `<h2>Kunlar bo'yicha dinamika</h2>${barChartSvg(r.days)}` : ''}

  <h2>Vazifalar</h2>
  <table>
    <thead><tr><th></th><th>Vazifa</th><th>Kategoriya</th><th class="num">🍅</th><th class="num">Fokus</th><th class="num">Vaqt</th></tr></thead>
    <tbody>${taskRows}</tbody>
  </table>

  ${r.categories.length ? `<h2>Yo'nalishlar bo'yicha taqsimot</h2>${catRows}` : ''}

  ${sessionRows ? `<h2>Ish sessiyalari</h2>
  <table>
    <thead><tr><th>Vaqt</th><th>Vazifa</th><th class="num">Davomiyligi</th><th>Holat</th></tr></thead>
    <tbody>${sessionRows}</tbody>
  </table>` : ''}

  <footer>
    <span>Pomodoro — Ish jarayoni boshqaruvi</span>
    <span>Yaratildi: ${new Date(r.generatedAt).toLocaleString('uz-UZ')}</span>
  </footer>
</div>
</body></html>`;
}

/* ═══════════════ Markdown ═══════════════ */

export function renderMarkdown(r) {
  const s = r.summary;
  const L = [];
  L.push(`# ${r.period.label}`);
  L.push('');
  L.push(`**${r.user.name}**${r.user.jobTitle ? ' · ' + r.user.jobTitle : ''}${r.user.company ? ' · ' + r.user.company : ''}  `);
  L.push(`${r.user.email} · ${fmtDate(r.period.from)}${r.period.from !== r.period.to ? ' – ' + fmtDate(r.period.to) : ''}`);
  L.push('');
  L.push('## Ko\'rsatkichlar');
  L.push('');
  L.push('| Ko\'rsatkich | Qiymat |');
  L.push('| --- | --- |');
  if (r.workday) {
    L.push(`| Ish vaqti | ${r.workday.start} – ${r.workday.end}${r.workday.endsNextDay ? '+1' : ''} (${fmtDur(r.workday.availableMinutes)}) |`);
    L.push(`| Rejalashtirilgan yuklama | ${fmtDur(r.workday.plannedMinutes)} — bandlik ${r.workday.utilizationPercent}% |`);
    L.push(r.workday.fits
      ? `| Bo'sh vaqt | ${fmtDur(r.workday.freeMinutes)} |`
      : `| Ish vaqtidan oshdi | ${fmtDur(r.workday.overflowMinutes)} |`);
  }
  L.push(`| Yakunlangan pomodorolar | ${s.completedPomodoros}${s.plannedPomodoros ? ` / ${s.plannedPomodoros} (${s.planPercent}%)` : ''} |`);
  L.push(`| Sof fokus vaqti | ${fmtDur(s.focusMinutes)} |`);
  L.push(`| Tanaffus vaqti | ${fmtDur(s.breakMinutes)} |`);
  L.push(`| Bajarilgan vazifalar | ${s.tasksDone} / ${s.tasksTotal} (${s.taskPercent}%) |`);
  L.push(`| Maqsad bajarilishi | ${s.goalPercent}% (maqsad: ${s.goal}) |`);
  if (s.interruptions) L.push(`| Uzilgan sessiyalar | ${s.interruptions} |`);
  if (s.dayCount > 1) L.push(`| Kunlik o'rtacha | ${s.avgPerDay} |`);
  L.push('');
  L.push('## Qisqacha xulosa');
  L.push('');
  for (const h of r.highlights) L.push(`- ${h}`);
  L.push('');
  L.push('## Vazifalar');
  L.push('');
  if (r.tasks.length) {
    L.push('| Holat | Vazifa | Kategoriya | Pomodoro | Fokus | Vaqt |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const t of r.tasks) {
      L.push(`| ${t.done ? '✔' : '○'} | ${t.title.replace(/\|/g, '\\|')}${t.source?.key ? ` (${t.source.key})` : ''} | ${t.categoryLabel} | ${t.completedPomodoros}/${t.plannedPomodoros} | ${fmtDur(t.focusMinutes)} | ${t.timeRange || '—'} |`);
    }
  } else {
    L.push('_Vazifa kiritilmagan._');
  }
  if (r.categories.length) {
    L.push('');
    L.push('## Yo\'nalishlar');
    L.push('');
    for (const c of r.categories) L.push(`- **${c.label}** — ${c.pomodoros} 🍅 · ${fmtDur(c.minutes)} · ${c.percent}%`);
  }
  if (r.days.length > 1) {
    L.push('');
    L.push('## Kunlar bo\'yicha');
    L.push('');
    L.push('| Sana | Pomodoro | Fokus | Vazifalar |');
    L.push('| --- | --- | --- | --- |');
    for (const d of r.days) L.push(`| ${fmtDate(d.date)} | ${d.pomodoros} | ${fmtDur(d.focusMinutes)} | ${d.tasksDone}/${d.tasksTotal} |`);
  }
  L.push('');
  L.push(`_Yaratildi: ${new Date(r.generatedAt).toLocaleString('uz-UZ')} — Pomodoro tizimi_`);
  return L.join('\n');
}

/* ═══════════════ CSV ═══════════════ */

export function renderCsv(r) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const row = (a) => a.map(cell).join(';');
  const s = r.summary;
  const L = [];
  L.push(row([r.period.label]));
  L.push(row(['Foydalanuvchi', r.user.name, r.user.email]));
  L.push('');
  L.push(row(['KO\'RSATKICH', 'QIYMAT']));
  if (r.workday) {
    L.push(row(['Ish vaqti boshlanishi', r.workday.start]));
    L.push(row(['Ish vaqti tugashi', r.workday.end + (r.workday.endsNextDay ? ' (+1 kun)' : '')]));
    L.push(row(['Mavjud ish vaqti (daq)', r.workday.availableMinutes]));
    L.push(row(['Rejalashtirilgan yuklama (daq)', r.workday.plannedMinutes]));
    L.push(row(['Bandlik (%)', r.workday.utilizationPercent]));
    L.push(row([r.workday.fits ? 'Bo\'sh vaqt (daq)' : 'Ish vaqtidan oshdi (daq)',
      r.workday.fits ? r.workday.freeMinutes : r.workday.overflowMinutes]));
  }
  L.push(row(['Yakunlangan pomodorolar', s.completedPomodoros]));
  L.push(row(['Rejalashtirilgan pomodorolar', s.plannedPomodoros]));
  L.push(row(['Reja bajarilishi (%)', s.planPercent]));
  L.push(row(['Sof fokus (daq)', s.focusMinutes]));
  L.push(row(['Tanaffus (daq)', s.breakMinutes]));
  L.push(row(['Vazifalar (bajarilgan/jami)', `${s.tasksDone}/${s.tasksTotal}`]));
  L.push(row(['Uzilishlar', s.interruptions]));
  L.push('');
  L.push(row(['VAZIFA', 'Sana', 'Kategoriya', 'Muhimlik', 'Reja', 'Bajarildi', 'Fokus (daq)', 'Boshlanish', 'Tugash', 'Holat', 'Manba']));
  for (const t of r.tasks) {
    L.push(row([t.title, t.date, t.categoryLabel, t.priority, t.plannedPomodoros, t.completedPomodoros,
      t.focusMinutes, t.startTime || '', t.endTime || '', t.done ? 'Bajarildi' : 'Bajarilmadi',
      t.source ? `${t.source.type}:${t.source.key || ''}` : '']));
  }
  L.push('');
  L.push(row(['SESSIYA', 'Sana', 'Rejim', 'Vazifa', 'Boshlandi', 'Tugadi', 'Daqiqa', 'Holat']));
  for (const x of r.sessions) {
    L.push(row(['', x.date, x.modeLabel, x.taskTitle, x.start, x.end, x.minutes, x.completed ? 'Tugallandi' : 'Uzildi']));
  }
  return '﻿' + L.join('\r\n');
}

/* ═══════════════ Confluence storage format ═══════════════ */

export function renderConfluence(r) {
  const s = r.summary;
  const th = (a) => '<tr>' + a.map(x => `<th>${esc(x)}</th>`).join('') + '</tr>';
  const td = (a) => '<tr>' + a.map(x => `<td>${esc(x)}</td>`).join('') + '</tr>';

  let h = '';
  h += `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>${esc(r.user.name)}${r.user.jobTitle ? ' — ' + esc(r.user.jobTitle) : ''} · ${esc(fmtDate(r.period.from))}${r.period.from !== r.period.to ? ' – ' + esc(fmtDate(r.period.to)) : ''}</p></ac:rich-text-body></ac:structured-macro>`;
  h += '<h2>Ko\'rsatkichlar</h2><table><tbody>';
  h += th(['Ko\'rsatkich', 'Qiymat']);
  if (r.workday) {
    h += td(['Ish vaqti', `${r.workday.start} – ${r.workday.end}${r.workday.endsNextDay ? ' (+1 kun)' : ''} · ${fmtDur(r.workday.availableMinutes)}`]);
    h += td(['Rejalashtirilgan yuklama', `${fmtDur(r.workday.plannedMinutes)} · bandlik ${r.workday.utilizationPercent}%`]);
    h += td([r.workday.fits ? 'Bo\'sh vaqt' : 'Ish vaqtidan oshdi',
      fmtDur(r.workday.fits ? r.workday.freeMinutes : r.workday.overflowMinutes)]);
  }
  h += td(['Yakunlangan pomodorolar', `${s.completedPomodoros}${s.plannedPomodoros ? ` / ${s.plannedPomodoros}` : ''}`]);
  h += td(['Reja bajarilishi', s.planPercent + '%']);
  h += td(['Sof fokus vaqti', fmtDur(s.focusMinutes)]);
  h += td(['Tanaffus vaqti', fmtDur(s.breakMinutes)]);
  h += td(['Bajarilgan vazifalar', `${s.tasksDone} / ${s.tasksTotal}`]);
  h += td(['Maqsad bajarilishi', s.goalPercent + '%']);
  h += '</tbody></table>';

  h += '<h2>Qisqacha xulosa</h2><ul>' + r.highlights.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';

  h += '<h2>Vazifalar</h2><table><tbody>';
  h += th(['Holat', 'Vazifa', 'Kategoriya', 'Pomodoro', 'Fokus', 'Vaqt']);
  for (const t of r.tasks) {
    h += td([t.done ? '✔' : '○', t.title + (t.source?.key ? ` (${t.source.key})` : ''), t.categoryLabel,
      `${t.completedPomodoros}/${t.plannedPomodoros}`, fmtDur(t.focusMinutes),
      t.timeRange || '—']);
  }
  h += '</tbody></table>';

  if (r.categories.length) {
    h += '<h2>Yo\'nalishlar</h2><ul>';
    h += r.categories.map(c => `<li>${esc(c.label)} — ${c.pomodoros} pomodoro · ${esc(fmtDur(c.minutes))} · ${c.percent}%</li>`).join('');
    h += '</ul>';
  }
  if (r.days.length > 1) {
    h += '<h2>Kunlar bo\'yicha</h2><table><tbody>';
    h += th(['Sana', 'Pomodoro', 'Fokus', 'Vazifalar']);
    for (const d of r.days) h += td([fmtDate(d.date), d.pomodoros, fmtDur(d.focusMinutes), `${d.tasksDone}/${d.tasksTotal}`]);
    h += '</tbody></table>';
  }
  h += `<p><em>Yaratildi: ${esc(new Date(r.generatedAt).toLocaleString('uz-UZ'))} — Pomodoro tizimi</em></p>`;
  return h;
}

/* ═══════════════ Notion bloklari ═══════════════ */

const nText = (content) => [{ type: 'text', text: { content: String(content).slice(0, 1900) } }];

export function renderNotionBlocks(r) {
  const s = r.summary;
  const blocks = [];
  const push = (type, extra) => blocks.push({ object: 'block', type, [type]: extra });

  push('callout', {
    rich_text: nText(`${r.user.name}${r.user.jobTitle ? ' — ' + r.user.jobTitle : ''} · ${fmtDate(r.period.from)}${r.period.from !== r.period.to ? ' – ' + fmtDate(r.period.to) : ''}`),
    icon: { emoji: '🍅' }
  });

  push('heading_2', { rich_text: nText('Ko\'rsatkichlar') });
  const metrics = [
    ...(r.workday ? [
      ['Ish vaqti', `${r.workday.start} – ${r.workday.end}${r.workday.endsNextDay ? ' (+1 kun)' : ''} · ${fmtDur(r.workday.availableMinutes)}`],
      ['Rejalashtirilgan yuklama', `${fmtDur(r.workday.plannedMinutes)} · bandlik ${r.workday.utilizationPercent}%`],
      [r.workday.fits ? 'Bo\'sh vaqt' : 'Ish vaqtidan oshdi', fmtDur(r.workday.fits ? r.workday.freeMinutes : r.workday.overflowMinutes)]
    ] : []),
    ['Yakunlangan pomodorolar', `${s.completedPomodoros}${s.plannedPomodoros ? ` / ${s.plannedPomodoros} (${s.planPercent}%)` : ''}`],
    ['Sof fokus vaqti', fmtDur(s.focusMinutes)],
    ['Tanaffus vaqti', fmtDur(s.breakMinutes)],
    ['Bajarilgan vazifalar', `${s.tasksDone} / ${s.tasksTotal} (${s.taskPercent}%)`],
    ['Maqsad bajarilishi', `${s.goalPercent}% (maqsad: ${s.goal})`]
  ];
  if (s.interruptions) metrics.push(['Uzilgan sessiyalar', String(s.interruptions)]);
  for (const [k, v] of metrics) push('bulleted_list_item', { rich_text: [
    { type: 'text', text: { content: k + ': ' }, annotations: { bold: true } },
    { type: 'text', text: { content: v } }
  ] });

  push('heading_2', { rich_text: nText('Qisqacha xulosa') });
  for (const h of r.highlights) push('bulleted_list_item', { rich_text: nText(h) });

  push('heading_2', { rich_text: nText('Vazifalar') });
  if (r.tasks.length) {
    for (const t of r.tasks) {
      push('to_do', {
        checked: !!t.done,
        rich_text: [
          { type: 'text', text: { content: t.title } },
          { type: 'text', text: { content: `  ${t.completedPomodoros}/${t.plannedPomodoros} 🍅 · ${fmtDur(t.focusMinutes)}${t.timeRange ? ' · ' + t.timeRange : ''}${t.source?.key ? ' · ' + t.source.key : ''}` }, annotations: { code: true } }
        ]
      });
    }
  } else {
    push('paragraph', { rich_text: nText('Vazifa kiritilmagan.') });
  }

  if (r.categories.length) {
    push('heading_2', { rich_text: nText('Yo\'nalishlar') });
    for (const c of r.categories) {
      push('bulleted_list_item', { rich_text: nText(`${c.label} — ${c.pomodoros} pomodoro · ${fmtDur(c.minutes)} · ${c.percent}%`) });
    }
  }

  if (r.days.length > 1) {
    push('heading_2', { rich_text: nText('Kunlar bo\'yicha') });
    for (const d of r.days) {
      push('bulleted_list_item', { rich_text: nText(`${fmtDate(d.date)} — ${d.pomodoros} pomodoro · ${fmtDur(d.focusMinutes)} · vazifalar ${d.tasksDone}/${d.tasksTotal}`) });
    }
  }

  push('divider', {});
  push('paragraph', { rich_text: nText(`Yaratildi: ${new Date(r.generatedAt).toLocaleString('uz-UZ')} — Pomodoro tizimi`) });

  return blocks.slice(0, 100);   // Notion API bir so'rovda 100 blok qabul qiladi
}
