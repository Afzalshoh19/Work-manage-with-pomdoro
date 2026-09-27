/** Profil, hisobotlar va integratsiyalar — app.js dan chaqiriladi */
import { api, downloadFile } from './api.js';
import { initAvatar, applyAvatar, setAvatar } from './avatar.js';
import { avatarInner, isIconAvatar } from './icons.js';
import { initWorkCard, load as loadWorkCard, refreshSoon as refreshWorkCard } from './workcard.js';

let C = null;   // umumiy kontekst (app.js beradi)
const $ = (id) => document.getElementById(id);

/* ═══════════════ PROFIL ═══════════════ */

let profileData = null;

export async function loadProfile() {
  profileData = await C.guard(() => api.profile());
  const u = profileData.user;
  const st = profileData.stats;

  document.documentElement.style.setProperty('--uc', u.color || '#ff5f56');
  applyAvatar($('profAvatar'), u);
  $('photoRemove').hidden = !u.photoUrl;
  $('photoHint').textContent = u.photoUrl
    ? 'Rasm yuklangan'
    : `JPG, PNG yoki WebP · ${profileData.photoMaxKb || 512} KB gacha`;
  $('profName').textContent = u.name;
  $('profMeta').innerHTML = [
    u.jobTitle && C.esc(u.jobTitle),
    u.company && C.esc(u.company),
    C.esc(u.email),
    u.role === 'owner' ? '<span class="role-chip">TIZIM EGASI</span>' : ''
  ].filter(Boolean).join(' · ');

  $('profNameInput').value = u.name;
  $('profJob').value = u.jobTitle || '';
  $('profCompany').value = u.company || '';
  $('profEmail').value = u.email;

  renderAvatarPicker(u);
  renderColorPicker(u);

  const since = new Date(st.memberSince);
  $('profStats').innerHTML = `
    <div class="kpi a"><div class="kpi-val">${st.totalPomodoros}</div><div class="kpi-lbl">Jami pomodoro</div></div>
    <div class="kpi g"><div class="kpi-val">${st.focusHours}</div><div class="kpi-lbl">Fokus soatlari</div></div>
    <div class="kpi b"><div class="kpi-val">${st.doneTasks}/${st.totalTasks}</div><div class="kpi-lbl">Bajarilgan vazifalar</div></div>
    <div class="kpi p"><div class="kpi-val">${st.activeDays}</div><div class="kpi-lbl">Faol kunlar</div></div>
    <div class="kpi"><div class="kpi-val" style="font-size:15px">${since.toLocaleDateString('uz-UZ')}</div><div class="kpi-lbl">Ro'yxatdan o'tgan sana</div></div>`;

  loadSessions();
  loadTwoFactor();
  loadWorkCard();

  $('pwHint').textContent = u.hasPassword ? '' : 'Siz OAuth orqali kirgansiz — joriy parolni bo\'sh qoldiring.';
  $('pwCurrent').disabled = !u.hasPassword;
  $('delPasswordWrap').hidden = !u.hasPassword;
  $('delPassword').value = '';
}

/**
 * Tahrirlashni kartaning o'zida ochadi.
 * Maydonlar har safar joriy qiymatdan to'ldiriladi — bekor qilingandan
 * keyin eski kiritmalar qolib ketmasin.
 */
function openProfEditor() {
  const u = profileData?.user;
  if (!u) return;
  $('profNameInput').value = u.name;
  $('profJob').value = u.jobTitle || '';
  $('profCompany').value = u.company || '';
  $('profEmail').value = u.email;
  renderAvatarPicker(u);
  renderColorPicker(u);

  $('profEdit').hidden = false;
  $('profEdit').closest('.card')?.classList.add('is-editing');
  setTimeout(() => $('profNameInput').focus(), 40);
}

function closeProfEditor() {
  $('profEdit').hidden = true;
  $('profEdit').closest('.card')?.classList.remove('is-editing');
}

