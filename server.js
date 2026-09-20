/**
 * Pomodoro — Ish jarayonini boshqarish tizimi
 * Tashqi kutubxonasiz Node.js HTTP serveri (npm install talab qilinmaydi).
 *   ishga tushirish:  node server.js
 */
// .env eng boshida o'qilishi kerak — qolgan modullar muhitni shu paytda ko'radi
import { loadEnvFile, envNames } from './lib/secrets.js';
const envHolat = loadEnvFile();

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, dailyBackup, paths } from './lib/db.js';
import { userFromRequest } from './lib/auth.js';
import { isSecureRequest } from './lib/net.js';
import { sweep as sweepLimits } from './lib/ratelimit.js';
import { TLS_ENABLED, TLS_KEY, TLS_CERT, TLS_CA, FORCE_HTTPS, HSTS_DAYS } from './lib/paths.js';
import * as Auth from './routes/auth.js';
import * as Profile from './routes/profile.js';
import * as Tasks from './routes/tasks.js';
import * as Timer from './routes/timer.js';
import * as Settings from './routes/settings.js';
import * as Stats from './routes/stats.js';
import * as Data from './routes/export.js';
import * as Report from './routes/report.js';
import * as Integrations from './routes/integrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4123;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* ---------------- Routerlar ----------------
   [metod, manzil, ishlovchi, ochiqmi (autentifikatsiyasiz)]           */
