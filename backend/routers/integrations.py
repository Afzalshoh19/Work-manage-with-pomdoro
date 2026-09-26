"""
Tashqi tizimlar: Jira (import), Notion / Confluence (eksport),
umumiy CSV/JSON import.

Node'dagi `routes/integrations.js` ning ko'chirmasi.

Marshrut tartibi haqida: `/api/integrations/jira/preview` `/api/integrations/:name`
dan OLDIN topilishi shart. `main._match_route` aniq yo'lni dinamikdan ustun
qo'yadi, shuning uchun jadvaldagi tartib ahamiyatsiz — Node ham shunday ishlaydi.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from ..core import report as Report
from ..core.db import get_db, persist
from ..core.integrations import IntegrationError, confluence, jira, notion
from ..core.util import UNDEFINED, clamp, is_date, js_round, s_str, today_local, uid
from .profile import note_integration_result, resolved_config

CLIENTS = {"jira": jira, "notion": notion, "confluence": confluence}


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


# ═══════════ Ulanishni tekshirish ═══════════

def test_integration(ctx):
    user = ctx["user"]
    name = ctx["params"]["name"]
    client = CLIENTS.get(name)
    if not client:
        return {"error": "Bunday integratsiya yo'q", "status": 404}
    cfg = resolved_config(user, name)
    try:
        info = client.test_connection(cfg)
        note_integration_result(user, name, error=None)
        return {"ok": True, "info": info}
    except IntegrationError as err:
        note_integration_result(user, name, error=str(err))
        return {"error": str(err), "status": 400}


# ═══════════ Jira: vazifalarni ko'rish va import qilish ═══════════

def jira_preview(ctx):
    user, query = ctx["user"], ctx["query"]
    cfg = resolved_config(user, "jira")
    if not (cfg or {}).get("token"):
        return {"error": "Jira sozlanmagan — Sozlamalar → Integratsiyalar bo'limiga kiring",
                "status": 400}
    jql = s_str(query.get("jql"), 1000) or cfg.get("jql")
    try:
        limit = query.get("limit")
        issues = jira.fetch_tasks(cfg, jql=jql,
                                  limit=clamp(25 if limit is None else limit, 1, 50))
        note_integration_result(user, "jira", error=None)
        return {"issues": issues, "jql": jql}
    except IntegrationError as err:
        note_integration_result(user, "jira", error=str(err))
        return {"error": str(err), "status": 400}


def jira_import(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    db = get_db()
    cfg = resolved_config(user, "jira")
    if not (cfg or {}).get("token"):
        return {"error": "Jira sozlanmagan", "status": 400}

    date = body.get("date") if is_date(body.get("date")) else today_local()
    keys = body.get("keys") if isinstance(body.get("keys"), list) else None

    try:
        issues = jira.fetch_tasks(cfg, jql=s_str(body.get("jql"), 1000) or cfg.get("jql"),
                                  limit=50)
        chosen = [i for i in issues if i["key"] in keys] if keys is not None else issues
        if not chosen:
            return {"error": "Import qilinadigan masala tanlanmadi", "status": 400}

        existing = [t for t in db["tasks"]
                    if t.get("userId") == user["id"] and t.get("date") == date]
        existing_keys = {(t.get("source") or {}).get("key")
                         for t in db["tasks"]
                         if t.get("userId") == user["id"]
                         and (t.get("source") or {}).get("type") == "jira"}
        order = (max(t.get("order") or 0 for t in existing) + 1) if existing else 0

        created = []
        skipped = 0
        for issue in chosen:
            if issue["key"] in existing_keys:
                skipped += 1
                continue
            izoh = " · ".join([x for x in (issue["project"], issue["issueType"],
                                           issue["status"]) if x])
            created.append({
                "id": uid(),
                "userId": user["id"],
                "date": date,
                "title": issue["title"],
                "note": izoh,
                "category": issue["category"],
                "priority": issue["priority"],
                "plannedPomodoros": issue["plannedPomodoros"],
                "completedPomodoros": 0,
                "focusSeconds": 0,
                "done": False,
                "order": order,
                "source": {"type": "jira", "key": issue["key"], "url": issue["url"]},
                "createdAt": _now_iso(),
                "completedAt": None,
            })
            order += 1
        db["tasks"].extend(created)
        persist()
        note_integration_result(user, "jira", error=None, imported_at=_now_iso())
        return {"imported": len(created), "skipped": skipped, "date": date}
    except IntegrationError as err:
        note_integration_result(user, "jira", error=str(err))
        return {"error": str(err), "status": 400}


# ═══════════ Notion / Confluence: hisobotni eksport qilish ═══════════

def export_report(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    target = ctx["params"]["name"]
    if target not in ("notion", "confluence"):
        return {"error": "Faqat notion yoki confluence", "status": 400}

    cfg = resolved_config(user, target)
    if not (cfg or {}).get("token"):
        nom = "Notion" if target == "notion" else "Confluence"
        return {"error": nom + " sozlanmagan", "status": 400}

    report = Report.build_report(user, {
        "type": body.get("type") if body.get("type") in ("daily", "weekly", "monthly") else "daily",
        # `undefined` — maydon YO'Q degani. `None` qo'yilsa `build_report`
        # boshqa tarmoqqa tushib, boshqa davrni hisoblab berardi.
        "date": body.get("date") if is_date(body.get("date")) else UNDEFINED,
        "from": body.get("from") if is_date(body.get("from")) else UNDEFINED,
        "to": body.get("to") if is_date(body.get("to")) else UNDEFINED,
    })
    title = f"{report['period']['label']} — {user.get('name')}"

    try:
        if target == "notion":
            page = notion.create_report_page(cfg, title=title,
                                             blocks=Report.render_notion_blocks(report))
        else:
            page = confluence.create_report_page(cfg, title=title,
                                                 storage_html=Report.render_confluence(report))
        note_integration_result(user, target, error=None, exported_at=_now_iso())
        return {"ok": True, "url": page["url"], "id": page["id"], "title": title}
    except IntegrationError as err:
        note_integration_result(user, target, error=str(err))
        return {"error": str(err), "status": 400}


# ═══════════ Umumiy import (Trello / Asana / Todoist / ClickUp CSV yoki JSON) ═══════════

def _parse_csv(text: str) -> list:
    """
    Oddiy CSV parseri — vergul yoki nuqta-vergul ajratgichi bilan.

    `csv` moduli ATAYLAB ishlatilmadi: Node'dagi qo'lda yozilgan holat
    mashinasi qo'shtirnoq va qatorlarni o'ziga xos kesadi (yopilmagan
    qo'shtirnoq, faqat bo'shliqdan iborat qatorni tashlash). `csv` moduli
    boshqacha qiladi — bu import natijasida ko'rinadigan farq berardi.
    """
    clean = text.lstrip("﻿")
    first_line = clean.split("\n")[0].replace("\r", "")
    delim = ";" if first_line.count(";") > first_line.count(",") else ","

    rows: list[list[str]] = []
    row: list[str] = []
    cell = ""
    in_quotes = False
    i = 0
    n = len(clean)
    while i < n:
        c = clean[i]
        if in_quotes:
            if c == '"':
                if i + 1 < n and clean[i + 1] == '"':
                    cell += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                cell += c
        elif c == '"':
            in_quotes = True
        elif c == delim:
            row.append(cell)
            cell = ""
        elif c == "\n":
            row.append(cell)
            rows.append(row)
            row = []
            cell = ""
        elif c != "\r":
            cell += c
        i += 1
    if cell or row:
        row.append(cell)
        rows.append(row)
    return [r for r in rows if any(str(x).strip() for x in r)]


TITLE_KEYS = ["title", "name", "task", "task name", "summary", "card name",
              "content", "vazifa", "nom"]
ESTIMATE_KEYS = ["estimate", "estimated", "time estimate", "original estimate",
                 "duration", "hours", "minutes", "vaqt", "baho"]
NOTE_KEYS = ["description", "notes", "note", "details", "izoh"]
PRIORITY_KEYS = ["priority", "muhimlik"]
DONE_KEYS = ["completed", "done", "status", "holat"]

DONE_VALUES = ["true", "1", "yes", "done", "completed", "bajarildi", "closed"]
_HIGH = re.compile(r"high|urgent|1|yuqori")
_LOW = re.compile(r"low|4|past")


def _pick(obj, keys: list):
    """JS `pick`: kalitlar KIRITILISH tartibida ko'riladi, birinchi mos kelgani."""
    if not isinstance(obj, dict):
        return UNDEFINED
    for k in obj:
        if str(k).strip().lower() in keys:
            return obj[k]
    return UNDEFINED


