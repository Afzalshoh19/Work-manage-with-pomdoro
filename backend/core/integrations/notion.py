"""
Notion integratsiyasi — hisobotni sahifa sifatida yaratish.

Node'dagi `lib/integrations/notion.js` ning ko'chirmasi.
"""
from __future__ import annotations

import json
import re

import httpx

from . import TIMEOUT, IntegrationError

API = "https://api.notion.com/v1"
VERSION = "2022-06-28"

_ID_RE = re.compile(
    r"([0-9a-f]{32})|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.I,
)


def _headers(token: str) -> dict:
    return {
        "Authorization": "Bearer " + str(token),
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
    }


def normalize_id(value) -> str:
    """"https://notion.so/Sahifa-2f1a..." yoki tire bilan yozilgan ID dan toza ID ajratish."""
    s = str(value or "").strip()
    if not s:
        return ""
    s = re.sub(r"[?#].*$", "", s)
    m = _ID_RE.search(s)
    if not m:
        return ""
    raw = m.group(0).replace("-", "")
    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def _call(token: str, path: str, method: str = "GET", body=None) -> dict:
    try:
        res = httpx.request(method, API + path, headers=_headers(token),
                            content=body, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise IntegrationError(str(exc) or "Notion'ga ulanib bo'lmadi") from exc

    text = res.text
    try:
        data = json.loads(text) if text else None
    except ValueError:
        data = {"raw": text[:300]}
    return {"ok": 200 <= res.status_code < 300, "status": res.status_code, "data": data}


def _birinchi_matn(bloklar) -> str | None:
    """Notion `title: [{plain_text}]` — birinchi bo'lagining matni."""
    if isinstance(bloklar, list) and bloklar and isinstance(bloklar[0], dict):
        return bloklar[0].get("plain_text")
    return None


def test_connection(cfg: dict) -> dict:
    if not cfg.get("token"):
        raise IntegrationError("Notion tokeni kiritilmagan")
    r = _call(cfg["token"], "/users/me")
    if r["status"] == 401:
        raise IntegrationError("Notion tokeni noto'g'ri yoki eskirgan")
    if not r["ok"]:
        xabar = (r["data"] or {}).get("message") or ""
        raise IntegrationError(f"Notion javob bermadi ({r['status']}): {xabar}")

    target = normalize_id(cfg.get("databaseId") or cfg.get("parentPageId"))
    target_title = None
    if target:
        is_db = bool(normalize_id(cfg.get("databaseId")))
        probe = _call(cfg["token"], ("/databases/" if is_db else "/pages/") + target)
        if probe["status"] == 404:
            raise IntegrationError(
                "Sahifa/baza topilmadi. Notion'da o'sha sahifani integratsiyaga "
                "ulang (Connections → integratsiya nomi)."
            )
        if not probe["ok"]:
            xabar = (probe["data"] or {}).get("message") or ""
            raise IntegrationError(f"Sahifaga kirib bo'lmadi ({probe['status']}): {xabar}")

        pd = probe["data"] or {}
        if is_db:
            target_title = _birinchi_matn(pd.get("title")) or "(nomsiz baza)"
        else:
            # `Object.values(properties)[0]?.title?.[0]?.plain_text`
            qiymatlar = list((pd.get("properties") or {}).values())
            birinchi = qiymatlar[0] if qiymatlar else None
            matn = _birinchi_matn(birinchi.get("title")) if isinstance(birinchi, dict) else None
            target_title = matn or "(nomsiz sahifa)"

    d = r["data"] or {}
    workspace = d.get("name") or ((d.get("bot") or {}).get("workspace_name")) or "Notion"
    return {"workspace": workspace, "target": target_title}


def create_report_page(cfg: dict, title: str, blocks: list) -> dict:
    """Hisobotni Notion sahifasi sifatida yaratadi."""
    if not cfg.get("token"):
        raise IntegrationError("Notion tokeni kiritilmagan")

    db_id = normalize_id(cfg.get("databaseId"))
    page_id = normalize_id(cfg.get("parentPageId"))
    if not db_id and not page_id:
        raise IntegrationError("Notion sahifa yoki baza ID kiritilmagan")

    parent = {"database_id": db_id} if db_id else {"page_id": page_id}

    # Baza bo'lsa — sarlavha ustunining nomini aniqlaymiz
    title_prop = "title"
    if db_id:
        db = _call(cfg["token"], "/databases/" + db_id)
        if not db["ok"]:
            xabar = (db["data"] or {}).get("message") or ""
            raise IntegrationError(f"Notion bazasi ochilmadi ({db['status']}): {xabar}")
        for nom, v in ((db["data"] or {}).get("properties") or {}).items():
            if isinstance(v, dict) and v.get("type") == "title":
                title_prop = nom
                break

    kalit = title_prop if db_id else "title"
    body = {
        "parent": parent,
        "icon": {"emoji": "🍅"},
        "properties": {
            kalit: {"title": [{"type": "text", "text": {"content": str(title)[:190]}}]}
        },
        "children": blocks[:100],
    }

    r = _call(cfg["token"], "/pages", "POST",
              json.dumps(body, ensure_ascii=False).encode("utf-8"))
    if r["status"] == 404:
        raise IntegrationError(
            "Sahifa topilmadi yoki integratsiyaga ulanmagan. Notion'da sahifa → "
            '"..." → Connections orqali ulang.'
        )
    if not r["ok"]:
        xabar = (r["data"] or {}).get("message") or ""
        raise IntegrationError(f"Notion sahifasi yaratilmadi ({r['status']}): {xabar}")

    # 100 tadan ortiq blok bo'lsa qolganini qo'shamiz
    if len(blocks) > 100:
        sahifa_id = (r["data"] or {}).get("id")
        for i in range(100, len(blocks), 100):
            _call(cfg["token"], f"/blocks/{sahifa_id}/children", "PATCH",
                  json.dumps({"children": blocks[i:i + 100]}, ensure_ascii=False).encode("utf-8"))

    d = r["data"] or {}
    return {"id": d.get("id"), "url": d.get("url")}


PROVIDER_INFO = {
    "id": "notion",
    "name": "Notion",
    "docs": "https://www.notion.so/my-integrations",
}