const routes = [
  ['GET',    '/api/health',              () => ({ ok: true, version: 2, time: new Date().toISOString() }), true],

  // Autentifikatsiya
  ['GET',    '/api/auth/config',         Auth.authConfig, true],
  ['POST',   '/api/auth/register',       Auth.register, true],
  ['POST',   '/api/auth/login',          Auth.login, true],
  ['POST',   '/api/auth/logout',         Auth.logout, true],
  ['GET',    '/api/auth/me',             Auth.me, true],
  ['GET',    '/api/auth/start/:provider',    Auth.oauthStart, true],
  ['GET',    '/api/auth/callback/:provider', Auth.oauthCallback, true],
  ['POST',   '/api/auth/password',       Auth.changePassword],
  ['POST',   '/api/auth/verify',         Auth.verifyEmail, true],
  ['POST',   '/api/auth/resend-code',    Auth.resendCode, true],
  ['POST',   '/api/auth/forgot',         Auth.forgotPassword, true],
  ['POST',   '/api/auth/reset',          Auth.resetPassword, true],

  // Ikki bosqichli tasdiqlash
  ['POST',   '/api/auth/2fa/verify',     Auth.twoFactorVerify, true],
  ['GET',    '/api/auth/2fa',            Auth.twoFactorStatus],
  ['POST',   '/api/auth/2fa/setup',      Auth.twoFactorSetup],
  ['POST',   '/api/auth/2fa/enable',     Auth.twoFactorEnable],
  ['POST',   '/api/auth/2fa/disable',    Auth.twoFactorDisable],
  ['POST',   '/api/auth/2fa/cancel',     Auth.twoFactorCancel],
  ['POST',   '/api/auth/2fa/backup-codes', Auth.twoFactorBackupCodes],

  // Qurilmalar (ochiq seanslar)
  ['GET',    '/api/auth/sessions',              Auth.mySessions],
  ['POST',   '/api/auth/sessions/revoke-others', Auth.revokeOtherSessions],
  ['DELETE', '/api/auth/sessions/:id',          Auth.revokeMySession],
  ['GET',    '/api/auth/smtp',           Auth.getSmtpSettings],
  ['PUT',    '/api/auth/smtp',           Auth.saveSmtpSettings],
  ['POST',   '/api/auth/smtp/test',      Auth.testSmtp],
  ['GET',    '/api/auth/oauth-settings', Auth.getOauthSettings],
  ['PUT',    '/api/auth/oauth-settings', Auth.saveOauthSettings],

  // Profil
  ['GET',    '/api/profile',             Profile.getProfile],
  ['GET',    '/api/profile/card',        Profile.getWorkCard],
  ['PUT',    '/api/profile',             Profile.updateProfile],
  ['POST',   '/api/profile/delete',      Profile.deleteAccount],
  ['POST',   '/api/profile/avatar',      Profile.uploadAvatar],
  ['DELETE', '/api/profile/avatar',       Profile.deleteAvatar],
  ['GET',    '/api/avatar/:id',          Profile.getAvatar],
  ['GET',    '/api/profile/schedule',    Profile.getWorkSchedule],
  ['PUT',    '/api/profile/schedule',    Profile.saveWorkSchedule],
  ['GET',    '/api/integrations',        Profile.getIntegrations],
  ['PUT',    '/api/integrations/:name',  Profile.saveIntegration],

  // Kun tartibi
  ['GET',    '/api/plan',                Tasks.getPlan],
  ['POST',   '/api/tasks',               Tasks.createTask],
  ['PATCH',  '/api/tasks/:id',           Tasks.updateTask],
  ['DELETE', '/api/tasks/:id',           Tasks.deleteTask],
  ['POST',   '/api/tasks/reorder',       Tasks.reorderTasks],
  ['PUT',    '/api/plan/window',         Tasks.setPlanWindow],
  ['GET',    '/api/plan/range',          Tasks.getPlanRange],
  ['GET',    '/api/plan/workdays',       Tasks.workdaysInRange],
  ['POST',   '/api/plan/bulk',           Tasks.bulkAddTasks],
  ['GET',    '/api/tasks/statuses',      Tasks.statusList],
  ['GET',    '/api/tasks/categories',    Tasks.categoryList],
  ['POST',   '/api/plan/copy',           Tasks.copyPlan],
  ['POST',   '/api/tasks/copy',          Tasks.copyTasks],
  ['POST',   '/api/tasks/:id/log',       Tasks.logPomodoros],
  ['GET',    '/api/tasks/reasons',       Tasks.correctionReasons],
  ['POST',   '/api/plan/carry',          Tasks.carryOver],

  // Taymer
  ['GET',    '/api/timer',               Timer.getTimer],
  ['POST',   '/api/timer/start',         Timer.startTimer],
  ['POST',   '/api/timer/pause',         Timer.pauseTimer],
  ['POST',   '/api/timer/resume',        Timer.resumeTimer],
  ['POST',   '/api/timer/complete',      Timer.completeTimer],
  ['POST',   '/api/timer/stop',          Timer.stopTimer],
  ['POST',   '/api/timer/skip',          Timer.skipTimer],
  ['POST',   '/api/timer/cycle-reset',   Timer.resetCycle],

  // Sozlamalar / statistika
  ['GET',    '/api/settings',            Settings.getSettings],
  ['PUT',    '/api/settings',            Settings.updateSettings],
  ['POST',   '/api/settings/reset',      Settings.resetSettings],
  ['GET',    '/api/stats',               Stats.getStats],
  ['GET',    '/api/history',             Stats.getHistory],

  // Hisobotlar
  ['GET',    '/api/report',              Report.previewReport],
  ['GET',    '/api/report/download',     Report.downloadReport],
  ['GET',    '/api/report/view',         Report.viewReport],

  // Integratsiyalar
  ['POST',   '/api/integrations/:name/test',   Integrations.testIntegration],
  ['GET',    '/api/integrations/jira/preview', Integrations.jiraPreview],
  ['POST',   '/api/integrations/jira/import',  Integrations.jiraImport],
  ['POST',   '/api/integrations/:name/export', Integrations.exportReport],
  ['POST',   '/api/integrations/import',       Integrations.genericImport],

  // Ma'lumotlar
  ['GET',    '/api/export',              Data.exportData],
  ['POST',   '/api/import',              Data.importData],
  ['POST',   '/api/clear',               Data.clearData]
];

function matchRoute(method, pathname) {
  let dynamic = null;
  for (const [m, pattern, handler, open] of routes) {
    if (m !== method) continue;
    if (!pattern.includes(':')) {
      if (pattern === pathname) return { handler, params: {}, open: !!open };
      continue;
    }
    if (dynamic) continue;
    const pParts = pattern.split('/');
    const uParts = pathname.split('/');
    if (pParts.length !== uParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i].startsWith(':')) params[pParts[i].slice(1)] = decodeURIComponent(uParts[i]);
      else if (pParts[i] !== uParts[i]) { ok = false; break; }
    }
    // Aniq mos keluvchi manzillar ustuvor: dinamikni oxirida qaytaramiz
    if (ok) dynamic = { handler, params, open: !!open };
  }
  return dynamic;
}

