/**
 * Vidjetlar — taymer va vazifalarni ekran burchagiga yig'ish.
 *
 * Vidjet o'z mantiqini yozmaydi: tugmalari asosiy kartalardagi tugmalarni
 * bosadi. Shuning uchun xatti-harakat har doim bir xil bo'ladi va ikkita
 * joyda alohida tuzatish kerak emas.
 */

let C = null;
const $ = (id) => document.getElementById(id);
const STORE = 'pmd_widgets';

const MODE_LABEL = { work: 'Ish', short: 'Qisqa tanaffus', long: 'Uzun tanaffus' };
const STATUS_ICON = { reja: '○', jarayonda: '◐', qabulga: '◉', bajarildi: '✔' };

const CORNERS = ['tl', 'tr', 'bl', 'br'];

/** Holat: qaysi vidjet ochiq, yig'ilganmi va qaysi burchakda */
let W = { timer: false, tasks: false, foldTimer: false, foldTasks: false, corner: 'br' };

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
  const dock = $('wdock');
  if (!dock) return;

  syncTopOffset();
  dock.dataset.corner = W.corner;
  $('wdgTimer').hidden = !W.timer;
  $('wdgTasks').hidden = !W.tasks;
  dock.hidden = !(W.timer || W.tasks);

  $('wdgTimer').classList.toggle('is-folded', !!W.foldTimer);
  $('wdgTasks').classList.toggle('is-folded', !!W.foldTasks);

  // Karta yig'ilganda sahifadagi nusxasi yashiriladi va joy bo'shaydi
  document.querySelector('.timer-card')?.toggleAttribute('hidden', !!W.timer);
  document.querySelector('.plan-card')?.toggleAttribute('hidden', !!W.tasks);
  document.querySelector('.layout')?.classList.toggle('no-timer', !!W.timer);
  document.querySelector('.layout')?.classList.toggle('no-plan', !!W.tasks);

  // Ikkala karta ham yig'ilsa sahifa bo'm-bo'sh qolmasin
  $('wdgParked')?.toggleAttribute('hidden', !(W.timer && W.tasks));

  $('wdgTimerFold').title = W.foldTimer ? 'Yoyish' : 'Yig\'ish';
  $('wdgTasksFold').title = W.foldTasks ? 'Yoyish' : 'Yig\'ish';
}

/** Taymer vidjetini joriy holatga moslaydi */
function renderTimerWidget() {
  if (!W.timer) return;
  const S = C.state;
  const mode = S.timer ? S.timer.mode : S.pendingMode;
  const running = S.timer && S.timer.status === 'running';
  const total = S.timer ? S.timer.durationSec : 0;
  const rem = Math.max(0, S.remaining);

  $('wdgMode').textContent = MODE_LABEL[mode] || 'Ish';
  $('wdgClock').textContent = fmtClock(rem);
  $('wdgTimer').dataset.mode = mode;
  $('wdgTimer').classList.toggle('is-running', !!running);
  $('wdgTimer').classList.toggle('is-paused', !!S.timer && !running);

  const frac = total > 0 ? 1 - rem / total : 0;
  $('wdgBar').style.width = (Math.min(1, Math.max(0, frac)) * 100).toFixed(1) + '%';

  const t = S.plan?.tasks.find(x => x.id === S.activeTaskId);
  $('wdgTask').textContent = t
    ? `${t.title} · ${t.completedPomodoros}/${t.plannedPomodoros}`
    : 'Vazifa tanlanmagan';
  $('wdgTask').title = t ? t.title : '';

  // Tugmalar asosiy kartadagi holatni takrorlaydi
  $('wdgMain').textContent = !S.timer ? 'Boshlash' : running ? 'Pauza' : 'Davom etish';
  $('wdgSkip').disabled = !S.timer;
  $('wdgStop').disabled = !S.timer;

  $('wdgStatus').textContent = !S.timer
    ? 'Boshlashga tayyor'
    : running ? 'davom etmoqda' : 'pauzada';
}