/** Rang tanlash paneli */
function renderColorPicker(u) {
  $('colorGrid').innerHTML = profileData.colors.map(c =>
    `<button type="button" class="color-pick ${c === u.color ? 'is-active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');
}

/**
 * Avatar tanlash paneli — SVG belgilar va emojilar alohida guruhda.
 * Ikkalasi ham amal qiladi, foydalanuvchi xohlaganini tanlaydi.
 */
function renderAvatarPicker(u) {
  const icons = profileData.avatarIcons || [];
  const emoji = profileData.avatarEmoji || [];

  const pick = (value, inner) =>
    `<button type="button" class="avatar-pick ${value === u.avatar ? 'is-active' : ''}" ` +
    `data-avatar="${C.esc(value)}" title="${C.esc(value)}">${inner}</button>`;

  const group = (label, items, asIcon) =>
    `<div class="apick-group">
      <span class="apick-lbl">${label}</span>
      <div class="apick-row">${items.map(v => pick(v, asIcon ? avatarInner(v) : v)).join('')}</div>
    </div>`;

  $('avatarGrid').innerHTML = group('Belgilar', icons, true) + group('Emoji', emoji, false);
  updateAvatarNote(u.photoUrl || null);
}

/** Rasm ustuvor ekanini tushuntiruvchi eslatma */
function updateAvatarNote(photoUrl) {
  const el = $('avatarNote');
  if (!el) return;
  el.hidden = !photoUrl;
  el.textContent = photoUrl
    ? 'Hozir profil rasmi ishlatilyapti. Tanlangan belgi rasm o\'chirilgandan keyin ko\'rinadi.'
    : '';
}

/** Rasm yuklangach profil ham, yuqoridagi tugma ham yangilanadi */
function onAvatarChange(user) {
  if (!user) return;
  if (profileData) profileData.user = user;
  applyAvatar($('profAvatar'), user);
  updateAvatarNote(user.photoUrl || null);
  refreshWorkCard();
  $('photoRemove').hidden = !user.photoUrl;
  $('photoHint').textContent = user.photoUrl
    ? 'Rasm yuklangan'
    : `JPG, PNG yoki WebP · ${profileData?.photoMaxKb || 512} KB gacha`;
  C.setUser(user);
}

function bindProfile() {
  $('photoPick2')?.addEventListener('click', () => $('photoPick').click());

  $('avatarGrid').addEventListener('click', e => {
    const b = e.target.closest('.avatar-pick');
    if (!b) return;
    $('avatarGrid').querySelectorAll('.avatar-pick').forEach(x => x.classList.toggle('is-active', x === b));

    // Rasm yuklangan bo'lsa u ustuvor — belgi uning ustiga chizilmaydi
    const photo = profileData?.user?.photoUrl || null;
    setAvatar($('profAvatar'), photo, b.dataset.avatar);
    updateAvatarNote(photo);
  });
  $('colorGrid').addEventListener('click', e => {
    const b = e.target.closest('.color-pick');
    if (!b) return;
    $('colorGrid').querySelectorAll('.color-pick').forEach(x => x.classList.toggle('is-active', x === b));
    document.documentElement.style.setProperty('--uc', b.dataset.color);
  });

  $('profEditOpen').addEventListener('click', openProfEditor);
  $('profEditCancel').addEventListener('click', closeProfEditor);

  $('profSave').addEventListener('click', async (e) => {
    e.preventDefault();
    const name = $('profNameInput').value.trim();
    if (!name) return C.toast('Ismni kiriting', 'err');

    const avatar = $('avatarGrid').querySelector('.is-active')?.dataset.avatar;
    const color = $('colorGrid').querySelector('.is-active')?.dataset.color;
    const res = await C.guard(() => api.saveProfile({
      name,
      jobTitle: $('profJob').value.trim(),
      company: $('profCompany').value.trim(),
      avatar, color
    }));
    closeProfEditor();
    C.setUser(res.user);
    await loadProfile();
    refreshWorkCard();
    C.toast('Profil saqlandi', 'ok');
  });

  $('pwSave').addEventListener('click', async () => {
    if ($('pwNew').value !== $('pwNew2').value) return C.toast('Yangi parollar mos kelmadi', 'err');
    const res = await C.guard(() => api.changePassword({
      currentPassword: $('pwCurrent').value,
      newPassword: $('pwNew').value
    }));
    $('pwCurrent').value = $('pwNew').value = $('pwNew2').value = '';
    await loadProfile();
    C.toast(res.message || 'Parol yangilandi', 'ok');
  });

  $('btnDeleteAccount').addEventListener('click', async () => {
    const ok = await C.confirmBox('Hisobni o\'chirish',
      'Barcha vazifalar, sessiyalar va sozlamalar butunlay o\'chiriladi. Bu amalni qaytarib bo\'lmaydi.', 'Ha, o\'chirish');
    if (!ok) return;
    const password = $('delPassword').value;
    if (profileData?.user?.hasPassword && !password) {
      $('delPassword').focus();
      return C.toast('Tasdiqlash uchun parolingizni kiriting', 'err');
    }
    try {
      await api.deleteAccount(password || '');
      location.replace('/login.html');
    } catch (err) {
      C.toast(err.message, 'err');
    }
  });
}

/* ═══════════════ HISOBOT ═══════════════ */

function reportOpts() {
  return { type: $('repType').value, date: $('repDate').value || C.todayStr() };
}

export async function loadReport() {
  if (!$('repDate').value) $('repDate').value = C.todayStr();
  const { report } = await C.guard(() => api.report(reportOpts()));
  const s = report.summary;

  // Skeuo uslubidagi dumaloq muhr uchun foiz. Bu yangi ma'lumot emas —
  // o'sha `planPercent` pastdagi kartochkada ham ko'rinadi; shunchaki
  // `themes.css` dagi `content:` unga yeta olsin deb o'zgaruvchiga
  // qo'yiladi. Boshqa uslublarda muhr chizilmaydi va o'zgaruvchi
  // ishlatilmay qoladi.
  $('repKpi').style.setProperty('--reja-pct', `"${s.planPercent}%"`);
  // Yangi tuzilishda muhr «Qisqacha xulosa» kartasida turadi — o'zgaruvchi o'sha yerga ham beriladi
  document.querySelector('#view-report .rep-main')?.style.setProperty('--reja-pct', `"${s.planPercent}%"`);

  $('repKpi').innerHTML = `
    <div class="kpi a"><div class="kpi-val">${s.completedPomodoros}${s.plannedPomodoros ? `/${s.plannedPomodoros}` : ''}</div>
      <div class="kpi-lbl">Pomodorolar</div><div class="kpi-sub">Reja: ${s.planPercent}%</div></div>
    <div class="kpi g"><div class="kpi-val">${C.fmtDuration(s.focusMinutes)}</div>
      <div class="kpi-lbl">Sof fokus vaqti</div><div class="kpi-sub">Tanaffus: ${C.fmtDuration(s.breakMinutes)}</div></div>
    <div class="kpi b"><div class="kpi-val">${s.tasksDone}/${s.tasksTotal}</div>
      <div class="kpi-lbl">Bajarilgan vazifalar</div><div class="kpi-sub">${s.taskPercent}%</div></div>
    <div class="kpi p"><div class="kpi-val">${s.goalPercent}%</div>
      <div class="kpi-lbl">Maqsad bajarilishi</div><div class="kpi-sub">Maqsad: ${s.goal} pomodoro</div></div>
    ${s.deltaPercent !== null ? `<div class="kpi"><div class="kpi-val">${s.deltaPercent >= 0 ? '+' : ''}${s.deltaPercent}%</div>
      <div class="kpi-lbl">Oldingi davrga nisbatan</div><div class="kpi-sub">${s.prevPomodoros} → ${s.completedPomodoros}</div></div>` : ''}`;

  $('repHighlights').innerHTML = `<div class="help"><b>${C.esc(report.period.label)}</b><ul style="margin:8px 0 0;padding-left:18px">`
    + report.highlights.map(h => `<li>${C.esc(h)}</li>`).join('') + '</ul></div>';

  renderCorrections(report);
  $('repFrame').src = api.reportViewUrl(reportOpts());
}

/**
 * Hisobotni to'g'rlash paneli: davrdagi har bir vazifa yonida «To'g'rlash»
 * tugmasi va allaqachon kiritilgan tuzatishlar sababi bilan ko'rinadi.
 */
function renderCorrections(report) {
  const el = $('repCorrect');
  if (!report.tasks.length) {
    el.innerHTML = '<div class="empty-mini">Bu davrda vazifa kiritilmagan — to\'g\'rlash uchun avval vazifa qo\'shing.</div>';
    return;
  }

  const kopKun = report.period.from !== report.period.to;

  const rows = report.tasks.map(t => {
    const tuz = t.corrections || [];
    const qulf = t.status === 'bajarildi';
    const belgi = t.manualPomodoros
      ? `<span class="corr-badge" title="Qo'lda kiritilgan">✍ ${t.manualPomodoros}</span>`
      : '';
    return `<div class="corr-row ${qulf ? 'is-locked' : ''}" data-id="${t.id}">
      <div class="corr-main">
        <span class="corr-title">${C.esc(t.title)}</span>
        <div class="corr-meta">
          ${kopKun ? `<span class="chip">${C.esc(C.fmtDateLong(t.date))}</span>` : ''}
          <span class="chip">${t.completedPomodoros}/${t.plannedPomodoros} pomodoro</span>
          <span>${C.fmtDuration(t.focusMinutes)}</span>
          ${belgi}
          ${qulf ? '<span class="corr-lock">🔒 Bajarilgan — qulflangan</span>' : ''}
        </div>
        ${tuz.length ? `<ul class="corr-list">${tuz.map(c =>
          `<li><b>+${c.pomodoros} pomodoro</b> · ${C.esc(c.reasonLabel)}${c.reasonNote ? ` — ${C.esc(c.reasonNote)}` : ''}</li>`
        ).join('')}</ul>` : ''}
      </div>
      ${qulf
        ? `<button class="btn btn-mini btn-ghost corr-reopen" data-id="${t.id}"
             title="To'g'rlash uchun avval vazifani qayta oching">↩ Qayta ochish</button>`
        : `<button class="btn btn-mini corr-btn" data-id="${t.id}">✍ To'g'rlash</button>`}
    </div>`;
  }).join('');

  const jami = report.summary.manualPomodoros
    ? `<div class="corr-sum">Bu davrda <b>${report.summary.manualPomodoros}</b> ta pomodoro qo'lda to'g'rlangan
       (${report.summary.correctionCount} ta tuzatish) · taymer bilan <b>${report.summary.trackedPomodoros}</b> ta.</div>`
    : '';

  el.innerHTML = jami + `<div class="corr-grid">${rows}</div>`;

  el.querySelectorAll('.corr-btn').forEach(b => b.addEventListener('click', () => {
    const t = report.tasks.find(x => x.id === b.dataset.id);
    if (t) C.openLogTask(t, loadReport);
  }));

  el.querySelectorAll('.corr-reopen').forEach(b => b.addEventListener('click', async () => {
    const t = report.tasks.find(x => x.id === b.dataset.id);
    if (!t) return;
    b.disabled = true;
    try {
      await C.guard(() => api.updateTask(t.id, {
        status: t.completedPomodoros >= t.plannedPomodoros ? 'qabulga'
          : t.completedPomodoros ? 'jarayonda' : 'reja'
      }));
      await loadReport();
      await C.loadPlan();
      C.toast(`«${t.title}» qayta ochildi — endi to'g'rlash mumkin`, 'ok');
    } catch { b.disabled = false; }
  }));
}

function bindReport() {
  $('repType').addEventListener('change', loadReport);
  $('repDate').addEventListener('change', loadReport);
  $('repRefresh').addEventListener('click', loadReport);

  document.querySelectorAll('.dl-card').forEach(b => b.addEventListener('click', async () => {
    const fmt = b.dataset.fmt;
    if (fmt === 'print') {
      const w = window.open(api.reportViewUrl(reportOpts()), '_blank');
      if (!w) C.toast('Brauzer yangi oynani bloklab qo\'ydi', 'err');
      return;
    }
    b.disabled = true;
    try {
      const name = await downloadFile(api.reportUrl({ ...reportOpts(), format: fmt }));
      C.toast(`Yuklab olindi: ${name}`, 'ok');
    } catch (err) {
      C.toast('Yuklab olinmadi — ' + err.message, 'err');
    } finally {
      b.disabled = false;
    }
  }));

  const sendTo = async (target, label) => {
    $('repExportState').textContent = 'Yuborilmoqda…';
    try {
      const res = await api.exportTo(target, reportOpts());
      $('repExportState').innerHTML = `<a class="link-out" href="${res.url}" target="_blank" rel="noopener">${label}da ochish ↗</a>`;
      C.toast(`Hisobot ${label}ga yuborildi`, 'ok');
    } catch (err) {
      $('repExportState').textContent = '';
      C.toast(err.message, 'err');
    }
  };
  $('repToNotion').addEventListener('click', () => sendTo('notion', 'Notion'));
  $('repToConfluence').addEventListener('click', () => sendTo('confluence', 'Confluence'));
}

/* ═══════════════ INTEGRATSIYALAR ═══════════════ */

function badge(el, cfg, okText) {
  const b = $(el);
  if (cfg.lastError) { b.className = 'badge err'; b.textContent = 'Xato'; b.title = cfg.lastError; return; }
  if (cfg.enabled && cfg.hasToken) { b.className = 'badge on'; b.textContent = okText; b.title = ''; return; }
  b.className = 'badge off';
  b.textContent = cfg.hasToken ? 'Sozlangan' : 'O\'chirilgan';
  b.title = '';
}

export async function loadIntegrations() {
  const it = await C.guard(() => api.integrations());

  // Jira
  $('jiraUrl').value = it.jira.baseUrl;
  $('jiraEmail').value = it.jira.email;
  $('jiraJql').value = it.jira.jql;
  $('jiraPerPomo').value = it.jira.minutesPerPomodoro;
  $('jiraDefault').value = it.jira.defaultPomodoros;
  $('jiraEnabled').checked = it.jira.enabled;
  $('jiraToken').placeholder = it.jira.hasToken ? `Saqlangan: ${it.jira.tokenMask}` : 'Atlassian API token';
  badge('jiraBadge', it.jira, 'Ulangan');
  $('jiraState').textContent = it.jira.lastImportAt
    ? 'Oxirgi import: ' + new Date(it.jira.lastImportAt).toLocaleString('uz-UZ') : '';

  // Notion
  $('notionPage').value = it.notion.parentPageId;
  $('notionDb').value = it.notion.databaseId;
  $('notionEnabled').checked = it.notion.enabled;
  $('notionToken').placeholder = it.notion.hasToken ? `Saqlangan: ${it.notion.tokenMask}` : 'secret_… yoki ntn_…';
  badge('notionBadge', it.notion, 'Ulangan');
  $('notionState').textContent = it.notion.lastExportAt
    ? 'Oxirgi eksport: ' + new Date(it.notion.lastExportAt).toLocaleString('uz-UZ') : '';

  // Confluence
  $('confUrl').value = it.confluence.baseUrl;
  $('confEmail').value = it.confluence.email;
  $('confSpace').value = it.confluence.spaceKey;
  $('confParent').value = it.confluence.parentPageId;
  $('confEnabled').checked = it.confluence.enabled;
  $('confToken').placeholder = it.confluence.hasToken ? `Saqlangan: ${it.confluence.tokenMask}` : 'Atlassian API token';
  badge('confBadge', it.confluence, 'Ulangan');
  $('confState').textContent = it.confluence.lastExportAt
    ? 'Oxirgi eksport: ' + new Date(it.confluence.lastExportAt).toLocaleString('uz-UZ') : '';

  if (!$('genDate').value) $('genDate').value = C.todayStr();
}

function bindIntegrations() {
  /* ─ Jira ─ */
  $('jiraSave').addEventListener('click', async () => {
    await C.guard(() => api.saveIntegration('jira', {
      baseUrl: $('jiraUrl').value.trim(),
      email: $('jiraEmail').value.trim(),
      token: $('jiraToken').value.trim() || undefined,
      jql: $('jiraJql').value.trim(),
      minutesPerPomodoro: +$('jiraPerPomo').value,
      defaultPomodoros: +$('jiraDefault').value,
      enabled: $('jiraEnabled').checked
    }));
    $('jiraToken').value = '';
    await loadIntegrations();
    C.toast('Jira sozlamalari saqlandi', 'ok');
  });

  $('jiraTest').addEventListener('click', async () => {
    $('jiraState').textContent = 'Tekshirilmoqda…';
    try {
      const r = await api.testIntegration('jira');
      $('jiraState').textContent = `✔ ${r.info.displayName} sifatida ulandi`;
      C.toast('Jira ulanishi muvaffaqiyatli', 'ok');
      await loadIntegrations();
    } catch (err) {
      $('jiraState').textContent = '';
      C.toast(err.message, 'err');
      await loadIntegrations();
    }
  });

  $('jiraLoad').addEventListener('click', async () => {
    $('jiraIssues').innerHTML = '<div class="hint" style="padding:10px 0">Yuklanmoqda…</div>';
    try {
      const r = await api.jiraPreview({ jql: $('jiraJql').value.trim(), limit: 25 });
      if (!r.issues.length) {
        $('jiraIssues').innerHTML = '<div class="hint" style="padding:10px 0">Bu JQL bo\'yicha masala topilmadi</div>';
        return;
      }
      $('jiraIssues').innerHTML = `
        <div class="split-actions" style="margin:12px 0 8px">
          <button class="btn btn-mini btn-ghost" id="jiraAll">Hammasini belgilash</button>
          <button class="btn btn-mini" id="jiraDoImport">Tanlanganlarni bugungi rejaga qo'shish</button>
          <span class="hint">${r.issues.length} ta masala</span>
        </div>
        <div class="issue-list">
          ${r.issues.map(i => `
            <label class="issue">
              <input type="checkbox" class="jira-pick" value="${C.esc(i.key)}" checked>
              <div>
                <div>${C.esc(i.summary)}</div>
                <div class="issue-meta">
                  <span class="issue-key">${C.esc(i.key)}</span>
                  <span class="chip">${C.esc(i.issueType || '—')}</span>
                  <span class="chip">${C.esc(i.status || '—')}</span>
                  ${i.estimateMinutes ? `<span class="chip time">${C.fmtDuration(i.estimateMinutes)}</span>` : '<span class="hint">baho yo\'q</span>'}
                </div>
              </div>
              <b>${i.plannedPomodoros} ta</b>
            </label>`).join('')}
        </div>`;

      $('jiraAll').addEventListener('click', () => {
        const boxes = [...document.querySelectorAll('.jira-pick')];
        const allOn = boxes.every(b => b.checked);
        boxes.forEach(b => { b.checked = !allOn; });
      });

      $('jiraDoImport').addEventListener('click', async () => {
        const keys = [...document.querySelectorAll('.jira-pick:checked')].map(b => b.value);
        if (!keys.length) return C.toast('Hech qanday masala tanlanmadi', 'err');
        const res = await C.guard(() => api.jiraImport({ keys, date: C.state.date, jql: $('jiraJql').value.trim() }));
        await C.loadPlan();
        await loadIntegrations();
        C.toast(`${res.imported} ta vazifa qo'shildi${res.skipped ? `, ${res.skipped} tasi allaqachon mavjud` : ''}`, 'ok');
        if (res.imported) C.setView('today');
      });
    } catch (err) {
      $('jiraIssues').innerHTML = '';
      C.toast(err.message, 'err');
    }
  });

  /* ─ Notion ─ */
  $('notionSave').addEventListener('click', async () => {
    await C.guard(() => api.saveIntegration('notion', {
      token: $('notionToken').value.trim() || undefined,
      parentPageId: $('notionPage').value.trim(),
      databaseId: $('notionDb').value.trim(),
      enabled: $('notionEnabled').checked
    }));
    $('notionToken').value = '';
    await loadIntegrations();
    C.toast('Notion sozlamalari saqlandi', 'ok');
  });
  $('notionTest').addEventListener('click', async () => {
    $('notionState').textContent = 'Tekshirilmoqda…';
    try {
      const r = await api.testIntegration('notion');
      $('notionState').textContent = `✔ ${r.info.workspace}${r.info.target ? ' — ' + r.info.target : ''}`;
      C.toast('Notion ulanishi muvaffaqiyatli', 'ok');
    } catch (err) {
      $('notionState').textContent = '';
      C.toast(err.message, 'err');
    }
    await loadIntegrations();
  });

  /* ─ Confluence ─ */
  $('confSave').addEventListener('click', async () => {
    await C.guard(() => api.saveIntegration('confluence', {
      baseUrl: $('confUrl').value.trim(),
      email: $('confEmail').value.trim(),
      token: $('confToken').value.trim() || undefined,
      spaceKey: $('confSpace').value.trim(),
      parentPageId: $('confParent').value.trim(),
      enabled: $('confEnabled').checked
    }));
    $('confToken').value = '';
    await loadIntegrations();
    C.toast('Confluence sozlamalari saqlandi', 'ok');
  });
  $('confTest').addEventListener('click', async () => {
    $('confState').textContent = 'Tekshirilmoqda…';
    try {
      const r = await api.testIntegration('confluence');
      $('confState').textContent = `✔ ${r.info.displayName}${r.info.space ? ' — ' + r.info.space : ''}`;
      C.toast('Confluence ulanishi muvaffaqiyatli', 'ok');
    } catch (err) {
      $('confState').textContent = '';
      C.toast(err.message, 'err');
    }
    await loadIntegrations();
  });

  /* ─ Umumiy CSV import ─ */
  $('genFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    $('genCsv').value = await f.text();
    $('genSource').value = f.name.replace(/\.csv$/i, '').slice(0, 40) || 'import';
    C.toast('Fayl o\'qildi — endi "Import qilish"ni bosing', 'ok');
    e.target.value = '';
  });

  $('genImport').addEventListener('click', async () => {
    const csv = $('genCsv').value.trim();
    if (!csv) return C.toast('Avval CSV matnini qo\'ying yoki fayl tanlang', 'err');
    const res = await C.guard(() => api.genericImport({
      csv,
      source: $('genSource').value.trim() || 'import',
      date: $('genDate').value || C.todayStr(),
      minutesPerPomodoro: +$('genPerPomo').value || 25
    }));
    $('genState').textContent = `${res.imported} ta vazifa qo'shildi`;
    $('genCsv').value = '';
    await C.loadPlan();
    if (res.imported) C.setView('today');
    C.toast(`${res.imported} ta vazifa import qilindi${res.skipped ? `, ${res.skipped} qator o'tkazib yuborildi` : ''}`, 'ok');
  });
}

