/**
 * Parol maydonlariga "ko'rsatish / yashirish" tugmasini qo'shadi.
 *
 * Har bir maydonni alohida tahrirlash o'rniga sahifadagi barcha
 * `input[type=password]` elementlari avtomatik topiladi — kirish sahifasi,
 * parolni o'zgartirish va integratsiya tokenlari ham shu bilan qamraladi.
 */

const EYE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const EYE_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2M6.2 6.6A17 17 0 0 0 2 13s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/>
  <path d="m9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>`;

/** Bitta maydonga tugma qo'shadi */
function enhance(input) {
  if (input.dataset.pwToggle) return;          // ikki marta qo'shilmasin
  input.dataset.pwToggle = '1';

  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  btn.innerHTML = EYE;
  btn.title = 'Parolni ko\'rsatish';
  btn.setAttribute('aria-label', 'Parolni ko\'rsatish');

  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE;
    const label = show ? 'Parolni yashirish' : 'Parolni ko\'rsatish';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    // Fokus maydonda qolsin, kursor matn oxirida
    const pos = input.value.length;
    input.focus();
    try { input.setSelectionRange(pos, pos); } catch { /* type=email kabi maydonlarda ishlamaydi */ }
  });

  wrap.appendChild(btn);
}

/** Sahifadagi (yoki berilgan blokdagi) barcha parol maydonlarini qamrab oladi */
export function enhancePasswordFields(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhance);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => enhancePasswordFields());
} else {
  enhancePasswordFields();
}