/* ---------------- Yordamchilar ---------------- */
/**
 * Har bir javobga qo'yiladigan xavfsizlik sarlavhalari.
 * HSTS faqat HTTPS orqali kelgan so'rovga qo'yiladi — HTTP ustida
 * uni yuborish standart bo'yicha ham ma'nosiz, ham zararli.
 */
function securityHeaders(req) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin'
  };
  if (HSTS_DAYS > 0 && isSecureRequest(req)) {
    h['Strict-Transport-Security'] = `max-age=${Math.round(HSTS_DAYS * 86400)}; includeSubDomains`;
  }
  return h;
}

function json(res, status, data, cookie, req) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(req)
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error('Sorov hajmi juda katta')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('JSON formati notogri')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Taqiqlangan'); }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — sahifa topilmadi');
    }
    const ext = path.extname(filePath).toLowerCase();

    // Fayl o'zgarsa brauzer eski nusxani ishlatmasligi uchun ETag beramiz.
    // HTML umuman keshlanmaydi — shunda yangilangan JS/CSS havolalari darhol yetib boradi.
    const etag = '"' + stat.mtimeMs.toString(36) + '-' + stat.size.toString(36) + '"';
    if (ext !== '.html' && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store, must-revalidate' : 'no-cache',
      ETag: etag,
      ...securityHeaders(req)
    });
    // Fayl o'qishda xato bo'lsa (o'chirilgan, band) 'error' hodisasi ushlanmasa server qulaydi
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

/** Oddiy CSRF himoyasi: o'zgartiruvchi so'rovlar faqat o'z manzilimizdan kelishi kerak */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;                    // brauzerdan kelmagan (curl, skript) — ruxsat
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/* ---------------- Server ---------------- */
function onRequest(req, res) {
  res.on('error', () => { /* mijoz ulanishni uzdi — server to'xtamasin */ });
  handleRequest(req, res).catch((err) => {
    console.error('  So\'rovda kutilmagan xato:', (err && err.message) || err);
    if (res.headersSent) return res.destroy();
    try { json(res, 500, { error: 'Server xatosi' }, null, req); } catch { res.destroy(); }
  });
}

/** TLS sertifikatlari o'qiladi; xato bo'lsa server HTTP rejimida qoladi */
function tlsOptions() {
  if (!TLS_ENABLED) return null;
  try {
    const opt = { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };
    if (TLS_CA) opt.ca = fs.readFileSync(TLS_CA);
    return opt;
  } catch (err) {
    console.error('  TLS sertifikati o\'qilmadi:', err.message);
    console.error('  Server HTTP rejimida ishga tushadi.');
    return null;
  }
}

const tls = tlsOptions();
const server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
const httpsActive = !!tls;

/**
 * HTTPS yoqilganda 80-portdagi HTTP so'rovlari HTTPS'ga yo'naltiriladi.
 * REDIRECT_PORT berilmasa yo'naltiruvchi umuman ishga tushmaydi.
 */