/* ═══════════════ OAUTH SOZLAMALARI (tizim egasi) ═══════════════ */

/* ═══════════════ POCHTA SERVERI (SMTP) ═══════════════ */

/**
 * `.env` boshqaradigan maydonni qulflaydi.
 * Aks holda foydalanuvchi hech qanday ta'sir qilmaydigan maydonni
 * tahrirlab, nega saqlanmadi deb hayron bo'lardi.
 */
function lockIfEnv(el, fromEnv, nom = '.env') {
  if (!el) return;
  el.disabled = !!fromEnv;
  el.classList.toggle('is-env', !!fromEnv);
  if (fromEnv) el.title = `Qiymat ${nom} faylidan olinadi — bu yerdan o'zgartirib bo'lmaydi`;
  else el.removeAttribute('title');
}

/** «Muhitdan boshqarilmoqda» eslatmasi */
function envNote(boxId, fromEnv, matn) {
  const el = $(boxId);
  if (!el) return;
  el.hidden = !fromEnv?.any;
  if (fromEnv?.any) el.textContent = matn;
}

export async function loadSmtpSettings(user) {
  if (user.role !== 'owner') return;
  $('smtpCard').hidden = false;
  try {
    const c = await api.smtpSettings();
    $('smtpHost').value = c.host || '';
    $('smtpPort').value = c.port || 587;
    $('smtpUser').value = c.user || '';
    $('smtpFrom').value = c.from || '';
    $('smtpSecure').value = c.secure ? '1' : '0';
    $('smtpEnabled').checked = !!c.enabled;
    const env = c.fromEnv || {};
    lockIfEnv($('smtpHost'), env.host);
    lockIfEnv($('smtpPort'), env.port);
    lockIfEnv($('smtpUser'), env.user);
    lockIfEnv($('smtpFrom'), env.from);
    lockIfEnv($('smtpSecure'), env.secure);
    lockIfEnv($('smtpPass'), env.pass);

    $('smtpPass').placeholder = env.pass
      ? '.env faylidan olinmoqda'
      : c.hasPass
        ? "Saqlangan — o'zgartirish uchun yozing"
        : 'Parol yoki ilova kaliti';

    envNote('smtpEnvNote', env,
      'Ba\'zi maydonlar .env faylidan olinmoqda va bu yerdan o\'zgartirilmaydi. '
      + '«Yoqilgan» bayrog\'i shu yerda qoladi.');

    $('smtpState').innerHTML = c.ready
      ? `<span class="pill-stat good">✓ Xat yuborishga tayyor</span>`
        + (c.lastSentAt ? `<span class="pill-stat">Oxirgi xat: ${new Date(c.lastSentAt).toLocaleString('uz-UZ')}</span>` : '')
      : `<span class="pill-stat warn">Sozlanmagan — tasdiqlash kodi server jurnaliga yoziladi</span>`;
    if (c.lastError) {
      $('smtpState').innerHTML += `<span class="pill-stat bad">Oxirgi xato: ${C.esc(c.lastError)}</span>`;
    }
  } catch (err) {
    $('smtpState').innerHTML = `<span class="pill-stat bad">${C.esc(err.message)}</span>`;
  }
}

