/**
 * Vidjetlar — taymer va vazifalarni ekran burchagiga yig'ish,
 * hamda ularni alohida, hamma oyna ustida turadigan oynaga chiqarish.
 *
 * Ikki rejim bor:
 *   1) Sahifa ichida — burchakda suzib turadigan panel.
 *   2) Alohida oynada — Document Picture-in-Picture. Brauzer haqiqiy
 *      OS oynasini beradi, u boshqa dasturlar ustida qoladi. Shunda
 *      brauzerni yig'ib qo'yib boshqa ish qilsangiz ham taymer ko'rinadi.
 *
 * Vidjet o'z mantiqini yozmaydi: tugmalari asosiy kartalardagi tugmalarni
 * bosadi. Shuning uchun xatti-harakat har doim bir xil bo'ladi.
 *
 * Muhim: elementlar bir marta topib olinadi (E). Alohida oynaga
 * ko'chirilganda tugunning o'zi o'zgarmaydi, shuning uchun havolalar
 * ishlayveradi — har safar getElementById qilinsa, ko'chirilgandan keyin
 * null qaytardi.
 */

let C = null;
const $ = (id) => document.getElementById(id);
const STORE = 'pmd_widgets';

const MODE_LABEL = { work: 'Ish', short: 'Qisqa tanaffus', long: 'Uzun tanaffus' };
const STATUS_ICON = { reja: '○', jarayonda: '◐', qabulga: '◉', bajarildi: '✔' };

const CORNERS = ['tl', 'tr', 'bl', 'br'];

/** Alohida oynani brauzer qo'llab-quvvatlaydimi */
export const pipSupported = () => 'documentPictureInPicture' in window;

/** Holat: qaysi vidjet ochiq, yig'ilganmi va qaysi burchakda */
let W = { timer: false, tasks: false, foldTimer: false, foldTasks: false, corner: 'br' };

/** Bir marta topib olingan elementlar */
const E = {};
/** Ochiq alohida oyna */
let pipWin = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    W = { ...W, ...raw };
    if (!CORNERS.includes(W.corner)) W.corner = 'br';
  } catch { /* birinchi ochilish */ }
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(W)); } catch { /* xotira yopiq */ }
}

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s % 60);
}

/* ═══════════════ Ko'rinish ═══════════════ */

/**
 * Yuqori burchakdagi vidjet yopishqoq topbar ustiga chiqmasligi uchun
 * uning balandligi o'lchanadi — topbar tor ekranda ikki qatorga tushadi.
 */
function syncTopOffset() {
  const bar = document.querySelector('.topbar');
  const h = bar ? Math.round(bar.getBoundingClientRect().height) : 64;
  document.documentElement.style.setProperty('--wdock-top', (h + 14) + 'px');
}

function applyLayout() {
  if (!E.dock) return;
  const inPip = !!pipWin;

  syncTopOffset();
  E.dock.dataset.corner = W.corner;
  E.timer.hidden = !W.timer;
  E.tasks.hidden = !W.tasks;
  // Alohida oyna ochiq bo'lsa dok ko'rinib turaveradi
  E.dock.hidden = !(W.timer || W.tasks) && !inPip;

  // Alohida oynada yig'ish ma'nosiz — joy baribir oynaning o'zi
  E.timer.classList.toggle('is-folded', !!W.foldTimer && !inPip);
  E.tasks.classList.toggle('is-folded', !!W.foldTasks && !inPip);

  // Karta yig'ilganda sahifadagi nusxasi yashiriladi va joy bo'shaydi
  document.querySelector('.timer-card')?.toggleAttribute('hidden', !!W.timer);
  document.querySelector('.plan-card')?.toggleAttribute('hidden', !!W.tasks);
  document.querySelector('.layout')?.classList.toggle('no-timer', !!W.timer);
  document.querySelector('.layout')?.classList.toggle('no-plan', !!W.tasks);

  // Ikkala karta ham yig'ilsa sahifa bo'm-bo'sh qolmasin
  $('wdgParked')?.toggleAttribute('hidden', !(W.timer && W.tasks));

  E.timerFold.title = W.foldTimer ? 'Yoyish' : 'Yig\'ish';
  E.tasksFold.title = W.foldTasks ? 'Yoyish' : 'Yig\'ish';
}

