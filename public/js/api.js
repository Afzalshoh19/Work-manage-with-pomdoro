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
  if (!res.ok) throw new Error(data.error || `Server xatosi (${res.status})`);
  return data;
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

  /* Profil */
  profile:       ()             => request('GET', '/api/profile'),
  saveProfile:   (patch)        => request('PUT', '/api/profile', patch),
  deleteAccount: (password)     => request('POST', '/api/profile/delete', { password }),

  /* Kun tartibi */
  plan:          (date)         => request('GET', '/api/plan' + qs({ date })),
  addTask:       (task)         => request('POST', '/api/tasks', task),
  updateTask:    (id, patch)    => request('PATCH', '/api/tasks/' + id, patch),
  deleteTask:    (id)           => request('DELETE', '/api/tasks/' + id),
  reorder:       (ids)          => request('POST', '/api/tasks/reorder', { ids }),
  copyPlan:      (from, to)     => request('POST', '/api/plan/copy', { from, to }),
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
  pause:         ()             => request('POST', '/api/timer/pause'),
  resume:        ()             => request('POST', '/api/timer/resume'),
  complete:      ()             => request('POST', '/api/timer/complete', {}),
  stop:          ()             => request('POST', '/api/timer/stop', {}),
  skip:          ()             => request('POST', '/api/timer/skip', {}),
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
