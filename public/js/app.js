import { api, AuthError, downloadFile } from './api.js';
import { playAlarm, playTick, notify, notifyPermission, askNotifyPermission, unlockAudio } from './sound.js';
import { dailyChart, hourlyChart, categoryBars, topTasksList, CAT_COLORS, CAT_LABELS } from './charts.js';
import { initFeatures, loadProfile, loadReport, loadIntegrations, loadOauthSettings } from './features.js';
import { initWidgets, updateWidgets } from './widgets.js';
import { applyAvatar } from './avatar.js';
import { load as loadWorkCard } from './workcard.js';
import { SVG, icon } from './icons.js';
import { initSchedule, renderDaySetup, loadWorkSchedule, maybeOnboard, closePomoModal } from './schedule.js';
import { initWeekPlan, closeWeekPlan } from './weekplan.js';
import { THEMES, applyTheme, themeInfo } from './theme.js';

/* ══════════════════ Holat ══════════════════ */
const S = {
  user: null,
  settings: null,
  plan: null,          // { date, tasks, summary }
  date: todayStr(),
  timer: null,         // serverdan kelgan taymer
  cycle: 0,
  pendingMode: 'work', // taymer yo'q paytdagi tanlangan rejim
  activeTaskId: null,
  endAt: 0,            // running paytdagi tugash vaqti (ms)
  remaining: 0,
  completing: false,
  lastTickMinute: -1,
  statsDays: 7
};

const MODE_LABEL = { work: 'Ish', short: 'Qisqa tanaffus', long: 'Uzun tanaffus' };
const STATUS = {
  reja:      { label: 'Rejalashtirilgan', icon: '○' },
  jarayonda: { label: 'Jarayonda',        icon: '◐' },
  qabulga:   { label: 'Qabul qilishga',   icon: '◉' },
  bajarildi: { label: 'Bajarildi',        icon: '✔' }
};
const PRI_LABEL = { yuqori: 'Yuqori', orta: "O'rta", past: 'Past' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function todayStr(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function shiftDate(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtDuration(min) {
  min = Math.round(min);
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}
/**
 * Ixcham davomiylik: "1s 15d".
 *
 * Xulosa kartochkalari uchun. To'liq shakl ("1 soat 15 daq") tor kartada
 * ikki qatorga bo'linib, kartochkalar balandligini buzardi — chizmada esa
 * ular bir xil balandlikda turadi.
 */
function fmtDurationShort(min) {
  min = Math.round(min);
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}s ${m}d` : `${h}s`;
}

/** Yarim tundan oshgan vaqtga "+1" belgisi qo'shadi */
function tm(time, dayOffset) {
  if (!time) return '—';
  return dayOffset > 0 ? `${time}⁺¹` : time;
}
/** "28-sentabr" — sarlavhadagi katta yozuv (chizmadagi ko'rinish) */
function fmtDateShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  return `${d.getDate()}-${months[d.getMonth()]}`;
}
/** "Dushanba" */
function weekdayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'][d.getDay()];
}

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  return `${d.getDate()}-${months[d.getMonth()]}, ${days[d.getDay()]}`;
}

/* ══════════════════ Toast / Modal ══════════════════ */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '.3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

function confirmBox(title, text, yesLabel = 'Ha, davom etish') {
  return new Promise(resolve => {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalYes').textContent = yesLabel;
    $('overlay').hidden = false;
    const done = (val) => {
      $('overlay').hidden = true;
      $('modalYes').onclick = null;
      $('modalNo').onclick = null;
      resolve(val);
    };
    $('modalYes').onclick = () => done(true);
    $('modalNo').onclick = () => done(false);
    $('overlay').onclick = (e) => { if (e.target === $('overlay')) done(false); };
  });
}

/* Vazifani tahrirlash oynasi */
let editingId = null;

function openTaskEditor(task) {
  editingId = task.id;
  $('edTitle').value = task.title;
  $('edPomos').value = task.plannedPomodoros;
  $('edCategory').value = task.category;
  $('edPriority').value = task.priority || 'orta';
  $('edNote').value = task.note || '';
  fillMeet('edMt', task);
  syncMeet('edMt', task.category);
  editEstimate();

  const src = task.source;
  $('edSourceInfo').hidden = !src;
  if (src) {
    $('edSourceInfo').innerHTML = `Manba: <b>${esc(src.type)}${src.key ? ' · ' + esc(src.key) : ''}</b>`
      + (src.url ? ` — <a class="link-out" href="${esc(src.url)}" target="_blank" rel="noopener">ochish ↗</a>` : '');
  }
  $('taskOverlay').hidden = false;
  setTimeout(() => $('edTitle').focus(), 40);
}

function closeTaskEditor() {
  $('taskOverlay').hidden = true;
  editingId = null;
}

/* ══════════════════ Vazifani ko'rish ══════════════════ */

function openTaskView(task) {
  if (!task) return;
  const st = task.status || (task.done ? 'bajarildi' : 'reja');
  const done = task.donePomodoroCount || 0;

  $('viewTitle').textContent = task.title;

  $('viewMeta').innerHTML =
      `<span class="chip status ${st}">${STATUS[st].icon} ${STATUS[st].label}</span>`
    + `<span class="chip cat">${esc(CAT_LABELS[task.category] || task.category)}</span>`
    + `<span class="chip pri-${task.priority}">${PRI_LABEL[task.priority] || task.priority}</span>`
    + `<span class="chip">${fmtDateLong(task.date || S.date)}</span>`
    + (task.source ? `<span class="chip">${esc(task.source.type)}${task.source.key ? ' · ' + esc(task.source.key) : ''}</span>` : '');

  const stat = (val, lbl, sub = '') =>
    `<div class="vs-item"><b>${val}</b><span>${lbl}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;

  $('viewStats').innerHTML =
      stat(`${task.completedPomodoros}<small>/${task.plannedPomodoros}</small>`, 'Pomodoro',
           done ? `${done} tasi bajarilgan` : 'hali boshlanmagan')
    + stat(fmtDuration(task.focusMinutes ?? task.estimatedMinutes), 'Pomodorolar vaqti',
           `${task.plannedPomodoros} × ${S.plan?.setup?.workMinutes ?? 25} daq`)
    + stat(task.startTime ? `${tm(task.startTime, task.startDayOffset)}<i>→</i>${tm(task.endTime, task.endDayOffset)}` : '—',
           'Boshlanish – tugash', done ? 'haqiqiy vaqt' : 'rejadagi vaqt')
    + stat(task.spanMinutes ? fmtDuration(task.spanMinutes) : '—', 'Umumiy oraliq',
           'uzilishlar bilan birga')
    + (task.pausedMinutes > 0
        ? stat(fmtDuration(task.pausedMinutes), 'Pauza', `${task.pauseCount || 0} marta`)
        : '');

  $('viewNote').innerHTML = task.note
    ? `<div class="view-note">📝 ${esc(task.note)}</div>` : '';

  /* — Pomodorolar jurnali — */
  const list = task.pomodoros || [];
  $('viewLog').innerHTML = list.length
    ? `<table class="view-log">
        <thead><tr><th>#</th><th>Boshlandi</th><th>Tugadi</th><th>Davomiyligi</th><th>Manba</th></tr></thead>
        <tbody>${list.map(p => `<tr class="${p.actual ? '' : 'is-plan'}">
          <td>${p.n}</td>
          <td>${tm(p.from, p.fromDayOffset)}</td>
          <td>${tm(p.to, p.toDayOffset)}</td>
          <td>${p.minutes} daq</td>
          <td>${p.actual
            ? (p.manual
                ? `<span class="src-manual" title="${esc(p.reasonLabel)}">✍ Qo'lda${p.reasonLabel ? ' — ' + esc(p.reasonLabel) : ''}</span>`
                : '<span class="src-timer">⏱ Taymer</span>')
            : '<span class="src-plan">○ Reja</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<div class="empty-mini">Bu vazifaga hali pomodoro belgilanmagan.</div>';

  $('viewOverlay').hidden = false;
  setTimeout(() => $('viewClose').focus(), 40);
}

function closeTaskView() { $('viewOverlay').hidden = true; }

function bindTaskView() {
  $('viewClose').addEventListener('click', closeTaskView);
  $('viewOverlay').addEventListener('click', e => { if (e.target === $('viewOverlay')) closeTaskView(); });
}

/* ══════════════════ Hisobotni to'g'rlash ══════════════════ */
let loggingTask = null;
let logAfter = null;

/** To'g'rlash sabablari serverdan bir marta olinadi */
let correctionReasons = null;
async function ensureReasons() {
  if (correctionReasons) return correctionReasons;
  try {
    correctionReasons = (await api.correctionReasons()).reasons;
  } catch {
    correctionReasons = [{ key: 'boshqa', label: 'Boshqa sabab' }];
  }
  $('logReason').innerHTML = '<option value="" disabled selected>Sababni tanlang…</option>'
    + correctionReasons.map(r => `<option value="${r.key}">${esc(r.label)}</option>`).join('');
  return correctionReasons;
}

/**
 * @param {Object}   task    { id, title, date, plannedPomodoros, completedPomodoros }
 * @param {Function} [after] muvaffaqiyatli yozilgach chaqiriladi (hisobotni yangilash uchun)
 */
async function openLogTask(task, after) {
  if (!task) return;
  loggingTask = task;
  logAfter = typeof after === 'function' ? after : null;
  await ensureReasons();

  const qoldi = Math.max(0, task.plannedPomodoros - task.completedPomodoros);
  const kun = task.date && task.date !== S.date ? ` (${fmtDateLong(task.date)})` : '';
  $('logWhat').innerHTML = `<b>${esc(task.title)}</b>${kun} — hozir `
    + `${task.completedPomodoros}/${task.plannedPomodoros} pomodoro yozilgan`
    + (qoldi ? `, ${qoldi} ta qoldi.` : '.')
    + ' Taymersiz bajarilgan ishni shu yerdan qo\'shing — hisobotda sababi bilan ko\'rinadi.';

  $('logCount').value = Math.min(Math.max(1, qoldi || 1), 20);
  $('logMinutes').value = modeMinutes('work');
  $('logStart').value = '';
  $('logReason').value = '';
  $('logReasonNote').value = '';
  logReasonChanged();
  logPreview();
  $('logOverlay').hidden = false;
  setTimeout(() => $('logCount').focus(), 40);
}

/** «Boshqa sabab» tanlansa izoh majburiy bo'ladi */
function logReasonChanged() {
  const other = $('logReason').value === 'boshqa';
  $('logReasonNote').required = other;
  $('logNoteLabel').textContent = other ? 'Izoh (majburiy)' : 'Izoh (ixtiyoriy)';
  $('logReasonNote').placeholder = other ? 'Sababni yozing' : 'Qo\'shimcha tushuntirish';
}

function closeLogTask() {
  $('logOverlay').hidden = true;
  loggingTask = null;
  logAfter = null;
}

function logPreview() {
  const n = Math.max(1, +$('logCount').value || 1);
  const m = Math.max(1, +$('logMinutes').value || 25);
  const start = $('logStart').value;
  const jami = fmtDuration(n * m);
  let vaqt = 'hozirdan orqaga hisoblanadi';
  if (start) {
    const [h, mi] = start.split(':').map(Number);
    const end = new Date(0, 0, 0, h, mi + n * m);
    vaqt = `${start} – ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  }
  $('logPreview').textContent = `${n} × ${m} daq = ${jami} · ${vaqt}`;
}

function bindLogTask() {
  $('logCancel').addEventListener('click', closeLogTask);
  $('logOverlay').addEventListener('click', e => { if (e.target === $('logOverlay')) closeLogTask(); });
  for (const id of ['logCount', 'logMinutes', 'logStart']) {
    $(id).addEventListener('input', logPreview);
  }
  $('logReason').addEventListener('change', logReasonChanged);

  $('logForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!loggingTask) return;
    const start = $('logStart').value;
    const payload = {
      pomodoros: +$('logCount').value,
      minutes: +$('logMinutes').value,
      reason: $('logReason').value,
      reasonNote: $('logReasonNote').value.trim()
    };
    const kun = loggingTask.date || S.date;
    if (start) payload.startedAt = new Date(`${kun}T${start}:00`).toISOString();
    const planned = loggingTask.plannedPomodoros;
    const done = logAfter;
    try {
      const r = await guard(() => api.logPomodoros(loggingTask.id, payload));
      closeLogTask();
      if (kun === S.date) await loadPlan();
      if (document.querySelector('#view-stats.is-active')) loadStats();
      if (done) await done();
      toast(`${r.logged} ta pomodoro qo'shildi (${r.reasonLabel}) — «${r.task.title}» ${r.task.completedPomodoros}/${planned}`, 'ok');
    } catch { /* guard xabar berdi */ }
  });
}

/* ══════════════════ Vazifani boshqa kunga nusxalash ══════════════════ */
let copyingTask = null;

/** Haftalik jadval bo'yicha keyingi ish kuni (dam olish kunlarini o'tkazib yuboradi) */
async function nextWorkday(from) {
  const start = shiftDate(from, 1);
  try {
    const r = await api.planRange(start, shiftDate(from, 14));
    const d = r.days?.find(x => x.isWorkday);
    if (d) return d.date;
  } catch { /* aloqa yo'q — ertangi kunga qaytamiz */ }
  return start;
}

function openCopyTask(task) {
  if (!task) return;
  copyingTask = task;
  $('copyWhat').innerHTML = `<b>${esc(task.title)}</b> — ${task.plannedPomodoros} pomodoro `
    + `(${fmtDuration(task.plannedPomodoros * dayWorkMinutes())}). `
    + 'Asl vazifa shu kunda qoladi, nusxa toza holatda yaratiladi.';
  $('copyDate').value = shiftDate(S.date, 1);
  $('copyDate').min = todayStr();
  copyPreview();
  $('copyOverlay').hidden = false;
  setTimeout(() => $('copyDate').focus(), 40);
}

function closeCopyTask() {
  $('copyOverlay').hidden = true;
  copyingTask = null;
}

/** Tanlangan kunning bandligini oldindan ko'rsatamiz */
async function copyPreview() {
  const to = $('copyDate').value;
  const el = $('copyPreview');
  if (!to || !copyingTask) return el.textContent = '';
  el.textContent = 'Tekshirilmoqda…';
  try {
    const r = await api.planRange(to, to);
    const d = r.days?.[0];
    if (!d) return el.textContent = '';
    if (!d.isWorkday) {
      el.innerHTML = `<span class="warn-text">⚠ ${esc(d.weekdayName)} — dam olish kuni.</span> Vazifa baribir qo'shiladi.`;
      return;
    }
    const after = d.totalPomodoros + copyingTask.plannedPomodoros;
    const fits = after <= d.capacityPomodoros;
    el.innerHTML = `${esc(d.weekdayName)}, ${d.startTime}–${d.endTime}`
      + (d.lunch?.enabled ? ` · tushlik ${d.lunch.start}–${d.lunch.end}` : '')
      + ` · hozir ${d.totalPomodoros}/${d.capacityPomodoros} ta → `
      + (fits
        ? `<b>${after}/${d.capacityPomodoros}</b> — sig'adi`
        : `<span class="warn-text"><b>${after}/${d.capacityPomodoros}</b> — ish vaqtidan oshadi</span>`);
  } catch {
    el.textContent = '';
  }
}

function bindCopyTask() {
  $('copyCancel').addEventListener('click', closeCopyTask);
  $('copyOverlay').addEventListener('click', e => { if (e.target === $('copyOverlay')) closeCopyTask(); });
  $('copyDate').addEventListener('change', copyPreview);

  $('copyQuick').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    $('copyDate').value = b.dataset.day ? shiftDate(S.date, +b.dataset.day) : await nextWorkday(S.date);
    copyPreview();
  });

  $('copyForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!copyingTask) return;
    const to = $('copyDate').value;
    const title = copyingTask.title;
    try {
      await guard(() => api.copyTasks([copyingTask.id], to));
      closeCopyTask();
      if (to === S.date) await loadPlan();
      toast(`«${title}» ${fmtDateLong(to)} kuniga nusxalandi`, 'ok');
    } catch { /* guard xabar berdi */ }
  });
}