/** Taymer vidjetini joriy holatga moslaydi */
function renderTimerWidget() {
  if (!W.timer && !pipWin) return;
  const S = C.state;
  const mode = S.timer ? S.timer.mode : S.pendingMode;
  const running = S.timer && S.timer.status === 'running';
  const total = S.timer ? S.timer.durationSec : 0;
  const rem = Math.max(0, S.remaining);

  E.mode.textContent = MODE_LABEL[mode] || 'Ish';
  E.clock.textContent = fmtClock(rem);
  E.timer.dataset.mode = mode;
  E.timer.classList.toggle('is-running', !!running);
  E.timer.classList.toggle('is-paused', !!S.timer && !running);

  const frac = total > 0 ? 1 - rem / total : 0;
  E.bar.style.width = (Math.min(1, Math.max(0, frac)) * 100).toFixed(1) + '%';

  const t = S.plan?.tasks.find(x => x.id === S.activeTaskId);
  E.task.textContent = t
    ? `${t.title} · ${t.completedPomodoros}/${t.plannedPomodoros}`
    : 'Vazifa tanlanmagan';
  E.task.title = t ? t.title : '';

  // Tugmalar asosiy kartadagi holatni takrorlaydi
  E.main.textContent = !S.timer ? 'Boshlash' : running ? 'Pauza' : 'Davom etish';
  E.skip.disabled = !S.timer;
  E.stop.disabled = !S.timer;

  E.status.textContent = !S.timer
    ? 'Boshlashga tayyor'
    : running ? 'davom etmoqda' : 'pauzada';

  // Alohida oyna sarlavhasida ham vaqt ko'rinib tursin
  if (pipWin && !pipWin.closed) {
    try { pipWin.document.title = `${fmtClock(rem)} · ${MODE_LABEL[mode]}`; } catch { /* oyna yopilgan */ }
  }
}

/** Vazifalar vidjeti — bajarilganlar oxirida */
function renderTasksWidget() {
  if (!W.tasks && !pipWin) return;
  const S = C.state;
  const tasks = S.plan?.tasks || [];
  const done = tasks.filter(t => (t.status || (t.done ? 'bajarildi' : 'reja')) === 'bajarildi').length;

  E.tasksCount.textContent = tasks.length ? `${done}/${tasks.length}` : '—';

  if (!tasks.length) {
    E.list.innerHTML = '<div class="wdg-empty">Bugunga vazifa yo\'q</div>';
    return;
  }

  E.list.innerHTML = tasks.map(t => {
    const st = t.status || (t.done ? 'bajarildi' : 'reja');
    const active = t.id === S.activeTaskId;
    return `<div class="wdg-row st-${st} ${active ? 'is-active' : ''}" data-id="${C.esc(t.id)}">
      <span class="wdg-st" title="${C.esc(t.title)}">${STATUS_ICON[st] || '○'}</span>
      <span class="wdg-title">${C.esc(t.title)}</span>
      <span class="wdg-count">${t.completedPomodoros}/${t.plannedPomodoros}</span>
      ${st === 'bajarildi' ? '' :
        `<button class="wdg-play" data-play="${C.esc(t.id)}" title="Shu vazifani boshlash">▶</button>`}
    </div>`;
  }).join('');
}

/** Tashqaridan chaqiriladi — taymer yoki reja o'zgarganda */
export function updateWidgets() {
  if (!E.dock) return;
  renderTimerWidget();
  renderTasksWidget();
}

/* ═══════════════ Yig'ish va qaytarish ═══════════════ */

function setOpen(which, open) {
  W[which] = open;
  if (open) W['fold' + (which === 'timer' ? 'Timer' : 'Tasks')] = false;
  save();
  applyLayout();
  updateWidgets();
  // Alohida oynada ikkalasi ham yopilsa oynaning o'zi ham kerak emas
  if (pipWin && !W.timer && !W.tasks) closePip();
}

/* ═══════════════ Alohida oyna (Picture-in-Picture) ═══════════════ */

