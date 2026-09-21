/** Kirish / ro'yxatdan o'tish sahifasi */

const $ = (id) => document.getElementById(id);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || `Xatolik (${res.status})`);
    Object.assign(err, data);          // pendingVerification, email, code ...
    err.status = res.status;
    throw err;
  }
  return data;
}

function alertBox(msg, kind = 'err') {
  const el = $('alert');
  el.textContent = msg;
  el.className = 'auth-alert ' + kind;
  el.hidden = !msg;
}

const FORMS = {
  login: 'formLogin', register: 'formRegister', verify: 'formVerify',
  forgot: 'formForgot', reset: 'formReset', twofa: 'formTwofa'
};

function setMode(mode) {
  const tabs = mode === 'login' || mode === 'register';
  document.querySelector('.auth-tabs')?.toggleAttribute('hidden', !tabs);
  document.getElementById('oauthBlock')?.toggleAttribute('hidden', !tabs || !oauthAvailable);
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('is-active', t.dataset.mode === mode));
  for (const [name, id] of Object.entries(FORMS)) $(id).classList.toggle('is-active', name === mode);
  alertBox('');
}

/** Tugmani ish holatiga o'tkazadi va qaytaradigan funksiya beradi */
function busy(btn, text) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
  return () => { btn.disabled = false; btn.textContent = was; };
}

/** Qayta yuborish tugmasiga 60 soniyalik hisoblagich */
function cooldown(btn, label, sec = 60) {
  let left = sec;
  btn.disabled = true;
  btn.textContent = `Qayta yuborish (${left})`;
  const tick = setInterval(() => {
    btn.textContent = `Qayta yuborish (${--left})`;
    if (left <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = label; }
  }, 1000);
}

/* ── Emailni tasdiqlash ── */
let pendingEmail = '';
let oauthAvailable = false;
let resetEmail = '';
let twofaTicket = '';

/** Parol yetarli emas — ikki bosqichli tasdiqlash so'raladi */
function startTwofa(ticket, { backupLeft = 0, message = '' } = {}) {
  twofaTicket = ticket;
  $('twofaCode').value = '';
  $('twofaBackupHint').hidden = !(backupLeft > 0);
  setMode('twofa');
  if (message) alertBox(message, 'ok');
  setTimeout(() => $('twofaCode').focus(), 60);
}

/** Kirish javobi: 2FA so'ralishi ham mumkin */
function afterLogin(res) {
  if (res.twoFactorRequired) {
    startTwofa(res.ticket, { backupLeft: res.backupLeft });
    return false;
  }
  location.replace('/');
  return true;
}

function startVerify(email, message, kind = 'ok') {
  pendingEmail = email;
  $('verifyEmail').textContent = email;
  $('verifyCode').value = '';
  setMode('verify');
  if (message) alertBox(message, kind);
  setTimeout(() => $('verifyCode').focus(), 60);
}

function pwStrength(p) {
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^a-zA-Z0-9]/.test(p)) score++;
  return Math.min(4, score);
}

