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
  if (!res.ok) throw new Error(data.error || `Xatolik (${res.status})`);
  return data;
}

function alertBox(msg, kind = 'err') {
  const el = $('alert');
  el.textContent = msg;
  el.className = 'auth-alert ' + kind;
  el.hidden = !msg;
}

function setMode(mode) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('is-active', t.dataset.mode === mode));
  $('formLogin').classList.toggle('is-active', mode === 'login');
  $('formRegister').classList.toggle('is-active', mode === 'register');
  alertBox('');
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

  // Allaqachon kirgan bo'lsa — asosiy sahifaga
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.user) { location.replace('/'); return; }
  } catch {}

  // Kirish usullarini yuklaymiz
  try {
    const cfg = await api('GET', '/api/auth/config');
    const any = cfg.providers.google.enabled || cfg.providers.github.enabled;
    $('oauthBlock').hidden = !any;
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
      await api('POST', '/api/auth/login', {
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value
      });
      location.replace('/');
    } catch (err) {
      alertBox(err.message);
      btn.disabled = false; btn.textContent = 'Kirish';
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
      await api('POST', '/api/auth/register', {
        name: $('regName').value.trim(),
        email: $('regEmail').value.trim(),
        password: $('regPassword').value
      });
      location.replace('/');
    } catch (err) {
      alertBox(err.message);
      btn.disabled = false; btn.textContent = 'Hisob yaratish';
    }
  });
}

init();