/** Asosiy sahifadagi uslublar alohida oynaga ham ko'chiriladi */
function copyStyles(win) {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const el = win.document.createElement('link');
    el.rel = 'stylesheet';
    el.href = link.href;
    win.document.head.appendChild(el);
  }
  // Mavzu (qorong'i / yorug') bir xil bo'lsin
  win.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';

  const own = win.document.createElement('style');
  own.textContent =
    'html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: var(--bg); }' +
    'body { display: flex; }';
  win.document.head.appendChild(own);
}

/** Alohida oyna uchun kerakli o'lcham */
function pipSize() {
  const h = (W.timer ? 190 : 0) + (W.tasks ? 252 : 0) + (W.timer && W.tasks ? 10 : 0);
  return { width: 300, height: Math.max(180, Math.min(620, h || 190)) };
}

async function openPip() {
  if (pipWin) { try { pipWin.focus(); } catch { /* yopilgan */ } return; }

  if (!pipSupported()) {
    // Sabab ikkita bo'lishi mumkin: brauzer eski yoki ulanish himoyalanmagan.
    // isSecureContext localhost va HTTPS'da true bo'ladi.
    C.toast(window.isSecureContext
      ? 'Alohida oyna faqat Chrome va Edge (116+) da ishlaydi.'
      : 'Alohida oyna uchun HTTPS kerak. Sayt himoyalanmagan ulanishda ochilgan — '
        + 'localhost orqali kiring yoki serverni HTTPS ga o\'tkazing.', 'warn');
    return;
  }
  // Hech bo'lmaganda bittasi ochiq bo'lsin
  if (!W.timer && !W.tasks) {
    W.timer = true;
    save();
    applyLayout();
  }

  try {
    const { width, height } = pipSize();
    pipWin = await window.documentPictureInPicture.requestWindow({ width, height });
  } catch (err) {
    pipWin = null;
    C.toast('Alohida oynani ochib bo\'lmadi: ' + (err?.message || err), 'err');
    return;
  }

  copyStyles(pipWin);
  E.dock.classList.add('in-pip');
  pipWin.document.body.append(E.dock);   // tugunning o'zi ko'chadi, havolalar saqlanadi

  // Foydalanuvchi oynani yopganda hammasi joyiga qaytadi
  pipWin.addEventListener('pagehide', restoreFromPip, { once: true });

  markPipButtons(true);
  applyLayout();
  updateWidgets();
}

function restoreFromPip() {
  if (!E.dock) return;
  E.dock.classList.remove('in-pip');
  document.body.append(E.dock);
  pipWin = null;
  markPipButtons(false);
  applyLayout();
  updateWidgets();
}

function closePip() {
  if (!pipWin) return;
  const w = pipWin;
  restoreFromPip();
  try { w.close(); } catch { /* allaqachon yopilgan */ }
}

function markPipButtons(on) {
  E.pipBtns.forEach(b => {
    b.classList.toggle('is-on', on);
    b.title = on ? 'Sahifaga qaytarish' : 'Alohida oynaga chiqarish (Shift+P)';
  });
}

const togglePip = () => (pipWin ? closePip() : openPip());

/* ═══════════════ Sudrash va burchakka o'tkazish ═══════════════ */

function nearestCorner(x, y) {
  const vertical = y < window.innerHeight / 2 ? 't' : 'b';
  const horizontal = x < window.innerWidth / 2 ? 'l' : 'r';
  return vertical + horizontal;
}

function bindDrag() {
  const dock = E.dock;
  let dragging = false, moved = false, startX = 0, startY = 0;

  const onDown = (e) => {
    if (pipWin) return;                       // alohida oynani OS o'zi sudraydi
    if (e.target.closest('button')) return;   // tugmalar bosilganda sudralmasin
    if (!e.target.closest('[data-drag]')) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    dock.classList.add('is-dragging');
    dock.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    dock.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    dock.classList.remove('is-dragging');
    dock.style.transform = '';
    if (moved) {
      // Qo'yib yuborilgan joyga eng yaqin burchakka o'tadi
      W.corner = nearestCorner(e.clientX, e.clientY);
      save();
      applyLayout();
    }
  };

  dock.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', syncTopOffset);
}

