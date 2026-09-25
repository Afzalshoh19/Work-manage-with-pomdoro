/** Backend bilan aloqa qatlami */

export class AuthError extends Error {}

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { data = {}; }
  if (res.status === 401 && data.code === 'AUTH_REQUIRED') {
    throw new AuthError(data.error || 'Avval tizimga kiring');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Server xatosi (${res.status})`);
    Object.assign(err, data);     // qo'shimcha maydonlar (code, backupLeft, ...)
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Faylni ishonchli yuklab olish.
 * `location.href` bilan yuklash brauzerlarda jimgina bekor bo'lishi mumkin va
 * xatoni ko'rsatmaydi. Shuning uchun faylni fetch bilan olamiz va blob orqali
 * saqlaymiz — muvaffaqiyatsiz bo'lsa aniq xato qaytadi.
 */
export async function downloadFile(url) {
  const res = await fetch(url, { headers: { Accept: '*/*' } });
  if (res.status === 401) throw new AuthError('Avval tizimga kiring');
  if (!res.ok) {
    let msg = `Server xatosi (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* JSON emas */ }
    throw new Error(msg);
  }

  // Fayl nomini serverdan olamiz, bo'lmasa manzildan yasaymiz
  let name = '';
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
  // Mahalliy sana: `toISOString()` UTC beradi va yarim tundan keyin
  // fayl kechagi kun nomi bilan saqlanardi
  if (!name) {
    const d = new Date();
    name = 'hisobot-' + new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error('Fayl bo\'sh qaytdi');

  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Blobni darhol tozalash yuklashni uzib qo'yishi mumkin — biroz kutamiz
  setTimeout(() => { URL.revokeObjectURL(href); a.remove(); }, 15000);
  return name;
}

const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  health:        ()             => request('GET', '/api/health'),

  /* Autentifikatsiya */
  me:            ()             => request('GET', '/api/auth/me'),
  logout:        ()             => request('POST', '/api/auth/logout', {}),
  changePassword:(payload)      => request('POST', '/api/auth/password', payload),
  oauthSettings: ()             => request('GET', '/api/auth/oauth-settings'),
  saveOauth:     (payload)      => request('PUT', '/api/auth/oauth-settings', payload),
  smtpSettings:  ()             => request('GET', '/api/auth/smtp'),
  saveSmtp:      (payload)      => request('PUT', '/api/auth/smtp', payload),
  testSmtp:      (to)           => request('POST', '/api/auth/smtp/test', { to }),

  /* Qurilmalar va ikki bosqichli tasdiqlash */
  sessions:      ()             => request('GET', '/api/auth/sessions'),
  revokeSession: (id)           => request('DELETE', '/api/auth/sessions/' + id),
  revokeOthers:  ()             => request('POST', '/api/auth/sessions/revoke-others', {}),
  twoFactor:     ()             => request('GET', '/api/auth/2fa'),
  twoFactorSetup:()             => request('POST', '/api/auth/2fa/setup', {}),
  twoFactorEnable:(code)        => request('POST', '/api/auth/2fa/enable', { code }),
  twoFactorDisable:(payload)    => request('POST', '/api/auth/2fa/disable', payload),
  twoFactorCancel:()            => request('POST', '/api/auth/2fa/cancel', {}),
  twoFactorCodes:(payload)      => request('POST', '/api/auth/2fa/backup-codes', payload),

  /* Profil */
  profile:       ()             => request('GET', '/api/profile'),
  workCard:      (date)         => request('GET', '/api/profile/card' + qs({ date })),
  saveProfile:   (patch)        => request('PUT', '/api/profile', patch),
  deleteAccount: (password)     => request('POST', '/api/profile/delete', { password }),
  uploadAvatar:  (image)        => request('POST', '/api/profile/avatar', { image }),
  deleteAvatar:  ()             => request('DELETE', '/api/profile/avatar'),

  /* Kun tartibi */
  plan:          (date)         => request('GET', '/api/plan' + qs({ date })),
  addTask:       (task)         => request('POST', '/api/tasks', task),
  updateTask:    (id, patch)    => request('PATCH', '/api/tasks/' + id, patch),
  deleteTask:    (id)           => request('DELETE', '/api/tasks/' + id),
  reorder:       (ids)          => request('POST', '/api/tasks/reorder', { ids }),
  copyPlan:      (from, to)     => request('POST', '/api/plan/copy', { from, to }),
  copyTasks:     (ids, to)      => request('POST', '/api/tasks/copy', { ids, to }),
  logPomodoros:  (id, payload)  => request('POST', '/api/tasks/' + id + '/log', payload),
  correctionReasons: ()         => request('GET', '/api/tasks/reasons'),
  carryOver:     (from, to)     => request('POST', '/api/plan/carry', { from, to }),
  setDaySetup:   (payload)      => request('PUT', '/api/plan/window', payload),
  planRange:     (from, to)     => request('GET', '/api/plan/range' + qs({ from, to })),
  bulkAdd:       (payload)      => request('POST', '/api/plan/bulk', payload),
  taskStatuses:  ()             => request('GET', '/api/tasks/statuses'),
  workSchedule:  ()             => request('GET', '/api/profile/schedule'),
  saveWorkSchedule: (payload)   => request('PUT', '/api/profile/schedule', payload),

  /* Taymer */
  timer:         ()             => request('GET', '/api/timer'),
  start:         (payload)      => request('POST', '/api/timer/start', payload),
  // Ikkitagacha taymer ochiq bo'lishi mumkin — qaysi biri ekani `where` da
  pause:         (where = {})   => request('POST', '/api/timer/pause', where),
  resume:        (where = {})   => request('POST', '/api/timer/resume', where),
  complete:      (where = {})   => request('POST', '/api/timer/complete', where),
  stop:          (where = {})   => request('POST', '/api/timer/stop', where),
  skip:          (where = {})   => request('POST', '/api/timer/skip', where),
  resetCycle:    ()             => request('POST', '/api/timer/cycle-reset', {}),

  /* Sozlamalar / statistika */
  settings:      ()             => request('GET', '/api/settings'),
  saveSettings:  (patch)        => request('PUT', '/api/settings', patch),
  resetSettings: ()             => request('POST', '/api/settings/reset', {}),
  stats:         (date, days)   => request('GET', '/api/stats' + qs({ date, days })),
  history:       (from, to)     => request('GET', '/api/history' + qs({ from, to })),

  /* Hisobotlar */
  report:        (opts)         => request('GET', '/api/report' + qs(opts)),
  reportUrl:     (opts)         => '/api/report/download' + qs(opts),
  reportViewUrl: (opts)         => '/api/report/view' + qs(opts),

  /* Integratsiyalar */
  integrations:  ()             => request('GET', '/api/integrations'),
  saveIntegration: (name, body) => request('PUT', '/api/integrations/' + name, body),
  testIntegration: (name)       => request('POST', '/api/integrations/' + name + '/test', {}),
  jiraPreview:   (opts)         => request('GET', '/api/integrations/jira/preview' + qs(opts)),
  jiraImport:    (payload)      => request('POST', '/api/integrations/jira/import', payload),
  exportTo:      (name, payload)=> request('POST', '/api/integrations/' + name + '/export', payload),
  genericImport: (payload)      => request('POST', '/api/integrations/import', payload),

  /* Ma'lumotlar */
  importData:    (payload)      => request('POST', '/api/import', payload),
  clear:         (scope)        => request('POST', '/api/clear', { scope }),
  exportUrl:     (format, from, to) => '/api/export' + qs({ format, from, to })
};
