/**
 * Taqdimot sahifasi: mehmon uchun demo taymer.
 *
 * Serverga umuman murojaat qilmaydi — ro'yxatdan o'tmagan odam ham
 * pomodoro usulini shu yerda sinab ko'ra oladi. Holat brauzerda,
 * `localStorage` da turadi; u ishlamasa (maxfiy oyna, sayt ma'lumotlari
 * o'chirilgan) taymer baribir ishlaydi, shunchaki eslab qolmaydi.
 */
import { unlockAudio, playAlarm, notify } from './sound.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

/* ═══════════ Doimiylar ═══════════ */

const MODES = {
  work:  { min: 25, nom: 'Ish',             sub: 'Diqqatni bitta ishga qarating' },
  short: { min: 5,  nom: 'Qisqa tanaffus',  sub: 'Biroz uzilib turing' },
  long:  { min: 15, nom: 'Uzun tanaffus',   sub: 'To\'rt pomodorodan keyin uzunroq dam' }
};
const CYCLE = 4;                        // necha pomodorodan keyin uzun tanaffus
const KEY = 'pomodoro-demo-taymer';
const RING = 2 * Math.PI * 106;         // halqa uzunligi — index.html dagi r=106 bilan bir xil

/* ═══════════ Holat ═══════════ */

const yangiHolat = () => ({
  mode: 'work',
  status: 'idle',                       // idle | running | paused
  endAt: 0,                             // running: qachon tugaydi (ms)
  remaining: MODES.work.min * 60,       // idle/paused: qolgan soniya
  cycle: 0,                             // tugallangan ish bosqichlari, 0..CYCLE-1
  done: 0                               // shu brauzerda tugallangan pomodorolar
});

let S = yangiHolat();

/**
 * Katta oyna (focus) rejimi. Taymer holatidan ALOHIDA: bu faqat ko'rinish.
 * Esc bosilsa taymer to'xtamaydi — shunchaki sahifa qaytadi.
 */
let katta = false;

const jamiSoniya = () => MODES[S.mode].min * 60;

/** Qolgan vaqt. Ishlayotganda soatdan hisoblanadi — fon rejimida ham aniq. */
function qolgan() {
  if (S.status !== 'running') return Math.max(0, S.remaining);
  return Math.max(0, (S.endAt - Date.now()) / 1000);
}

/* ═══════════ Saqlash ═══════════ */

function saqla() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...S, katta }));
  } catch {
    // Maxfiy oyna yoki sayt ma'lumotlari yopilgan — bu xato emas,
    // shunchaki keyingi ochilishda taymer esda qolmaydi.
  }
}

function tikla() {
  let saqlangan = null;
  try {
    saqlangan = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    saqlangan = null;
  }
  if (!saqlangan || typeof saqlangan !== 'object') return;

  // Faqat tanish qiymatlarni olamiz — buzilgan yozuv taymerni sindirmasin
  if (!MODES[saqlangan.mode]) return;
  S.mode = saqlangan.mode;
  S.cycle = Number.isInteger(saqlangan.cycle) ? Math.min(Math.max(saqlangan.cycle, 0), CYCLE - 1) : 0;
  S.done = Number.isInteger(saqlangan.done) ? Math.max(saqlangan.done, 0) : 0;

  if (saqlangan.status === 'running' && saqlangan.endAt > Date.now()) {
    S.status = 'running';
    S.endAt = saqlangan.endAt;
    S.remaining = (saqlangan.endAt - Date.now()) / 1000;
  } else if (saqlangan.status === 'paused' && saqlangan.remaining > 0) {
    S.status = 'paused';
    S.remaining = Math.min(saqlangan.remaining, jamiSoniya());
  } else {
    // Ishlab turgan taymer sahifa yopiq paytda tugagan bo'lsa,
    // uni "tugadi" deb hisoblamaymiz — mehmon ovozni eshitmagan.
    S.status = 'idle';
    S.remaining = jamiSoniya();
  }

  // Katta oyna — ko'rinish tanlovi. Taymer ishlayotgan bo'lsagina tiklanadi:
  // to'xtagan taymer uchun butun sahifani yopib turishning ma'nosi yo'q.
  katta = saqlangan.katta === true && S.status !== 'idle';
}

/* ═══════════ Chizish ═══════════ */