function bindSmtp() {
  $('smtpSave').addEventListener('click', async () => {
    $('smtpMsg').textContent = 'Saqlanmoqda…';
    try {
      await api.saveSmtp({
        host: $('smtpHost').value.trim(),
        port: +$('smtpPort').value || 587,
        user: $('smtpUser').value.trim(),
        pass: $('smtpPass').value,          // bo'sh bo'lsa eskisi qoladi
        from: $('smtpFrom').value.trim(),
        secure: $('smtpSecure').value === '1',
        enabled: $('smtpEnabled').checked
      });
      $('smtpPass').value = '';
      $('smtpMsg').textContent = '';
      await loadSmtpSettings(C.state.user);
      C.toast('Pochta sozlamasi saqlandi', 'ok');
    } catch (err) {
      $('smtpMsg').textContent = '';
      C.toast(err.message, 'err');
    }
  });

  $('smtpTest').addEventListener('click', async () => {
    $('smtpMsg').textContent = 'Yuborilmoqda…';
    try {
      const r = await api.testSmtp(C.state.user.email);
      $('smtpMsg').textContent = '';
      C.toast(`Sinov xati ${r.to} manziliga yuborildi`, 'ok');
      await loadSmtpSettings(C.state.user);
    } catch (err) {
      $('smtpMsg').textContent = '';
      C.toast(err.message, 'err');
      await loadSmtpSettings(C.state.user);
    }
  });
}

