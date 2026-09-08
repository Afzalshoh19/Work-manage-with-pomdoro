/** Kun rejimi paneli, haftalik ish jadvali va birinchi sozlash oynasi */
import { api } from './api.js';

let C = null;
const $ = (id) => document.getElementById(id);

const WEEK = [
  { key: 1, name: 'Dushanba', short: 'Du' },
  { key: 2, name: 'Seshanba', short: 'Se' },
  { key: 3, name: 'Chorshanba', short: 'Ch' },
  { key: 4, name: 'Payshanba', short: 'Pa' },
  { key: 5, name: 'Juma', short: 'Ju' },
  { key: 6, name: 'Shanba', short: 'Sh' },
  { key: 0, name: 'Yakshanba', short: 'Ya' }
];

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')) || [];
  return (+m[1] || 0) * 60 + (+m[2] || 0);
};
const spanHours = (start, end) => {
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 1440;
  return d;
};

/* ═══════════════ Kun rejimi paneli (faqat ko'rsatish) ═══════════════ */

let currentSetup = null;

export function renderDaySetup(plan) {
  const s = plan.setup;
  currentSetup = s;

  /* — O'qish uchun ko'rinish (tahrirlash o'ngdagi tugmadan) — */
  const item = (label, value, opts = {}) => `
    <div class="dv-item ${opts.cls || ''}"${opts.title ? ` title="${C.esc(opts.title)}"` : ''}>
      <span>${label}</span>
      <b>${value}</b>
      ${opts.note ? `<em class="dv-note">${opts.note}</em>` : ''}
    </div>`;

  $('dsView').innerHTML =
      item('Ish vaqti', `${s.startTime} – ${s.endTime}`, {
        cls: 'dv-wide' + (s.isWorkday ? '' : ' dv-off'),
        note: s.isWorkday ? '' : '🌙 Dam olish kuni',
        title: s.isWorkday ? '' : `${s.weekdayName} — haftalik jadvalda dam olish kuni`
      })
    + item('Tushlik', s.lunchEnabled ? `${s.lunchStart} – ${s.lunchEnd}` : 'Belgilanmagan', {
        cls: 'dv-wide' + (s.lunchEnabled ? '' : ' dv-off'),
        title: s.lunchEnabled
          ? 'Bu oraliqqa vazifa belgilanmaydi — jadval uni chetlab o\'tadi'
          : 'Tushlik vaqtini Profil > Ish jadvali bo\'limidan belgilang'
      })
    + item('Pomodoro', `${s.workMinutes} daq`)
    + item('Qisqa tanaffus', `${s.shortBreakMinutes} daq`)
    + item('Uzun tanaffus', `${s.longBreakMinutes} daq`)
    + item('Uzun tanaffus har', `${s.longBreakInterval} 🍅`, {
        title: `Har ${s.longBreakInterval} pomodorodan keyin uzun tanaffus`
      });

  $('dsReset').hidden = !s.custom;
  $('daySetup').classList.toggle('is-custom', !!s.custom);
}

/* ── Pomodoroni to'g'rlash oynasi ── */

function pomoPreview() {
  const w = +$('pmWork').value || 25;
  const sh = +$('pmShort').value || 0;
  const lg = +$('pmLong').value || 0;
  const iv = Math.max(2, +$('pmInterval').value || 4);
  const cycle = iv * w + (iv - 1) * sh + lg;
  const seq = [];
  for (let i = 1; i <= iv; i++) {
    seq.push(`<span class="seq-w">${w}</span>`);
    seq.push(i === iv ? `<span class="seq-l">${lg}</span>` : `<span class="seq-s">${sh}</span>`);
  }
  $('pomoPreview').innerHTML =
    `<div class="seq">${seq.join('<em>›</em>')}</div>`
    + `<div class="hint">Bir to'liq sikl: ${iv} pomodoro + ${iv - 1} qisqa + 1 uzun tanaffus = `
    + `<b>${C.fmtDuration(cycle)}</b> · sof ish ${C.fmtDuration(iv * w)}</div>`;
}

function openPomoModal() {
  const s = currentSetup;
  if (!s) return;
  $('pmWork').value = s.workMinutes;
  $('pmShort').value = s.shortBreakMinutes;
  $('pmLong').value = s.longBreakMinutes;
  $('pmInterval').value = s.longBreakInterval;
  $('pomoScope').innerHTML = `Bu qiymatlar <b>faqat ${C.esc(C.fmtDateLong(C.state.date))}</b> kuniga qo'llanadi. `
    + "Barcha kunlar uchun standartni Profil bo'limidan o'zgartiring.";
  pomoPreview();
  $('pomoOverlay').hidden = false;
  setTimeout(() => $('pmWork').focus(), 40);
}