/** Vazifalar vidjeti — bajarilganlar oxirida */
function renderTasksWidget() {
  if (!W.tasks) return;
  const S = C.state;
  const tasks = S.plan?.tasks || [];
  const done = tasks.filter(t => (t.status || (t.done ? 'bajarildi' : 'reja')) === 'bajarildi').length;

  $('wdgTasksCount').textContent = tasks.length ? `${done}/${tasks.length}` : '—';

  const list = $('wdgList');
  if (!tasks.length) {
    list.innerHTML = '<div class="wdg-empty">Bugunga vazifa yo\'q</div>';
    return;
  }

  list.innerHTML = tasks.map(t => {
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
  if (!$('wdock')) return;
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
}

/* ═══════════════ Sudrash va burchakka o'tkazish ═══════════════ */

function nearestCorner(x, y) {
  const vertical = y < window.innerHeight / 2 ? 't' : 'b';
  const horizontal = x < window.innerWidth / 2 ? 'l' : 'r';
  return vertical + horizontal;
}

function bindDrag() {
  const dock = $('wdock');
  let dragging = false, moved = false, startX = 0, startY = 0, dx = 0, dy = 0;

  const onDown = (e) => {
    // Tugmalar bosilganda sudrash boshlanmasin
    if (e.target.closest('button')) return;
    const head = e.target.closest('[data-drag]');
    if (!head) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    dx = 0; dy = 0;
    dock.classList.add('is-dragging');
    dock.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
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

  // Ekran o'lchami o'zgarsa topbar balandligi ham o'zgaradi
  window.addEventListener('resize', syncTopOffset);
}

/* ═══════════════ Ishga tushirish ═══════════════ */

export function initWidgets(ctx) {
  C = ctx;
  if (!$('wdock')) return;

  load();
  applyLayout();

  /* Kartalardagi «kichraytirish» tugmalari */
  $('btnMinTimer')?.addEventListener('click', () => setOpen('timer', true));
  $('btnMinPlan')?.addEventListener('click', () => setOpen('tasks', true));

  /* Vidjetni kartaga qaytarish */
  $('wdgTimerClose').addEventListener('click', () => setOpen('timer', false));
  $('wdgTasksClose').addEventListener('click', () => setOpen('tasks', false));

  $('wdgRestoreAll')?.addEventListener('click', () => {
    W.timer = false;
    W.tasks = false;
    save();
    applyLayout();
    updateWidgets();
  });

  /* Yig'ish / yoyish */
  $('wdgTimerFold').addEventListener('click', () => {
    W.foldTimer = !W.foldTimer; save(); applyLayout();
  });
  $('wdgTasksFold').addEventListener('click', () => {
    W.foldTasks = !W.foldTasks; save(); applyLayout();
  });

  /* Sarlavhani bosish ham yig'adi */
  $('wdgTimer').querySelector('.wdg-head').addEventListener('dblclick', () => {
    W.foldTimer = !W.foldTimer; save(); applyLayout();
  });
  $('wdgTasks').querySelector('.wdg-head').addEventListener('dblclick', () => {
    W.foldTasks = !W.foldTasks; save(); applyLayout();
  });

  /* Taymer tugmalari — asosiy kartadagilarni bosadi */
  $('wdgMain').addEventListener('click', () => $('btnMain').click());
  $('wdgSkip').addEventListener('click', () => $('btnSkip').click());
  $('wdgStop').addEventListener('click', () => $('btnStop').click());

  /* Vazifa tanlash va boshlash */
  $('wdgList').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (!play) return;
    const row = document.querySelector(`#taskList .task[data-id="${CSS.escape(play.dataset.play)}"] .t-btn.play`);
    if (row) row.click();
    else C.toast('Vazifa ro\'yxatda topilmadi — sahifani yangilang', 'warn');
  });

  bindDrag();

  /* Klaviatura: Shift+W — taymer vidjetini yoqish/o'chirish */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.shiftKey && (e.key === 'W' || e.key === 'w')) {
      e.preventDefault();
      setOpen('timer', !W.timer);
    }
  });

  updateWidgets();
}