export async function loadOauthSettings(user) {
  if (user.role !== 'owner') return;
  loadSmtpSettings(user);
  $('oauthCard').hidden = false;
  const base = location.origin;
  $('googleRedirect').textContent = base + '/api/auth/callback/google';
  $('githubRedirect').textContent = base + '/api/auth/callback/github';
  try {
    const cfg = await api.oauthSettings();
    for (const [p, ids] of [['google', ['googleId', 'googleSecret', 'googleEnabled', 'googleBadge']],
                            ['github', ['githubId', 'githubSecret', 'githubEnabled', 'githubBadge']]]) {
      const [idEl, secretEl, enEl, badgeEl] = ids;
      const env = cfg[p].fromEnv || {};
      $(idEl).value = cfg[p].clientId;
      lockIfEnv($(idEl), env.clientId);
      lockIfEnv($(secretEl), env.clientSecret);
      $(secretEl).placeholder = env.clientSecret
        ? '.env faylidan olinmoqda'
        : cfg[p].hasSecret ? 'Saqlangan — o\'zgartirish uchun yozing' : 'Client Secret';
      $(enEl).checked = cfg[p].enabled;
      const b = $(badgeEl);
      const on = cfg[p].enabled && cfg[p].clientId && cfg[p].hasSecret;
      b.className = 'badge ' + (on ? 'on' : 'off');
      b.textContent = on ? 'Yoqilgan' : 'O\'chirilgan';
    }
  } catch { /* egasi emas */ }
}

