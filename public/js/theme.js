/**
 * Ko'rinish uslublari: ro'yxat, qo'llash va shriftni yuklash.
 *
 * Uch joyda ishlatiladi:
 *   · index.html  — foydalanuvchi sozlamalardan tanlaydi (serverda saqlanadi)
 *   · landing.html — har daqiqada o'zi almashadi
 *   · login.html  — sukutdagi uslub bilan chiziladi
 *
 * Shriftlar ATAYLAB dangasa yuklanadi: to'rt uslubning hammasi uchun
 * sakkizta shrift oilasini har sahifada tortib olish sahifani sekinlashtiradi.
 * Faqat qo'llanayotgan uslubning shrifti so'raladi. Internet bo'lmasa
 * `<link>` yuklanmaydi va uslub tizim shriftiga tushadi — `themes.css` dagi
 * har bir `--font` da zaxira ro'yxat shuning uchun bor.
 */

export const THEMES = [
  {
    id: 'glass',
    name: 'Glassmorphism',
    note: 'Qorong\'i fon, xiralashgan shisha yuzalar',
    preview: 'tp-glass',
    fonts: 'family=Sora:wght@300;400;600;700&family=Manrope:wght@400;500;600;700'
  },
  {
    id: 'clay',
    name: 'Claymorphism',
    note: 'Iliq och fon, yumshoq gil bloklar',
    preview: 'tp-clay',
    fonts: 'family=Nunito:wght@500;700;800;900'
  },
  {
    id: 'skeuo',
    name: 'Skeuomorphism',
    note: 'Yog\'och stol, qog\'oz daftar, LCD taymer',
    preview: 'tp-skeuo',
    fonts: 'family=Libre+Baskerville:wght@400;700'
           + '&family=IBM+Plex+Sans:wght@400;500;600;700'
           + '&family=IBM+Plex+Mono:wght@500;600'
           + '&family=Share+Tech+Mono'
           + '&family=Caveat:wght@600;700'
  },
  {
    id: 'neu',
    name: 'Neumorphism',
    note: 'Tekis fon, faqat yumshoq soyalar',
    preview: 'tp-neu',
    fonts: 'family=Plus+Jakarta+Sans:wght@400;500;600;700;800'
  },
  { id: 'dark', name: 'Klassik qorong\'i', note: 'Tizimning avvalgi ko\'rinishi', preview: 'tp-dark', fonts: null },
  { id: 'light', name: 'Klassik yorug\'', note: 'Avvalgi ko\'rinishning kunduzgi varianti', preview: 'tp-light', fonts: null }
];

export const DEFAULT_THEME = 'glass';

/** Uslub nomi ro'yxatda bormi; bo'lmasa sukutdagisi */
export function validTheme(id) {
  return THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
}

export function themeInfo(id) {
  return THEMES.find(t => t.id === validTheme(id));
}

/**
 * Shrift `<link>` ini bir marta qo'shadi.
 *
 * `preconnect` ham qo'shiladi: birinchi so'rovda TLS qo'l siqishini
 * oldindan bajarib, shrift kechikishini kamaytiradi.
 */
const yuklangan = new Set();
function shriftYukla(theme) {
  if (!theme.fonts || yuklangan.has(theme.id)) return;
  yuklangan.add(theme.id);

  if (!document.getElementById('gf-pre')) {
    const pre = document.createElement('link');
    pre.id = 'gf-pre';
    pre.rel = 'preconnect';
    pre.href = 'https://fonts.gstatic.com';
    pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = 'gf-' + theme.id;
  link.href = 'https://fonts.googleapis.com/css2?' + theme.fonts + '&display=swap';
  document.head.appendChild(link);
}

/**
 * Uslubni qo'llaydi. Qaytaradi: haqiqatda qo'llangan uslub nomi.
 *
 * `<html data-theme>` ni o'zgartirish yetarli — `themes.css` qolganini
 * qiladi. Shrift shu yerda yuklanadi, chunki uslub almashguncha uning
 * kerak bo'lishi ma'lum emas.
 */
export function applyTheme(id) {
  const theme = themeInfo(id);
  shriftYukla(theme);
  document.documentElement.dataset.theme = theme.id;
  return theme.id;
}
