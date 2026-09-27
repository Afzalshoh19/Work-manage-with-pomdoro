import { getDb, persist, userSettings, DEFAULT_SETTINGS } from '../lib/db.js';
import { clamp } from '../lib/util.js';
import { checkLunch } from './tasks.js';

const THEMES = ['glass', 'clay', 'skeuo', 'neu', 'dark', 'light'];

export function getSettings({ user }) {
  return { settings: userSettings(user.id), defaults: DEFAULT_SETTINGS };
}

export function updateSettings({ user, body }) {
  const s = { ...DEFAULT_SETTINGS, ...(user.settings || {}) };
  const b = body || {};

  if (b.workMinutes !== undefined) s.workMinutes = clamp(b.workMinutes, 1, 180);
  if (b.shortBreakMinutes !== undefined) s.shortBreakMinutes = clamp(b.shortBreakMinutes, 0, 60);
  if (b.longBreakMinutes !== undefined) s.longBreakMinutes = clamp(b.longBreakMinutes, 0, 120);
  if (b.longBreakInterval !== undefined) s.longBreakInterval = clamp(b.longBreakInterval, 2, 12);
  if (b.dailyGoal !== undefined) s.dailyGoal = clamp(b.dailyGoal, 1, 30);
  if (b.volume !== undefined) s.volume = clamp(b.volume, 0, 1);
  if (b.dayStartTime !== undefined && /^\d{1,2}:\d{2}$/.test(String(b.dayStartTime))) {
    s.dayStartTime = String(b.dayStartTime).padStart(5, '0');
  }
  if (b.dayEndTime !== undefined && /^\d{1,2}:\d{2}$/.test(String(b.dayEndTime))) {
    s.dayEndTime = String(b.dayEndTime).padStart(5, '0');
  }
  if (b.lunchStart !== undefined || b.lunchEnd !== undefined) {
    const ls = String(b.lunchStart ?? s.lunchStart).padStart(5, '0');
    const le = String(b.lunchEnd ?? s.lunchEnd).padStart(5, '0');
    const err = checkLunch(ls, le, s.dayStartTime, s.dayEndTime);
    if (err) return { error: err, status: 400 };
    s.lunchStart = ls;
    s.lunchEnd = le;
  }
  for (const key of ['autoStartBreaks', 'autoStartWork', 'soundEnabled', 'notificationsEnabled', 'tickingEnabled', 'lunchEnabled']) {
    if (b[key] !== undefined) s[key] = !!b[key];
  }
  // Ko'rinish uslublari. `dark` va `light` — eski klassik ko'rinish;
  // kimning sozlamasida o'sha tursa o'zgarmasin, shuning uchun qoldirildi.
  // Ro'yxat `public/js/theme.js` dagi THEMES bilan bir xil bo'lishi shart.
  if (THEMES.includes(b.theme)) s.theme = b.theme;

  user.settings = s;
  persist();
  return { settings: s };
}

export function resetSettings({ user }) {
  user.settings = { ...DEFAULT_SETTINGS };
  persist();
  return { settings: user.settings };
}
