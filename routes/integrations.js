/** Tashqi tizimlar: Jira (import), Notion / Confluence (eksport), umumiy CSV/JSON import */
import { getDb, persist } from '../lib/db.js';
import { buildReport, renderNotionBlocks, renderConfluence } from '../lib/report.js';
import { resolvedConfig, noteIntegrationResult } from './profile.js';
import { uid, isDate, clamp, str } from '../lib/util.js';
import * as jira from '../lib/integrations/jira.js';
import * as notion from '../lib/integrations/notion.js';
import * as confluence from '../lib/integrations/confluence.js';

const CLIENTS = { jira, notion, confluence };

/* ═══════════ Ulanishni tekshirish ═══════════ */

export async function testIntegration({ user, params }) {
  const name = params.name;
  const client = CLIENTS[name];
  if (!client) return { error: 'Bunday integratsiya yo\'q', status: 404 };
  const cfg = resolvedConfig(user, name);
  try {
    const info = await client.testConnection(cfg);
    noteIntegrationResult(user, name, { error: null });
    return { ok: true, info };
  } catch (err) {
    noteIntegrationResult(user, name, { error: err.message });
    return { error: err.message, status: 400 };
  }
}

/* ═══════════ Jira: vazifalarni ko'rish va import qilish ═══════════ */

export async function jiraPreview({ user, query }) {
  const cfg = resolvedConfig(user, 'jira');
  if (!cfg?.token) return { error: 'Jira sozlanmagan — Sozlamalar → Integratsiyalar bo\'limiga kiring', status: 400 };
  try {
    const issues = await jira.fetchTasks(cfg, { jql: str(query.jql, 1000) || cfg.jql, limit: clamp(query.limit ?? 25, 1, 50) });
    noteIntegrationResult(user, 'jira', { error: null });
    return { issues, jql: str(query.jql, 1000) || cfg.jql };
  } catch (err) {
    noteIntegrationResult(user, 'jira', { error: err.message });
    return { error: err.message, status: 400 };
  }
}

export async function jiraImport({ user, body }) {
  const db = getDb();
  const cfg = resolvedConfig(user, 'jira');
  if (!cfg?.token) return { error: 'Jira sozlanmagan', status: 400 };

  const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const keys = Array.isArray(body.keys) ? body.keys : null;

  try {
    const issues = await jira.fetchTasks(cfg, { jql: str(body.jql, 1000) || cfg.jql, limit: 50 });
    const chosen = keys ? issues.filter(i => keys.includes(i.key)) : issues;
    if (!chosen.length) return { error: 'Import qilinadigan masala tanlanmadi', status: 400 };

    const existing = db.tasks.filter(t => t.userId === user.id && t.date === date);
    const existingKeys = new Set(
      db.tasks.filter(t => t.userId === user.id && t.source?.type === 'jira').map(t => t.source.key)
    );
    let order = existing.length ? Math.max(...existing.map(t => t.order ?? 0)) + 1 : 0;

    const created = [];
    let skipped = 0;
    for (const issue of chosen) {
      if (existingKeys.has(issue.key)) { skipped++; continue; }
      created.push({
        id: uid(),
        userId: user.id,
        date,
        title: issue.title,
        note: [issue.project, issue.issueType, issue.status].filter(Boolean).join(' · '),
        category: issue.category,
        priority: issue.priority,
        plannedPomodoros: issue.plannedPomodoros,
        completedPomodoros: 0,
        focusSeconds: 0,
        done: false,
        order: order++,
        source: { type: 'jira', key: issue.key, url: issue.url },
        createdAt: new Date().toISOString(),
        completedAt: null
      });
    }
    db.tasks.push(...created);
    persist();
    noteIntegrationResult(user, 'jira', { error: null, importedAt: new Date().toISOString() });
    return { imported: created.length, skipped, date };
  } catch (err) {
    noteIntegrationResult(user, 'jira', { error: err.message });
    return { error: err.message, status: 400 };
  }
}

/* ═══════════ Notion / Confluence: hisobotni eksport qilish ═══════════ */

export async function exportReport({ user, params, body }) {
  const target = params.name;
  if (!['notion', 'confluence'].includes(target)) return { error: 'Faqat notion yoki confluence', status: 400 };

  const cfg = resolvedConfig(user, target);
  if (!cfg?.token) return { error: `${target === 'notion' ? 'Notion' : 'Confluence'} sozlanmagan`, status: 400 };

  const report = buildReport(user, {
    type: ['daily', 'weekly', 'monthly'].includes(body.type) ? body.type : 'daily',
    date: isDate(body.date) ? body.date : undefined,
    from: isDate(body.from) ? body.from : undefined,
    to: isDate(body.to) ? body.to : undefined
  });
  const title = `${report.period.label} — ${user.name}`;

  try {
    const page = target === 'notion'
      ? await notion.createReportPage(cfg, { title, blocks: renderNotionBlocks(report) })
      : await confluence.createReportPage(cfg, { title, storageHtml: renderConfluence(report) });

    noteIntegrationResult(user, target, { error: null, exportedAt: new Date().toISOString() });
    return { ok: true, url: page.url, id: page.id, title };
  } catch (err) {
    noteIntegrationResult(user, target, { error: err.message });
    return { error: err.message, status: 400 };
  }
}