def _matn(v) -> str:
    """JS `String(x ?? '')` — `undefined` ham, `null` ham bo'sh satr."""
    if v is UNDEFINED or v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _estimate_to_pomodoros(value, per_pomodoro):
    if value is UNDEFINED or value is None or value == "":
        return None
    s = _matn(value).strip().lower()
    minutes = 0.0
    h = re.search(r"(\d+(?:[.,]\d+)?)\s*(h|soat|hour)", s)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(m|daq|min)", s)
    if h:
        minutes += float(h.group(1).replace(",", ".")) * 60
    if m:
        minutes += float(m.group(1).replace(",", "."))
    if not h and not m:
        try:
            num = float(s.replace(",", "."))
        except ValueError:
            return None
        # JS `Number.isFinite` — NaN va cheksizlik rad etiladi
        if num != num or num in (float("inf"), float("-inf")):
            return None
        # 12 dan kichik son — soat deb qabul qilinadi
        minutes = num * 60 if num <= 12 else num
    if not minutes:
        return None
    return clamp(js_round(minutes / per_pomodoro), 1, 30)


def generic_import(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    db = get_db()
    date = body.get("date") if is_date(body.get("date")) else today_local()
    mpp = body.get("minutesPerPomodoro")
    per_pomodoro = clamp(25 if mpp is None else mpp, 5, 120)
    dp = body.get("defaultPomodoros")
    fallback = clamp(2 if dp is None else dp, 1, 20)
    source_name = s_str(body.get("source"), 40) or "import"

    csv_matn = body.get("csv")
    if isinstance(csv_matn, str) and csv_matn.strip():
        rows = _parse_csv(csv_matn)
        if len(rows) < 2:
            return {"error": "CSV faylda sarlavha qatori va kamida bitta vazifa bo'lishi kerak",
                    "status": 400}
        headers = [str(h).strip() for h in rows[0]]
        records = []
        for r in rows[1:]:
            # JS `Object.fromEntries` — takror ustun nomida OXIRGISI qoladi
            records.append({h: (r[i] if i < len(r) else "") for i, h in enumerate(headers)})
    elif isinstance(body.get("items"), list):
        records = body["items"]
    else:
        return {"error": "CSV matni yoki items ro'yxati kerak", "status": 400}

    existing = [t for t in db["tasks"]
                if t.get("userId") == user["id"] and t.get("date") == date]
    order = (max(t.get("order") or 0 for t in existing) + 1) if existing else 0

    created = []
    skipped = 0
    for rec in records[:200]:
        xom = _pick(rec, TITLE_KEYS)
        if xom is UNDEFINED:
            xom = rec.get("title") if isinstance(rec, dict) else UNDEFINED
        title = s_str(_matn(xom), 200)
        if not title:
            skipped += 1
            continue

        done_raw = _matn(_pick(rec, DONE_KEYS)).strip().lower()
        done = done_raw in DONE_VALUES

        prio_raw = _matn(_pick(rec, PRIORITY_KEYS)).strip().lower()
        if _HIGH.search(prio_raw):
            priority = "yuqori"
        elif _LOW.search(prio_raw):
            priority = "past"
        else:
            priority = "orta"

        pom = _estimate_to_pomodoros(_pick(rec, ESTIMATE_KEYS), per_pomodoro)

        manba_id = rec.get("id") if isinstance(rec, dict) else None
        if manba_id is None and isinstance(rec, dict):
            manba_id = rec.get("ID")
        manba_url = rec.get("url") if isinstance(rec, dict) else None
        if manba_url is None and isinstance(rec, dict):
            manba_url = rec.get("URL")

        created.append({
            "id": uid(),
            "userId": user["id"],
            "date": date,
            "title": title,
            "note": s_str(_matn(_pick(rec, NOTE_KEYS)), 1000),
            "category": "ish",
            "priority": priority,
            "plannedPomodoros": fallback if pom is None else pom,
            "completedPomodoros": 0,
            "focusSeconds": 0,
            "done": done,
            "order": order,
            "source": {
                "type": source_name,
                "key": s_str(_matn(manba_id), 60) or None,
                "url": s_str(_matn(manba_url), 300) or None,
            },
            "createdAt": _now_iso(),
            "completedAt": None,
        })
        order += 1

    if not created:
        return {"error": "Vazifa topilmadi — ustun nomlarini tekshiring (title / name / task)",
                "status": 400}
    db["tasks"].extend(created)
    persist()
    return {"imported": len(created), "skipped": skipped, "date": date}
