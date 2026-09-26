"""
Jira Cloud / Server integratsiyasi — vazifalarni JQL bo'yicha yuklab olish.
Autentifikatsiya: email + API token (Basic auth).

Node'dagi `lib/integrations/jira.js` ning ko'chirmasi.
"""
from __future__ import annotations

import base64
import json
import re

import httpx

from ..util import js_round
from . import TIMEOUT, IntegrationError

PRIORITY_MAP = {
    "highest": "yuqori", "high": "yuqori", "critical": "yuqori", "blocker": "yuqori",
    "medium": "orta", "normal": "orta", "major": "orta",
    "low": "past", "lowest": "past", "minor": "past", "trivial": "past",
}

TYPE_CATEGORY = {
    "bug": "ish", "task": "ish", "sub-task": "ish", "subtask": "ish", "story": "loyiha",
    "epic": "loyiha", "new feature": "loyiha", "improvement": "loyiha", "spike": "oqish",
}


def _auth_header(email, token) -> str:
    raw = f"{email}:{token}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def norm_base(base_url) -> str:
    b = str(base_url or "").strip().rstrip("/")
    if b and not re.match(r"^https?://", b, re.I):
        b = "https://" + b
    return b


def _call(cfg: dict, path: str, method: str = "GET", body=None) -> dict:
    """
    Node'dagi `call()`: javob matni JSON bo'lsa o'qiladi, bo'lmasa
    `{"raw": ...}` ga o'raladi. Tarmoq xatosi ham shu yerda xabarga aylanadi —
    Node'da `fetch` istisnosi yuqoriga chiqib `err.message` bo'lardi.
    """
    url = norm_base(cfg.get("baseUrl")) + path
    headers = {
        "Authorization": _auth_header(cfg.get("email"), cfg.get("token")),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        res = httpx.request(method, url, headers=headers, content=body, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise IntegrationError(str(exc) or "Jira'ga ulanib bo'lmadi") from exc

    text = res.text
    try:
        data = json.loads(text) if text else None
    except ValueError:
        data = {"raw": text[:300]}
    return {"ok": 200 <= res.status_code < 300, "status": res.status_code, "data": data}


def test_connection(cfg: dict) -> dict:
    """Ulanishni tekshirish."""
    if not norm_base(cfg.get("baseUrl")):
        raise IntegrationError("Jira manzili kiritilmagan")
    if not cfg.get("email") or not cfg.get("token"):
        raise IntegrationError("Email yoki API token kiritilmagan")

    r = _call(cfg, "/rest/api/3/myself")
    if r["status"] in (401, 403):
        raise IntegrationError(f"Email yoki API token noto'g'ri ({r['status']})")
    if not r["ok"]:
        raise IntegrationError(f"Jira javob bermadi ({r['status']}). Manzil to'g'rimi?")
    d = r["data"] or {}
    return {
        "accountId": d.get("accountId"),
        "displayName": d.get("displayName"),
        "email": d.get("emailAddress") or cfg.get("email"),
    }


def _search_issues(cfg: dict, jql, max_results: int) -> list:
    """JQL bo'yicha masalalarni olish (yangi va eski API bilan mos)."""
    fields = ["summary", "priority", "status", "issuetype", "timetracking",
              "timeoriginalestimate", "timeestimate", "duedate", "project", "description"]
    payload = json.dumps({"jql": jql, "maxResults": max_results, "fields": fields})

    # Yangi endpoint (Jira Cloud 2025+)
    r = _call(cfg, "/rest/api/3/search/jql", "POST", payload)

    # Eski endpoint bilan zaxira urinish
    if r["status"] in (404, 410, 405):
        r = _call(cfg, "/rest/api/3/search", "POST", payload)

    if r["status"] == 400:
        xabarlar = (r["data"] or {}).get("errorMessages") or []
        msg = "; ".join(xabarlar) if xabarlar else "JQL so'rovi noto'g'ri"
        raise IntegrationError("Jira: " + msg)
    if r["status"] in (401, 403):
        raise IntegrationError("Jira: ruxsat yo'q — email yoki API tokenni tekshiring")
    if not r["ok"]:
        raise IntegrationError(f"Jira qidiruvi muvaffaqiyatsiz ({r['status']})")
    return (r["data"] or {}).get("issues") or []


def _nested(d, *yol):
    """`f.priority?.name` — oraliqda `None` chiqsa butun zanjir `None`."""
    cur = d
    for k in yol:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def fetch_tasks(cfg: dict, jql=None, limit: int = 25) -> list:
    """
    Jira masalalarini pomodoro vazifalariga aylantirish.
    Vaqt bahosi (original estimate) bo'lsa — pomodorolar soni shundan hisoblanadi.
    """
    try:
        per_pomodoro = max(5, int(float(cfg.get("minutesPerPomodoro") or 0)) or 25)
    except (TypeError, ValueError):
        per_pomodoro = 25
    try:
        fallback = max(1, int(float(cfg.get("defaultPomodoros") or 0)) or 2)
    except (TypeError, ValueError):
        fallback = 2

    issues = _search_issues(cfg, jql or cfg.get("jql"), min(100, max(1, limit)))
    base = norm_base(cfg.get("baseUrl"))

    out = []
    for issue in issues:
        f = issue.get("fields") or {}
        # `??` zanjiri: faqat None/yo'q bo'lsa keyingisiga o'tadi, 0 esa to'xtatadi
        estimate_sec = _nested(f, "timetracking", "originalEstimateSeconds")
        if estimate_sec is None:
            estimate_sec = f.get("timeoriginalestimate")
        if estimate_sec is None:
            estimate_sec = f.get("timeestimate")
        if estimate_sec is None:
            estimate_sec = 0

        pomodoros = (max(1, min(30, js_round(estimate_sec / 60 / per_pomodoro)))
                     if estimate_sec else fallback)
        prio = str(_nested(f, "priority", "name") or "").lower()
        typ = str(_nested(f, "issuetype", "name") or "").lower()

        out.append({
            "key": issue.get("key"),
            "title": f"{issue.get('key')} — {f.get('summary') or '(nomsiz)'}",
            "summary": f.get("summary") or "",
            "plannedPomodoros": pomodoros,
            "estimateMinutes": js_round(estimate_sec / 60) if estimate_sec else None,
            "priority": PRIORITY_MAP.get(prio, "orta"),
            "category": TYPE_CATEGORY.get(typ, "ish"),
            "status": _nested(f, "status", "name") or "",
            "issueType": _nested(f, "issuetype", "name") or "",
            "project": _nested(f, "project", "name") or "",
            "dueDate": f.get("duedate") or None,
            "url": base + "/browse/" + str(issue.get("key")),
        })
    return out


PROVIDER_INFO = {
    "id": "jira",
    "name": "Jira",
    "docs": "https://id.atlassian.com/manage-profile/security/api-tokens",
}