function bindOauth() {
  const save = async (provider, idEl, secretEl, enEl, stateEl) => {
    try {
      await api.saveOauth({
        provider,
        clientId: $(idEl).value.trim(),
        clientSecret: $(secretEl).value.trim() || undefined,
        enabled: $(enEl).checked
      });
      $(secretEl).value = '';
      $(stateEl).textContent = '✔ Saqlandi';
      C.toast('Saqlandi — kirish sahifasida tugma paydo bo\'ladi', 'ok');
      await loadOauthSettings(C.state.user);
    } catch (err) {
      C.toast(err.message, 'err');
    }
  };
  $('googleSave').addEventListener('click', () => save('google', 'googleId', 'googleSecret', 'googleEnabled', 'googleState'));
  $('githubSave').addEventListener('click', () => save('github', 'githubId', 'githubSecret', 'githubEnabled', 'githubState'));
}

/* ═══════════════ Ishga tushirish ═══════════════ */

export function initFeatures(ctx) {
  C = ctx;
  bindProfile();
  bindSecurity();
  initAvatar(ctx, { onChange: onAvatarChange });
  initWorkCard(ctx);
  bindReport();
  bindSmtp();
  bindIntegrations();
  bindOauth();
}


/* ═══════════════ QURILMALAR VA 2FA ═══════════════ */