/* ═══════════════ Ishga tushirish ═══════════════ */

export function initWidgets(ctx) {
  C = ctx;
  if (!$('wdock')) return;

  /* Elementlarni bir marta topamiz — keyin boshqa oynaga ko'chsa ham ishlaydi */
  Object.assign(E, {
    dock: $('wdock'),
    timer: $('wdgTimer'), tasks: $('wdgTasks'),
    mode: $('wdgMode'), clock: $('wdgClock'), bar: $('wdgBar'),
    task: $('wdgTask'), status: $('wdgStatus'),
    main: $('wdgMain'), skip: $('wdgSkip'), stop: $('wdgStop'),
    tasksCount: $('wdgTasksCount'), list: $('wdgList'),
    timerFold: $('wdgTimerFold'), tasksFold: $('wdgTasksFold'),
    pipBtns: [$('wdgTimerPip'), $('wdgTasksPip')].filter(Boolean)
  });

  load();
  applyLayout();

  /* Tugma har doim ko'rinadi — ishlamasa bosilganda sababi aytiladi */
  markPipButtons(false);
  if (!pipSupported()) {
    const why = window.isSecureContext ? 'Chrome yoki Edge (116+) kerak' : 'HTTPS kerak';
    [...E.pipBtns, $('btnPipTimer')].filter(Boolean).forEach(b => {
      b.classList.add('is-off');
      b.title = 'Alohida oynaga chiqarish — ' + why;
    });
  }

  /* Kartalardagi «kichraytirish» tugmalari */
  $('btnMinTimer')?.addEventListener('click', () => setOpen('timer', true));
  $('btnMinPlan')?.addEventListener('click', () => setOpen('tasks', true));
  $('btnPipTimer')?.addEventListener('click', togglePip);

  /* Vidjetni kartaga qaytarish */
  $('wdgTimerClose').addEventListener('click', () => setOpen('timer', false));
  $('wdgTasksClose').addEventListener('click', () => setOpen('tasks', false));

  $('wdgRestoreAll')?.addEventListener('click', () => {
    closePip();
    W.timer = false;
    W.tasks = false;
    save();
    applyLayout();
    updateWidgets();
  });

  /* Alohida oynaga chiqarish */
  E.pipBtns.forEach(b => b.addEventListener('click', togglePip));

  /* Yig'ish / yoyish */
  E.timerFold.addEventListener('click', () => { W.foldTimer = !W.foldTimer; save(); applyLayout(); });
  E.tasksFold.addEventListener('click', () => { W.foldTasks = !W.foldTasks; save(); applyLayout(); });

  E.timer.querySelector('.wdg-head').addEventListener('dblclick', () => {
    W.foldTimer = !W.foldTimer; save(); applyLayout();
  });
  E.tasks.querySelector('.wdg-head').addEventListener('dblclick', () => {
    W.foldTasks = !W.foldTasks; save(); applyLayout();
  });

  /* Taymer tugmalari — asosiy kartadagilarni bosadi */
  E.main.addEventListener('click', () => $('btnMain').click());
  E.skip.addEventListener('click', () => $('btnSkip').click());
  E.stop.addEventListener('click', () => $('btnStop').click());

  /* Vazifa tanlash va boshlash */
  E.list.addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (!play) return;
    const btn = document.querySelector(`#taskList .task[data-id="${CSS.escape(play.dataset.play)}"] .t-btn.play`);
    if (btn) btn.click();
    else C.toast('Vazifa ro\'yxatda topilmadi — sahifani yangilang', 'warn');
  });

  bindDrag();

  /* Sahifa yopilsa alohida oyna osilib qolmasin */
  window.addEventListener('pagehide', () => { try { pipWin?.close(); } catch { /* ahamiyatsiz */ } });

  /* Klaviatura yorliqlari */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.matches('input, textarea, select')) return;
    if (!e.shiftKey) return;
    if (e.key === 'W' || e.key === 'w') { e.preventDefault(); setOpen('timer', !W.timer); }
    if (e.key === 'P' || e.key === 'p') { e.preventDefault(); togglePip(); }
  });

  updateWidgets();
}