export function closePomoModal() {
  $('pomoOverlay').hidden = true;
}

function bindDaySetup() {
  $('dsEdit').addEventListener('click', openPomoModal);
  $('pmCancel').addEventListener('click', closePomoModal);
  $('pomoOverlay').addEventListener('click', e => { if (e.target === $('pomoOverlay')) closePomoModal(); });

  for (const id of ['pmWork', 'pmShort', 'pmLong', 'pmInterval']) {
    $(id).addEventListener('input', pomoPreview);
  }
  document.querySelectorAll('[data-pomo]').forEach(b => b.addEventListener('click', () => {
    const [w, sh, lg, iv] = b.dataset.pomo.split(',').map(Number);
    $('pmWork').value = w; $('pmShort').value = sh; $('pmLong').value = lg; $('pmInterval').value = iv;
    pomoPreview();
  }));

  $('pomoForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const plan = await api.setDaySetup({
        date: C.state.date,
        workMinutes: +$('pmWork').value,
        shortBreakMinutes: +$('pmShort').value,
        longBreakMinutes: +$('pmLong').value,
        longBreakInterval: +$('pmInterval').value
      });
      closePomoModal();
      C.applyPlan(plan);
      C.toast("Pomodoro sozlamasi shu kunga qo'llanildi", 'ok');
    } catch (err) {
      C.toast(err.message, 'err');
    }
  });

  $('dsReset').addEventListener('click', async () => {
    const plan = await C.guard(() => api.setDaySetup({ date: C.state.date, reset: true }));
    C.applyPlan(plan);
    C.toast('Profildagi standart qiymatlarga qaytarildi', 'ok');
  });
}

/* ═══════════════════════════════════════════════════════════
   Haftalik jadval muharriri — ikki rejim:
   «Umumiy» (bitta vaqt + ish kunlari) va «Har kuni alohida»
   ═══════════════════════════════════════════════════════════ */

const norm = (t) => String(t || '').padStart(5, '0');

/** Yoqilgan kunlarning vaqti bir xilmi? (tushlik ham hisobga olinadi) */
function isUniform(schedule) {
  const on = WEEK.map(d => schedule[d.key] || schedule[String(d.key)]).filter(x => x && x.enabled);
  if (on.length <= 1) return true;
  const a = on[0];
  return on.every(x =>
    norm(x.start) === norm(a.start) && norm(x.end) === norm(a.end)
    && (x.lunchEnabled !== false) === (a.lunchEnabled !== false)
    && norm(x.lunchStart || '13:00') === norm(a.lunchStart || '13:00')
    && norm(x.lunchEnd || '14:00') === norm(a.lunchEnd || '14:00'));
}

function commonTimes(schedule) {
  const on = WEEK.map(d => schedule[d.key] || schedule[String(d.key)]).filter(x => x && x.enabled);
  const first = on[0] || {};
  return {
    start: norm(first.start || '09:00'),
    end: norm(first.end || '18:00'),
    lunchEnabled: first.lunchEnabled !== false,
    lunchStart: norm(first.lunchStart || '13:00'),
    lunchEnd: norm(first.lunchEnd || '14:00')
  };
}

/** Tushlik ish vaqti ichidami — muharrirda darhol ogohlantirish uchun */
function lunchFits(start, end, ls, le) {
  const ws = toMin(start); let we = toMin(end); if (we <= ws) we += 1440;
  let s = toMin(ls); let e = toMin(le); if (e <= s) e += 1440;
  while (s < ws) { s += 1440; e += 1440; }
  return s >= ws && e <= we;
}