/** «3 daqiqa oldin» ko'rinishidagi vaqt */
function agoText(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'hozir';
  if (m < 60) return m + ' daqiqa oldin';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' soat oldin';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' kun oldin';
  return new Date(iso).toLocaleDateString('uz-UZ');
}

function renderSessions(list) {
  const box = $('authSessions');
  if (!list.length) {
    box.innerHTML = '<div class="hint">Faol seans yo\'q</div>';
    return;
  }
  box.innerHTML = list.map(s => `
    <div class="session-row" data-sid="${C.esc(s.id || '')}">
      <div class="sess-main">
        <span class="sess-dev">${C.esc(s.device || 'Noma\'lum qurilma')}
          ${s.current ? '<span class="sess-now">shu qurilma</span>' : ''}</span>
        <span class="sess-sub">${s.ip ? C.esc(s.ip) + ' · ' : ''}kirilgan: ${new Date(s.createdAt).toLocaleString('uz-UZ')}</span>
      </div>
      <span class="sess-when" title="Oxirgi faollik">${agoText(s.lastSeenAt)}</span>
      ${s.current
        ? '<span class="hint">—</span>'
        : `<button class="btn btn-mini btn-ghost sess-kill" data-sid="${C.esc(s.id)}">Yopish</button>`}
    </div>`).join('');
}

async function loadSessions() {
  try {
    const res = await api.sessions();
    renderSessions(res.sessions);
    const others = res.sessions.filter(x => !x.current).length;
    $('sessRevokeAll').disabled = others === 0;
    $('sessHint').textContent = others ? `Boshqa ${others} ta qurilma` : 'Boshqa qurilma yo\'q';
  } catch (err) {
    $('authSessions').innerHTML = '<div class="hint">Seanslarni yuklab bo\'lmadi: ' + C.esc(err.message) + '</div>';
  }
}

/* ── Ikki bosqichli tasdiqlash ── */

function renderTwoFactor(st) {
  const badge = $('twofaBadge');
  badge.textContent = st.enabled ? 'Yoqilgan' : 'O\'chiq';
  badge.className = 'twofa-badge ' + (st.enabled ? 'on' : 'off');

  $('twofaInfo').textContent = st.enabled
    ? `${st.backupLeft} ta zaxira koddan foydalanish mumkin` +
      (st.confirmedAt ? ' · yoqilgan: ' + new Date(st.confirmedAt).toLocaleDateString('uz-UZ') : '')
    : 'Hisobingiz faqat parol bilan himoyalangan';

  $('twofaOff').hidden = st.enabled || st.pending;
  $('twofaSetup').hidden = !st.pending || st.enabled;
  $('twofaOn').hidden = !st.enabled;

  // Sozlash tugallanmagan bo'lsa kalit serverdan qaytadi — sahifa
  // yangilangan bo'lsa ham foydalanuvchi davom ettira oladi
  if (st.pending && st.secretGrouped) {
    $('twofaSecret').textContent = st.secretGrouped;
    $('twofaAccount').textContent = st.account || '';
  }

  if (st.enabled && st.backupLeft <= 2) {
    $('twofaInfo').textContent += ' — kodlar tugayapti, yangilang';
  }
}

async function loadTwoFactor() {
  try {
    const st = await api.twoFactor();
    renderTwoFactor(st);
  } catch { /* sozlamalar oynasi ochilmagan bo'lishi mumkin */ }
}

let lastBackupCodes = [];