const raqam = (n) => String(Math.floor(n)).padStart(2, '0');

function soatMatni(sek) {
  const butun = Math.ceil(sek);
  return raqam(butun / 60) + ':' + raqam(butun % 60);
}

function chiz() {
  const sek = qolgan();
  const jami = jamiSoniya();

  $('lpClock').textContent = soatMatni(sek);
  $('lpSub').textContent = S.status === 'running'
    ? MODES[S.mode].sub
    : S.status === 'paused' ? 'To\'xtatib turildi' : 'Boshlashga tayyor';

  // Halqa: to'liqdan nolga qarab bo'shaydi
  $('lpRing').style.strokeDashoffset = String(RING * (1 - sek / jami));

  document.body.dataset.mode = S.mode;
  document.body.classList.toggle('is-running', S.status === 'running');

  // Taymer to'xtagan bo'lsa katta oynada ushlab turishning ma'nosi yo'q
  if (S.status === 'idle') katta = false;
  document.body.classList.toggle('lp-focus', katta);
  $('lpFocusMode').textContent = MODES[S.mode].nom;

  for (const el of document.querySelectorAll('#lpPills .pill')) {
    el.classList.toggle('is-active', el.dataset.mode === S.mode);
  }

  $('lpMain').innerHTML = S.status === 'running'
    ? `${icon('pause', 'bi')} Pauza`
    : S.status === 'paused' ? `${icon('play', 'bi')} Davom etish` : `${icon('play', 'bi')} Boshlash`;
  $('lpStop').disabled = S.status === 'idle';

  // Sikl nuqtalari — nechta pomodoro uzun tanaffusgacha qolgani
  const nuqtalar = [];
  for (let i = 0; i < CYCLE; i++) nuqtalar.push(`<i class="${i < S.cycle ? 'on' : ''}"></i>`);
  $('lpDots').innerHTML = nuqtalar.join('');

  $('lpDone').textContent = String(S.done);
  document.title = S.status === 'running'
    ? `${soatMatni(sek)} — ${MODES[S.mode].nom}`
    : 'Pomodoro — ish vaqtini boshqarish';
}

/* ═══════════ Amallar ═══════════ */

function rejimGa(mode, { majburan = false } = {}) {
  if (!MODES[mode]) return;
  if (S.status === 'running' && !majburan) return;   // ishlayotgan taymerni almashtirmaymiz
  S.mode = mode;
  S.status = 'idle';
  S.remaining = jamiSoniya();
  S.endAt = 0;
  saqla();
  chiz();
}

function boshla() {
  unlockAudio();
  // Bildirishnoma ruxsati bu yerda SO'RALMAYDI: sahifaga birinchi marta
  // kirgan odamga darhol brauzer ruxsat oynasini ko'rsatish — tajovuzkor.
  // Ilovada ruxsat sozlamalardan so'raladi; bu yerda ovozning o'zi yetarli.
  if (S.status === 'running') {              // pauza
    S.remaining = qolgan();
    S.status = 'paused';
    S.endAt = 0;
  } else {                                    // boshlash yoki davom etish
    const sek = S.status === 'paused' ? S.remaining : jamiSoniya();
    S.endAt = Date.now() + sek * 1000;
    S.remaining = sek;
    S.status = 'running';
    katta = true;                             // ishga tushdi — faqat taymer qolsin
  }
  saqla();
  chiz();
}

/** Katta oynadan chiqish — taymerga tegmaydi, u ishlayaveradi */
function kattaChiq() {
  katta = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  saqla();   // tanlov esda qolsin — yangilanganda focus qaytib kelmasin
  chiz();
}

/**
 * Butun ekran. Brauzer buni faqat foydalanuvchi bosgan paytda ruxsat etadi,
 * shuning uchun faqat shu tugmadan chaqiriladi — o'z-o'zidan emas.
 */
function butunEkran() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

function toxtat() {
  S.status = 'idle';
  S.remaining = jamiSoniya();
  S.endAt = 0;
  saqla();
  chiz();
}

/** Joriy bosqichni tugatib, keyingisiga o'tadi */
function otkaz() {
  tugadi({ ovoz: false });
}

