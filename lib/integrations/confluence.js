/**
 * Confluence Cloud integratsiyasi — hisobotni sahifa sifatida yaratish.
 * Autentifikatsiya: email + Atlassian API token (Basic auth).
 * Token: https://id.atlassian.com/manage-profile/security/api-tokens
 */

function authHeader(email, token) {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

/** "https://kompaniya.atlassian.net" yoki ".../wiki" — ikkalasi ham qabul qilinadi */
function wikiBase(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  if (!/\/wiki$/i.test(b) && /atlassian\.net$/i.test(new URL(b).host)) b += '/wiki';
  return b;
}

async function call(cfg, path, init = {}) {
  const base = wikiBase(cfg.baseUrl);
  if (!base) throw new Error('Confluence manzili kiritilmagan');
  const res = await fetch(base + path, {
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
  return { ok: res.ok, status: res.status, data, base };
}

export async function testConnection(cfg) {
  if (!cfg.email || !cfg.token) throw new Error('Email yoki API token kiritilmagan');

  const me = await call(cfg, '/rest/api/user/current');
  if (me.status === 401 || me.status === 403) throw new Error('Email yoki API token noto\'g\'ri (' + me.status + ')');
  if (!me.ok) throw new Error(`Confluence javob bermadi (${me.status}). Manzil to'g'rimi?`);

  let spaceName = null;
  if (cfg.spaceKey) {
    const sp = await call(cfg, '/rest/api/space/' + encodeURIComponent(cfg.spaceKey));
    if (sp.status === 404) throw new Error(`"${cfg.spaceKey}" space topilmadi`);
    if (sp.ok) spaceName = sp.data?.name;
  }
  return { displayName: me.data?.displayName || cfg.email, space: spaceName };
}

/** Mavjud space'lar ro'yxati (interfeysda tanlash uchun) */
export async function listSpaces(cfg) {
  const r = await call(cfg, '/rest/api/space?limit=50&type=global');
  if (!r.ok) throw new Error(`Space'lar olinmadi (${r.status})`);
  return (r.data?.results || []).map(s => ({ key: s.key, name: s.name }));
}

/**
 * Hisobotni Confluence sahifasi sifatida yaratadi.
 * @returns {{url:string, id:string}}
 */
export async function createReportPage(cfg, { title, storageHtml }) {
  if (!cfg.spaceKey) throw new Error('Confluence space kaliti (Space Key) kiritilmagan');

  const body = {
    type: 'page',
    title: String(title).slice(0, 250),
    space: { key: cfg.spaceKey },
    body: { storage: { value: storageHtml, representation: 'storage' } }
  };
  if (cfg.parentPageId) body.ancestors = [{ id: String(cfg.parentPageId).trim() }];

  let r = await call(cfg, '/rest/api/content', { method: 'POST', body: JSON.stringify(body) });

  // Bir xil nomli sahifa bo'lsa — nomga vaqt qo'shib qayta urinamiz
  if (r.status === 400 && /same title|already exists/i.test(JSON.stringify(r.data || {}))) {
    body.title = `${body.title} (${new Date().toLocaleTimeString('uz-UZ')})`;
    r = await call(cfg, '/rest/api/content', { method: 'POST', body: JSON.stringify(body) });
  }
  if (r.status === 401 || r.status === 403) throw new Error('Confluence: sahifa yaratishga ruxsat yo\'q');
  if (!r.ok) {
    const msg = r.data?.message || r.data?.raw || '';
    throw new Error(`Confluence sahifasi yaratilmadi (${r.status}) ${msg}`.trim());
  }

  const webui = r.data?._links?.webui || '';
  const base = r.data?._links?.base || wikiBase(cfg.baseUrl);
  return { id: r.data.id, url: webui ? base + webui : base };
}

export const providerInfo = {
  id: 'confluence',
  name: 'Confluence',
  docs: 'https://id.atlassian.com/manage-profile/security/api-tokens'
};
