/** Kutubxonasiz SVG grafiklar */

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const CAT_COLORS = {
  ish: '#ff5f56', oqish: '#4a9eff', loyiha: '#a77dff',
  uy: '#f6b73c', sport: '#35c88f',
  meet: '#00b8c4', uchrashuv: '#00b8c4', boshqa: '#8a97a8'
};
export const CAT_LABELS = {
  ish: 'Ish', oqish: "O'qish", loyiha: 'Loyiha',
  uy: 'Uy ishlari', sport: 'Sport',
  meet: 'Meet', uchrashuv: 'Uchrashuv', boshqa: 'Boshqa'
};

const shortDate = (d) => {
  const dt = new Date(d + 'T12:00:00');
  return `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

/** Kunlik pomodorolar — ustunli diagramma */
export function dailyChart(series, goal = 8, width = 0) {
  if (!series.length) return '<div class="empty">Ma\'lumot yo\'q</div>';

  // Konteyner kengligi berilsa grafik unga to'liq yoyiladi (maketdagidek)
  const W = Math.max(width || 560, series.length * 34);
  const H = 220, PAD_L = 30, PAD_B = 28, PAD_T = 14;
  const max = Math.max(goal, ...series.map(s => s.pomodoros), 1);
  const plotH = H - PAD_B - PAD_T;
  const step = (W - PAD_L - 10) / series.length;
  const bw = Math.min(24, step * 0.62);

  const ticks = [0, Math.ceil(max / 2), max];
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;

  for (const t of ticks) {
    const y = PAD_T + plotH - (t / max) * plotH;
    svg += `<line class="grid-line" x1="${PAD_L}" y1="${y}" x2="${W - 6}" y2="${y}"/>`;
    svg += `<text class="axis-txt" x="${PAD_L - 6}" y="${y + 3}" text-anchor="end">${t}</text>`;
  }
  // maqsad chizig'i
  const gy = PAD_T + plotH - (goal / max) * plotH;
  svg += `<line x1="${PAD_L}" y1="${gy}" x2="${W - 6}" y2="${gy}" stroke="#f6b73c" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/>`;
  svg += `<text class="axis-txt" x="${W - 8}" y="${gy - 5}" text-anchor="end" fill="#f6b73c">maqsad ${goal}</text>`;

  series.forEach((s, i) => {
    const x = PAD_L + i * step + (step - bw) / 2;
    const h = (s.pomodoros / max) * plotH;
    const y = PAD_T + plotH - h;
    const color = s.pomodoros >= goal ? '#35c88f' : (s.pomodoros ? '#ff5f56' : 'transparent');
    if (s.pomodoros) {
      svg += `<rect class="bar-rect" x="${x}" y="${y}" width="${bw}" height="${Math.max(2, h)}" rx="4" fill="${color}">`;
      svg += `<title>${s.date}: ${s.pomodoros} pomodoro, ${s.focusMinutes} daqiqa</title></rect>`;
    } else {
      svg += `<rect x="${x}" y="${PAD_T + plotH - 3}" width="${bw}" height="3" rx="1.5" fill="#333e4f"><title>${s.date}: 0</title></rect>`;
    }
    const showEvery = series.length > 40 ? 7 : (series.length > 16 ? 3 : 1);
    if (i % showEvery === 0 || i === series.length - 1) {
      svg += `<text class="axis-txt" x="${x + bw / 2}" y="${H - 9}" text-anchor="middle">${shortDate(s.date)}</text>`;
    }
  });

  return svg + '</svg>';
}

/** Soatlar bo'yicha taqsimot */
export function hourlyChart(hourly, width = 0) {
  const max = Math.max(1, ...hourly.map(h => h.pomodoros));
  if (!hourly.some(h => h.pomodoros)) return '<div class="empty">Hali ma\'lumot to\'planmagan</div>';

  const W = Math.max(280, width || 560), H = 150, PAD_B = 22, PAD_T = 8;
  const plotH = H - PAD_B - PAD_T;
  const step = W / 24;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
  hourly.forEach((h, i) => {
    const bh = (h.pomodoros / max) * plotH;
    const x = i * step + step * 0.18;
    const bw = step * 0.64;
    const active = h.pomodoros === max && max > 0;
    svg += `<rect class="bar-rect" x="${x}" y="${PAD_T + plotH - bh}" width="${bw}" height="${Math.max(2, bh)}" rx="3"
            fill="${h.pomodoros ? (active ? '#35c88f' : '#4a9eff') : '#333e4f'}">
            <title>${String(h.hour).padStart(2, '0')}:00 — ${h.pomodoros} pomodoro</title></rect>`;
    if (i % 3 === 0) svg += `<text class="axis-txt" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${String(h.hour).padStart(2, '0')}</text>`;
  });
  return svg + '</svg>';
}

/** Kategoriyalar — gorizontal chiziqlar */
export function categoryBars(categories) {
  if (!categories.length) return '<div class="empty">Ma\'lumot yo\'q</div>';
  const max = Math.max(...categories.map(c => c.pomodoros));
  return '<div class="cat-list">' + categories.map(c => {
    const color = CAT_COLORS[c.category] || CAT_COLORS.boshqa;
    const pct = Math.round((c.pomodoros / max) * 100);
    const hrs = c.minutes >= 60 ? `${Math.floor(c.minutes / 60)}s ${c.minutes % 60}d` : `${c.minutes}d`;
    return `<div class="cat-row">
      <span>${esc(CAT_LABELS[c.category] || c.category)}</span>
      <div class="cat-bar"><i style="width:${pct}%;background:${color}"></i></div>
      <span class="cat-val">${c.pomodoros} · ${hrs}</span>
    </div>`;
  }).join('') + '</div>';
}

export function topTasksList(tasks) {
  if (!tasks.length) return '<div class="empty">Ma\'lumot yo\'q</div>';
  return tasks.map(t => {
    const hrs = t.minutes >= 60 ? `${Math.floor(t.minutes / 60)} s ${t.minutes % 60} daq` : `${t.minutes} daq`;
    return `<div class="tt-row">
      <span>${esc(t.title)}</span>
      <b>${t.pomodoros} pomodoro</b>
      <span class="hint">${hrs}</span>
    </div>`;
  }).join('');
}