/* ═══════════ Umumiy import (Trello / Asana / Todoist / ClickUp CSV yoki JSON) ═══════════ */

/** Oddiy CSV parseri — vergul yoki nuqta-vergul ajratgichi bilan */
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

const TITLE_KEYS = ['title', 'name', 'task', 'task name', 'summary', 'card name', 'content', 'vazifa', 'nom'];
const ESTIMATE_KEYS = ['estimate', 'estimated', 'time estimate', 'original estimate', 'duration', 'hours', 'minutes', 'vaqt', 'baho'];
const NOTE_KEYS = ['description', 'notes', 'note', 'details', 'izoh'];
const PRIORITY_KEYS = ['priority', 'muhimlik'];
const DONE_KEYS = ['completed', 'done', 'status', 'holat'];

function pick(obj, keys) {
  for (const k of Object.keys(obj)) {
    if (keys.includes(k.trim().toLowerCase())) return obj[k];
  }
  return undefined;
}

function estimateToPomodoros(value, perPomodoro) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  let minutes = 0;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(h|soat|hour)/);
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(m|daq|min)/);
  if (h) minutes += parseFloat(h[1].replace(',', '.')) * 60;
  if (m) minutes += parseFloat(m[1].replace(',', '.'));
  if (!h && !m) {
    const n = parseFloat(s.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    minutes = n <= 12 ? n * 60 : n;      // 12 dan kichik son — soat deb qabul qilinadi
  }
  if (!minutes) return null;
  return clamp(Math.round(minutes / perPomodoro), 1, 30);
}

export function genericImport({ user, body }) {
  const db = getDb();
  const date = isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const perPomodoro = clamp(body.minutesPerPomodoro ?? 25, 5, 120);
  const fallback = clamp(body.defaultPomodoros ?? 2, 1, 20);
  const sourceName = str(body.source, 40) || 'import';

  let records = [];
  if (typeof body.csv === 'string' && body.csv.trim()) {
    const rows = parseCsv(body.csv);
    if (rows.length < 2) return { error: 'CSV faylda sarlavha qatori va kamida bitta vazifa bo\'lishi kerak', status: 400 };
    const headers = rows[0].map(h => String(h).trim());
    records = rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  } else if (Array.isArray(body.items)) {
    records = body.items;
  } else {
    return { error: 'CSV matni yoki items ro\'yxati kerak', status: 400 };
  }

  const existing = db.tasks.filter(t => t.userId === user.id && t.date === date);
  let order = existing.length ? Math.max(...existing.map(t => t.order ?? 0)) + 1 : 0;

  const created = [];
  let skipped = 0;
  for (const rec of records.slice(0, 200)) {
    const title = str(pick(rec, TITLE_KEYS) ?? rec.title ?? '', 200);
    if (!title) { skipped++; continue; }

    const doneRaw = String(pick(rec, DONE_KEYS) ?? '').trim().toLowerCase();
    const done = ['true', '1', 'yes', 'done', 'completed', 'bajarildi', 'closed'].includes(doneRaw);
    const prioRaw = String(pick(rec, PRIORITY_KEYS) ?? '').trim().toLowerCase();
    const priority = /high|urgent|1|yuqori/.test(prioRaw) ? 'yuqori'
      : /low|4|past/.test(prioRaw) ? 'past' : 'orta';

    created.push({
      id: uid(),
      userId: user.id,
      date,
      title,
      note: str(pick(rec, NOTE_KEYS) ?? '', 1000),
      category: 'ish',
      priority,
      plannedPomodoros: estimateToPomodoros(pick(rec, ESTIMATE_KEYS), perPomodoro) ?? fallback,
      completedPomodoros: 0,
      focusSeconds: 0,
      done,
      order: order++,
      source: { type: sourceName, key: str(rec.id ?? rec.ID ?? '', 60) || null, url: str(rec.url ?? rec.URL ?? '', 300) || null },
      createdAt: new Date().toISOString(),
      completedAt: null
    });
  }

  if (!created.length) return { error: 'Vazifa topilmadi — ustun nomlarini tekshiring (title / name / task)', status: 400 };
  db.tasks.push(...created);
  persist();
  return { imported: created.length, skipped, date };
}
