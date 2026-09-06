/**
 * Notion integratsiyasi — hisobotni sahifa sifatida yaratish.
 * Token: https://www.notion.so/my-integrations (Internal Integration Secret).
 * Sahifani integratsiyaga ulashish shart: sahifa → "..." → Connections → integratsiyani qo'shing.
 */
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

function headers(token) {
  return {
    Authorization: 'Bearer ' + token,
    'Notion-Version': VERSION,
    'Content-Type': 'application/json'
  };
}

/** "https://notion.so/Sahifa-2f1a..." yoki tire bilan yozilgan ID dan toza ID ajratish */
export function normalizeId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.replace(/[?#].*$/, '').match(/([0-9a-f]{32})|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return '';
  const raw = m[0].replace(/-/g, '');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

async function call(token, path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...headers(token), ...(init.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, data };
}

export async function testConnection(cfg) {
  if (!cfg.token) throw new Error('Notion tokeni kiritilmagan');
  const r = await call(cfg.token, '/users/me');
  if (r.status === 401) throw new Error('Notion tokeni noto\'g\'ri yoki eskirgan');
  if (!r.ok) throw new Error(`Notion javob bermadi (${r.status}): ${r.data?.message || ''}`);

  const target = normalizeId(cfg.databaseId || cfg.parentPageId);
  let targetTitle = null;
  if (target) {
    const isDb = !!normalizeId(cfg.databaseId);
    const probe = await call(cfg.token, (isDb ? '/databases/' : '/pages/') + target);
    if (probe.status === 404) {
      throw new Error('Sahifa/baza topilmadi. Notion\'da o\'sha sahifani integratsiyaga ulang (Connections → integratsiya nomi).');
    }
    if (!probe.ok) throw new Error(`Sahifaga kirib bo'lmadi (${probe.status}): ${probe.data?.message || ''}`);
    targetTitle = isDb
      ? (probe.data?.title?.[0]?.plain_text || '(nomsiz baza)')
      : (Object.values(probe.data?.properties || {})[0]?.title?.[0]?.plain_text || '(nomsiz sahifa)');
  }
  return { workspace: r.data?.name || r.data?.bot?.workspace_name || 'Notion', target: targetTitle };
}

/**
 * Hisobotni Notion sahifasi sifatida yaratadi.
 * @returns {{url:string, id:string}}
 */
export async function createReportPage(cfg, { title, blocks }) {
  if (!cfg.token) throw new Error('Notion tokeni kiritilmagan');

  const dbId = normalizeId(cfg.databaseId);
  const pageId = normalizeId(cfg.parentPageId);
  if (!dbId && !pageId) throw new Error('Notion sahifa yoki baza ID kiritilmagan');

  const parent = dbId ? { database_id: dbId } : { page_id: pageId };

  // Baza bo'lsa — sarlavha ustunining nomini aniqlaymiz
  let titleProp = 'title';
  if (dbId) {
    const db = await call(cfg.token, '/databases/' + dbId);
    if (!db.ok) throw new Error(`Notion bazasi ochilmadi (${db.status}): ${db.data?.message || ''}`);
    const found = Object.entries(db.data.properties || {}).find(([, v]) => v.type === 'title');
    if (found) titleProp = found[0];
  }

  const body = {
    parent,
    icon: { emoji: '🍅' },
    properties: {
      [dbId ? titleProp : 'title']: { title: [{ type: 'text', text: { content: String(title).slice(0, 190) } }] }
    },
    children: blocks.slice(0, 100)
  };

  const r = await call(cfg.token, '/pages', { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 404) throw new Error('Sahifa topilmadi yoki integratsiyaga ulanmagan. Notion\'da sahifa → "..." → Connections orqali ulang.');
  if (!r.ok) throw new Error(`Notion sahifasi yaratilmadi (${r.status}): ${r.data?.message || ''}`);

  // 100 tadan ortiq blok bo'lsa qolganini qo'shamiz
  if (blocks.length > 100) {
    for (let i = 100; i < blocks.length; i += 100) {
      await call(cfg.token, `/blocks/${r.data.id}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: blocks.slice(i, i + 100) })
      });
    }
  }
  return { id: r.data.id, url: r.data.url };
}

export const providerInfo = {
  id: 'notion',
  name: 'Notion',
  docs: 'https://www.notion.so/my-integrations'
};