function tugadi({ ovoz = true } = {}) {
  const ishEdi = S.mode === 'work';

  if (ishEdi) {
    S.done++;
    S.cycle = (S.cycle + 1) % CYCLE;
  }

  if (ovoz) {
    playAlarm(ishEdi ? 'work' : 'break');
    notify(
      ishEdi ? 'Pomodoro tugadi' : 'Tanaffus tugadi',
      ishEdi ? 'Endi tanaffus qiling' : 'Ishga qaytish vaqti'
    );
  }

  // Ishdan keyin tanaffus, tanaffusdan keyin ish.
  // Avto-boshlash yo'q — keyingi bosqichni mehmonning o'zi boshlaydi.
  const keyingi = ishEdi ? (S.cycle === 0 ? 'long' : 'short') : 'work';
  rejimGa(keyingi, { majburan: true });
}

/* ═══════════ Sanoq ═══════════ */

function tick() {
  if (S.status !== 'running') return;
  if (qolgan() <= 0.4) { tugadi(); return; }
  chiz();
}

/* ═══════════ Imkoniyatlar ro'yxati ═══════════ */

// Faqat haqiqatan mavjud imkoniyatlar. Har biri kodda ishlaydigan bo'lim.
const IMKONIYATLAR = [
  ['calDays', 'Kun tartibi o\'zi quriladi',
   'Vazifa va unga necha pomodoro kerakligini yozasiz — tizim jadvalni, tanaffuslarni va tushlikni o\'zi joylashtiradi.'],
  ['calendar', 'Haftalik jadval va ko\'p kunlik reja',
   'Qaysi kunlari ishlashingizni belgilang; rejani bir yo\'la bir necha kunga tuzing.'],
  ['chart', 'Statistika va ketma-ket kunlar',
   'Kategoriyalar bo\'yicha taqsimot, eng samarali soatingiz va uzluksiz ish kunlari seriyasi.'],
  ['report', 'Hisobotni yuklab olish',
   'Kunlik, haftalik yoki oylik hisobot — html, md, csv yoki json ko\'rinishida.'],
  ['user', 'Profil va ish kartasi',
   'Jonli holat, haftalik natijalar, avatar yoki o\'z rasmingiz.'],
  ['timer', 'Taymer alohida oynada',
   'Taymerni burchakka yig\'ing yoki alohida oynaga chiqaring — u boshqa dasturlar ustida turadi.'],
  ['focus', 'Bir vaqtda ikkita vazifa',
   'Birovga topshirgan ishingiz kutayotganda ikkinchisini boshlang — ikkalasi ham hisoblanadi.'],
  ['link', 'Jira, Notion, Confluence',
   'Jira\'dan vazifalarni yuklang, tayyor hisobotni Notion yoki Confluence\'ga jo\'nating.'],
  ['shield', 'Hisobingiz himoyada',
   'Email tasdiqlash, ikki bosqichli kirish (2FA), qurilmalar ro\'yxati va seansni bekor qilish.']
];

function imkoniyatlarniChiz() {
  $('lpGrid').innerHTML = IMKONIYATLAR.map(([belgi, sarlavha, matn]) => `
    <article class="lp-feat">
      <b>${icon(belgi)}</b>
      <div>
        <strong>${sarlavha}</strong>
        <span>${matn}</span>
      </div>
    </article>`).join('');
}

/* ═══════════ Ishga tushirish ═══════════ */

function bogla() {
  $('lpMain').addEventListener('click', boshla);
  $('lpSkip').addEventListener('click', otkaz);
  $('lpStop').addEventListener('click', toxtat);

  $('lpExit').addEventListener('click', kattaChiq);
  $('lpFull').addEventListener('click', butunEkran);

  $('lpPills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (pill) rejimGa(pill.dataset.mode);
  });

  // Sahifa fondan qaytganda darhol aniq vaqtni ko'rsatamiz
  document.addEventListener('visibilitychange', () => { if (!document.hidden) chiz(); });
  window.addEventListener('focus', chiz);

  document.addEventListener('keydown', (e) => {
    // Esc — katta oynadan chiqish. Taymer to'xtamaydi.
    if (e.key === 'Escape' && katta) { kattaChiq(); return; }
    // Probel — boshlash/pauza. Tugma yoki maydonda turganda aralashmaydi.
    if (e.code !== 'Space' || e.target.closest('input, textarea, button')) return;
    e.preventDefault();
    boshla();
  });
}

tikla();
imkoniyatlarniChiz();
bogla();
chiz();
setInterval(tick, 250);
