import { api, AuthError } from './api.js';
import { playAlarm, playTick, notify, notifyPermission, askNotifyPermission, unlockAudio } from './sound.js';
import { dailyChart, hourlyChart, categoryBars, topTasksList, CAT_COLORS, CAT_LABELS } from './charts.js';
import { initFeatures, loadProfile, loadReport, loadIntegrations, loadOauthSettings } from './features.js';
import { initSchedule, renderDaySetup, loadWorkSchedule, maybeOnboard, closePomoModal } from './schedule.js';
import { initWeekPlan, closeWeekPlan } from './weekplan.js';

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
/** Yarim tundan oshgan vaqtga "+1" belgisi qo'shadi */
function tm(time, dayOffset) {
  if (!time) return '—';
  return dayOffset > 0 ? `${time}⁺¹` : time;
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
function setView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  $('userMenu').hidden = true;
  if (name === 'stats') loadStats();
  if (name === 'history') loadHistory();
  if (name === 'report') { $('repDate').value = S.date; loadReport(); }
  if (name === 'profile') { loadProfile(); loadWorkSchedule(); }
  if (name === 'settings') loadIntegrations();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════ Foydalanuvchi ══════════════════ */
function renderUser() {
  const u = S.user;
  if (!u) return;
  document.documentElement.style.setProperty('--uc', u.color || '#ff5f56');
  $('userAvatar').textContent = u.avatar || '🍅';
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
const ADD_KEY = 'pmd_add_open';
let addFold = null;

/** Blokni ochib, kursorni nom maydoniga qo'yadi */
function openAddForm() {
  if ($('addWrap').open) { $('taskTitle').focus(); return; }
  addFold?.open();
}

function restoreAddFormState() {
  let open = false;
  try { open = localStorage.getItem(ADD_KEY) === '1'; } catch {}
  $('addWrap').open = open;

  addFold = smoothDetails($('addWrap'), { onOpen: () => $('taskTitle').focus() });

  $('addWrap').addEventListener('toggle', () => {
    try { localStorage.setItem(ADD_KEY, $('addWrap').open ? '1' : '0'); } catch {}
  });

  // Boshqa yig'iladigan bloklar ham xuddi shunday yumshoq ochilsin
  smoothDetails($('timelineWrap'));
  document.querySelectorAll('#view-settings details.integ').forEach(d => smoothDetails(d));
}

/** Shu kun uchun amaldagi pomodoro davomiyligi */
function dayWorkMinutes() {
  return S.plan?.setup?.workMinutes || S.settings?.workMinutes || 25;
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

  $('summary').innerHTML =
    card({
      tone: 'accent', ico: '🍅',
      value: summary.completedPomodoros, unit: `/${summary.totalPomodoros}`,
      label: 'Pomodoro',
      sub: summary.remainingPomodoros ? `${summary.remainingPomodoros} ta qoldi` : 'Reja to\'liq bajarildi'
    })
  + card({
      ico: '⏱', value: fmtDuration(summary.workMinutes), label: 'Sof ish vaqti',
      sub: summary.totalPomodoros ? `${summary.totalPomodoros} × ${summary.workMinutesUsed} daq` : 'Reja bo\'sh'
    })
  + card({
      tone: 'green', ico: '☕', value: fmtDuration(summary.breakMinutes), label: 'Tanaffuslar',
      sub: `${summary.shortBreaks} qisqa · ${summary.longBreaks} uzun`
    })
  + card({
      tone: 'blue', ico: '📅', twoLine: true,
      value: `<span>${summary.dayStart}</span><span><i>→</i>${tm(summary.dayEnd, summary.dayEndOffset)}</span>`,
      label: 'Kun jadvali',
      sub: fmtDuration(summary.totalMinutes) + (summary.overnight ? ' · ertasi kunga o\'tadi' : '')
    })
  + card({
      tone: summary.fits ? '' : 'warn', ico: summary.fits ? '📊' : '⚠️',
      value: busy, unit: '%', label: 'Ish vaqti bandligi',
      sub: summary.fits
        ? `Bo'sh: ${fmtDuration(summary.freeMinutes)} · sig'imi ${summary.capacityPomodoros} 🍅`
        : `${fmtDuration(summary.overflowMinutes)} oshdi · ${summary.extraPomodoros} ta sig'maydi`
    })
  + card({
      tone: 'purple', ico: '✅',
      value: summary.doneTaskCount, unit: `/${summary.taskCount}`,
      label: 'Vazifalar bajarildi',
      sub: tasks.length
        ? `<span class="si-dots">`
          + (cnt.reja ? `<i class="d-reja" title="Rejalashtirilgan">○ ${cnt.reja}</i>` : '')
          + (cnt.jarayonda ? `<i class="d-jarayonda" title="Jarayonda">◐ ${cnt.jarayonda}</i>` : '')
          + (cnt.qabulga ? `<i class="d-qabulga" title="Qabul qilishga">◉ ${cnt.qabulga}</i>` : '')
          + (cnt.bajarildi ? `<i class="d-bajarildi" title="Bajarildi">✔ ${cnt.bajarildi}</i>` : '')
          + `</span>`
        : 'Vazifa yo\'q'
    })
  + `<div class="sum-bar">
       <div class="sum-bar-head">
         <span>Kun bajarilishi</span>
         <b>${pct}%</b>
       </div>
       <div class="bar"><i style="width:${pct}%"></i></div>
     </div>`;

  /* — Vazifalar — */
  const list = $('taskList');
  if (!tasks.length) {
    const isPast = S.date < todayStr();
    list.innerHTML = `<li class="empty"><b>📋</b>
      ${isPast ? 'Bu kunda vazifa kiritilmagan.' : 'Bu kun uchun hali vazifa qoʻshilmagan.'}<br>
      Yuqoridagi maydonga vazifa nomini yozing va unga necha 🍅 kerakligini belgilang —
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
        <div class="t-main">
          <span class="t-title">${esc(t.title)}</span>
          <div class="t-meta">
            <span class="chip status ${st}">${STATUS[st].icon} ${STATUS[st].label}</span>
            <span class="chip cat">${esc(CAT_LABELS[t.category] || t.category)}</span>
            ${t.priority === 'yuqori' ? '<span class="chip pri-yuqori">Yuqori</span>' : ''}
            ${t.startTime ? `<span class="chip time ${t.overflow ? 'out' : ''}" title="${t.overflow ? 'Ish vaqtidan tashqarida' : ''}">${tm(t.startTime, t.startDayOffset)}–${tm(t.endTime, t.endDayOffset)}</span>` : ''}
            <span class="t-pomos" title="${t.completedPomodoros}/${t.plannedPomodoros} pomodoro">${dots}</span>
            <span>${t.completedPomodoros}/${t.plannedPomodoros}${extra} · ${fmtDuration(t.estimatedMinutes)}</span>
            ${t.note ? `<span title="${esc(t.note)}">📝</span>` : ''}
          </div>
        </div>
        <div class="t-actions">
          ${st === 'qabulga'
            ? '<button class="btn btn-mini t-accept" title="Vazifani bajarildi deb tasdiqlash">✔ Bajarildi</button>'
            : st === 'bajarildi'
              ? '<button class="t-btn reopen" title="Qayta ochish">↩</button>'
              : ''}
          <button class="t-btn play" title="Shu vazifa ustida ishlashni boshlash">▶</button>
          <button class="t-btn edit" title="Tahrirlash">✎</button>
          <button class="t-btn del" title="O'chirish">✕</button>
        </div>
      </li>`;
    }).join('');
  }

  /* — Kun jadvali — */
  const blocks = [];
  for (const t of tasks) for (const b of t.blocks) blocks.push({ ...b, task: t.title });
  $('timeline').innerHTML = blocks.length
    ? blocks.map(b => `<div class="tl-row ${b.overflow ? 'out' : ''}">
        <span class="tl-time">${tm(b.from, b.fromDayOffset)} – ${tm(b.to, b.toDayOffset)}</span>
        <div class="tl-bar ${b.type}">${b.type === 'work'
          ? `#${b.n} · ${esc(b.task)}`
          : (b.type === 'long' ? 'Uzun tanaffus' : 'Qisqa tanaffus') + ` · ${b.minutes} daq`}</div>
      </div>`).join('')
    : '<div class="empty">Jadval bo\'sh</div>';
}

function renderActiveTask() {
  const t = S.plan?.tasks.find(x => x.id === S.activeTaskId);
  $('activeTaskTitle').textContent = t
    ? `${t.title} (${t.completedPomodoros}/${t.plannedPomodoros})`
    : 'Tanlanmagan — ro\'yxatdan ▶ tugmasini bosing';
}

/* ══════════════════ Taymer ══════════════════ */
/** Shu kunning amaldagi sozlamasidan bosqich davomiyligi */
function modeMinutes(mode) {
  const s = S.plan?.setup || S.settings;
  return mode === 'short' ? s.shortBreakMinutes : mode === 'long' ? s.longBreakMinutes : s.workMinutes;
}

function applyTimerSnapshot(snap) {
  S.timer = snap.timer;
  S.cycle = snap.cycle ?? 0;
  if (snap.timer) {
    S.pendingMode = snap.timer.mode;
    S.remaining = snap.timer.remainingSec;
    S.endAt = Date.now() + snap.timer.remainingSec * 1000;
    if (snap.timer.taskId) S.activeTaskId = snap.timer.taskId;
  } else {
    S.remaining = modeMinutes(S.pendingMode) * 60;
  }
  S.completing = false;
  renderTimer();
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

  $('dialSub').textContent = !S.timer
    ? `${MODE_LABEL[mode]} · ${modeMinutes(mode)} daqiqa`
    : (running ? MODE_LABEL[mode] + ' davom etmoqda' : MODE_LABEL[mode] + ' — pauzada');

  $('btnMain').textContent = !S.timer ? '▶ Boshlash' : (running ? '⏸ Pauza' : '▶ Davom etish');
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
    <div class="mini"><b>${s.completedPomodoros}</b><span>Bugungi 🍅</span></div>
    <div class="mini"><b>${s.remainingPomodoros}</b><span>Qoldi</span></div>
    <div class="mini"><b>${Math.round((s.completedPomodoros / Math.max(1, goal)) * 100)}%</b><span>Maqsad (${goal})</span></div>`;
}

