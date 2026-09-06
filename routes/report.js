/** Hisobotni ko'rish va yuklab olish */
import { buildReport, renderHtml, renderMarkdown, renderCsv } from '../lib/report.js';
import { isDate } from '../lib/util.js';

const TYPES = ['daily', 'weekly', 'monthly'];

function opts(query) {
  return {
    type: TYPES.includes(query.type) ? query.type : 'daily',
    date: isDate(query.date) ? query.date : undefined,
    from: isDate(query.from) ? query.from : undefined,
    to: isDate(query.to) ? query.to : undefined
  };
}

/** Interfeysda ko'rsatish uchun JSON model */
export function previewReport({ query, user }) {
  return { report: buildReport(user, opts(query)) };
}

/** Yuklab olish: html | md | csv | json */
export function downloadReport({ query, user }) {
  const report = buildReport(user, opts(query));
  const format = ['html', 'md', 'csv', 'json'].includes(query.format) ? query.format : 'html';
  const slug = report.period.from === report.period.to
    ? report.period.from
    : `${report.period.from}_${report.period.to}`;
  const base = `pomodoro-hisobot-${slug}`;

  if (format === 'md') {
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: base + '.md', body: renderMarkdown(report) } };
  }
  if (format === 'csv') {
    return { __raw: { contentType: 'text/csv; charset=utf-8', filename: base + '.csv', body: renderCsv(report) } };
  }
  if (format === 'json') {
    return { __raw: { contentType: 'application/json; charset=utf-8', filename: base + '.json', body: JSON.stringify(report, null, 2) } };
  }
  return { __raw: { contentType: 'text/html; charset=utf-8', filename: base + '.html', body: renderHtml(report) } };
}

/** Brauzerda ochish (chop etish / PDF uchun) — yuklab olmasdan */
export function viewReport({ query, user }) {
  const report = buildReport(user, opts(query));
  return { __html: renderHtml(report) };
}