/** Muharrir belgilashi — p: har bir nusxa uchun noyob prefiks */
function editorHtml(p, schedule) {
  const uniform = isUniform(schedule);
  const t = commonTimes(schedule);

  const chips = WEEK.map(d => {
    const row = schedule[d.key] || schedule[String(d.key)] || {};
    return `<button type="button" class="chip-day ${row.enabled ? 'on' : ''}" data-day="${d.key}" title="${d.name}">${d.short}</button>`;
  }).join('');

  const rows = WEEK.map(d => {
    const row = schedule[d.key] || schedule[String(d.key)] || { enabled: false, start: '09:00', end: '18:00' };
    const lOn = row.lunchEnabled !== false;
    return `<div class="week-row ${row.enabled ? '' : 'off'}" data-day="${d.key}">
      <input type="checkbox" ${row.enabled ? 'checked' : ''} id="${p}en${d.key}">
      <label class="week-day" for="${p}en${d.key}">${d.name}</label>
      <div class="week-times">
        <input type="time" step="300" value="${norm(row.start)}" id="${p}st${d.key}">
        <em>–</em>
        <input type="time" step="300" value="${norm(row.end)}" id="${p}nd${d.key}">
        <span class="week-hours">${row.enabled
          ? C.fmtDuration(spanHours(row.start, row.end) - (lOn ? spanHours(row.lunchStart || '13:00', row.lunchEnd || '14:00') : 0))
          : 'Dam olish kuni'}</span>
      </div>
      <div class="week-lunch">
        <input type="checkbox" ${lOn ? 'checked' : ''} id="${p}lc${d.key}" title="Tushlik hisobga olinsinmi">
        <label for="${p}lc${d.key}">🍽</label>
        <input type="time" step="300" value="${norm(row.lunchStart || '13:00')}" id="${p}ls${d.key}" ${lOn ? '' : 'disabled'}>
        <em>–</em>
        <input type="time" step="300" value="${norm(row.lunchEnd || '14:00')}" id="${p}le${d.key}" ${lOn ? '' : 'disabled'}>
      </div>
    </div>`;
  }).join('');

  return `<div class="sched" id="${p}root" data-mode="${uniform ? 'simple' : 'custom'}">
    <div class="sched-tabs">
      <button type="button" class="sched-tab ${uniform ? 'is-active' : ''}" data-mode="simple">Umumiy</button>
      <button type="button" class="sched-tab ${uniform ? '' : 'is-active'}" data-mode="custom">Har kuni alohida</button>
    </div>

    <div class="sched-pane" data-pane="simple" ${uniform ? '' : 'hidden'}>
      <div class="sched-main">
        <div class="ds-item">
          <span>Ish vaqti</span>
          <div class="ds-times">
            <input type="time" step="300" id="${p}gs" value="${t.start}">
            <em>–</em>
            <input type="time" step="300" id="${p}ge" value="${t.end}">
          </div>
        </div>
        <div class="ds-item">
          <span>
            <input type="checkbox" id="${p}lcOn" ${t.lunchEnabled ? 'checked' : ''}>
            <label for="${p}lcOn">Tushlik</label>
          </span>
          <div class="ds-times">
            <input type="time" step="300" id="${p}lcs" value="${t.lunchStart}" ${t.lunchEnabled ? '' : 'disabled'}>
            <em>–</em>
            <input type="time" step="300" id="${p}lce" value="${t.lunchEnd}" ${t.lunchEnabled ? '' : 'disabled'}>
          </div>
        </div>
        <div class="ds-item">
          <span>Ish kunlari</span>
          <div class="day-chips" id="${p}chips">${chips}</div>
        </div>
      </div>
      <div class="sched-presets">
        <span>Tez tanlash:</span>
        <button type="button" data-preset="5">Du–Ju (5 kun)</button>
        <button type="button" data-preset="6">Du–Sh (6 kun)</button>
        <button type="button" data-preset="7">Har kuni</button>
      </div>
      <div class="sched-summary" id="${p}sum"></div>
    </div>

    <div class="sched-pane" data-pane="custom" ${uniform ? 'hidden' : ''}>
      <div class="week-grid">${rows}</div>
      <p class="hint" style="margin-top:10px">Kunlar turlicha bo'lsa shu yerdan sozlang. Barchasi bir xil bo'lsa «Umumiy» qulayroq.</p>
    </div>
  </div>`;
}

/** Muharrirdan hozirgi jadvalni o'qish */
function readEditor(p) {
  const mode = $(`${p}root`).dataset.mode;
  const out = {};

  if (mode === 'simple') {
    const start = $(`${p}gs`).value || '09:00';
    const end = $(`${p}ge`).value || '18:00';
    const lunchEnabled = $(`${p}lcOn`).checked;
    const lunchStart = $(`${p}lcs`).value || '13:00';
    const lunchEnd = $(`${p}lce`).value || '14:00';
    for (const d of WEEK) {
      const chip = $(`${p}chips`).querySelector(`.chip-day[data-day="${d.key}"]`);
      out[d.key] = { enabled: chip.classList.contains('on'), start, end, lunchEnabled, lunchStart, lunchEnd };
    }
  } else {
    for (const d of WEEK) {
      out[d.key] = {
        enabled: $(`${p}en${d.key}`).checked,
        start: $(`${p}st${d.key}`).value || '09:00',
        end: $(`${p}nd${d.key}`).value || '18:00',
        lunchEnabled: $(`${p}lc${d.key}`).checked,
        lunchStart: $(`${p}ls${d.key}`).value || '13:00',
        lunchEnd: $(`${p}le${d.key}`).value || '14:00'
      };
    }
  }
  return out;
}

