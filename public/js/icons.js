/**
 * Umumiy SVG belgilar to'plami.
 *
 * Emoji o'rniga shular ishlatiladi: emoji operatsion tizimga qarab
 * har xil chiziladi va uslubga bo'ysunmaydi, SVG esa matn rangini
 * oladi va hamma joyda bir xil ko'rinadi.
 *
 * Har bir qiymat — faqat ichki shakllar; o'rov `icon()` da qo'shiladi.
 */
export const SVG = {
  /* ── Taymer va ish ── */
  pomodoro: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M8.5 3.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>',
  focus:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  coffee:   '<path d="M4 9h13v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M17 10h1.8a2.2 2.2 0 1 1 0 4.4H17"/><path d="M7 2.5v2.2M11 2.5v2.2"/>',
  timer:    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  gauge:    '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 18l4.5-5"/><circle cx="12" cy="18" r="1.3"/>',
  play:     '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause:    '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  skip:     '<path d="M5 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  stopSq:   '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',

  /* ── Sana va jadval ── */
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  calDays:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.3 2"/>',

  /* ── Amallar ── */
  check:    '<path d="M20 6.5 9.5 17 4 11.5"/>',
  tick:     '<path d="M20 6.5 9.5 17 4 11.5"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  eye:      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  copy:     '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  pencil:   '<path d="M15 4.5 19.5 9 8 20.5l-5 1 1-5z"/><path d="M13.5 6 18 10.5"/>',
  trash:    '<path d="M4 7h16M10 4h4M9 7v11M15 7v11M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  undo:     '<path d="M4 10h10a5 5 0 1 1 0 10H8"/><path d="M4 10 8 6M4 10l4 4"/>',
  arrowR:   '<path d="M5 12h14M13 6l6 6-6 6"/>',
  note:     '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  warn:     '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/>',

  /* ── Profil bo'limlari ── */
  user:     '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  idCard:   '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.2a3.8 3.8 0 0 1 7 0M14.5 10h4M14.5 13.5h4"/>',
  shield:   '<path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  lock:     '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 1 1 8 0v3.5"/>',
  link:     '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11 6.1"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0L5 13.1a4.5 4.5 0 0 0 6.4 6.4L13 17.9"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  cog:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.8-1.1V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.8h.1a2 2 0 1 1 0 4z"/>',

  /* ── Aloqa va ovoz ── */
  mail:     '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/>',
  key:      '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3.5M15.5 12v2.5"/>',
  bell:     '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z"/><path d="M10 18.5a2.2 2.2 0 0 0 4 0"/>',
  volume:   '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M15.5 9.5a3.8 3.8 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',

  /* ── Natijalar ── */
  chart:    '<path d="M3 20h18"/><rect x="5" y="11" width="3.5" height="6" rx="1"/><rect x="10.2" y="7" width="3.5" height="10" rx="1"/><rect x="15.5" y="13" width="3.5" height="4" rx="1"/>',
  flame:    '<path d="M12 21c3.6 0 6-2.4 6-5.6 0-3.6-2.8-5.4-3.6-8.9-2 1.3-2.6 3.2-2.4 5-1-.6-1.6-1.8-1.6-3.2C8.2 9.6 6 11.9 6 15.4 6 18.6 8.4 21 12 21z"/>',
  medal:    '<circle cx="12" cy="15" r="5"/><path d="M12 13.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 15.3l2-.3z"/><path d="M8.5 10.5 6.5 3h11l-2 7.5"/>',
  folder:   '<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/><path d="M3 8h18l-1.4 10a2 2 0 0 1-2 1.8H6.4a2 2 0 0 1-2-1.8z"/>',
  report:   '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'
};

/** Belgini tayyor SVG holida qaytaradi */
export const icon = (name, cls = '') =>
  '<svg' + (cls ? ` class="${cls}"` : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + (SVG[name] || '') + '</svg>';

/** Sarlavha oldidagi belgi — o'lchami va rangi uslubdan keladi */
export const secIcon = (name) => `<span class="sec-ico">${icon(name)}</span>`;


/**
 * Avatar belgilari — profil rasmi yuklanmaganda ishlatiladi.
 * Kalitlar server bilan bir xil: lib/avatars.js → AVATAR_ICONS.
 * Emoji avatarlar ham qo'llab-quvvatlanadi, ular matn sifatida chiziladi.
 */
export const AVATAR_SVG = {
  pomodoro:  '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M8.5 3.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>',
  rocket:    '<path d="M12 3c3 2 5 5.6 5 9.6V17l-2.5 2h-5L7 17v-4.4C7 8.6 9 5 12 3z"/><circle cx="12" cy="10" r="1.7"/><path d="M7 14.5 4 17l1.4 3M17 14.5l3 2.5-1.4 3"/>',
  target:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  bolt:      '<path d="M13.5 2.5 5 13.5h5.5L10 21.5 19 10h-5.5z"/>',
  star:      '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  flame:     '<path d="M12 21c3.6 0 6-2.4 6-5.6 0-3.6-2.8-5.4-3.6-8.9-2 1.3-2.6 3.2-2.4 5-1-.6-1.6-1.8-1.6-3.2C8.2 9.6 6 11.9 6 15.4 6 18.6 8.4 21 12 21z"/>',
  leaf:      '<path d="M5 19.5c0-8.5 5.5-13.5 15.5-13.5 0 9.5-5.5 14.5-13.5 14.5"/><path d="M5 19.5c3-3.8 6.8-6.4 11-8"/>',
  wave:      '<path d="M2.5 9c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 4.1-1.8 4.6 0"/><path d="M2.5 15c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 4.1-1.8 4.6 0"/>',
  book:      '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19.5v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18.5h15.5V21H6.5A2.5 2.5 0 0 1 4 18.5z"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18"/>',
  bulb:      '<path d="M9.5 17.5h5M10.2 20.5h3.6"/><path d="M12 3a6 6 0 0 1 3.4 10.9c-.6.4-.9 1-.9 1.7v.4h-5v-.4c0-.7-.3-1.3-.9-1.7A6 6 0 0 1 12 3z"/>',
  coffee:    '<path d="M4 9h13v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M17 10h1.8a2.2 2.2 0 1 1 0 4.4H17"/><path d="M7 2.5v2.2M11 2.5v2.2"/>',
  compass:   '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.1 5.2-5.1 2.1 2.1-5.2z"/>',
  mountain:  '<path d="M2.5 19.5 9 7l4 6.6 2.6-3.6 5.9 9.5z"/><path d="M9 7l2.2 3.6"/>',
  puzzle:    '<path d="M9 4.5h3.2a1.5 1.5 0 1 1 2.8 0H18v3.2a1.5 1.5 0 1 0 0 2.8V14h-3.2a1.5 1.5 0 1 0-2.8 0H9v-3.2a1.5 1.5 0 1 1 0-2.8z"/><path d="M9 14v5.5h9.5"/>',
  cube:      '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'
};

/** Qiymat SVG belgimi yoki emojimi */
export const isIconAvatar = (key) => Object.prototype.hasOwnProperty.call(AVATAR_SVG, String(key || ''));

/** Avatar belgisi — SVG holida */
export const avatarIcon = (key) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + (AVATAR_SVG[key] || AVATAR_SVG.pomodoro) + '</svg>';

/** Avatar ichi — belgi bo'lsa SVG, aks holda emojining o'zi */
export const avatarInner = (value) =>
  isIconAvatar(value) ? avatarIcon(value) : String(value || '🍅');
