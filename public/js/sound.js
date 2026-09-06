/** Ovozli signal (WebAudio orqali generatsiya qilinadi — tashqi fayl kerak emas) */

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Brauzer avtomatik ovozni bloklamasligi uchun birinchi bosishda uyg'otamiz */
export function unlockAudio() {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0.0001;
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.01);
}

function tone(freq, start, dur, volume, type = 'sine') {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain); gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * @param {'work'|'break'|'test'} kind  qaysi bosqich tugadi
 * @param {number} volume 0..1
 */
export function playAlarm(kind, volume = 0.6) {
  const v = Math.max(0, Math.min(1, volume)) * 0.35;
  if (!v) return;
  if (kind === 'work') {
    // Ish tugadi — pastdan yuqoriga uch nota (dam olish vaqti)
    tone(523.25, 0.00, 0.35, v);
    tone(659.25, 0.18, 0.35, v);
    tone(783.99, 0.36, 0.55, v);
  } else if (kind === 'break') {
    // Tanaffus tugadi — ikki qat'iy signal (ishga qaytish)
    tone(880, 0.00, 0.22, v, 'triangle');
    tone(880, 0.30, 0.22, v, 'triangle');
    tone(1046.5, 0.60, 0.40, v, 'triangle');
  } else {
    tone(659.25, 0, 0.3, v);
  }
}

/** Har daqiqada yengil "tik" (ixtiyoriy) */
export function playTick(volume = 0.6) {
  tone(1200, 0, 0.045, Math.max(0, Math.min(1, volume)) * 0.06, 'square');
}

/* ═══════ Brauzer bildirishnomalari ═══════ */

export function notifyPermission() {
  return ('Notification' in window) ? Notification.permission : 'unsupported';
}

export async function askNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); }
  catch { return 'denied'; }
}

export function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍅</text></svg>",
      tag: 'pomodoro',
      renotify: true
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 15000);
  } catch { /* e'tiborsiz */ }
}