/** «Umumiy» rejim xulosasi */
function refreshSimpleSummary(p) {
  const start = $(`${p}gs`).value || '09:00';
  const end = $(`${p}ge`).value || '18:00';
  const on = [...$(`${p}chips`).querySelectorAll('.chip-day.on')];
  const el = $(`${p}sum`);

  const lOn = $(`${p}lcOn`).checked;
  const ls = $(`${p}lcs`).value || '13:00';
  const le = $(`${p}lce`).value || '14:00';
  $(`${p}lcs`).disabled = !lOn;
  $(`${p}lce`).disabled = !lOn;

  const lunchMin = lOn ? spanHours(ls, le) : 0;
  const perDay = spanHours(start, end) - lunchMin;

  if (!on.length) {
    el.innerHTML = '<span class="pill-stat bad">⚠ Kamida bitta ish kuni tanlang</span>';
    return;
  }
  if (lOn && !lunchFits(start, end, ls, le)) {
    el.innerHTML = `<span class="pill-stat bad">⚠ Tushlik ish vaqti ichida bo'lishi kerak (${start}–${end})</span>`;
    return;
  }
  const names = on.map(c => WEEK.find(d => d.key === +c.dataset.day).name);
  el.innerHTML =
    `<span class="pill-stat info">${on.length} ish kuni</span>`
    + `<span class="pill-stat">Kuniga ${C.fmtDuration(perDay)}</span>`
    + (lOn ? `<span class="pill-stat">🍽 ${C.fmtDuration(lunchMin)} tushlik</span>` : '')
    + `<span class="pill-stat good">Haftasiga ${C.fmtDuration(perDay * on.length)}</span>`
    + `<span class="hint">${C.esc(names.join(', '))}</span>`;
}

/** Har kunlik qatorlarni «Umumiy» qiymatlari bilan to'ldirish */
function fillRowsFromSimple(p) {
  const start = $(`${p}gs`).value || '09:00';
  const end = $(`${p}ge`).value || '18:00';
  const lOn = $(`${p}lcOn`).checked;
  const ls = $(`${p}lcs`).value || '13:00';
  const le = $(`${p}lce`).value || '14:00';
  for (const d of WEEK) {
    const on = $(`${p}chips`).querySelector(`.chip-day[data-day="${d.key}"]`).classList.contains('on');
    $(`${p}en${d.key}`).checked = on;
    $(`${p}st${d.key}`).value = start;
    $(`${p}nd${d.key}`).value = end;
    $(`${p}lc${d.key}`).checked = lOn;
    $(`${p}ls${d.key}`).value = ls;
    $(`${p}le${d.key}`).value = le;
    $(`${p}ls${d.key}`).disabled = !lOn;
    $(`${p}le${d.key}`).disabled = !lOn;
    const row = $(`${p}root`).querySelector(`.week-row[data-day="${d.key}"]`);
    row.classList.toggle('off', !on);
    row.classList.remove('bad-lunch');
    row.querySelector('.week-hours').textContent = on
      ? C.fmtDuration(spanHours(start, end) - (lOn ? spanHours(ls, le) : 0))
      : 'Dam olish kuni';
  }
}

/** «Umumiy» maydonlarini qatorlardan to'ldirish */
function fillSimpleFromRows(p) {
  const sch = readEditor(p);
  const t = commonTimes(sch);
  $(`${p}gs`).value = t.start;
  $(`${p}ge`).value = t.end;
  $(`${p}lcOn`).checked = t.lunchEnabled;
  $(`${p}lcs`).value = t.lunchStart;
  $(`${p}lce`).value = t.lunchEnd;
  for (const d of WEEK) {
    $(`${p}chips`).querySelector(`.chip-day[data-day="${d.key}"]`)
      .classList.toggle('on', !!sch[d.key].enabled);
  }
  refreshSimpleSummary(p);
}