let redirector = null;
if (httpsActive && FORCE_HTTPS && process.env.REDIRECT_PORT) {
  const rp = Number(process.env.REDIRECT_PORT);
  redirector = http.createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const target = 'https://' + host + (PORT === 443 ? '' : ':' + PORT) + req.url;
    res.writeHead(301, { Location: target, 'Cache-Control': 'no-store' });
    res.end();
  });
  redirector.on('error', (e) => console.error('  Yo\'naltiruvchi port xatosi:', e.message));
  redirector.listen(rp, HOST, () => console.log('  HTTP -> HTTPS yo\'naltirish: ' + rp + '-port'));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Allow': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' });
    return res.end();
  }

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const route = matchRoute(req.method, pathname);
  if (!route) return json(res, 404, { error: 'Bunday API manzili yoq' }, null, req);

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !originAllowed(req)) {
    return json(res, 403, { error: 'So\'rov manbasi ruxsat etilmagan' }, null, req);
  }

  const { user, token } = userFromRequest(req);
  if (!route.open && !user) {
    return json(res, 401, { error: 'Avval tizimga kiring', code: 'AUTH_REQUIRED' }, null, req);
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams.entries());
    const result = await route.handler({ query, body, params: route.params, req, user, authToken: token });

    if (result && result.__redirect) {
      const headers = { Location: result.__redirect, 'Cache-Control': 'no-store' };
      if (result.__cookie) headers['Set-Cookie'] = result.__cookie;
      res.writeHead(302, headers);
      return res.end();
    }
    if (result && result.__html) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(result.__html),
        'Cache-Control': 'no-store'
      });
      return res.end(result.__html);
    }
    if (result && result.__raw) {
      const { contentType, filename, body: raw, inline, cacheControl } = result.__raw;
      const headers = {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(raw),
        'Cache-Control': cacheControl || 'no-store',
        ...securityHeaders(req)
      };
      // Rasm brauzerda ko'rsatiladi, hisobot esa yuklab olinadi
      if (!inline) headers['Content-Disposition'] = 'attachment; filename="' + filename + '"';
      res.writeHead(200, headers);
      return res.end(raw);
    }
    // Xato javobida qo'shimcha maydonlar ham uzatiladi — mijoz ularni ajratib
    // ishlata olsin (masalan TASK_LOCKED kodi yoki pendingVerification bayrog'i)
    if (result && result.error) {
      const { status, ...payload } = result;
      return json(res, status || 400, payload, null, req);
    }

    const cookie = result?.__cookie;
    if (cookie) delete result.__cookie;
    return json(res, 200, result ?? { ok: true }, cookie, req);
  } catch (err) {
    console.error('[api]', req.method, pathname, '-', err.message);
    return json(res, 500, { error: err.message || 'Server xatosi' }, null, req);
  }
}

const db = load();
safeBackup();
setInterval(safeBackup, 60 * 60 * 1000).unref();

// Eskirgan cheklov hisoblagichlari baza ichida to'planib qolmasin
const safeSweep = () => { try { sweepLimits(); } catch (e) { console.error('  Tozalash xatosi:', e.message); } };
safeSweep();
setInterval(safeSweep, 6 * 60 * 60 * 1000).unref();

/** Zaxira nusxada xato bo'lsa ham server to'xtamasligi kerak */
function safeBackup() {
  try { dailyBackup(); }
  catch (err) { console.error('  Zaxira nusxa xatosi:', (err && err.message) || err); }
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🍅  Pomodoro — Ish jarayonini boshqarish tizimi');
  console.log('  ---------------------------------------------');
  console.log('  Manzil : ' + (httpsActive ? 'https' : 'http') + '://' + HOST + ':' + PORT);
  if (!httpsActive) {
    console.log('  Eslatma: HTTPS o\'chiq. Tashqi manzilga chiqarishdan oldin');
    console.log('           TLS_KEY va TLS_CERT ni bering yoki nginx orqasiga qo\'ying');
    console.log('           (u holda TRUST_PROXY=1).');
  }
  console.log('  Baza   : ' + paths.DB_FILE);
  console.log('  Hisob  : ' + (db.users.length
    ? db.users.length + ' ta foydalanuvchi'
    : 'hali yo\'q — brauzerda ro\'yxatdan o\'ting'));
  if (envHolat.loaded) {
    // Faqat nomlar — qiymatlar hech qachon jurnalga tushmaydi
    const nomlar = envNames();
    console.log('  Maxfiy : .env o\'qildi' + (nomlar.length
      ? ' — ' + nomlar.join(', ')
      : ' (maxfiy kalitlar berilmagan)'));
  }
  console.log('  Toxtatish: Ctrl+C');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('  Xato: ' + PORT + '-port band. Boshqa port bilan ishga tushiring:  PORT=4200 node server.js');
    process.exit(1);
  }
  throw err;
});

// Ushlanmagan xato Node'ni butunlay o'chirib yuboradi — logga yozamiz, lekin ishlashda davom etamiz
process.on('uncaughtException', (err) => {
  console.error('  Ushlanmagan xato:', (err && err.stack) || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('  Ushlanmagan promise xatosi:', (reason && reason.stack) || reason);
});

function shutdown(signal) {
  console.log('\n  Server toxtatildi (' + signal + ').');
  if (redirector) { try { redirector.close(); } catch { /* ahamiyatsiz */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