function editEstimate() {
  const n = Math.max(1, +$('edPomos').value || 1);
  $('edEstimate').textContent = fmtDuration(n * dayWorkMinutes());
}

async function guard(fn) {
  try { return await fn(); }
  catch (err) {
    if (err instanceof AuthError) { location.replace('/login.html'); throw err; }
    toast(err.message || 'Xatolik yuz berdi', 'err');
    setConn(false);
    throw err;
  }
}

function setConn(ok) {
  const el = $('conn');
  el.className = 'conn ' + (ok ? 'ok' : 'off');
  el.querySelector('span').textContent = ok ? 'Server ulangan' : 'Server bilan aloqa yo\'q';
}

/* ══════════════════ Ko'rinishlar ══════════════════ */
/* ══════════════ Profil bo'limlari ══════════════ */

const PROF_SECTIONS = ['umumiy', 'korinish', 'jadval', 'taymer', 'xavfsizlik', 'integratsiya', 'malumot'];
let integrationsLoaded = false;

/**
 * Profil ichidagi bo'limni ochadi.
 * Manzilga yozib qo'yiladi — havolani yuborish yoki sahifani yangilash mumkin.
 */
function showProfSection(name, { updateHash = true } = {}) {
  const sec = PROF_SECTIONS.includes(name) ? name : 'umumiy';

  document.querySelectorAll('#profRail .rail-item')
    .forEach(b => b.classList.toggle('is-active', b.dataset.sec === sec));
  document.querySelectorAll('.prof-sec')
    .forEach(s => s.classList.toggle('is-active', s.id === 'psec-' + sec));

  // Integratsiyalar og'ir — faqat kerak bo'lganda yuklanadi
  if (sec === 'integratsiya' && !integrationsLoaded) {
    integrationsLoaded = true;
    loadIntegrations();
  }
  if (updateHash) {
    const want = '#profil/' + sec;
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  document.querySelector('.prof-pane')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Hozir ochiq turgan bo'lim */
function currentProfSection() {
  const el = document.querySelector('.prof-sec.is-active');
  return el ? el.id.replace('psec-', '') : 'umumiy';
}

/** Manzildagi #profil/... ni o'qiydi */
function profSectionFromHash() {
  const m = /^#profil\/([a-z]+)$/.exec(location.hash);
  return m ? m[1] : null;
}

function setView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  $('userMenu').hidden = true;
  if (name === 'stats') loadStats();
  if (name === 'history') loadHistory();
  if (name === 'report') { $('repDate').value = S.date; loadReport(); }
  if (name === 'profile') {
    loadProfile();
    loadWorkSchedule();
    showProfSection(profSectionFromHash() || currentProfSection(), { updateHash: true });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════ Foydalanuvchi ══════════════════ */
function renderUser() {
  const u = S.user;
  if (!u) return;
  document.documentElement.style.setProperty('--uc', u.color || '#ff5f56');
  applyAvatar($('userAvatar'), u);
  $('userName').textContent = u.name;
  $('menuName').innerHTML = esc(u.name) + (u.role === 'owner' ? ' <span class="role-chip">EGA</span>' : '');
  $('menuEmail').textContent = u.email;
}

/* ══════════════════ Reja ══════════════════ */
async function loadPlan() {
  applyPlan(await guard(() => api.plan(S.date)));
}

/** Serverdan kelgan reja bilan ekranni yangilash */
function applyPlan(data) {
  S.plan = data;
  setConn(true);
  restoreActiveTask();          // sahifa yangilanganda tanlov yo'qolmasin
  renderPlan();
  renderDaySetup(data);
  renderActiveTask();
  taskEstimateText();
}

/* ══════════════════ Yig'iladigan bloklar (details) ══════════════════
   Native <details> animatsiyasiz ochiladi — balandlikni o'zimiz yumshoq
   o'zgartiramiz. Har bir blok uchun ochish/yopish funksiyalari qaytariladi. */

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function smoothDetails(details, { onOpen } = {}) {
  const summary = details.querySelector('summary');
  const content = summary?.nextElementSibling;
  if (!summary || !content) return { open: () => {}, close: () => {} };

  const EASE = 'cubic-bezier(.32,.72,0,1)';
  let anim = null;
  let guard = null;
  let selfCancel = false;

  const resetStyles = () => {
    content.style.overflow = '';
    content.style.height = '';
    content.style.opacity = '';
    content.style.transform = '';
  };

  /** Joriy animatsiyani o'zimiz bekor qilamiz (yakunlovchi ishlamasin) */
  const clearAnim = () => {
    clearTimeout(guard);
    guard = null;
    if (anim) {
      selfCancel = true;
      try { anim.cancel(); } catch {}
      selfCancel = false;
      anim = null;
    }
  };

  /** Fon rejimida yoki harakat kamaytirilgan bo'lsa — animatsiyasiz */
  const canAnimate = () =>
    !REDUCE_MOTION &&
    typeof content.animate === 'function' &&
    document.visibilityState === 'visible';

  /**
   * Animatsiyani ishga tushiradi. Yakuniy holat har qanday yo'l bilan
   * o'rnatiladi: tugaganda, brauzer bekor qilganda yoki kafolat taymeri bilan.
   */
  const play = (frames, duration, settleFn) => {
    content.style.overflow = 'hidden';
    anim = content.animate(frames, { duration, easing: EASE });

    const settle = () => {
      if (selfCancel) return;          // biz o'zimiz to'xtatgan bo'lsak — tegmaymiz
      clearTimeout(guard);
      guard = null;

      // Animatsiya hali tugamagan bo'lsa (masalan sahifa fonga o'tib qotib
      // qolgan) — uni to'xtatamiz, aks holda oxirgi kadrni ushlab turadi.
      const a = anim;
      anim = null;
      if (a && a.playState !== 'finished') {
        selfCancel = true;
        try { a.cancel(); } catch {}
        selfCancel = false;
      }

      settleFn();
      resetStyles();
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
    guard = setTimeout(settle, duration + 250);
  };

  const expand = () => {
    clearAnim();
    details.open = true;               // holat darhol o'rnatiladi
    if (!canAnimate()) { resetStyles(); onOpen?.(); return; }
    const h = content.offsetHeight;
    play(
      [{ height: '0px', opacity: 0, transform: 'translateY(-6px)' },
       { height: h + 'px', opacity: 1, transform: 'translateY(0)' }],
      260,
      () => onOpen?.()
    );
  };

  const collapse = () => {
    clearAnim();
    if (!canAnimate()) { details.open = false; resetStyles(); return; }
    const h = content.offsetHeight;
    play(
      [{ height: h + 'px', opacity: 1, transform: 'translateY(0)' },
       { height: '0px', opacity: 0, transform: 'translateY(-6px)' }],
      200,
      () => { details.open = false; }
    );
  };

  // Brauzerning tayyor ochilishini to'xtatib, o'zimiz boshqaramiz
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    if (details.open) collapse(); else expand();
  });

  return { open: expand, close: collapse };
}

/* ── Vazifa qo'shish bloki ── */
/* Faol vazifa tanlovi sahifa yangilanganda ham saqlanadi */
const ACTIVE_KEY = 'pmd_active_task';

function setActiveTask(id) {
  S.activeTaskId = id;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, S.date + '|' + id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* localStorage yopiq bo'lishi mumkin */ }
}

/** Saqlangan tanlovni tiklaydi — faqat shu kunniki va vazifa hali mavjud bo'lsa */
function restoreActiveTask() {
  if (S.activeTaskId) return;
  let raw = '';
  try { raw = localStorage.getItem(ACTIVE_KEY) || ''; } catch { return; }
  const [date, id] = raw.split('|');
  if (date !== S.date || !id) return;
  if (S.plan?.tasks.some(t => t.id === id)) S.activeTaskId = id;
}

/* ── Vazifa qo'shish oynasi ── */
function openAddForm() {
  $('addScope').textContent = `${fmtDateLong(S.date)} kuniga qo'shiladi`;
  $('addOverlay').hidden = false;
  setTimeout(() => $('taskTitle').focus(), 40);
}

function closeAddForm() { $('addOverlay').hidden = true; }

/* ── Kun tartibi yig'ilgan holatda qolsin ── */
const PLAN_KEY = 'pmd_plan_open';

function restoreFoldState() {
  const wrap = $('planWrap');
  let open = true;
  try { open = localStorage.getItem(PLAN_KEY) !== '0'; } catch {}
  wrap.open = open;
  smoothDetails(wrap);
  wrap.addEventListener('toggle', () => {
    try { localStorage.setItem(PLAN_KEY, wrap.open ? '1' : '0'); } catch {}
  });

  // Boshqa yig'iladigan bloklar ham xuddi shunday yumshoq ochilsin
  smoothDetails($('timelineWrap'));
  document.querySelectorAll('#view-profile details.integ, #view-profile details.fold')
    .forEach(d => smoothDetails(d));

  initCollapseBoxes();

  $('btnAddTask').addEventListener('click', openAddForm);
  $('addCancel').addEventListener('click', closeAddForm);
  $('addOverlay').addEventListener('click', e => { if (e.target === $('addOverlay')) closeAddForm(); });
}

/**
 * Maketda yo'q, lekin tizimda kerak bo'lgan bloklar yig'iladi.
 * `[data-collapse]` blokning birinchi `.sec-title` sarlavhasi tugmaga
 * aylanadi; holat shu brauzerda eslab qolinadi (`fold:<nom>`).
 * `data-default="closed"` bo'lsa — birinchi ochilishda yopiq turadi.
 */
function initCollapseBoxes() {
  document.querySelectorAll('[data-collapse]').forEach(box => {
    const head = box.querySelector(':scope > .sec-title');
    if (!head || head.dataset.ready) return;
    head.dataset.ready = '1';
    head.classList.add('collapse-head');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    if (!head.querySelector('.collapse-caret')) {
      head.insertAdjacentHTML('beforeend',
        '<svg class="collapse-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
    }
    const key = 'fold:' + box.dataset.collapse;
    let open = box.dataset.default !== 'closed';
    try { const v = localStorage.getItem(key); if (v !== null) open = v === '1'; } catch {}
    const apply = (o) => {
      box.classList.toggle('is-collapsed', !o);
      head.setAttribute('aria-expanded', String(o));
    };
    apply(open);
    const toggle = () => {
      open = !open; apply(open);
      try { localStorage.setItem(key, open ? '1' : '0'); } catch {}
    };
    head.addEventListener('click', e => { if (!e.target.closest('a, button:not(.collapse-head), input, select')) toggle(); });
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

/** Shu kun uchun amaldagi pomodoro davomiyligi */
function dayWorkMinutes() {
  return S.plan?.setup?.workMinutes || S.settings?.workMinutes || 25;
}

/* ══════════════════ Uchrashuv (meet / uchrashuv) ══════════════════ */

const MEET_CATS = new Set(['meet', 'uchrashuv']);
const isMeetCat = (c) => MEET_CATS.has(c);

/** Bir xil tuzilishdagi maydonlar to'plami — qo'shish (mt) va tahrirlash (edMt) uchun */
function meetFields(p) {
  return {
    box: $(p + 'Box'), start: $(p + 'Start'), end: $(p + 'End'), len: $(p + 'Len'),
    brOn: $(p + 'BrOn'), brRow: $(p + 'BrRow'), place: $(p + 'Place'),
    min: $(p + 'Min'), atField: $(p + 'AtField'), at: $(p + 'At')
  };
}

const hhmmToMin = (t) => { const [h, m] = String(t || '').split(':'); return (+h || 0) * 60 + (+m || 0); };

/** Uchrashuv oralig'i (daqiqa) — yarim tundan o'tsa ham to'g'ri sanaladi */
function meetSpanOf(f) {
  let d = hhmmToMin(f.end.value) - hhmmToMin(f.start.value);
  if (d <= 0) d += 1440;
  return d;
}

/**
 * Kategoriya uchrashuv bo'lsa — vaqt maydonlari ochiladi,
 * pomodoro soni va taxminiy vaqt esa yashiriladi (ular uchrashuvda ma'nosiz).
 */
function syncMeet(p, category) {
  const f = meetFields(p);
  if (!f.box) return;
  const on = isMeetCat(category);
  f.box.hidden = !on;

  const scope = f.box.closest('form') || document;
  scope.querySelectorAll('.pomo-field, .est-field').forEach(el => {
    el.hidden = on;
    if (el.parentElement) el.parentElement.classList.toggle('meet-on', on);
  });
  if (!on) return;

  const span = meetSpanOf(f);
  f.len.textContent = fmtDuration(span);
  f.brRow.hidden = !f.brOn.checked;
  f.atField.hidden = f.place.value !== 'vaqt';
  const maxBr = Math.max(1, span - 1);
  f.min.max = maxBr;
  if (+f.min.value > maxBr) f.min.value = maxBr;
  if (f.place.value === 'vaqt' && !f.at.value) f.at.value = f.start.value;
}

/** So'rov uchun uchrashuv maydonlari */
function meetPayload(p) {
  const f = meetFields(p);
  return {
    meetStart: f.start.value,
    meetEnd: f.end.value,
    meetBreak: f.brOn.checked
      ? {
          enabled: true,
          placement: f.place.value,
          minutes: +f.min.value || 0,
          at: f.place.value === 'vaqt' ? f.at.value : null
        }
      : { enabled: false }
  };
}

/** Uchrashuv maydonlarini vazifadan to'ldiradi */
function fillMeet(p, task) {
  const f = meetFields(p);
  if (!f.box) return;
  const br = task.meetBreak || {};
  f.start.value = task.meetStart || '10:00';
  f.end.value = task.meetEnd || '11:00';
  f.brOn.checked = !!br.enabled;
  f.place.value = br.placement || 'ortasida';
  f.min.value = br.minutes || 10;
  f.at.value = br.at || '';
}

/** Maydonlar o'zgarganda darhol qayta hisoblansin */
function wireMeet(p, catSelectId) {
  const f = meetFields(p);
  if (!f.box) return;
  const upd = () => syncMeet(p, $(catSelectId).value);
  $(catSelectId).addEventListener('change', upd);
  for (const el of [f.start, f.end, f.brOn, f.place, f.min, f.at]) {
    el.addEventListener('change', upd);
    el.addEventListener('input', upd);
  }
}

function taskEstimateText() {
  const n = Math.max(1, +$('taskPomos').value || 1);
  $('taskEstimate').textContent = fmtDuration(n * dayWorkMinutes());
}



function renderPlan() {
  const { tasks, summary } = S.plan;

  /* — Xulosa kartochkalari — */
  const cnt = { reja: 0, jarayonda: 0, qabulga: 0, bajarildi: 0 };
  for (const t of tasks) cnt[t.status || (t.done ? 'bajarildi' : 'reja')]++;

  const card = ({ tone = '', ico, value, unit = '', label, sub = '', twoLine = false }) => `
    <div class="sum-item ${tone}">
      <span class="si-ico">${ico}</span>
      <b class="${twoLine ? 'si-2line' : ''}">${value}${unit ? `<small>${unit}</small>` : ''}</b>
      <span class="si-label">${label}</span>
      ${sub ? `<span class="si-sub">${sub}</span>` : ''}
    </div>`;

  const pct = Math.min(100, summary.progressPercent);
  const busy = summary.utilizationPercent;

  /* Chizmada to'rtta karta: Pomodoro · Sof ish vaqti · Tanaffuslar · Vazifalar.
     Oldin oltita edi — «Kun jadvali» va «Ish vaqti bandligi» yo'qolmadi,
     ular sana sarlavhasi ostidagi qatorga ko'chdi (`dhSub`). */
  $('summary').innerHTML =
    card({
      tone: 'accent', ico: icon('pomodoro'),
      value: summary.completedPomodoros, unit: `/${summary.totalPomodoros}`,
      label: 'Pomodoro',
      sub: summary.remainingPomodoros ? `${summary.remainingPomodoros} ta qoldi` : 'Reja to\'liq bajarildi'
    })
  + card({
      ico: icon('focus'), value: fmtDurationShort(summary.workMinutes), label: 'Sof ish vaqti',
      sub: summary.pauseMinutes
        ? `⏸ ${fmtDuration(summary.pauseMinutes)} pauza`
        : summary.totalPomodoros ? `${summary.totalPomodoros} × ${summary.workMinutesUsed} daq` : 'Reja bo\'sh'
    })
  + card({
      tone: 'green', ico: icon('coffee'), value: fmtDurationShort(summary.breakMinutes), label: 'Tanaffuslar',
      sub: `${summary.shortBreaks} qisqa · ${summary.longBreaks} uzun`
        + (summary.lunch?.enabled ? ` · tushlik ${summary.lunch.start}` : '')
    })
  + card({
      tone: 'purple', ico: icon('check'),
      value: summary.doneTaskCount, unit: `/${summary.taskCount}`,
      label: 'Vazifalar',
      sub: tasks.length
        ? `<span class="si-dots">`
          + (cnt.reja ? `<i class="d-reja" title="Rejalashtirilgan">○ ${cnt.reja}</i>` : '')
          + (cnt.jarayonda ? `<i class="d-jarayonda" title="Jarayonda">◐ ${cnt.jarayonda}</i>` : '')
          + (cnt.qabulga ? `<i class="d-qabulga" title="Qabul qilishga">◉ ${cnt.qabulga}</i>` : '')
          + (cnt.bajarildi ? `<i class="d-bajarildi" title="Bajarildi">✔ ${cnt.bajarildi}</i>` : '')
          + `</span>`
        : 'Vazifa yo\'q'
    });

  /* — Sana sarlavhasi (chizmadagi katta yozuv) — */
  $('dhDate').textContent = fmtDateShort(S.date);
  const bandlik = summary.fits
    ? `bandlik ${busy}%`
    : `${fmtDuration(summary.overflowMinutes)} oshdi`;
  $('dhSub').innerHTML = `${weekdayName(S.date)} · Ish vaqti ${summary.dayStart}–${tm(summary.dayEnd, summary.dayEndOffset)}`
    + ` · <span class="${summary.fits ? '' : 'dh-warn'}">${bandlik}</span>`;

  /* — Kun bajarilishi — */
  $('dayPct').textContent = pct + '%';
  $('dayBar').firstElementChild.style.width = pct + '%';

  /* — Vazifalar — */
  const qoldi = tasks.filter(t => (t.status || (t.done ? 'bajarildi' : 'reja')) !== 'bajarildi').length;
  $('planCount').textContent = tasks.length
    ? (qoldi ? `${qoldi} ta qoldi · ${tasks.length} ta jami` : `${tasks.length} ta — hammasi bajarildi`)
    : '';

  const list = $('taskList');
  if (!tasks.length) {
    const isPast = S.date < todayStr();
    list.innerHTML = `<li class="empty"><b>📋</b>
      ${isPast ? 'Bu kunda vazifa kiritilmagan.' : 'Bu kun uchun hali vazifa qoʻshilmagan.'}<br>
      Yuqoridagi tugma orqali vazifa nomini yozing va unga nechta pomodoro kerakligini belgilang —
      tizim jadval va tanaffuslarni o'zi hisoblaydi.
      <div class="empty-actions">
        <button class="btn btn-mini btn-ghost" id="emptyFocus">+ Birinchi vazifani qo'shish</button>
        ${isPast ? '' : '<button class="btn btn-mini btn-ghost" id="emptyCopy">⧉ Kechagi rejadan nusxalash</button>'}
      </div>
      <div class="hint" style="margin-top:12px">Yorliqlar: <span class="kbd">N</span> — yangi vazifa, <span class="kbd">Probel</span> — taymerni boshlash/to'xtatish</div>
    </li>`;
    $('emptyFocus')?.addEventListener('click', openAddForm);
    $('emptyCopy')?.addEventListener('click', () => $('btnCopyYesterday').click());
  } else {
    list.innerHTML = tasks.map(t => {
      const color = CAT_COLORS[t.category] || CAT_COLORS.boshqa;
      const dots = Array.from({ length: t.plannedPomodoros }, (_, i) =>
        `<i class="${i < t.completedPomodoros ? 'on' : ''}"></i>`).join('');
      const extra = t.completedPomodoros > t.plannedPomodoros ? ` +${t.completedPomodoros - t.plannedPomodoros}` : '';
      const st = t.status || (t.done ? 'bajarildi' : 'reja');
      return `<li class="task st-${st} ${t.done ? 'is-done' : ''} ${t.overflow ? 'is-overflow' : ''} ${t.id === S.activeTaskId ? 'is-active' : ''}"
                  style="--cat:${color}" data-id="${t.id}" draggable="true">
        <span class="t-grip" title="Sudrab tartibni o'zgartiring">⠿</span>
        <span class="t-dot" aria-hidden="true">${st === 'bajarildi' ? icon('tick') : ''}</span>
        <div class="t-main">
          <span class="t-title">${esc(t.title)}</span>
          <div class="t-meta">
            ${st !== 'reja' ? `<span class="chip status ${st}">${STATUS[st].icon} ${STATUS[st].label}</span>` : ''}
            ${t.startTime ? `<span class="t-time ${t.overflow ? 'out' : ''} ${t.pinnedStart ? 'pinned' : ''}" title="${
              t.donePomodoroCount
                ? `Birinchi pomodoro boshlanishidan oxirgisining tugashigacha — ${fmtDuration(t.spanMinutes)}`
                : t.overflow ? 'Ish vaqtidan tashqarida' : 'Rejadagi vaqt'
            }">${t.pinnedStart ? '▶ ' : ''}${tm(t.startTime, t.startDayOffset)}–${tm(t.endTime, t.endDayOffset)}</span>` : ''}
            <span class="t-cat">${esc(CAT_LABELS[t.category] || t.category)}</span>
            <span class="t-pri pri-${t.priority}">${PRI_LABEL[t.priority] || ''}</span>
            ${t.pausedMinutes > 0 ? `<span class="t-pause" title="Pauzada o'tgan vaqt — tugash vaqti shunga surildi">⏸ ${fmtDuration(t.pausedMinutes)}</span>` : ''}
            ${t.note ? `<span class="t-note" title="${esc(t.note)}">${icon('note')}</span>` : ''}
          </div>
        </div>
        ${t.isMeet
          ? `<span class="t-count" title="Uchrashuv davomiyligi — tanaffus chiqarilgan">${fmtDuration(t.focusMinutes)}${
               t.meetBreakMinutes ? `<small>tanaffus ${t.meetBreakMinutes} daq</small>` : ''}</span>`
          : `<span class="t-pomos" title="${t.completedPomodoros}/${t.plannedPomodoros} pomodoro">${dots}</span>
        <span class="t-count" title="Pomodorolar davomiyliklari yig'indisi — oraliq cho'zilsa ham o'zgarmaydi">${t.completedPomodoros}/${t.plannedPomodoros}${extra}<small>${fmtDuration(t.focusMinutes ?? t.estimatedMinutes)}</small></span>`}
        <button class="t-btn t-more" type="button" aria-expanded="false" title="Amallar" aria-label="Amallar">${icon('more')}</button>
        <div class="t-actions">
          ${st === 'qabulga'
            ? `<button class="btn btn-mini t-accept" title="Vazifani bajarildi deb tasdiqlash">${icon('tick')} Bajarildi</button>`
            : st === 'bajarildi'
              ? `<button class="t-btn reopen" title="Qayta ochish">${icon('undo')}</button>`
              : ''}
          ${st === 'bajarildi' ? '' : `
          <button class="t-btn play" title="Shu vazifa ustida ishlashni boshlash">${icon('play')}</button>`}
          <button class="t-btn t-view" title="Vazifani ko'rish — pomodorolar jurnali">${icon('eye')}</button>
          <button class="t-btn copy" title="Boshqa kunga nusxalash">${icon('copy')}</button>
          ${st === 'bajarildi'
            ? `<button class="t-btn edit is-locked" title="Bajarilgan vazifani tahrirlab bo'lmaydi — avval qayta oching" disabled>${icon('lock')}</button>`
            : `<button class="t-btn edit" title="Tahrirlash">${icon('pencil')}</button>`}
          <button class="t-btn del" title="O'chirish">${icon('trash')}</button>
        </div>
      </li>`;
    }).join('');
  }

  /* — Kun jadvali — */
  const blocks = [];
  for (const t of tasks) for (const b of t.blocks) blocks.push({ ...b, task: t.title });
  // Vazifalar tushlikka yetib bormasa ham, tushlik jadvalda o'z o'rnida ko'rinsin
  if (S.plan.lunchBlock) blocks.push({ ...S.plan.lunchBlock, task: '' });
  blocks.sort((a, b) => (a.abs ?? 0) - (b.abs ?? 0));

  const LABEL = {
    long: 'Uzun tanaffus',
    short: 'Qisqa tanaffus',
    lunch: 'Tushlik — vazifa belgilanmaydi',
    pause: '⏸ Pauza — ishlanmagan vaqt',
    'meet-break': 'Uchrashuv ichidagi tanaffus'
  };

  $('timeline').innerHTML = blocks.length
    ? blocks.map(b => `<div class="tl-row ${b.overflow ? 'out' : ''}">
        <span class="tl-time">${tm(b.from, b.fromDayOffset)} – ${tm(b.to, b.toDayOffset)}</span>
        <div class="tl-bar ${b.type}">${b.type === 'work'
          ? `#${b.n} · ${esc(b.task)}`
          : b.type === 'meet'
            ? `${esc(b.meetTitle || b.task)} · uchrashuv · ${b.minutes} daq`
            : `${LABEL[b.type]} · ${b.minutes} daq`}</div>
      </div>`).join('')
    : '<div class="empty">Jadval bo\'sh</div>';
}

/** Ikkinchi taymer qatori — asosiy siferblatdan mustaqil ishlaydi */
function renderSecondTimer() {
  const box = $('secondTimer');
  if (!box) return;

  const t = S.second;
  box.hidden = !t;
  if (!t) return;

  const paused = t.status === 'paused';
  box.classList.toggle('is-paused', paused);
  $('stTitle').textContent = t.taskTitle || MODE_LABEL[t.mode] || 'Vazifasiz';
  $('stTitle').title = t.taskTitle || '';
  $('stClock').textContent = fmtClock(Math.max(0, t.remaining));

  const frac = t.durationSec > 0 ? 1 - Math.max(0, t.remaining) / t.durationSec : 0;
  $('stBar').style.width = (Math.min(1, Math.max(0, frac)) * 100).toFixed(1) + '%';
  $('stMain').textContent = paused ? 'Davom etish' : 'Pauza';
}

function renderActiveTask() {
  const t = S.plan?.tasks.find(x => x.id === S.activeTaskId);
  $('activeTaskTitle').textContent = t
    ? `${t.title} (${t.completedPomodoros}/${t.plannedPomodoros})`
    : 'Tanlanmagan — ro\'yxatdan ▶ tugmasini bosing';
  updateWidgets();
}

/* ══════════════════ Taymer ══════════════════ */
/** Shu kunning amaldagi sozlamasidan bosqich davomiyligi */
function modeMinutes(mode) {
  const s = S.plan?.setup || S.settings;
  return mode === 'short' ? s.shortBreakMinutes : mode === 'long' ? s.longBreakMinutes : s.workMinutes;
}

/**
 * Ikkita taymerdan qaysi biri asosiy siferblatda ko'rinadi.
 * 0-slot ustuvor; u yopilsa qolgani asosiyga aylanadi.
 */
function pickPrimary(list) {
  if (!list?.length) return null;
  return list.find(t => t.slot === 0) || list[0];
}

function applyTimerSnapshot(snap) {
  const prevActive = S.activeTaskId;
  const list = snap.timers || (snap.timer ? [snap.timer] : []);
  const primary = pickPrimary(list);

  S.timers = list;
  S.freeSlot = snap.freeSlot ?? null;
  S.maxTimers = snap.maxTimers ?? 2;
  S.timer = primary;
  S.cycle = snap.cycle ?? 0;

  // Ikkinchi taymer — asosiy bo'lmagani
  const second = list.find(t => t !== primary) || null;
  S.second = second
    ? { ...second, endAt: Date.now() + second.remainingSec * 1000, remaining: second.remainingSec }
    : null;
  S.secondCompleting = false;

  if (primary) {
    S.pendingMode = primary.mode;
    S.remaining = primary.remainingSec;
    S.endAt = Date.now() + primary.remainingSec * 1000;
    if (primary.taskId) setActiveTask(primary.taskId);
    // Pauza hisoblagichi: serverdagi jamlangan qiymat + shu paytdan o'tgani
    S.pausedBase = primary.pausedSec || 0;
    S.pausedSince = primary.status === 'paused' ? Date.now() : null;
  } else {
    S.remaining = modeMinutes(S.pendingMode) * 60;
    S.pausedBase = 0;
    S.pausedSince = null;
  }
  S.completing = false;
  renderTimer();
  renderSecondTimer();

  // Taymerdagi vazifa ekranda ham ko'rinsin. Sahifa yangilanganda reja
  // taymerdan oldin yuklanadi — bu yerda chizilmasa "Tanlanmagan" bo'lib qolardi.
  if (S.plan && S.activeTaskId !== prevActive) renderPlan();
  renderActiveTask();
}

function renderTimer() {
  const mode = S.timer ? S.timer.mode : S.pendingMode;
  const running = S.timer && S.timer.status === 'running';
  document.body.dataset.mode = mode;
  document.body.classList.toggle('is-running', !!running);

  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('is-active', p.dataset.mode === mode));

  const total = S.timer ? S.timer.durationSec : modeMinutes(mode) * 60;
  const rem = Math.max(0, S.remaining);
  $('clock').textContent = fmtClock(rem);

  const C = 2 * Math.PI * 106;
  const frac = total > 0 ? rem / total : 1;
  $('ringFg').setAttribute('stroke-dasharray', C.toFixed(2));
  $('ringFg').setAttribute('stroke-dashoffset', (C * (1 - frac)).toFixed(2));

  // Pauzada o'tgan vaqt jonli sanaladi — jadval shunga qarab suriladi
  const pausedSec = (S.pausedBase || 0) + (S.pausedSince ? (Date.now() - S.pausedSince) / 1000 : 0);
  $('dialSub').textContent = !S.timer
    ? `${MODE_LABEL[mode]} · ${modeMinutes(mode)} daqiqa`
    : running
      ? MODE_LABEL[mode] + ' davom etmoqda' + (pausedSec >= 60 ? ` · ⏸ ${fmtClock(pausedSec)} pauza` : '')
      : `${MODE_LABEL[mode]} — pauzada ${fmtClock(pausedSec)}`;

  $('btnMain').innerHTML = !S.timer
    ? `${icon('play')} Boshlash`
    : running ? `${icon('pause')} Pauza` : `${icon('play')} Davom etish`;
  $('btnSkip').disabled = !S.timer;
  $('btnStop').disabled = !S.timer;

  // Sikl nuqtalari
  const interval = S.settings.longBreakInterval;
  const filled = S.cycle % interval || (S.cycle && S.cycle % interval === 0 ? interval : 0);
  $('cycleDots').innerHTML = Array.from({ length: interval }, (_, i) =>
    `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
  $('cycleDots').title = `Uzun tanaffusgacha: ${Math.max(0, interval - filled)} pomodoro`;

  document.title = S.timer
    ? `${fmtClock(rem)} · ${MODE_LABEL[mode]} — Pomodoro`
    : 'Pomodoro — Ish jarayoni boshqaruvi';

  renderTodayMini();
  renderNotifNotice();
  updateWidgets();
  syncWorkCard();
}

/**
 * Taymer holati o'zgarsa ish kartasi ham yangilanadi.
 * Har soniyada emas — faqat holat haqiqatan boshqacha bo'lganda.
 */
let lastCardState = '';
function syncWorkCard() {
  if (document.querySelector('.view.is-active')?.id !== 'view-profile') return;
  const key = (S.timer ? S.timer.mode + ':' + S.timer.status + ':' + (S.timer.taskId || '') : 'yoq');
  if (key === lastCardState) return;
  lastCardState = key;
  loadWorkCard();
}

/** Bildirishnoma yoqilgan, lekin brauzer ruxsat bermagan bo'lsa — sababini tushuntiramiz */
function renderNotifNotice() {
  const el = $('notifNotice');
  if (!el) return;
  const perm = notifyPermission();
  if (!S.settings.notificationsEnabled || perm === 'granted' || perm === 'unsupported') {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (perm === 'denied') {
    el.innerHTML = '<span>🔕</span><span>Brauzer bildirishnomalarni bloklagan — pomodoro tugaganda faqat ovoz eshitiladi. '
      + 'Manzil satridagi qulf belgisidan ruxsat bering.</span>';
  } else {
    el.innerHTML = '<span>🔔</span><span>Bildirishnomalar uchun ruxsat kerak.</span>'
      + '<button type="button" id="noticeAsk">Ruxsat berish</button>';
    $('noticeAsk').addEventListener('click', async () => {
      await askNotifyPermission();
      updateNotifState();
      renderNotifNotice();
    });
  }
}

function renderTodayMini() {
  const s = S.plan?.summary;
  if (!s) return;
  const goal = S.settings.dailyGoal;
  $('todayMini').innerHTML = `
    <div class="mini"><b>${s.completedPomodoros}</b><span>Bugungi pomodoro</span></div>
    <div class="mini"><b>${s.remainingPomodoros}</b><span>Qoldi</span></div>
    <div class="mini"><b>${Math.round((s.completedPomodoros / Math.max(1, goal)) * 100)}%</b><span>Maqsad (${goal})</span></div>`;
}

function tick() {
  tickSecond();
  if (!S.timer) return;
  if (S.timer.status === 'running') {
    S.remaining = Math.max(0, (S.endAt - Date.now()) / 1000);
    const min = Math.floor(S.remaining / 60);
    if (S.settings.tickingEnabled && min !== S.lastTickMinute && S.remaining > 1) {
      S.lastTickMinute = min;
      playTick(S.settings.volume);
    }
    if (S.remaining <= 0.4 && !S.completing) {
      S.completing = true;
      finishStage();
      return;
    }
  }
  renderTimer();
}

/** Ikkinchi taymer ham mustaqil sanaydi va o'zi yakunlanadi */
function tickSecond() {
  const t = S.second;
  if (!t) return;
  if (t.status === 'running') {
    t.remaining = Math.max(0, (t.endAt - Date.now()) / 1000);
    if (t.remaining <= 0.4 && !S.secondCompleting) {
      S.secondCompleting = true;
      finishSecond();
      return;
    }
  }
  renderSecondTimer();
}

/** Ikkinchi taymer tugadi — faqat o'sha slot yakunlanadi */
async function finishSecond() {
  const t = S.second;
  if (!t) return;
  try {
    const res = await api.complete({ slot: t.slot });
    applyTimerSnapshot(res);
    await loadPlan();
    if (S.settings.soundEnabled) playAlarm(t.mode === 'work' ? 'work' : 'break', S.settings.volume);
    toast(`«${t.taskTitle || 'Ikkinchi vazifa'}» pomodorosi yakunlandi`, 'ok');
  } catch (err) {
    if (err instanceof AuthError) { location.replace('/login.html'); return; }
    S.secondCompleting = false;
    await syncTimer();
    await loadPlan();
  }
}

async function finishStage() {
  const finishedMode = S.timer.mode;
  try {
    const res = await api.complete({ slot: S.timer.slot ?? 0 });
    await afterStage(res, finishedMode, true);
  } catch (err) {
    if (err instanceof AuthError) { location.replace('/login.html'); return; }
    // Taymer boshqa oynada allaqachon yakunlangan bo'lishi mumkin — shunchaki sinxronlaymiz
    S.completing = false;
    await syncTimer();
    await loadPlan();
  }
}

async function afterStage(res, finishedMode, wasNatural) {
  applyTimerSnapshot(res);
  await loadPlan();

  if (wasNatural) {
    const isWork = finishedMode === 'work';
    if (S.settings.soundEnabled) playAlarm(isWork ? 'work' : 'break', S.settings.volume);
    if (S.settings.notificationsEnabled) {
      notify(
        isWork ? '🍅 Pomodoro tugadi!' : '✅ Tanaffus tugadi',
        isWork
          ? `${MODE_LABEL[res.nextMode]} vaqti — ${modeMinutes(res.nextMode)} daqiqa dam oling.`
          : 'Keyingi pomodoroni boshlash vaqti keldi.'
      );
    }
    toast(finishedMode === 'work' ? 'Pomodoro yakunlandi 🍅' : 'Tanaffus tugadi', 'ok');
  }

  S.pendingMode = res.nextMode || 'work';
  S.remaining = modeMinutes(S.pendingMode) * 60;
  renderTimer();

  if (wasNatural && res.autoStart) {
    scheduleAutoStart(S.pendingMode);
  }
}

/* ── Avtomatik boshlash: 5 soniyalik sanoq, bekor qilish mumkin ── */
let autoTimer = null;

function cancelAutoStart() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  $('autoNext').hidden = true;
}

function scheduleAutoStart(mode) {
  cancelAutoStart();
  let left = 5;
  const el = $('autoNext');
  const label = MODE_LABEL[mode];

  const paint = () => {
    el.innerHTML = `<span>▶</span><span>${esc(label)} <b>${left}</b> soniyadan keyin boshlanadi</span>`
      + '<button type="button" id="autoCancel">Bekor qilish</button>';
    $('autoCancel').onclick = cancelAutoStart;
  };
  el.hidden = false;
  paint();

  autoTimer = setInterval(async () => {
    left--;
    if (left > 0) return paint();
    cancelAutoStart();
    await startTimer(mode);
  }, 1000);
}

/** Ishlash uchun keyingi mos vazifa: rejadagi yoki jarayondagi, pomodorosi qolgan */
function nextPendingTask() {
  const tasks = S.plan?.tasks || [];
  return tasks.find(t => !t.done && t.status !== 'qabulga' && t.completedPomodoros < t.plannedPomodoros)
      || tasks.find(t => !t.done && t.completedPomodoros < t.plannedPomodoros)
      || null;
}

async function startTimer(mode) {
  unlockAudio();
  // Bildirishnoma yoqilgan, lekin ruxsat so'ralmagan bo'lsa — hozir so'raymiz
  if (S.settings.notificationsEnabled && notifyPermission() === 'default') {
    await askNotifyPermission();
  }
  if (mode === 'work') {
    const active = S.plan?.tasks.find(t => t.id === S.activeTaskId);
    // Faol vazifa tugagan yoki tanlanmagan bo'lsa — keyingisiga o'tamiz
    if (!active || active.done || active.completedPomodoros >= active.plannedPomodoros) {
      const next = nextPendingTask();
      if (next) setActiveTask(next.id);
    }
  }
  const res = await guard(() => api.start({
    mode,
    date: S.date,
    taskId: mode === 'work' ? S.activeTaskId : null
  }));
  applyTimerSnapshot(res);
  S.lastTickMinute = -1;
  // Ish boshlangani jadvalni o'zgartiradi: vazifa haqiqiy vaqtga bog'lanadi
  if (mode === 'work') await loadPlan();
  renderActiveTask();
  toast(`${MODE_LABEL[mode]} boshlandi — ${modeMinutes(mode)} daqiqa`, 'ok');
}

/**
 * Ikkinchi vazifani parallel boshlaydi.
 * Birinchisi to'xtamaydi — ikkalasi ham hisoblanadi.
 */
async function startSecondTask(taskId) {
  unlockAudio();
  const res = await guard(() => api.start({ mode: 'work', date: S.date, taskId, slot: S.freeSlot }));
  applyTimerSnapshot(res);
  await loadPlan();
  renderActiveTask();
  const t = S.timers.find(x => x.taskId === taskId);
  toast(`«${t?.taskTitle || 'Vazifa'}» parallel boshlandi — ikkalasi ham hisoblanadi`, 'ok');
}

/* ══════════════════ Statistika ══════════════════ */
async function loadStats() {
  const st = await guard(() => api.stats(S.date, S.statsDays));
  const t = st.today;
  const isToday = S.date === todayStr();
  const dayLabel = isToday ? 'Bugungi' : fmtDateLong(S.date) + ' —';

  $('kpiGrid').innerHTML = `
    <div class="kpi a"><div class="kpi-val">${t.pomodoros}</div><div class="kpi-lbl">${dayLabel} pomodorolar</div>
      <div class="kpi-sub">Maqsad: ${t.goal} · ${t.goalPercent}%</div></div>
    <div class="kpi g"><div class="kpi-val">${fmtDuration(t.focusMinutes)}</div><div class="kpi-lbl">Sof fokus vaqti</div>
      <div class="kpi-sub">Tanaffus: ${fmtDuration(t.breakMinutes)}</div></div>
    <div class="kpi b"><div class="kpi-val">${t.tasksDone}/${t.tasksTotal}</div><div class="kpi-lbl">Bajarilgan vazifalar</div>
      <div class="kpi-sub">Reja bajarilishi: ${t.planPercent}%</div></div>
    <div class="kpi p"><div class="kpi-val">${st.streak}</div><div class="kpi-lbl">Ketma-ket kunlar</div>
      <div class="kpi-sub">${st.totals.activeDays} faol kun jami</div></div>
    <div class="kpi"><div class="kpi-val">${st.totals.rangePomodoros}</div><div class="kpi-lbl">${st.range.days} kunlik jami</div>
      <div class="kpi-sub">${fmtDuration(st.totals.rangeFocusMinutes)} fokus</div></div>
    <div class="kpi"><div class="kpi-val">${st.totals.avgPerActiveDay}</div><div class="kpi-lbl">Kunlik o'rtacha</div>
      <div class="kpi-sub">${st.totals.bestDay ? `Rekord: ${st.totals.bestDay.pomodoros} (${st.totals.bestDay.date})` : 'Rekord yo\'q'}</div></div>
    <div class="kpi"><div class="kpi-val">${st.totals.focusHours}</div><div class="kpi-lbl">Umumiy fokus (soat)</div>
      <div class="kpi-sub">${st.totals.pomodoros} pomodoro</div></div>
    <div class="kpi"><div class="kpi-val">${t.interruptions}</div><div class="kpi-lbl">${isToday ? 'Bugun' : 'Shu kuni'} uzilishlar</div>
      <div class="kpi-sub">Tugatilmagan sessiyalar</div></div>`;

  $('chartDaily').innerHTML = dailyChart(st.series, st.today.goal, $('chartDaily').clientWidth);
  $('chartCategory').innerHTML = categoryBars(st.categories);
  $('chartHourly').innerHTML = hourlyChart(st.hourly, $('chartHourly').clientWidth);
  $('topTasks').innerHTML = topTasksList(st.topTasks);
}

/* ══════════════════ Tarix ══════════════════ */
async function loadHistory() {
  if (!$('histTo').value) {
    $('histTo').value = todayStr();
    $('histFrom').value = shiftDate(todayStr(), -29);
  }
  const data = await guard(() => api.history($('histFrom').value, $('histTo').value));
  if (!data.days.length) {
    $('historyList').innerHTML = '<div class="empty">Bu oraliqda ma\'lumot yo\'q</div>';
    return;
  }
  $('historyList').innerHTML = data.days.map((d, i) => `
    <details class="hday" ${i === 0 ? 'open' : ''}>
      <summary>
        <span class="hday-date">${fmtDateLong(d.date)}</span>
        <span class="hday-bar" title="${d.pomodoros} pomodoro"><i style="width:${Math.min(100, Math.round(d.pomodoros / Math.max(1, S.settings?.dailyGoal || 8) * 100))}%"></i></span>
        <span class="hday-stat" title="Pomodoro"><b>${d.pomodoros}</b> pomodoro</span>
        <span class="hday-stat">Fokus: <b>${fmtDuration(d.focusMinutes)}</b></span>
        <span class="hday-stat">Tanaffus: <b>${fmtDuration(d.breakMinutes)}</b></span>
        ${d.interruptions ? `<span class="hday-stat">Uzilish: <b>${d.interruptions}</b></span>` : ''}
        <span class="hday-stat">${d.tasks.filter(t => t.done).length}/${d.tasks.length} vazifa</span>
      </summary>
      <div class="hday-body">
        ${d.tasks.length ? d.tasks.map(t => `
          <div class="hrow">
            <span>${t.done ? '<span class="ok-mark">✔</span>' : '<span class="no-mark">○</span>'} ${esc(t.title)}
              <span class="chip cat" style="--cat:${CAT_COLORS[t.category] || CAT_COLORS.boshqa}">${esc(CAT_LABELS[t.category] || t.category)}</span></span>
            <span class="hint">${t.completedPomodoros}/${t.plannedPomodoros} pomodoro</span>
            <span class="hint">${fmtDuration(t.focusMinutes)}</span>
          </div>`).join('') : '<div class="hint" style="padding:10px 0">Vazifa kiritilmagan</div>'}
      </div>
    </details>`).join('');
}

/* ══════════════════ Sozlamalar ══════════════════ */
/** Element bo'lmasa jimgina o'tkazib yuboradi */
const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
const setChk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

function fillSettings() {
  const s = S.settings;
  setVal('setWork', s.workMinutes);
  setVal('setShort', s.shortBreakMinutes);
  setVal('setLong', s.longBreakMinutes);
  setVal('setInterval', s.longBreakInterval);
  setVal('setGoal', s.dailyGoal);
  setChk('setAutoBreak', s.autoStartBreaks);
  setChk('setAutoWork', s.autoStartWork);
  setChk('setSound', s.soundEnabled);
  setVal('setVolume', Math.round(s.volume * 100));
  setChk('setNotif', s.notificationsEnabled);
  applyTheme(s.theme);
  renderThemeGrid(s.theme);
  const info = themeInfo(s.theme);
  $('themeToggle').textContent = THEME_ICON[info.id] || '🎨';
  $('themeToggle').title = info.name + ' — bosib keyingisiga o\'tish';
  updateNotifState();
}

/* Topbar tugmasidagi belgi. Uslub nomini ko'rsatishga joy yo'q,
   shuning uchun har biriga bitta belgi. */
const THEME_ICON = {
  glass: '🔮', clay: '🧱', skeuo: '📼', neu: '🧼', dark: '🌙', light: '☀️'
};

/**
 * Sozlamalardagi uslub tanlagichni chizadi.
 *
 * Har bir namuna o'z uslubining ranglari bilan ko'rsatiladi (`themes.css`
 * dagi `.tp-*`), shuning uchun tanlashdan oldin qanday ko'rinishi ma'lum.
 */
function renderThemeGrid(current) {
  const box = $('themeGrid');
  if (!box) return;
  box.innerHTML = THEMES.map(th => `
    <button type="button" class="theme-card" data-theme-id="${th.id}"
            aria-pressed="${th.id === current}">
      <span class="theme-prev ${th.preview}">
        <i class="tp-bar"></i>
        <span class="tp-row"><i class="tp-dial"></i><i class="tp-body"></i></span>
      </span>
      <span class="theme-name">${esc(th.name)}</span>
      <span class="theme-note">${esc(th.note)}</span>
    </button>`).join('');
}

function updateNotifState() {
  const p = notifyPermission();
  const map = {
    granted: 'Ruxsat berilgan ✔',
    denied: 'Ruxsat rad etilgan — brauzer sozlamasidan yoqing',
    default: 'Ruxsat so\'ralmagan',
    unsupported: 'Brauzer qo\'llab-quvvatlamaydi'
  };
  $('notifState').textContent = map[p] || '';
}

async function saveSettings(patch) {
  const res = await guard(() => api.saveSettings(patch));
  S.settings = res.settings;
  fillSettings();
  taskEstimateText();
  await loadPlan();
  if (!S.timer) { S.remaining = modeMinutes(S.pendingMode) * 60; }
  renderTimer();
  renderNotifNotice();
}

/* ══════════════════ Hodisalar ══════════════════ */
function bindEvents() {
  bindTaskView();
  bindCopyTask();
  bindLogTask();

  /* Tablar */
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) setView(b.dataset.view);
  });

  /* Foydalanuvchi menyusi */
  $('userBtn').addEventListener('click', e => {
    e.stopPropagation();
    $('userMenu').hidden = !$('userMenu').hidden;
    if (!$('userMenu').hidden) placeUserMenu();
  });
  // Menyu tugmaning tagida, o'ng chetiga tekislangan holda ochiladi —
  // sarlavha markazda turgani uchun ekran chetiga yopishtirib bo'lmaydi
  function placeUserMenu() {
    const r = $('userBtn').getBoundingClientRect();
    const m = $('userMenu');
    m.style.top = Math.round(r.bottom + 8) + 'px';
    m.style.right = Math.max(10, Math.round(window.innerWidth - r.right)) + 'px';
    m.style.left = 'auto';
  }
  window.addEventListener('resize', () => { if (!$('userMenu').hidden) placeUserMenu(); });
  document.addEventListener('click', e => {
    if (!$('userMenu').hidden && !e.target.closest('#userMenu') && !e.target.closest('#userBtn')) {
      $('userMenu').hidden = true;
    }
  });
  $('userMenu').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    $('userMenu').hidden = true;
    const act = b.dataset.act;
    if (act === 'profile') return setView('profile');
    if (act === 'report') return setView('report');
    if (act === 'integrations') {
      setView('profile');
      showProfSection('integratsiya');
      return;
    }
    if (act === 'logout') {
      const ok = await confirmBox('Chiqish', 'Tizimdan chiqmoqchimisiz?', 'Chiqish');
      if (!ok) return;
      try { await api.logout(); } catch {}
      location.replace('/login.html');
    }
  });

  /* Ko'rinish uslubi — topbar tugmasi ro'yxat bo'ylab aylantiradi */
  $('themeToggle').addEventListener('click', () => {
    const i = THEMES.findIndex(th => th.id === S.settings.theme);
    saveSettings({ theme: THEMES[(i + 1) % THEMES.length].id });
  });

  /* Sozlamalardagi tanlagich */
  $('themeGrid').addEventListener('click', e => {
    const card = e.target.closest('.theme-card');
    if (!card || card.dataset.themeId === S.settings.theme) return;
    // Bosilgan zahoti qo'llanadi: server javobini kutib turish sekin ko'rinadi
    applyTheme(card.dataset.themeId);
    saveSettings({ theme: card.dataset.themeId });
  });

  /* Rejim tanlash */
  $('modePills').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    if (S.timer) { toast('Avval joriy taymerni to\'xtating', 'err'); return; }
    S.pendingMode = p.dataset.mode;
    S.remaining = modeMinutes(S.pendingMode) * 60;
    renderTimer();
  });

  /* Asosiy boshqaruv */
  $('btnMain').addEventListener('click', async () => {
    unlockAudio();
    cancelAutoStart();
    if (!S.timer) return startTimer(S.pendingMode);
    const where = { slot: S.timer.slot ?? 0 };
    if (S.timer.status === 'running') {
      applyTimerSnapshot(await guard(() => api.pause(where)));
      toast('Pauza — bu vaqt hisobga olinadi va jadval suriladi');
    } else {
      applyTimerSnapshot(await guard(() => api.resume(where)));
      // Pauzada o'tgan vaqt vazifa tugash vaqtini surdi — jadvalni yangilaymiz
      await loadPlan();
    }
  });

  $('btnSkip').addEventListener('click', async () => {
    if (!S.timer) return;
    const mode = S.timer.mode;
    if (mode === 'work') {
      const ok = await confirmBox('Pomodoroni o\'tkazib yuborish',
        'Joriy pomodoro hisobga olinmaydi. Davom etamizmi?', 'Ha, o\'tkazish');
      if (!ok) return;
    }
    const res = await guard(() => api.skip({ slot: S.timer.slot ?? 0 }));
    await afterStage(res, mode, false);
    toast(mode === 'work' ? 'Pomodoro o\'tkazib yuborildi' : 'Tanaffus o\'tkazib yuborildi');
  });

  $('btnStop').addEventListener('click', async () => {
    if (!S.timer) return;
    const mode = S.timer.mode;
    const ok = await confirmBox('Taymerni to\'xtatish',
      'Joriy sessiya bekor qilinadi (1 daqiqadan uzun ish vaqti tarixga "uzilgan" deb yoziladi).', 'To\'xtatish');
    if (!ok) return;
    const res = await guard(() => api.stop({ slot: S.timer.slot ?? 0 }));
    await afterStage(res, mode, false);
    toast('Taymer to\'xtatildi');
  });

  /* Ikkinchi taymer */
  $('stMain').addEventListener('click', async () => {
    const t = S.second;
    if (!t) return;
    const where = { slot: t.slot };
    if (t.status === 'running') {
      applyTimerSnapshot(await guard(() => api.pause(where)));
    } else {
      applyTimerSnapshot(await guard(() => api.resume(where)));
      await loadPlan();
    }
  });

  $('stStop').addEventListener('click', async () => {
    const t = S.second;
    if (!t) return;
    const ok = await confirmBox('Ikkinchi taymerni to\'xtatish',
      `«${t.taskTitle || 'Vazifasiz'}» bo'yicha joriy sessiya bekor qilinadi.`, 'To\'xtatish');
    if (!ok) return;
    applyTimerSnapshot(await guard(() => api.stop({ slot: t.slot })));
    await loadPlan();
    toast('Ikkinchi taymer to\'xtatildi');
  });

  /* Sana */
  const goDate = (d) => {
    S.date = d;
    $('datePicker').value = d;
    if (!S.timer) setActiveTask(null);     // boshqa kunga o'tganda faol vazifa tozalanadi
    loadPlan();
  };
  /* ── Yarim tundan o'tish ──
     `S.date` ilgari FAQAT sahifa yuklanganda hisoblanardi. Oyna kechadan
     o'tib ochiq qolsa, ilova kechagi kunda qolib ketardi va o'sha kuni
     qo'shilgan vazifalar o'tgan kunga yozilardi (`createdAt` bugungi,
     `date` esa kechagi bo'lib qolardi).

     Endi har yarim daqiqada tekshiriladi. Foydalanuvchi ataylab boshqa
     kunni ochib qo'ygan bo'lsa tegilmaydi — faqat "bugun" da turganini
     yangi kunga surib qo'yamiz. */
  let kuzatilganKun = todayStr();
  setInterval(() => {
    const hozir = todayStr();
    if (hozir === kuzatilganKun) return;
    const avvalgi = kuzatilganKun;
    kuzatilganKun = hozir;
    if (S.date !== avvalgi) return;        // boshqa kunni ko'rib turibdi
    goDate(hozir);
    toast('Yangi kun boshlandi — «Bugun» ' + hozir + ' ga o\'tdi');
  }, 30000);

  $('datePicker').addEventListener('change', () => goDate($('datePicker').value || todayStr()));
  $('datePrev').addEventListener('click', () => goDate(shiftDate(S.date, -1)));
  $('dateNext').addEventListener('click', () => goDate(shiftDate(S.date, 1)));
  $('dateToday').addEventListener('click', () => goDate(todayStr()));

  /* Vazifa qo'shish */
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('taskTitle').value.trim();
    if (!title) { toast('Vazifa nomini kiriting', 'err'); $('taskTitle').focus(); return; }
    const category = $('taskCategory').value;
    const payload = {
      date: S.date,
      title,
      plannedPomodoros: +$('taskPomos').value || 1,
      category,
      priority: $('taskPriority').value
    };
    if (isMeetCat(category)) Object.assign(payload, meetPayload('mt'));
    await guard(() => api.addTask(payload));
    $('taskTitle').value = '';
    $('taskTitle').focus();
    await loadPlan();
    toast('Vazifa qo\'shildi', 'ok');
  });

  document.querySelectorAll('.step').forEach(btn => btn.addEventListener('click', () => {
    const inp = $('taskPomos');
    inp.value = Math.max(1, Math.min(30, (+inp.value || 1) + (+btn.dataset.step)));
    taskEstimateText();
  }));
  $('taskPomos').addEventListener('input', taskEstimateText);
  wireMeet('mt', 'taskCategory');
  wireMeet('edMt', 'edCategory');

  /* Reja amallari */
  $('btnCopyYesterday').addEventListener('click', async () => {
    const from = shiftDate(S.date, -1);
    const ok = await confirmBox('Rejani nusxalash', `${fmtDateLong(from)} kunidagi vazifalar shu kunga qo'shiladi.`, 'Nusxalash');
    if (!ok) return;
    const res = await guard(() => api.copyPlan(from, S.date));
    await loadPlan();
    toast(`${res.created} ta vazifa nusxalandi`, 'ok');
  });

  $('btnCarry').addEventListener('click', async () => {
    const to = shiftDate(S.date, 1);
    const ok = await confirmBox('Ertaga ko\'chirish', `Bajarilmagan vazifalar ${fmtDateLong(to)} kuniga ko'chiriladi.`, 'Ko\'chirish');
    if (!ok) return;
    const res = await guard(() => api.carryOver(S.date, to));
    await loadPlan();
    toast(`${res.moved} ta vazifa ko'chirildi`, 'ok');
  });

  /* Vazifa ro'yxati amallari */
  $('taskList').addEventListener('click', async e => {
    const li = e.target.closest('.task');
    if (!li) return;
    // «⋯» — maketda yo'q amallar yig'ilgan; bosilganda shu qatorniki ochiladi
    const more = e.target.closest('.t-more');
    if (more) {
      const open = !li.classList.contains('is-open');
      document.querySelectorAll('#taskList .task.is-open').forEach(x => {
        x.classList.remove('is-open'); x.querySelector('.t-more')?.setAttribute('aria-expanded', 'false');
      });
      li.classList.toggle('is-open', open);
      more.setAttribute('aria-expanded', String(open));
      return;
    }
    const id = li.dataset.id;
    const task = S.plan.tasks.find(t => t.id === id);

    if (e.target.closest('.play')) {
      // Shu vazifa ustida allaqachon ishlanyaptimi
      if ((S.timers || []).some(t => t.taskId === id)) {
        toast('Bu vazifa ustida ish allaqachon boshlangan');
        return;
      }
      setActiveTask(id);
      renderActiveTask();
      renderPlan();

      // Taymer yo'q bo'lsa oddiy boshlash, bo'sh slot bo'lsa — ikkinchi vazifa
      if (!S.timer) { await startTimer('work'); return; }
      if (S.freeSlot !== null && S.freeSlot !== undefined) {
        await startSecondTask(id);
        return;
      }
      toast(`Bir vaqtda ko'pi bilan ${S.maxTimers || 2} ta vazifa ustida ishlash mumkin`, 'warn');
      return;
    }
    if (e.target.closest('.t-view')) {
      openTaskView(task);
      return;
    }
    if (e.target.closest('.copy')) {
      openCopyTask(task);
      return;
    }
    if (e.target.closest('.t-accept')) {
      await guard(() => api.updateTask(id, { status: 'bajarildi' }));
      await loadPlan();
      toast('Vazifa bajarildi deb belgilandi', 'ok');
      return;
    }
    if (e.target.closest('.reopen')) {
      await guard(() => api.updateTask(id, {
        status: task.completedPomodoros >= task.plannedPomodoros ? 'qabulga' : (task.completedPomodoros ? 'jarayonda' : 'reja')
      }));
      await loadPlan();
      toast('Vazifa qayta ochildi');
      return;
    }
    if (e.target.closest('.del')) {
      const ok = await confirmBox('Vazifani o\'chirish', `"${task.title}" o'chirilsinmi?`, 'O\'chirish');
      if (!ok) return;
      await guard(() => api.deleteTask(id));
      if (S.activeTaskId === id) setActiveTask(null);
      await loadPlan();
      toast('Vazifa o\'chirildi');
      return;
    }
    if (e.target.closest('.edit')) {
      if (task.status === 'bajarildi') {
        toast('Bajarilgan vazifani tahrirlab bo\'lmaydi — avval ↩ bilan qayta oching', 'err');
        return;
      }
      openTaskEditor(task);
    }
  });

  /* Drag & drop */
  let dragId = null;
  $('taskList').addEventListener('dragstart', e => {
    const li = e.target.closest('.task');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  $('taskList').addEventListener('dragend', e => {
    e.target.closest('.task')?.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  });
  $('taskList').addEventListener('dragover', e => {
    e.preventDefault();
    const li = e.target.closest('.task');
    document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    if (li && li.dataset.id !== dragId) li.classList.add('drag-over');
  });
  $('taskList').addEventListener('drop', async e => {
    e.preventDefault();
    const li = e.target.closest('.task');
    document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    if (!li || !dragId || li.dataset.id === dragId) return;
    const ids = S.plan.tasks.map(t => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(li.dataset.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await guard(() => api.reorder(ids));
    dragId = null;
    await loadPlan();
  });

  /* Statistika oraliqlari */
  $('statsRange').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $('statsRange').querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
    S.statsDays = +b.dataset.days;
    loadStats();
  });

  /* Tarix */
  $('histLoad').addEventListener('click', loadHistory);
  const exportHistory = async (btn, format) => {
    btn.disabled = true;
    try {
      const name = await downloadFile(api.exportUrl(format, $('histFrom').value, $('histTo').value));
      toast(`Yuklab olindi: ${name}`, 'ok');
    } catch (err) {
      if (err instanceof AuthError) return location.replace('/login.html');
      toast('Yuklab olinmadi — ' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  };
  $('expJson').addEventListener('click', e => exportHistory(e.currentTarget, 'json'));
  $('expCsv').addEventListener('click', e => exportHistory(e.currentTarget, 'csv'));
  $('impFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const ok = await confirmBox('Import qilish',
        `${(payload.tasks || []).length} vazifa va ${(payload.sessions || []).length} sessiya mavjud ma'lumotlarga qo'shiladi.`, 'Import qilish');
      if (!ok) return;
      const res = await guard(() => api.importData({ ...payload, mode: 'merge' }));
      toast(`${res.addedTasks} vazifa, ${res.addedSessions} sessiya import qilindi`, 'ok');
      await loadPlan();
      await loadHistory();
    } catch (err) {
      toast('Fayl o\'qilmadi: ' + err.message, 'err');
    }
    e.target.value = '';
  });

  /* Sozlamalar */
  const numMap = {
    setWork: 'workMinutes', setShort: 'shortBreakMinutes', setLong: 'longBreakMinutes',
    setInterval: 'longBreakInterval', setGoal: 'dailyGoal'
  };
  for (const [id, key] of Object.entries(numMap)) {
    $(id)?.addEventListener('change', () => saveSettings({ [key]: +$(id).value }));
  }
  $('setAutoBreak')?.addEventListener('change', () => saveSettings({ autoStartBreaks: $('setAutoBreak').checked }));
  $('setAutoWork')?.addEventListener('change', () => saveSettings({ autoStartWork: $('setAutoWork').checked }));
  $('setSound')?.addEventListener('change', () => saveSettings({ soundEnabled: $('setSound').checked }));
  $('setNotif')?.addEventListener('change', async () => {
    if ($('setNotif').checked) await askNotifyPermission();
    saveSettings({ notificationsEnabled: $('setNotif').checked });
  });
  $('setVolume')?.addEventListener('change', () => saveSettings({ volume: +$('setVolume').value / 100 }));

  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const [w, s, l, i] = b.dataset.preset.split(',').map(Number);
    saveSettings({ workMinutes: w, shortBreakMinutes: s, longBreakMinutes: l, longBreakInterval: i });
    toast('Shablon qo\'llanildi', 'ok');
  }));

  /* Profil bo'limlari orasida yurish */
  $('profRail')?.addEventListener('click', (e) => {
    const b = e.target.closest('.rail-item');
    if (b) showProfSection(b.dataset.sec);
  });
  $('testSound').addEventListener('click', () => { unlockAudio(); playAlarm('test', S.settings.volume); });
  $('askNotif').addEventListener('click', async () => {
    const p = await askNotifyPermission();
    updateNotifState();
    if (p === 'granted') { notify('Bildirishnoma yoqildi ✔', 'Endi pomodoro tugaganda xabar olasiz.'); toast('Ruxsat berildi', 'ok'); }
    else toast('Ruxsat berilmadi', 'err');
  });

  $('btnResetSettings').addEventListener('click', async () => {
    const ok = await confirmBox('Sozlamalarni tiklash', 'Barcha sozlamalar boshlang\'ich holatga qaytariladi.', 'Tiklash');
    if (!ok) return;
    const res = await guard(() => api.resetSettings());
    S.settings = res.settings;
    fillSettings();
    await loadPlan();
    toast('Sozlamalar tiklandi', 'ok');
  });
  $('btnClearSessions').addEventListener('click', async () => {
    const ok = await confirmBox('Tarixni tozalash', 'Barcha sessiya yozuvlari o\'chiriladi. Vazifalar saqlanadi.', 'O\'chirish');
    if (!ok) return;
    await guard(() => api.clear('sessions'));
    await loadPlan();
    toast('Sessiyalar tarixi tozalandi');
  });
  $('btnClearAll').addEventListener('click', async () => {
    const ok = await confirmBox('Hammasini o\'chirish', 'Barcha vazifalar va sessiyalar butunlay o\'chiriladi. Bu amalni qaytarib bo\'lmaydi.', 'Ha, o\'chirish');
    if (!ok) return;
    await guard(() => api.clear('all'));
    S.activeTaskId = null;
    await loadPlan();
    applyTimerSnapshot(await guard(() => api.timer()));
    toast('Barcha ma\'lumotlar o\'chirildi');
  });

  /* Tahrirlash oynasi */
  $('edCancel').addEventListener('click', closeTaskEditor);
  $('taskOverlay').addEventListener('click', e => { if (e.target === $('taskOverlay')) closeTaskEditor(); });
  $('edPomos').addEventListener('input', editEstimate);
  document.querySelectorAll('[data-edstep]').forEach(btn => btn.addEventListener('click', () => {
    const inp = $('edPomos');
    inp.value = Math.max(1, Math.min(30, (+inp.value || 1) + (+btn.dataset.edstep)));
    editEstimate();
  }));
  $('taskEditForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('edTitle').value.trim();
    if (!title) { toast('Vazifa nomini kiriting', 'err'); return; }
    const category = $('edCategory').value;
    const patch = {
      title,
      plannedPomodoros: +$('edPomos').value || 1,
      category,
      priority: $('edPriority').value,
      note: $('edNote').value.trim()
    };
    if (isMeetCat(category)) Object.assign(patch, meetPayload('edMt'));
    await guard(() => api.updateTask(editingId, patch));
    closeTaskEditor();
    await loadPlan();
    toast('Vazifa yangilandi', 'ok');
  });

  /* Klaviatura yorliqlari */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // Modal ochiq bo'lsa — faqat Escape ishlaydi
    if (!$('overlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); $('modalNo').click(); }
      return;
    }
    if (!$('taskOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeTaskEditor(); }
      return;
    }
    if (!$('pomoOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closePomoModal(); }
      return;
    }
    if (!$('weekPlanOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeWeekPlan(); }
      return;
    }
    if (!$('addOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeAddForm(); }
      return;
    }
    if (!$('viewOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeTaskView(); }
      return;
    }
    if (!$('copyOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeCopyTask(); }
      return;
    }
    if (!$('logOverlay').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeLogTask(); }
      return;
    }
    if (e.key === 'Escape') { $('userMenu').hidden = true; return; }

    // Matn maydonlarida yorliqlar ishlamaydi
    const el = e.target;
    const tag = (el.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag) || el.isContentEditable) return;

    // Fokus tugma/havolada bo'lsa — brauzerning o'zi ishga tushiradi, aralashmaymiz
    const onControl = ['button', 'a', 'summary', 'label'].includes(tag);

    if (e.code === 'Space' && !onControl) { e.preventDefault(); $('btnMain').click(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddForm(); }
  });

  /* Fon rejimidan qaytganda serverdan aniq holatni olamiz */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTimer(); });
  window.addEventListener('focus', syncTimer);
}

async function syncTimer() {
  try {
    const snap = await api.timer();
    setConn(true);
    // Taymer allaqachon tugagan bo'lsa (masalan, kompyuter uxlagan) — yakunlaymiz
    if (snap.timer && snap.timer.remainingSec <= 0 && !S.completing) {
      S.completing = true;
      const mode = snap.timer.mode;
      const res = await api.complete();
      await afterStage(res, mode, true);
      return;
    }
    applyTimerSnapshot(snap);
  } catch { setConn(false); }
}

/* ══════════════════ Ishga tushirish ══════════════════ */
async function init() {
  // 1) Kim kirgan?
  let me;
  try {
    me = await api.me();
    setConn(true);
  } catch {
    setConn(false);
    toast('Serverga ulanib bo\'lmadi. Server ishlab turibdimi?', 'err');
    return;
  }
  // Bosh manzilga — u yerda mehmon taqdimot sahifasini ko'radi
  if (!me.user) { location.replace('/'); return; }

  S.user = me.user;
  S.settings = me.settings;
  renderUser();

  // 2) Umumiy kontekstni qo'shimcha modullarga uzatamiz
  const ctx = {
    state: S,
    esc, toast, confirmBox, guard, todayStr, fmtDuration, fmtDateLong,
    loadPlan,
    applyPlan,
    setView,
    openLogTask,                 // hisobotni to'g'rlash oynasi
    setUser: (u) => { S.user = u; renderUser(); }
  };
  initFeatures(ctx);
  initSchedule(ctx);
  initWeekPlan(ctx);
  initWidgets(ctx);

  fillSettings();
  $('datePicker').value = S.date;
  $('repDate').value = todayStr();
  $('genDate').value = todayStr();
  $('histTo').value = todayStr();
  $('histFrom').value = shiftDate(todayStr(), -29);
  taskEstimateText();

  restoreFoldState();
  bindEvents();

  // Manzil #profil/... bo'lsa darhol o'sha bo'limni ochamiz
  if (profSectionFromHash()) setView('profile');
  await loadPlan();
  applyTimerSnapshot(await api.timer());
  loadOauthSettings(S.user);
  maybeOnboard(me.onboarded);

  setInterval(tick, 250);
  setInterval(syncTimer, 20000);
}

init();
