/**
 * Profil rasmi: tanlash, kesish va yuklash.
 *
 * Rasm serverga yuborilishidan oldin brauzerda 256x256 kvadratga
 * keltiriladi — shunda tarmoqdan ham, diskdan ham ortiqcha joy ketmaydi
 * va server tomonda rasm qayta ishlash kutubxonasi kerak bo'lmaydi.
 */
import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const SIZE = 256;                 // saqlanadigan rasm o'lchami
const QUALITY = 0.86;
const MAX_SOURCE_MB = 20;

let C = null;
let img = null;                   // tanlangan rasm (ImageBitmap yoki HTMLImageElement)
let zoom = 1, offX = 0, offY = 0; // joylashuv holati
let baseScale = 1;
let onSaved = null;

/* ═══════════════ Chizish ═══════════════ */

function clampOffsets() {
  const w = imgW() * scale();
  const h = imgH() * scale();
  offX = Math.min(0, Math.max(SIZE - w, offX));
  offY = Math.min(0, Math.max(SIZE - h, offY));
}

const imgW = () => img?.width || 1;
const imgH = () => img?.height || 1;
const scale = () => baseScale * zoom;

function draw() {
  const cv = $('cropCanvas');
  if (!cv || !img) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  clampOffsets();
  ctx.drawImage(img, offX, offY, imgW() * scale(), imgH() * scale());
}

/** Rasm kvadratni to'ldiradigan eng kichik kattalik */
function fitCover() {
  baseScale = SIZE / Math.min(imgW(), imgH());
  zoom = 1;
  offX = (SIZE - imgW() * baseScale) / 2;
  offY = (SIZE - imgH() * baseScale) / 2;
}

/* ═══════════════ Fayl tanlash ═══════════════ */

async function loadFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    C.toast('Bu rasm fayli emas', 'err');
    return;
  }
  if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
    C.toast(`Fayl juda katta (${Math.round(file.size / 1048576)} MB). Chegara — ${MAX_SOURCE_MB} MB`, 'err');
    return;
  }

  try {
    // imageOrientation telefonda olingan rasmning burilishini to'g'rilaydi
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Rasmni ochib bo\'lmadi'));
      el.src = URL.createObjectURL(file);
    }).catch(() => null);
    if (!img) { C.toast('Rasmni ochib bo\'lmadi', 'err'); return; }
  }

  fitCover();
  $('cropZoom').value = '1';
  $('cropOverlay').hidden = false;
  draw();
}

/* ═══════════════ Saqlash ═══════════════ */

async function saveCrop() {
  const cv = $('cropCanvas');
  const btn = $('cropSave');
  const dataUrl = cv.toDataURL('image/jpeg', QUALITY);

  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = 'Yuklanmoqda…';
  try {
    const res = await api.uploadAvatar(dataUrl);
    $('cropOverlay').hidden = true;
    C.toast('Profil rasmi yangilandi', 'ok');
    onSaved?.(res.user);
  } catch (err) {
    C.toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* ═══════════════ Ko'rsatish ═══════════════ */

/** Avatar elementiga rasm yoki emoji qo'yadi */
export function applyAvatar(el, user) {
  if (!el || !user) return;
  if (user.photoUrl) {
    el.style.backgroundImage = `url("${user.photoUrl}")`;
    el.classList.add('has-photo');
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-photo');
    el.textContent = user.avatar || '🍅';
  }
}

/* ═══════════════ Ishga tushirish ═══════════════ */

export function initAvatar(ctx, { onChange } = {}) {
  C = ctx;
  onSaved = onChange;
  if (!$('cropOverlay')) return;

  $('photoPick').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', (e) => {
    loadFile(e.target.files?.[0]);
    e.target.value = '';                   // bir xil faylni qayta tanlash mumkin bo'lsin
  });

  $('photoRemove').addEventListener('click', async () => {
    const ok = await C.confirmBox('Rasmni o\'chirish',
      'Profil rasmi o\'chiriladi va emoji avatarga qaytasiz.', 'O\'chirish');
    if (!ok) return;
    try {
      const res = await api.deleteAvatar();
      C.toast('Rasm o\'chirildi', 'ok');
      onSaved?.(res.user);
    } catch (err) { C.toast(err.message, 'err'); }
  });

  /* Kesish oynasi */
  $('cropCancel').addEventListener('click', () => { $('cropOverlay').hidden = true; img = null; });
  $('cropSave').addEventListener('click', saveCrop);
  $('cropOverlay').addEventListener('click', (e) => {
    if (e.target === $('cropOverlay')) { $('cropOverlay').hidden = true; img = null; }
  });

  $('cropZoom').addEventListener('input', (e) => {
    const next = +e.target.value;
    // Kattalashtirishda markaz joyida qolsin
    const cx = SIZE / 2, cy = SIZE / 2;
    const k = next / zoom;
    offX = cx - (cx - offX) * k;
    offY = cy - (cy - offY) * k;
    zoom = next;
    draw();
  });

  /* Sudrash */
  const cv = $('cropCanvas');
  let dragging = false, lastX = 0, lastY = 0;

  const toCanvas = (v) => v * (SIZE / cv.getBoundingClientRect().width);

  cv.addEventListener('pointerdown', (e) => {
    if (!img) return;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('is-dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offX += toCanvas(e.clientX - lastX);
    offY += toCanvas(e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    draw();
  });
  const endDrag = () => { dragging = false; cv.classList.remove('is-dragging'); };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  cv.addEventListener('wheel', (e) => {
    if (!img) return;
    e.preventDefault();
    const slider = $('cropZoom');
    const next = Math.min(+slider.max, Math.max(+slider.min, zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
    slider.value = String(next);
    slider.dispatchEvent(new Event('input'));
  }, { passive: false });

  /* Faylni sudrab tashlash */
  const stage = $('photoBox');
  ['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, (e) => {
    e.preventDefault(); stage.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(t => stage.addEventListener(t, (e) => {
    e.preventDefault(); stage.classList.remove('is-over');
  }));
  stage.addEventListener('drop', (e) => loadFile(e.dataTransfer?.files?.[0]));
}
