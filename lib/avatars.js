/**
 * Profil rasmlari.
 *
 * Rasm bazaga emas, alohida faylga yoziladi: db.json har bir yozuvda
 * butunlay qayta yoziladi, shuning uchun unga o'nlab kilobaytlik rasm
 * solish butun tizimni sekinlashtirardi.
 *
 * Fayl turi kengaytmaga emas, baytlarning o'ziga qarab aniqlanadi —
 * nomi yoki MIME sarlavhasi soxta bo'lishi mumkin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

export const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
export const MAX_BYTES = 512 * 1024;        // 512 KB — 256x256 rasm uchun yetarli

const TYPES = {
  jpg:  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png:  { mime: 'image/png',  test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  webp: { mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
};

const ensureDir = () => { if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true }); };

/** Fayl nomi faqat hisob id'sidan quriladi — tashqi matn ishlatilmaydi */
const fileFor = (userId, ext) => path.join(AVATAR_DIR, `${String(userId).replace(/[^\w-]/g, '')}.${ext}`);

/** Baytlarga qarab turini aniqlaydi */
function detect(buf) {
  for (const [ext, t] of Object.entries(TYPES)) if (t.test(buf)) return { ext, mime: t.mime };
  return null;
}

/**
 * data:image/... ko'rinishidagi satrni faylga yozadi.
 * @returns {{ok: true, ext: string} | {ok: false, error: string}}
 */
export function saveAvatar(userId, dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return { ok: false, error: 'Rasm formati tushunarsiz' };

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); }
  catch { return { ok: false, error: 'Rasmni o\'qib bo\'lmadi' }; }

  if (!buf.length) return { ok: false, error: 'Rasm bo\'sh' };
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: `Rasm juda katta (${Math.round(buf.length / 1024)} KB). Chegara — ${MAX_BYTES / 1024} KB` };
  }

  const kind = detect(buf);
  if (!kind) return { ok: false, error: 'Faqat JPG, PNG yoki WebP qabul qilinadi' };

  ensureDir();
  removeAvatar(userId);                       // eski kengaytma boshqacha bo'lishi mumkin

  const tmp = fileFor(userId, kind.ext) + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, fileFor(userId, kind.ext));
  return { ok: true, ext: kind.ext };
}

/** Saqlangan rasmni qaytaradi */
export function readAvatar(userId, ext) {
  const candidates = ext ? [ext] : Object.keys(TYPES);
  for (const e of candidates) {
    const file = fileFor(userId, e);
    try {
      const buf = fs.readFileSync(file);
      return { buffer: buf, contentType: TYPES[e].mime };
    } catch { /* keyingisini sinaymiz */ }
  }
  return null;
}

/** Barcha kengaytmalardagi nusxalarni o'chiradi */
export function removeAvatar(userId) {
  let removed = 0;
  for (const ext of Object.keys(TYPES)) {
    try { fs.unlinkSync(fileFor(userId, ext)); removed++; }
    catch { /* yo'q edi */ }
  }
  return removed;
}

/** Profilda ko'rsatiladigan manzil — versiya keshni yangilaydi */
export function avatarUrl(user) {
  if (!user?.photo?.ext) return null;
  return `/api/avatar/${user.id}?v=${user.photo.version || 1}`;
}