function tick() {
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

async function finishStage() {
  const finishedMode = S.timer.mode;
  try {
    const res = await api.complete();
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
      if (next) S.activeTaskId = next.id;
    }
  }
  const res = await guard(() => api.start({
    mode,
    date: S.date,
    taskId: mode === 'work' ? S.activeTaskId : null
  }));
  applyTimerSnapshot(res);
  S.lastTickMinute = -1;
  renderActiveTask();
  toast(`${MODE_LABEL[mode]} boshlandi — ${modeMinutes(mode)} daqiqa`, 'ok');
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

  $('chartDaily').innerHTML = dailyChart(st.series, st.today.goal);
  $('chartCategory').innerHTML = categoryBars(st.categories);
  $('chartHourly').innerHTML = hourlyChart(st.hourly);
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
    $('historyList').innerHTML = '<div class="empty"><b>🗂</b>Bu oraliqda ma\'lumot yo\'q</div>';
    return;
  }
  $('historyList').innerHTML = data.days.map((d, i) => `
    <details class="hday" ${i === 0 ? 'open' : ''}>
      <summary>
        <span class="hday-date">${fmtDateLong(d.date)}</span>
        <span class="hday-stat">🍅 <b>${d.pomodoros}</b></span>
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
            <span class="hint">${t.completedPomodoros}/${t.plannedPomodoros} 🍅</span>
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
  document.documentElement.dataset.theme = s.theme;
  $('themeToggle').textContent = s.theme === 'dark' ? '🌙' : '☀️';
  updateNotifState();
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
  /* Tablar */
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) setView(b.dataset.view);
  });

  /* Foydalanuvchi menyusi */
  $('userBtn').addEventListener('click', e => {
    e.stopPropagation();
    $('userMenu').hidden = !$('userMenu').hidden;
  });
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
      setView('settings');
      setTimeout(() => {
        $('integrationsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    if (act === 'logout') {
      const ok = await confirmBox('Chiqish', 'Tizimdan chiqmoqchimisiz?', 'Chiqish');
      if (!ok) return;
      try { await api.logout(); } catch {}
      location.replace('/login.html');
    }
  });

  /* Mavzu */
  $('themeToggle').addEventListener('click', () => {
    const next = S.settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings({ theme: next });
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
    if (S.timer.status === 'running') applyTimerSnapshot(await guard(() => api.pause()));
    else { applyTimerSnapshot(await guard(() => api.resume())); }
  });

  $('btnSkip').addEventListener('click', async () => {
    if (!S.timer) return;
    const mode = S.timer.mode;
    if (mode === 'work') {
      const ok = await confirmBox('Pomodoroni o\'tkazib yuborish',
        'Joriy pomodoro hisobga olinmaydi. Davom etamizmi?', 'Ha, o\'tkazish');
      if (!ok) return;
    }
    const res = await guard(() => api.skip());
    await afterStage(res, mode, false);
    toast(mode === 'work' ? 'Pomodoro o\'tkazib yuborildi' : 'Tanaffus o\'tkazib yuborildi');
  });

  $('btnStop').addEventListener('click', async () => {
    if (!S.timer) return;
    const mode = S.timer.mode;
    const ok = await confirmBox('Taymerni to\'xtatish',
      'Joriy sessiya bekor qilinadi (1 daqiqadan uzun ish vaqti tarixga "uzilgan" deb yoziladi).', 'To\'xtatish');
    if (!ok) return;
    const res = await guard(() => api.stop());
    await afterStage(res, mode, false);
    toast('Taymer to\'xtatildi');
  });

  /* Sana */
  const goDate = (d) => {
    S.date = d;
    $('datePicker').value = d;
    if (!S.timer) S.activeTaskId = null;   // boshqa kunga o'tganda faol vazifa tozalanadi
    loadPlan();
  };
  $('datePicker').addEventListener('change', () => goDate($('datePicker').value || todayStr()));
  $('datePrev').addEventListener('click', () => goDate(shiftDate(S.date, -1)));
  $('dateNext').addEventListener('click', () => goDate(shiftDate(S.date, 1)));
  $('dateToday').addEventListener('click', () => goDate(todayStr()));

  /* Vazifa qo'shish */
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('taskTitle').value.trim();
    if (!title) { toast('Vazifa nomini kiriting', 'err'); $('taskTitle').focus(); return; }
    await guard(() => api.addTask({
      date: S.date,
      title,
      plannedPomodoros: +$('taskPomos').value || 1,
      category: $('taskCategory').value,
      priority: $('taskPriority').value
    }));
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
    const id = li.dataset.id;
    const task = S.plan.tasks.find(t => t.id === id);

    if (e.target.closest('.play')) {
      S.activeTaskId = id;
      renderActiveTask();
      renderPlan();
      if (S.timer) { toast('Faol vazifa keyingi pomodoroda qo\'llanadi'); return; }
      await startTimer('work');
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
      if (S.activeTaskId === id) S.activeTaskId = null;
      await loadPlan();
      toast('Vazifa o\'chirildi');
      return;
    }
    if (e.target.closest('.edit')) {
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
  $('expJson').addEventListener('click', () => { window.location.href = api.exportUrl('json', $('histFrom').value, $('histTo').value); });
  $('expCsv').addEventListener('click', () => { window.location.href = api.exportUrl('csv', $('histFrom').value, $('histTo').value); });
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

  $('gotoProfileSettings')?.addEventListener('click', () => setView('profile'));
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
    await guard(() => api.updateTask(editingId, {
      title,
      plannedPomodoros: +$('edPomos').value || 1,
      category: $('edCategory').value,
      priority: $('edPriority').value,
      note: $('edNote').value.trim()
    }));
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
    toast('Serverga ulanib bo\'lmadi. `node server.js` ishlab turibdimi?', 'err');
    return;
  }
  if (!me.user) { location.replace('/login.html'); return; }

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
    setUser: (u) => { S.user = u; renderUser(); }
  };
  initFeatures(ctx);
  initSchedule(ctx);
  initWeekPlan(ctx);

  fillSettings();
  $('datePicker').value = S.date;
  $('repDate').value = todayStr();
  $('genDate').value = todayStr();
  $('histTo').value = todayStr();
  $('histFrom').value = shiftDate(todayStr(), -29);
  taskEstimateText();

  restoreAddFormState();
  bindEvents();
  await loadPlan();
  applyTimerSnapshot(await api.timer());
  loadOauthSettings(S.user);
  maybeOnboard(me.onboarded);

  setInterval(tick, 250);
  setInterval(syncTimer, 20000);
}

init();
