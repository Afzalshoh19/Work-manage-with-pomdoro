"""Ma'lumotlarni eksport, import va tozalash. Node'dagi `routes/export.js`."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from ..core.actuals import _parse_iso
from ..core.db import DEFAULT_SETTINGS, get_db, persist, user_settings
from ..core.util import add_days, is_date, js_ready, js_round, today_local, uid


def _csv_cell(v) -> str:
    s = "" if v is None else str(v)
    if re.search(r'[",;\n]', s):
        return chr(34) + s.replace(chr(34), chr(34) * 2) + chr(34)
    return s


def _csv_row(arr) -> str:
    return ";".join(_csv_cell(x) for x in arr)


def _time_uz(iso) -> str:
    """JS `new Date(iso).toLocaleTimeString('uz-UZ')` — `HH:MM:SS`."""
    d = _parse_iso(iso)
    return d.strftime("%H:%M:%S") if d else ""


def export_data(ctx):
    db = get_db()
    query, user = ctx["query"], ctx["user"]

    to = query.get("to") if is_date(query.get("to")) else today_local()
    frm = query.get("from") if is_date(query.get("from")) else add_days(to, -364)
    fmt = "csv" if query.get("format") == "csv" else "json"

    tasks = [t for t in db["tasks"]
             if t.get("userId") == user["id"] and frm <= t.get("date", "") <= to]
    sessions = [s for s in db["sessions"]
                if s.get("userId") == user["id"] and frm <= s.get("date", "") <= to]
    stamp = f"{frm}_{to}"

    if fmt == "json":
        d = datetime.now(timezone.utc)
        body = json.dumps(js_ready({
            "exportedAt": d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z",
            "user": {"name": user.get("name"), "email": user.get("email")},
            "from": frm, "to": to,
            "settings": user_settings(user["id"]),
            "tasks": tasks, "sessions": sessions,
        }), indent=2, ensure_ascii=False)
        return {"__raw": {"contentType": "application/json; charset=utf-8",
                          "filename": f"pomodoro-{stamp}.json", "body": body}}

    lines = []
    lines.append(_csv_row(["TUR", "Sana", "Vazifa", "Kategoriya", "Rejalashtirilgan",
                           "Bajarilgan", "Holat", "Fokus (daq)", "Manba"]))
    for t in tasks:
        src = t.get("source")
        manba = f"{src['type']}:{src.get('key') or ''}" if src else ""
        lines.append(_csv_row(["VAZIFA", t.get("date"), t.get("title"), t.get("category"),
                               t.get("plannedPomodoros"), t.get("completedPomodoros"),
                               "Bajarildi" if t.get("done") else "Bajarilmadi",
                               js_round((t.get("focusSeconds") or 0) / 60), manba]))
    lines.append("")
    lines.append(_csv_row(["TUR", "Sana", "Vazifa", "Rejim", "Boshlandi", "Tugadi",
                           "Reja (daq)", "Amalda (daq)", "Holat"]))
    mode_uz = {"work": "Ish", "short": "Qisqa tanaffus", "long": "Uzun tanaffus"}
    for s in sessions:
        lines.append(_csv_row(["SESSIYA", s.get("date"), s.get("taskTitle") or "-",
                               mode_uz.get(s.get("mode"), s.get("mode")),
                               _time_uz(s.get("startedAt")), _time_uz(s.get("endedAt")),
                               js_round((s.get("plannedSec") or 0) / 60),
                               js_round((s.get("actualSec") or 0) / 60),
                               "Tugallandi" if s.get("completed") else "Uzildi"]))

    return {"__raw": {"contentType": "text/csv; charset=utf-8",
                      "filename": f"pomodoro-{stamp}.csv",
                      "body": "﻿" + "\r\n".join(lines)}}


def import_data(ctx):
    db = get_db()
    body, user = ctx["body"], ctx["user"]

    if not body or not isinstance(body.get("tasks"), list):
        return {"error": "Noto'g'ri fayl formati", "status": 400}
    mode = "replace" if body.get("mode") == "replace" else "merge"

    if mode == "replace":
        db["tasks"] = [t for t in db["tasks"] if t.get("userId") != user["id"]]
        db["sessions"] = [s for s in db["sessions"] if s.get("userId") != user["id"]]

    task_ids = {t["id"] for t in db["tasks"] if t.get("userId") == user["id"]}
    session_ids = {s["id"] for s in db["sessions"] if s.get("userId") == user["id"]}
    id_map: dict = {}
    added_tasks = 0
    added_sessions = 0

    for t in body["tasks"]:
        if not t or not t.get("title"):
            continue
        tid = t["id"] if (t.get("id") and t["id"] not in task_ids) else uid()
        if t.get("id"):
            id_map[t["id"]] = tid
        db["tasks"].append({**t, "id": tid, "userId": user["id"]})
        task_ids.add(tid)
        added_tasks += 1

    for s in (body.get("sessions") or []):
        if not s or not s.get("date"):
            continue
        sid = s["id"] if (s.get("id") and s["id"] not in session_ids) else uid()
        db["sessions"].append({**s, "id": sid, "userId": user["id"],
                               "taskId": id_map.get(s.get("taskId")) or s.get("taskId")})
        session_ids.add(sid)
        added_sessions += 1

    if body.get("settings") and mode == "replace":
        user["settings"] = {**DEFAULT_SETTINGS, **(user.get("settings") or {}), **body["settings"]}

    persist()
    return {"addedTasks": added_tasks, "addedSessions": added_sessions, "mode": mode}


def clear_data(ctx):
    db = get_db()
    user = ctx["user"]
    scope = (ctx["body"] or {}).get("scope")

    if scope == "all":
        db["tasks"] = [t for t in db["tasks"] if t.get("userId") != user["id"]]
        db["sessions"] = [s for s in db["sessions"] if s.get("userId") != user["id"]]
        db["dayPlans"] = [d for d in db["dayPlans"] if d.get("userId") != user["id"]]
        db["timers"].pop(user["id"], None)
        db["userState"][user["id"]] = {"pomodorosSinceLongBreak": 0, "lastCycleDate": None}
    elif scope == "sessions":
        db["sessions"] = [s for s in db["sessions"] if s.get("userId") != user["id"]]
    elif is_date(scope):
        db["tasks"] = [t for t in db["tasks"]
                       if not (t.get("userId") == user["id"] and t.get("date") == scope)]
        db["sessions"] = [s for s in db["sessions"]
                          if not (s.get("userId") == user["id"] and s.get("date") == scope)]
    else:
        return {"error": 'scope: "all" | "sessions" | "YYYY-MM-DD"', "status": 400}

    persist()
    return {"ok": True}
