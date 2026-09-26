"""
Confluence Cloud integratsiyasi — hisobotni sahifa sifatida yaratish.
Autentifikatsiya: email + Atlassian API token (Basic auth).

Node'dagi `lib/integrations/confluence.js` ning ko'chirmasi.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from urllib.parse import urlparse

import httpx

from ..util import encode_uri_component
from . import TIMEOUT, IntegrationError


def _auth_header(email, token) -> str:
    raw = f"{email}:{token}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def wiki_base(base_url) -> str:
    """"https://kompaniya.atlassian.net" yoki ".../wiki" — ikkalasi ham qabul qilinadi."""
    b = str(base_url or "").strip().rstrip("/")
    if not b:
        return ""
    if not re.match(r"^https?://", b, re.I):
        b = "https://" + b
    if not re.search(r"/wiki$", b, re.I):
        host = urlparse(b).netloc
        if re.search(r"atlassian\.net$", host, re.I):
            b += "/wiki"
    return b


def _call(cfg: dict, path: str, method: str = "GET", body=None) -> dict:
    base = wiki_base(cfg.get("baseUrl"))
    if not base:
        raise IntegrationError("Confluence manzili kiritilmagan")
    headers = {
        "Authorization": _auth_header(cfg.get("email"), cfg.get("token")),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        res = httpx.request(method, base + path, headers=headers,
                            content=body, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise IntegrationError(str(exc) or "Confluence'ga ulanib bo'lmadi") from exc

    text = res.text
    try:
        data = json.loads(text) if text else None
    except ValueError:
        data = {"raw": text[:300]}
    return {"ok": 200 <= res.status_code < 300, "status": res.status_code,
            "data": data, "base": base}


def test_connection(cfg: dict) -> dict:
    if not cfg.get("email") or not cfg.get("token"):
        raise IntegrationError("Email yoki API token kiritilmagan")

    me = _call(cfg, "/rest/api/user/current")
    if me["status"] in (401, 403):
        raise IntegrationError(f"Email yoki API token noto'g'ri ({me['status']})")
    if not me["ok"]:
        raise IntegrationError(f"Confluence javob bermadi ({me['status']}). Manzil to'g'rimi?")

    space_name = None
    if cfg.get("spaceKey"):
        sp = _call(cfg, "/rest/api/space/" + encode_uri_component(cfg["spaceKey"]))
        if sp["status"] == 404:
            raise IntegrationError(f"\"{cfg['spaceKey']}\" space topilmadi")
        if sp["ok"]:
            space_name = (sp["data"] or {}).get("name")
    return {"displayName": (me["data"] or {}).get("displayName") or cfg.get("email"),
            "space": space_name}


def list_spaces(cfg: dict) -> list:
    """Mavjud space'lar ro'yxati (interfeysda tanlash uchun)."""
    r = _call(cfg, "/rest/api/space?limit=50&type=global")
    if not r["ok"]:
        raise IntegrationError(f"Space'lar olinmadi ({r['status']})")
    return [{"key": s.get("key"), "name": s.get("name")}
            for s in ((r["data"] or {}).get("results") or [])]


def create_report_page(cfg: dict, title: str, storage_html: str) -> dict:
    """Hisobotni Confluence sahifasi sifatida yaratadi."""
    if not cfg.get("spaceKey"):
        raise IntegrationError("Confluence space kaliti (Space Key) kiritilmagan")

    body = {
        "type": "page",
        "title": str(title)[:250],
        "space": {"key": cfg["spaceKey"]},
        "body": {"storage": {"value": storage_html, "representation": "storage"}},
    }
    if cfg.get("parentPageId"):
        body["ancestors"] = [{"id": str(cfg["parentPageId"]).strip()}]

    def yubor():
        return _call(cfg, "/rest/api/content", "POST",
                     json.dumps(body, ensure_ascii=False).encode("utf-8"))

    r = yubor()

    # Bir xil nomli sahifa bo'lsa — nomga vaqt qo'shib qayta urinamiz
    if r["status"] == 400 and re.search(r"same title|already exists",
                                        json.dumps(r["data"] or {}), re.I):
        # JS `toLocaleTimeString('uz-UZ')` — 24 soatlik HH:MM:SS
        body["title"] = f"{body['title']} ({datetime.now().strftime('%H:%M:%S')})"
        r = yubor()

    if r["status"] in (401, 403):
        raise IntegrationError("Confluence: sahifa yaratishga ruxsat yo'q")
    if not r["ok"]:
        d = r["data"] or {}
        msg = d.get("message") or d.get("raw") or ""
        raise IntegrationError(f"Confluence sahifasi yaratilmadi ({r['status']}) {msg}".strip())

    d = r["data"] or {}
    links = d.get("_links") or {}
    webui = links.get("webui") or ""
    base = links.get("base") or wiki_base(cfg.get("baseUrl"))
    return {"id": d.get("id"), "url": base + webui if webui else base}


PROVIDER_INFO = {
    "id": "confluence",
    "name": "Confluence",
    "docs": "https://id.atlassian.com/manage-profile/security/api-tokens",
}