function showBackupCodes(codes) {
  lastBackupCodes = codes;
  $('backupGrid').innerHTML = codes.map(c => `<code>${C.esc(c)}</code>`).join('');
  $('backupBox').hidden = false;
  $('backupBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 2FA ni tasdiqlash uchun kiritilgan parol */
function twofaAuth() {
  const pw = $('twofaPassword').value;
  return pw ? { password: pw } : {};
}

function bindSecurity() {
  /* Qurilmalar */
  $('sessRefresh').addEventListener('click', loadSessions);

  $('authSessions').addEventListener('click', async (e) => {
    const b = e.target.closest('.sess-kill');
    if (!b) return;
    const ok = await C.confirmBox('Qurilmani yopish',
      'Shu qurilmadagi seans darhol yopiladi va qaytadan kirish talab qilinadi.', 'Yopish');
    if (!ok) return;
    try {
      const res = await api.revokeSession(b.dataset.sid);
      renderSessions(res.sessions);
      C.toast('Qurilma yopildi', 'ok');
      loadSessions();
    } catch (err) { C.toast(err.message, 'err'); }
  });

  $('sessRevokeAll').addEventListener('click', async () => {
    const ok = await C.confirmBox('Boshqa qurilmalarni yopish',
      'Shu qurilmadan tashqari barcha seanslar yopiladi.', 'Hammasini yopish');
    if (!ok) return;
    try {
      const res = await api.revokeOthers();
      renderSessions(res.sessions);
      C.toast(res.closed ? `${res.closed} ta qurilma yopildi` : 'Yopiladigan qurilma yo\'q', 'ok');
      loadSessions();
    } catch (err) { C.toast(err.message, 'err'); }
  });

  /* 2FA — sozlashni boshlash */
  $('twofaStart').addEventListener('click', async () => {
    try {
      const st = await api.twoFactorSetup();
      $('twofaSecret').textContent = st.secretGrouped;
      $('twofaAccount').textContent = st.account;
      $('twofaSetupCode').value = '';
      $('twofaSetupHint').textContent = '';
      renderTwoFactor({ enabled: false, pending: true, backupLeft: 0 });
      setTimeout(() => $('twofaSetupCode').focus(), 60);
    } catch (err) { C.toast(err.message, 'err'); }
  });

  $('twofaCopy').addEventListener('click', async () => {
    const text = $('twofaSecret').textContent.replace(/\s/g, '');
    try {
      await navigator.clipboard.writeText(text);
      C.toast('Kalit nusxalandi', 'ok');
    } catch { C.toast('Nusxalab bo\'lmadi — kalitni qo\'lda ko\'chiring', 'warn'); }
  });

  $('twofaSetupCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  $('twofaEnable').addEventListener('click', async () => {
    const code = $('twofaSetupCode').value;
    if (code.length !== 6) return C.toast('6 xonali kodni kiriting', 'err');
    try {
      const res = await api.twoFactorEnable(code);
      showBackupCodes(res.backupCodes);
      C.toast('Ikki bosqichli tasdiqlash yoqildi', 'ok');
      await loadTwoFactor();
      await loadSessions();
    } catch (err) {
      $('twofaSetupHint').textContent = err.message;
      C.toast(err.message, 'err');
    }
  });

  $('twofaCancel').addEventListener('click', async () => {
    try { await api.twoFactorCancel(); } catch { /* holat baribir yangilanadi */ }
    $('twofaSetupCode').value = '';
    $('twofaSetupHint').textContent = '';
    await loadTwoFactor();
  });

  /* 2FA — yoqilgan holatdagi amallar */
  $('twofaDisable').addEventListener('click', async () => {
    const ok = await C.confirmBox('Ikki bosqichli tasdiqlashni o\'chirish',
      'Hisobingiz faqat parol bilan himoyalangan holga qaytadi.', 'O\'chirish');
    if (!ok) return;
    try {
      await api.twoFactorDisable(twofaAuth());
      $('twofaPassword').value = '';
      $('backupBox').hidden = true;
      C.toast('Ikki bosqichli tasdiqlash o\'chirildi', 'ok');
      await loadTwoFactor();
      await loadProfile();
    } catch (err) { C.toast(err.message, 'err'); }
  });

  $('twofaNewCodes').addEventListener('click', async () => {
    const ok = await C.confirmBox('Zaxira kodlarni yangilash',
      'Eski zaxira kodlar darhol kuchini yo\'qotadi.', 'Yangilash');
    if (!ok) return;
    try {
      const res = await api.twoFactorCodes(twofaAuth());
      $('twofaPassword').value = '';
      showBackupCodes(res.backupCodes);
      C.toast('Yangi kodlar yaratildi', 'ok');
      await loadTwoFactor();
    } catch (err) { C.toast(err.message, 'err'); }
  });

  /* Zaxira kodlar bilan ishlash */
  $('backupCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastBackupCodes.join('\n'));
      C.toast('Kodlar nusxalandi', 'ok');
    } catch { C.toast('Nusxalab bo\'lmadi', 'warn'); }
  });

  $('backupDownload').addEventListener('click', () => {
    const text = [
      'Pomodoro — zaxira kodlar',
      'Hisob: ' + (profileData?.user?.email || ''),
      'Yaratilgan: ' + new Date().toLocaleString('uz-UZ'),
      '',
      'Har bir kod faqat bir marta ishlaydi.',
      ''
    ].concat(lastBackupCodes).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pomodoro-zaxira-kodlar.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  });

  $('backupDone').addEventListener('click', () => {
    $('backupBox').hidden = true;
    lastBackupCodes = [];
  });
}
