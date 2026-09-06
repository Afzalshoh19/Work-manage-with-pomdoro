/**
 * Jira Cloud / Server integratsiyasi — vazifalarni JQL bo'yicha yuklab olish.
 * Autentifikatsiya: email + API token (Basic auth).
 * Token olish: https://id.atlassian.com/manage-profile/security/api-tokens
 */

const PRIORITY_MAP = {
  highest: 'yuqori', high: 'yuqori', critical: 'yuqori', blocker: 'yuqori',
  medium: 'orta', normal: 'orta', major: 'orta',
  low: 'past', lowest: 'past', minor: 'past', trivial: 'past'
};

const TYPE_CATEGORY = {
  bug: 'ish', task: 'ish', 'sub-task': 'ish', subtask: 'ish', story: 'loyiha',
  epic: 'loyiha', 'new feature': 'loyiha', improvement: 'loyiha', spike: 'oqish'
};

function authHeader(email, token) {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

function normBase(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b;
  return b;
}

async function call(cfg, path, init = {}) {
  const url = normBase(cfg.baseUrl) + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(cfg.email, cfg.token),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, data };
}

/** Ulanishni tekshirish */
export async function testConnection(cfg) {
  if (!normBase(cfg.baseUrl)) throw new Error('Jira manzili kiritilmagan');
  if (!cfg.email || !cfg.token) throw new Error('Email yoki API token kiritilmagan');

  const r = await call(cfg, '/rest/api/3/myself');
  if (r.status === 401 || r.status === 403) throw new Error('Email yoki API token noto\'g\'ri (' + r.status + ')');
  if (!r.ok) throw new Error(`Jira javob bermadi (${r.status}). Manzil to'g'rimi?`);
  return {
    accountId: r.data.accountId,
    displayName: r.data.displayName,
    email: r.data.emailAddress || cfg.email
  };
}

/** JQL bo'yicha masalalarni olish (yangi va eski API bilan mos) */
async function searchIssues(cfg, jql, maxResults) {
  const fields = ['summary', 'priority', 'status', 'issuetype', 'timetracking',
    'timeoriginalestimate', 'timeestimate', 'duedate', 'project', 'description'];

  // Yangi endpoint (Jira Cloud 2025+)
  let r = await call(cfg, '/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, maxResults, fields })
  });

  // Eski endpoint bilan zaxira urinish
  if (r.status === 404 || r.status === 410 || r.status === 405) {
    r = await call(cfg, '/rest/api/3/search', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults, fields })
    });
  }
  if (r.status === 400) {
    const msg = r.data?.errorMessages?.join('; ') || 'JQL so\'rovi noto\'g\'ri';
    throw new Error('Jira: ' + msg);
  }
  if (r.status === 401 || r.status === 403) throw new Error('Jira: ruxsat yo\'q — email yoki API tokenni tekshiring');
  if (!r.ok) throw new Error(`Jira qidiruvi muvaffaqiyatsiz (${r.status})`);
  return r.data?.issues || [];
}

/**
 * Jira masalalarini pomodoro vazifalariga aylantirish.
 * Vaqt bahosi (original estimate) bo'lsa — pomodorolar soni shundan hisoblanadi.
 */
export async function fetchTasks(cfg, { jql, limit = 25 } = {}) {
  const perPomodoro = Math.max(5, Number(cfg.minutesPerPomodoro) || 25);
  const fallback = Math.max(1, Number(cfg.defaultPomodoros) || 2);
  const issues = await searchIssues(cfg, jql || cfg.jql, Math.min(100, Math.max(1, limit)));
  const base = normBase(cfg.baseUrl);

  return issues.map(issue => {
    const f = issue.fields || {};
    const estimateSec = f.timetracking?.originalEstimateSeconds ?? f.timeoriginalestimate ?? f.timeestimate ?? 0;
    const pomodoros = estimateSec
      ? Math.max(1, Math.min(30, Math.round(estimateSec / 60 / perPomodoro)))
      : fallback;
    const prio = String(f.priority?.name || '').toLowerCase();
    const type = String(f.issuetype?.name || '').toLowerCase();

    return {
      key: issue.key,
      title: `${issue.key} — ${f.summary || '(nomsiz)'}`,
      summary: f.summary || '',
      plannedPomodoros: pomodoros,
      estimateMinutes: estimateSec ? Math.round(estimateSec / 60) : null,
      priority: PRIORITY_MAP[prio] || 'orta',
      category: TYPE_CATEGORY[type] || 'ish',
      status: f.status?.name || '',
      issueType: f.issuetype?.name || '',
      project: f.project?.name || '',
      dueDate: f.duedate || null,
      url: base + '/browse/' + issue.key
    };
  });
}

export const providerInfo = {
  id: 'jira',
  name: 'Jira',
  docs: 'https://id.atlassian.com/manage-profile/security/api-tokens'
};