function bindEditor(p) {
  const root = $(`${p}root`);

  /* — Rejim almashtirish — */
  root.querySelectorAll('.sched-tab').forEach(tab => tab.addEventListener('click', async () => {
    const mode = tab.dataset.mode;
    if (mode === root.dataset.mode) return;

    if (mode === 'custom') {
      fillRowsFromSimple(p);
    } else {
      const sch = readEditor(p);
      if (!isUniform(sch)) {
        const ok = await C.confirmBox('Umumiy rejimga o\'tish',
          'Kunlarning vaqtlari har xil. Umumiy rejimga o\'tsangiz, barcha ish kunlari uchun bitta vaqt qo\'llanadi.',
          'Ha, o\'tkazish');
        if (!ok) return;
      }
      fillSimpleFromRows(p);
    }

    root.dataset.mode = mode;
    root.querySelectorAll('.sched-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    root.querySelectorAll('.sched-pane').forEach(pane => { pane.hidden = pane.dataset.pane !== mode; });
  }));

  /* — Umumiy rejim — */
  $(`${p}chips`).addEventListener('click', e => {
    const chip = e.target.closest('.chip-day');
    if (!chip) return;
    chip.classList.toggle('on');
    refreshSimpleSummary(p);
  });
  for (const id of ['gs', 'ge', 'lcs', 'lce']) {
    $(`${p}${id}`).addEventListener('input', () => refreshSimpleSummary(p));
  }
  $(`${p}lcOn`).addEventListener('change', () => refreshSimpleSummary(p));

  root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.preset;
    const days = n === 5 ? [1, 2, 3, 4, 5] : n === 6 ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
    for (const d of WEEK) {
      $(`${p}chips`).querySelector(`.chip-day[data-day="${d.key}"]`)
        .classList.toggle('on', days.includes(d.key));
    }
    refreshSimpleSummary(p);
  }));

  /* — Har kunlik rejim — */
  root.querySelector('[data-pane="custom"]').addEventListener('input', e => {
    const row = e.target.closest('.week-row');
    if (!row) return;
    const key = row.dataset.day;
    const on = $(`${p}en${key}`).checked;
    row.classList.toggle('off', !on);

    const lOn = $(`${p}lc${key}`).checked;
    $(`${p}ls${key}`).disabled = !lOn;
    $(`${p}le${key}`).disabled = !lOn;

    const st = $(`${p}st${key}`).value, nd = $(`${p}nd${key}`).value;
    const bad = on && lOn && !lunchFits(st, nd, $(`${p}ls${key}`).value, $(`${p}le${key}`).value);
    row.classList.toggle('bad-lunch', bad);

    const net = spanHours(st, nd) - (lOn ? spanHours($(`${p}ls${key}`).value, $(`${p}le${key}`).value) : 0);
    row.querySelector('.week-hours').textContent = !on ? 'Dam olish kuni'
      : bad ? '⚠ tushlik ish vaqtidan tashqarida'
      : C.fmtDuration(net);
  });

  refreshSimpleSummary(p);
}

function mountEditor(containerId, p, schedule) {
  $(containerId).innerHTML = editorHtml(p, schedule);
  bindEditor(p);
}

/* ═══════════════ Profil: haftalik jadval ═══════════════ */

export async function loadWorkSchedule() {
  const data = await C.guard(() => api.workSchedule());
  mountEditor('weekGrid', 'w', data.schedule);
  $('weekState').textContent = '';
  return data;
}

function bindWorkSchedule() {
  $('weekSave').addEventListener('click', async () => {
    try {
      await api.saveWorkSchedule({ schedule: readEditor('w'), markOnboarded: true });
      $('weekState').textContent = '✔ Saqlandi';
      C.toast('Haftalik ish jadvali saqlandi', 'ok');
      await C.loadPlan();
    } catch (err) {
      $('weekState').textContent = '';
      C.toast(err.message, 'err');
    }
  });
}

/* ═══════════════ Birinchi sozlash oynasi ═══════════════ */

export async function maybeOnboard(onboarded) {
  if (onboarded) return;
  let data;
  try { data = await api.workSchedule(); } catch { return; }

  mountEditor('onboardGrid', 'o', data.schedule);
  $('onboardOverlay').hidden = false;

  $('onboardSave').onclick = async () => {
    try {
      await api.saveWorkSchedule({ schedule: readEditor('o'), markOnboarded: true });
      $('onboardOverlay').hidden = true;
      C.toast('Ish jadvalingiz saqlandi', 'ok');
      await C.loadPlan();
    } catch (err) {
      C.toast(err.message, 'err');
    }
  };
  $('onboardSkip').onclick = () => {
    $('onboardOverlay').hidden = true;
    C.toast('Jadvalni keyinroq Profil bo\'limidan sozlashingiz mumkin');
  };
}

export function initSchedule(ctx) {
  C = ctx;
  bindDaySetup();
  bindWorkSchedule();
}
