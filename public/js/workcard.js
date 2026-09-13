/**
 * Ish kartasi — profil «Umumiy» bo'limining yuqori qismi.
 *
 * Holat taymer va ish jadvalidan kelib chiqadi, shuning uchun karta
 * profil ochiq turganda o'zi yangilanib turadi.
 */
import { api } from './api.js';
import { applyAvatar } from './avatar.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
let C = null;
let timer = null;
let last = null;

const REFRESH_MS = 30000;

/* ═══════════════ Yordamchilar ═══════════════ */

const pad = (n) => String(n).padStart(2, '0');

function fmtLeft(sec) {
  if (!(sec > 0)) return '';
  const m = Math.floor(sec / 60);
  if (m >= 60) return `${Math.floor(m / 60)} soat ${pad(m % 60)} daq qoldi`;
  return m >= 1 ? `${m} daq qoldi` : 'tugayapti';
}

function fmtMinutes(min) {
  if (!min) return '0 daq';
  const h = Math.floor(min / 60);
  return h ? `${h} s ${pad(min % 60)} daq` : `${min} daq`;
}

const OYLAR = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/**
 * «13-sentabr, 19:54» ko'rinishida.
 * Brauzerning uz-UZ lokali oy nomlarini «M09» deb beradi, shuning uchun
 * nomlar qo'lda yoziladi.
 */
function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const bugun = new Date();
  const shuKun = d.toDateString() === bugun.toDateString();
  const vaqt = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return shuKun ? `bugun, ${vaqt}` : `${d.getDate()}-${OYLAR[d.getMonth()]}, ${vaqt}`;
}

/* ═══════════════ Kun chizig'i ═══════════════ */

/**
 * Ish kunini bo'laklarga bo'ladi: ish, tushlik va hozirgi payt belgisi.
 * Chiziq faqat ish oralig'ini ko'rsatadi — undan tashqarisi ma'nosiz.
 */
function bandHtml(day) {
  const span = Math.max(1, day.endMin - day.startMin);
  const pct = (min) => Math.max(0, Math.min(100, ((min - day.startMin) / span) * 100));

  let parts = '';
  if (day.lunchEnabled && day.lunchEndMin > day.startMin && day.lunchStartMin < day.endMin) {
    const a = pct(day.lunchStartMin);
    const b = pct(day.lunchEndMin);
    parts += `<i class="wb-lunch" style="left:${a}%;width:${b - a}%" title="Tushlik ${day.lunchStart}–${day.lunchEnd}"></i>`;
  }

  const inside = day.nowMin >= day.startMin && day.nowMin <= day.endMin;
  if (inside) {
    parts += `<i class="wb-done" style="width:${pct(day.nowMin)}%"></i>`;
    parts += `<i class="wb-now" style="left:${pct(day.nowMin)}%" title="Hozir ${day.now}"></i>`;
  }

  return `
    <div class="wc-band ${day.isWorkday ? '' : 'is-off'}">${parts}</div>
    <div class="wc-band-lbl">
      <span>${day.start}</span>
      ${day.lunchEnabled ? `<span>tushlik ${day.lunchStart}–${day.lunchEnd}</span>` : '<span></span>'}
      <span>${day.end}</span>
    </div>`;
}

/* ═══════════════ Chizish ═══════════════ */

function render(data) {
  last = data;
  const { card, user } = data;
  const box = $('workCard');
  if (!box) return;

  const s = card.status;
  const sub = [user.jobTitle, user.company].filter(Boolean).map(C.esc).join(' · ');

  box.innerHTML = `
    <div class="wc-head">
      <span class="avatar lg" id="wcAvatar"></span>
      <div class="wc-id">
        <span class="wc-name">${C.esc(user.name)}</span>
        ${sub ? `<span class="wc-sub">${sub}</span>` : ''}
        <span class="wc-mail">${C.esc(user.email)}</span>
      </div>
      <span class="wc-pill tone-${s.tone}" title="${C.esc(card.day.weekdayName)}">
        <i></i>${C.esc(s.label)}${s.taskTitle ? ` · ${C.esc(s.taskTitle)}` : ''}
      </span>
    </div>

    ${bandHtml(card.day)}

    <div class="wc-nums">
      <div class="wc-num a">
        <b>${card.today.donePomodoros}<small>/${card.today.plannedPomodoros}</small></b>
        <span>Bugungi pomodoro</span>
      </div>
      <div class="wc-num b">
        <b>${card.streak.current}</b>
        <span>Kunlik seriya${card.streak.best > card.streak.current ? ` · eng uzuni ${card.streak.best}` : ''}</span>
      </div>
      <div class="wc-num c">
        <b>${fmtMinutes(card.today.focusMinutes)}</b>
        <span>Bugungi fokus</span>
      </div>
      <div class="wc-num d">
        <b>${card.totals.pomodoros}</b>
        <span>Jami pomodoro · ${card.totals.activeDays} kun</span>
      </div>
    </div>

    <div class="wc-foot">
      ${s.remainingSec ? `<span>${fmtLeft(s.remainingSec)}</span>` : ''}
      <span>Oxirgi kirish: ${fmtWhen(data.lastLoginAt)}</span>
      ${data.timezone ? `<span>${C.esc(data.timezone)}</span>` : ''}
      <button class="btn btn-mini btn-ghost" id="wcRefresh" title="Yangilash">${icon('undo')}</button>
    </div>`;

  applyAvatar($('wcAvatar'), user);
  $('wcRefresh').addEventListener('click', () => load());
}

/* ═══════════════ Yuklash ═══════════════ */

export async function load() {
  if (!$('workCard')) return;
  try {
    render(await api.workCard());
  } catch (err) {
    if (!last) {
      $('workCard').innerHTML = `<p class="hint">Ish kartasini yuklab bo'lmadi: ${C.esc(err.message)}</p>`;
    }
  }
}

/** Profil ochiq turganda o'zi yangilanib turadi */
export function startAutoRefresh() {
  stopAutoRefresh();
  timer = setInterval(() => {
    // Ko'rinmayotgan sahifani yangilashning ma'nosi yo'q
    if (document.hidden) return;
    if (document.querySelector('.view.is-active')?.id !== 'view-profile') return;
    if (document.querySelector('.prof-sec.is-active')?.id !== 'psec-umumiy') return;
    load();
  }, REFRESH_MS);
}

export function stopAutoRefresh() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Avatar yoki ism o'zgarganda kartani ham yangilaymiz */
export function refreshSoon() {
  if (last) load();
}

export function initWorkCard(ctx) {
  C = ctx;
  startAutoRefresh();
}
