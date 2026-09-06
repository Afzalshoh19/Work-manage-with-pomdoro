/** Ko'p kunlik (haftalik) reja tuzish oynasi */
import { api } from './api.js';

let C = null;
const $ = (id) => document.getElementById(id);

const WD = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const WD_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

let selected = new Set();
let lastDays = [];

const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const dayNum = (d) => new Date(d + 'T12:00:00').getDate();
const monthShort = (d) => MONTHS_SHORT[new Date(d + 'T12:00:00').getMonth()];

/** Berilgan sanadagi haftaning dushanbasi */
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return C.todayStr(d);
}

function shift(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return C.todayStr(d);
}

/* ═══════════ Kunlar to'ri ═══════════ */

async function loadDays() {
  const from = $('wpFrom').value;
  const to = $('wpTo').value;
  if (!from || !to || from > to) {
    $('wpDays').innerHTML = '<div class="empty">Sana oralig\'i noto\'g\'ri</div>';
    return;
  }

  $('wpDays').innerHTML = '<div class="hint" style="padding:14px">Yuklanmoqda…</div>';
  const data = await C.guard(() => api.planRange(from, to));
  lastDays = data.days;

  // Ish kunlarini birinchi ochilishda avtomatik tanlaymiz
  if (!selected.size) {
    for (const d of lastDays) if (d.isWorkday) selected.add(d.date);
  } else {
    for (const key of [...selected]) if (!lastDays.some(d => d.date === key)) selected.delete(key);
  }

  renderDays();
}

function renderDays() {
  const pomos = Math.max(1, +$('wpPomos').value || 1);

  $('wpDays').innerHTML = lastDays.map(d => {
    const wd = new Date(d.date + 'T12:00:00').getDay();
    const on = selected.has(d.date);
    const used = d.totalPomodoros;
    const cap = d.capacityPomodoros;
    const after = used + (on ? pomos : 0);
    const over = after > cap;
    const pct = cap ? Math.min(100, Math.round((after / cap) * 100)) : 0;

    const tasks = d.tasks.length
      ? d.tasks.slice(0, 4).map(t =>
          `<div class="wp-task ${t.status === 'bajarildi' ? 'done' : ''}" title="${C.esc(t.title)}">
             <span>${C.esc(t.title)}</span><b>${t.plannedPomodoros}🍅</b>
           </div>`).join('')
        + (d.tasks.length > 4 ? `<div class="wp-more">+${d.tasks.length - 4} ta yana</div>` : '')
      : '<div class="wp-empty">Bo\'sh</div>';

    return `<div class="wp-day ${on ? 'on' : ''} ${d.isWorkday ? '' : 'off'} ${over && on ? 'over' : ''}" data-date="${d.date}">
      <div class="wp-day-head">
        <input type="checkbox" ${on ? 'checked' : ''} tabindex="-1">
        <div>
          <b>${WD_SHORT[wd]}, ${dayNum(d.date)} ${C.esc(monthShort(d.date))}</b>
          <span>${d.isWorkday ? `${d.startTime}–${d.endTime}` : 'Dam olish kuni'}</span>
        </div>
      </div>
      <div class="wp-bar"><i style="width:${pct}%"></i></div>
      <div class="wp-load">
        ${used}${on && pomos ? ` <em>+${pomos}</em>` : ''} / ${cap} 🍅
        ${over && on ? '<span class="wp-warn">sig\'maydi</span>' : ''}
      </div>
      <div class="wp-tasks">${tasks}</div>
    </div>`;
  }).join('');

  const n = selected.size;
  $('wpSelInfo').textContent = n
    ? `${n} kun tanlangan · har biriga ${pomos} 🍅 (${C.fmtDuration(pomos * (C.state.plan?.setup?.workMinutes || 25))})`
    : 'Kunlarni yuqoridan tanlang';
}

/* ═══════════ Ochish / yopish ═══════════ */

export async function openWeekPlan() {
  const base = C.state.date || C.todayStr();
  if (!$('wpFrom').value) {
    $('wpFrom').value = mondayOf(base);
    $('wpTo').value = shift(mondayOf(base), 6);
  }
  $('weekPlanOverlay').hidden = false;
  await loadDays();
}

export function closeWeekPlan() {
  $('weekPlanOverlay').hidden = true;
}

function setRange(from, to) {
  $('wpFrom').value = from;
  $('wpTo').value = to;
  selected.clear();
  loadDays();
}

/* ═══════════ Hodisalar ═══════════ */

export function initWeekPlan(ctx) {
  C = ctx;

  $('btnWeekPlan').addEventListener('click', openWeekPlan);
  $('wpClose').addEventListener('click', closeWeekPlan);
  $('weekPlanOverlay').addEventListener('click', e => {
    if (e.target === $('weekPlanOverlay')) closeWeekPlan();
  });

  $('wpFrom').addEventListener('change', () => { selected.clear(); loadDays(); });
  $('wpTo').addEventListener('change', () => { selected.clear(); loadDays(); });

  $('wpThisWeek').addEventListener('click', () => {
    const m = mondayOf(C.todayStr());
    setRange(m, shift(m, 6));
  });
  $('wpNextWeek').addEventListener('click', () => {
    const m = shift(mondayOf(C.todayStr()), 7);
    setRange(m, shift(m, 6));
  });

  /* Kun tanlash */
  $('wpDays').addEventListener('click', e => {
    const card = e.target.closest('.wp-day');
    if (!card) return;
    const date = card.dataset.date;
    if (selected.has(date)) selected.delete(date); else selected.add(date);
    renderDays();
  });

  /* Pomodoro soni */
  $('wpPomos').addEventListener('input', renderDays);
  document.querySelectorAll('[data-wpstep]').forEach(b => b.addEventListener('click', () => {
    const inp = $('wpPomos');
    inp.value = Math.max(1, Math.min(30, (+inp.value || 1) + (+b.dataset.wpstep)));
    renderDays();
  }));

  /* Qo'shish */
  $('wpForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('wpTitle').value.trim();
    if (!title) return C.toast('Vazifa nomini kiriting', 'err');
    if (!selected.size) return C.toast('Kamida bitta kun tanlang', 'err');

    const res = await C.guard(() => api.bulkAdd({
      dates: [...selected].sort(),
      title,
      plannedPomodoros: +$('wpPomos').value || 1,
      category: $('wpCategory').value,
      priority: $('wpPriority').value
    }));

    $('wpTitle').value = '';
    $('wpTitle').focus();
    await loadDays();
    await C.loadPlan();
    C.toast(`«${title}» ${res.days} kunga qo'shildi (jami ${res.created} ta vazifa)`, 'ok');
  });
}