async function init() {
  // OAuth qaytganda xato xabari URL'da keladi
  const params = new URLSearchParams(location.search);
  if (params.get('error')) alertBox(params.get('error'));
  if (params.get('registered')) setMode('login');

  // Taqdimot sahifasidagi «Ro'yxatdan o'tish» tugmasi shu yerga olib keladi
  if (location.hash === '#register') setMode('register');

  // OAuth orqali kirdi, lekin hisobda 2FA yoqilgan
  const ticket = params.get('twofa');
  if (ticket) {
    history.replaceState(null, '', location.pathname);
    startTwofa(ticket, { backupLeft: 1, message: 'Kirishni yakunlash uchun kodni kiriting' });
  }

  // Allaqachon kirgan bo'lsa — asosiy sahifaga
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.user) { location.replace('/'); return; }
  } catch {}

  // Kirish usullarini yuklaymiz
  try {
    const cfg = await api('GET', '/api/auth/config');
    oauthAvailable = cfg.providers.google.enabled || cfg.providers.github.enabled;
    $('oauthBlock').hidden = !oauthAvailable;
    $('btnGoogle').hidden = !cfg.providers.google.enabled;
    $('btnGithub').hidden = !cfg.providers.github.enabled;
    if (!cfg.hasUsers) {
      setMode('register');
      $('firstUserNote').hidden = false;
    }
  } catch {
    alertBox('Serverga ulanib bo\'lmadi. `node server.js` ishlab turibdimi?');
  }

  document.querySelectorAll('.auth-tab').forEach(t =>
    t.addEventListener('click', () => setMode(t.dataset.mode)));

  $('btnGoogle').addEventListener('click', () => { location.href = '/api/auth/start/google'; });
  $('btnGithub').addEventListener('click', () => { location.href = '/api/auth/start/github'; });

  $('regPassword').addEventListener('input', e => {
    const s = pwStrength(e.target.value);
    const bar = $('pwBar');
    bar.style.width = (s / 4 * 100) + '%';
    bar.style.background = ['#d9534f', '#f6b73c', '#f6b73c', '#35c88f', '#35c88f'][s];
  });

  $('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Kirilmoqda…';
    try {
      const res = await api('POST', '/api/auth/login', {
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value
      });
      if (!afterLogin(res)) { btn.disabled = false; btn.textContent = 'Kirish'; }
      return;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Kirish';
      if (err.pendingVerification) {
        const email = err.email || $('loginEmail').value.trim();
        startVerify(email, 'Avval emailingizni tasdiqlang', 'warn');
        try { await api('POST', '/api/auth/resend-code', { email }); } catch { /* kutish vaqti bo'lishi mumkin */ }
        return;
      }
      alertBox(err.message);
    }
  });

  $('formRegister').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('regPassword').value !== $('regPassword2').value) {
      return alertBox('Parollar mos kelmadi');
    }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Yaratilmoqda…';
    try {
      const res = await api('POST', '/api/auth/register', {
        name: $('regName').value.trim(),
        email: $('regEmail').value.trim(),
        password: $('regPassword').value
      });
      btn.disabled = false; btn.textContent = 'Hisob yaratish';
      if (res.pendingVerification) {
        startVerify(res.email, res.message, res.sent ? 'ok' : 'warn');
        if (!res.sent) $('verifyHint').hidden = false,
          $('verifyHint').textContent = 'Pochta serveri hali sozlanmagan — kodni server oynasidan (jurnaldan) oling.';
        return;
      }
      location.replace('/');
    } catch (err) {
      alertBox(err.message);
      btn.disabled = false; btn.textContent = 'Hisob yaratish';
    }
  });

  /* ── Tasdiqlash ── */
  $('verifyCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  $('formVerify').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Tekshirilmoqda…';
    try {
      await api('POST', '/api/auth/verify', { email: pendingEmail, code: $('verifyCode').value });
      location.replace('/');
    } catch (err) {
      alertBox(err.message);
      btn.disabled = false; btn.textContent = 'Tasdiqlash';
      $('verifyCode').select();
    }
  });

  $('btnResend').addEventListener('click', async () => {
    const b = $('btnResend');
    b.disabled = true;
    try {
      const res = await api('POST', '/api/auth/resend-code', { email: pendingEmail });
      alertBox(res.message || 'Yangi kod yuborildi', res.sent ? 'ok' : 'warn');
    } catch (err) {
      alertBox(err.message, 'warn');
    }
    // Qayta yuborish uchun kutish
    let left = 60;
    const tick = setInterval(() => {
      b.textContent = `Qayta yuborish (${--left})`;
      if (left <= 0) { clearInterval(tick); b.disabled = false; b.textContent = 'Kodni qayta yuborish'; }
    }, 1000);
    b.textContent = `Qayta yuborish (${left})`;
  });

  $('btnBackToLogin').addEventListener('click', () => setMode('login'));
  document.querySelectorAll('.back-login').forEach(b => b.addEventListener('click', () => setMode('login')));

  /* ── Parolni unutdim ── */
  $('btnForgot').addEventListener('click', () => {
    $('forgotEmail').value = $('loginEmail').value.trim();
    setMode('forgot');
    setTimeout(() => $('forgotEmail').focus(), 60);
  });

  $('formForgot').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const done = busy(btn, 'Yuborilmoqda…');
    try {
      const res = await api('POST', '/api/auth/forgot', { email: $('forgotEmail').value.trim() });
      resetEmail = $('forgotEmail').value.trim();
      $('resetEmail').textContent = resetEmail;
      $('resetCode').value = '';
      $('resetPassword').value = '';
      $('resetPassword2').value = '';
      setMode('reset');
      alertBox(res.message, res.smtpReady ? 'ok' : 'warn');
      $('resetHint').hidden = !!res.smtpReady;
      if (!res.smtpReady) {
        $('resetHint').textContent = 'Pochta serveri sozlanmagan — kodni server oynasidan (jurnaldan) oling.';
      }
      setTimeout(() => $('resetCode').focus(), 60);
    } catch (err) {
      alertBox(err.message);
    } finally { done(); }
  });

  $('resetCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  $('resetPassword').addEventListener('input', e => {
    const s = pwStrength(e.target.value);
    const bar = $('resetBar');
    bar.style.width = (s / 4 * 100) + '%';
    bar.style.background = ['#d9534f', '#f6b73c', '#f6b73c', '#35c88f', '#35c88f'][s];
  });

  $('formReset').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('resetPassword').value !== $('resetPassword2').value) {
      return alertBox('Parollar mos kelmadi');
    }
    const btn = e.target.querySelector('button[type=submit]');
    const done = busy(btn, 'Yangilanmoqda…');
    try {
      const res = await api('POST', '/api/auth/reset', {
        email: resetEmail,
        code: $('resetCode').value,
        password: $('resetPassword').value
      });
      if (res.twoFactorRequired) {
        done();
        startTwofa(res.ticket, { backupLeft: res.backupLeft, message: 'Parol yangilandi. Endi kodni kiriting.' });
        return;
      }
      location.replace('/');
    } catch (err) {
      alertBox(err.message);
      done();
      $('resetCode').select();
    }
  });

  $('btnResendReset').addEventListener('click', async () => {
    const b = $('btnResendReset');
    try {
      const res = await api('POST', '/api/auth/forgot', { email: resetEmail });
      alertBox(res.message, res.smtpReady ? 'ok' : 'warn');
    } catch (err) {
      alertBox(err.message, 'warn');
    }
    cooldown(b, 'Kodni qayta yuborish');
  });

  /* ── Ikki bosqichli tasdiqlash ── */
  $('twofaCode').addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase();
    // Raqamli TOTP kodi yoki ABCDE-FGHIJ ko'rinishidagi zaxira kod
    e.target.value = /[A-Z-]/.test(v) ? v.replace(/[^A-Z0-9-]/g, '').slice(0, 11)
                                      : v.replace(/\D/g, '').slice(0, 6);
  });

  $('formTwofa').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const done = busy(btn, 'Tekshirilmoqda…');
    try {
      const res = await api('POST', '/api/auth/2fa/verify', {
        ticket: twofaTicket,
        code: $('twofaCode').value.trim()
      });
      if (res.usedBackupCode) {
        sessionStorage.setItem('pmd_backup_used', String(res.backupLeft ?? ''));
      }
      location.replace('/');
    } catch (err) {
      done();
      if (err.code === 'TICKET_EXPIRED') {
        setMode('login');
        alertBox('Tasdiqlash muddati tugadi — qaytadan kiring', 'warn');
        return;
      }
      alertBox(err.message);
      $('twofaCode').select();
    }
  });
}

init();
