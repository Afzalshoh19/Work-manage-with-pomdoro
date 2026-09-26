"""Vazifalar, kun rejasi va ko'p kunlik rejalashtirish. Node'dagi `routes/tasks.js`."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from ..core.actuals import _parse_iso, with_actuals
from ..core.db import (
    STATUS_LABELS, TASK_STATUSES, day_setup, get_db, persist, set_day_setup,
    user_settings, user_work_schedule, weekday_of,
)
from ..core.plan import build_schedule
from ..core.task_rules import (
    BREAK_PLACEMENTS, CATEGORIES, HHMM, check_lunch, is_meet,
)
from ..core.util import (
    add_days, clamp, is_date, prop, s_str, today_local, uid,
)

PRIORITIES = ["past", "orta", "yuqori"]

# Bajarilgan vazifada o'zgartirib bo'lmaydigan maydonlar
FROZEN_FIELDS = ["title", "note", "category", "priority",
                 "plannedPomodoros", "completedPomodoros", "date"]

# Hisobotni to'g'rlash sabablari
CORRECTION_REASONS = {
    "tizim": "Tizim ishlamadi",
    "unutdim": "Taymerni bosish esdan chiqdi",
    "yigilish": "Yig'ilish / uchrashuv",
    "oflayn": "Kompyuterdan tashqarida ishladim",
    "boshqa": "Boshqa sabab",
}


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _iso(d: datetime) -> str:
    u = d.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def _pad(t) -> str:
    return str(t).strip().rjust(5, "0")


def _mins(t) -> int:
    parts = str(t).split(":")
    try:
        h = int(parts[0])
    except (ValueError, IndexError):
        h = 0
    try:
        m = int(parts[1])
    except (ValueError, IndexError):
        m = 0
    return h * 60 + m


def _coalesce(a, b):
    """JS `a ?? b` — faqat `None` da zaxiraga o'tadi."""
    return b if a is None else a


def _order_max(tasks) -> int:
    """Keyingi `order` qiymati."""
    if not tasks:
        return 0
    return max((t.get("order") if t.get("order") is not None else 0) for t in tasks) + 1


def _parse_meet(body: dict, current: dict | None = None) -> dict:
    """Uchrashuv maydonlarini tekshiradi va tozalaydi."""
    current = current or {}
    start = _pad(s_str(_coalesce(body.get("meetStart"), current.get("meetStart")), 5))
    end = _pad(s_str(_coalesce(body.get("meetEnd"), current.get("meetEnd")), 5))
    if not HHMM.match(start):
        return {"error": "Uchrashuv boshlanish vaqti notogri (soat:daqiqa)"}
    if not HHMM.match(end):
        return {"error": "Uchrashuv tugash vaqti notogri (soat:daqiqa)"}

    s = _mins(start)
    e = _mins(end)
    if e <= s:
        e += 1440                       # yarim tundan oshishi mumkin
    uzunlik = e - s
    if uzunlik < 5:
        return {"error": "Uchrashuv kamida 5 daqiqa bo'lishi kerak"}
    if uzunlik > 12 * 60:
        return {"error": "Uchrashuv 12 soatdan uzun bo'lmasligi kerak"}

    src = _coalesce(body.get("meetBreak"), current.get("meetBreak")) or {}
    yoqilgan = bool(src.get("enabled"))
    joy = src.get("placement") if src.get("placement") in BREAK_PLACEMENTS else "ortasida"
    davomiylik = clamp(_coalesce(src.get("minutes"), 10), 1, 240)

    if yoqilgan and davomiylik >= uzunlik:
        return {"error": "Tanaffus uchrashuvdan qisqa bo'lishi kerak"}

    at = None
    if yoqilgan and joy == "vaqt":
        at = _pad(s_str(src.get("at"), 5))
        if not HHMM.match(at):
            return {"error": "Tanaffus boshlanish vaqti notogri (soat:daqiqa)"}
        a = _mins(at)
        while a < s:
            a += 1440
        if a < s or a + davomiylik > e:
            return {"error": f"Tanaffus uchrashuv ichida bo'lishi kerak ({start}–{end})"}

    return {"meet": {
        "meetStart": start,
        "meetEnd": end,
        "meetBreak": {"enabled": yoqilgan, "placement": joy,
                      "minutes": davomiylik, "at": at},
    }}


def _norm_category(c) -> str:
    c = s_str(c, 20).lower()
    return c if c in CATEGORIES else "ish"


def day_tasks(user_id, date: str) -> list:
    """
    Kun vazifalari. Bajarilganlari ro'yxat oxiriga tushadi — kun davomida
    ko'z oldida faqat qolgan ishlar turadi. `order` maydoni o'zgarmaydi,
    faqat ko'rsatish tartibi shunday.
    """
    mine = [t for t in get_db()["tasks"]
            if t.get("userId") == user_id and t.get("date") == date]
    return sorted(mine, key=lambda t: (1 if t.get("status") == "bajarildi" else 0,
                                       t.get("order") if t.get("order") is not None else 0))


def _own_task(user, task_id):
    return next((t for t in get_db()["tasks"]
                 if t.get("id") == task_id and t.get("userId") == user["id"]), None)


# ═══════════ Kun rejasi ═══════════

def get_plan(ctx):
    user = ctx["user"]
    date = ctx["query"].get("date") if is_date(ctx["query"].get("date")) else today_local()
    setup = day_setup(user["id"], date)
    tasks = [with_actuals(t, date) for t in day_tasks(user["id"], date)]
    plan = build_schedule(tasks, user_settings(user["id"]), setup)
    return {"date": date, "setup": setup, **plan}


def set_plan_window(ctx):
    """
    Shu kunning sozlamasi: ish vaqti oralig'i, pomodoro va tanaffus
    davomiyligi, uzun tanaffus oralig'i. Faqat yuborilgan maydonlar o'zgaradi.
    """
    user, body = ctx["user"], (ctx["body"] or {})
    date = body.get("date") if is_date(body.get("date")) else today_local()

    if body.get("reset"):
        set_day_setup(user["id"], date, None)
        return get_plan({**ctx, "query": {"date": date}})

    patch = {}

    if "startTime" in body or "endTime" in body:
        current = day_setup(user["id"], date)
        start = _pad(s_str(_coalesce(body.get("startTime"), current["startTime"]), 5))
        end = _pad(s_str(_coalesce(body.get("endTime"), current["endTime"]), 5))
        if not HHMM.match(start):
            return {"error": "Boshlanish vaqti notogri (soat:daqiqa ko'rinishida)", "status": 400}
        if not HHMM.match(end):
            return {"error": "Tugash vaqti notogri (soat:daqiqa ko'rinishida)", "status": 400}
        if start == end:
            return {"error": "Boshlanish va tugash vaqti bir xil bo'lmasligi kerak", "status": 400}
        patch["startTime"] = start
        patch["endTime"] = end

    if "workMinutes" in body:
        patch["workMinutes"] = clamp(body["workMinutes"], 1, 180)
    if "shortBreakMinutes" in body:
        patch["shortBreakMinutes"] = clamp(body["shortBreakMinutes"], 0, 60)
    if "longBreakMinutes" in body:
        patch["longBreakMinutes"] = clamp(body["longBreakMinutes"], 0, 120)
    if "longBreakInterval" in body:
        patch["longBreakInterval"] = clamp(body["longBreakInterval"], 2, 12)

    if "lunchEnabled" in body:
        patch["lunchEnabled"] = bool(body["lunchEnabled"])
    if "lunchStart" in body or "lunchEnd" in body:
        cur = day_setup(user["id"], date)
        ls = _pad(s_str(_coalesce(body.get("lunchStart"), cur["lunchStart"]), 5))
        le = _pad(s_str(_coalesce(body.get("lunchEnd"), cur["lunchEnd"]), 5))
        err = check_lunch(ls, le,
                          _coalesce(patch.get("startTime"), cur["startTime"]),
                          _coalesce(patch.get("endTime"), cur["endTime"]))
        if err:
            return {"error": err, "status": 400}
        patch["lunchStart"] = ls
        patch["lunchEnd"] = le

    if not patch:
        return {"error": "O'zgartirish uchun maydon yuborilmadi", "status": 400}

    set_day_setup(user["id"], date, patch)
    return get_plan({**ctx, "query": {"date": date}})


# ═══════════ Vazifalar ═══════════

def create_task(ctx):
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    date = body.get("date") if is_date(body.get("date")) else today_local()
    title = s_str(body.get("title"), 200)
    if not title:
        return {"error": "Vazifa nomi bo'sh bo'lmasligi kerak", "status": 400}

    siblings = day_tasks(user["id"], date)
    task = {
        "id": uid(),
        "userId": user["id"],
        "date": date,
        "title": title,
        "note": s_str(body.get("note"), 1000),
        "category": _norm_category(body.get("category")),
        "priority": body["priority"] if body.get("priority") in PRIORITIES else "orta",
        "plannedPomodoros": clamp(_coalesce(body.get("plannedPomodoros"), 1), 1, 30),
        "completedPomodoros": 0,
        "focusSeconds": 0,
        "status": "reja",
        "done": False,
        "order": _order_max(siblings),
        # masalan: { type:'jira', key:'PRJ-12', url:'...' }
        "source": body.get("source") or None,
        "createdAt": _now_iso(),
        "completedAt": None,
    }

    # Uchrashuv bo'lsa vaqti belgilanishi shart — pomodoro soni o'rniga shu ishlatiladi
    if is_meet(task["category"]):
        m = _parse_meet(body)
        if m.get("error"):
            return {"error": m["error"], "status": 400}
        task.update(m["meet"])
        task["plannedPomodoros"] = 1

    db["tasks"].append(task)
    persist()
    return {"task": task}


def set_status(task: dict, status: str) -> dict:
    """Holatni o'zgartirish — `done` bayrog'i bilan mos saqlanadi."""
    task["status"] = status
    task["done"] = status == "bajarildi"
    task["completedAt"] = (task.get("completedAt") or _now_iso()) if task["done"] else None
    return task


def category_list(ctx=None):
    LABELS = {"ish": "Ish", "oqish": "O'qish", "loyiha": "Loyiha", "uy": "Uy ishlari",
              "sport": "Sport", "meet": "Meet", "uchrashuv": "Uchrashuv", "boshqa": "Boshqa"}
    return {
        "categories": [{"key": k, "label": LABELS[k], "meet": is_meet(k)} for k in CATEGORIES],
        "breakPlacements": [{"key": k, "label": v} for k, v in BREAK_PLACEMENTS.items()],
    }


def status_list(ctx=None):
    return {"statuses": [{"key": s, "label": STATUS_LABELS[s]} for s in TASK_STATUSES]}


def update_task(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    task = _own_task(user, ctx["params"]["id"])
    if not task:
        return {"error": "Vazifa topilmadi", "status": 404}

    # Bajarilgan vazifa qulflanadi. Holatni o'zgartirish (qayta ochish) mumkin
    if task.get("status") == "bajarildi" and any(f in body for f in FROZEN_FIELDS):
        return {"error": "Bajarilgan vazifani tahrirlab bo'lmaydi. "
                         "Avval «Qayta ochish» (↩) tugmasini bosing.", "status": 409}

    if "title" in body:
        t = s_str(body["title"], 200)
        if t:
            task["title"] = t
    if "note" in body:
        task["note"] = s_str(body["note"], 1000)
    if "category" in body:
        task["category"] = _norm_category(body["category"])

    # Uchrashuv maydonlari: kategoriya uchrashuvga o'tsa yoki vaqt yuborilsa
    meet_touched = ("meetStart" in body or "meetEnd" in body or "meetBreak" in body)
    if is_meet(task.get("category")) and (meet_touched or not task.get("meetStart")):
        m = _parse_meet(body, task)
        if m.get("error"):
            return {"error": m["error"], "status": 400}
        task.update(m["meet"])
        task["plannedPomodoros"] = 1
    elif not is_meet(task.get("category")):
        # Oddiy vazifaga qaytdi — uchrashuv maydonlari kerak emas
        task.pop("meetStart", None)
        task.pop("meetEnd", None)
        task.pop("meetBreak", None)

    if "priority" in body and body["priority"] in PRIORITIES:
        task["priority"] = body["priority"]
    if "plannedPomodoros" in body:
        task["plannedPomodoros"] = clamp(body["plannedPomodoros"], 1, 30)
    if "completedPomodoros" in body:
        task["completedPomodoros"] = clamp(body["completedPomodoros"], 0, 99)
    if "date" in body and is_date(body["date"]):
        task["date"] = body["date"]
    if "status" in body and body["status"] in TASK_STATUSES:
        set_status(task, body["status"])
    if "done" in body:
        if body["done"]:
            set_status(task, "bajarildi")
        else:
            set_status(task, "jarayonda" if (task.get("completedPomodoros") or 0) > 0 else "reja")

    persist()
    return {"task": task}


def delete_task(ctx):
    db = get_db()
    user = ctx["user"]
    i = next((k for k, t in enumerate(db["tasks"])
              if t.get("id") == ctx["params"]["id"] and t.get("userId") == user["id"]), -1)
    if i == -1:
        return {"error": "Vazifa topilmadi", "status": 404}
    removed = db["tasks"].pop(i)

    # Ochiq taymerlarda shu vazifa qolib ketmasin (ikkitagacha bo'lishi mumkin)
    open_t = db["timers"].get(user["id"])
    lst = open_t if isinstance(open_t, list) else ([open_t] if open_t else [])
    for t in lst:
        if t.get("taskId") == removed["id"]:
            t["taskId"] = None

    persist()
    return {"ok": True}


def reorder_tasks(ctx):
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    for idx, tid in enumerate(ids):
        t = next((x for x in db["tasks"]
                  if x.get("id") == tid and x.get("userId") == user["id"]), None)
        if t:
            t["order"] = idx
    persist()
    return {"ok": True}


def copy_plan(ctx):
    """Boshqa kundagi rejani shu kunga nusxalash."""
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    to = body.get("to") if is_date(body.get("to")) else today_local()
    frm = body.get("from") if is_date(body.get("from")) else add_days(to, -1)

    source = day_tasks(user["id"], frm)
    if not source:
        return {"error": f"{frm} sanasida vazifa topilmadi", "status": 400}

    order = _order_max(day_tasks(user["id"], to))
    created = []
    for t in source:
        created.append({
            "id": uid(), "userId": user["id"], "date": to,
            "title": t.get("title"), "note": t.get("note"), "category": t.get("category"),
            "priority": t.get("priority"), "plannedPomodoros": t.get("plannedPomodoros"),
            "completedPomodoros": 0, "focusSeconds": 0, "status": "reja", "done": False,
            "order": order, "source": t.get("source") or None,
            "createdAt": _now_iso(), "completedAt": None,
        })
        order += 1

    db["tasks"].extend(created)
    persist()
    return {"created": len(created)}


def correction_reasons(ctx=None):
    return {"reasons": [{"key": k, "label": v} for k, v in CORRECTION_REASONS.items()]}


def log_pomodoros(ctx):
    """
    Bajarilgan pomodoroni qo'lda yozish — hisobotni to'g'rlash.
    Har bir pomodoro uchun seans yozuvi yaratiladi va sababi bilan saqlanadi.
    """
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    task = _own_task(user, ctx["params"]["id"])
    if not task:
        return {"error": "Vazifa topilmadi", "status": 404}

    # Bajarilgan vazifa qulflangan — uning hisoboti ham o'zgarmaydi
    if task.get("status") == "bajarildi":
        return {"error": "Bajarilgan vazifa hisobotini to'g'rlab bo'lmaydi. "
                         "Avval «Qayta ochish» tugmasini bosing.",
                "status": 409, "code": "TASK_LOCKED"}

    reason_key = body.get("reason") if body.get("reason") in CORRECTION_REASONS else None
    if not reason_key:
        return {"error": "To'g'rlash sababini tanlang", "status": 400}
    note = s_str(body.get("reasonNote"), 300)
    if reason_key == "boshqa" and not note:
        return {"error": "«Boshqa sabab» tanlansa, izoh yozilishi shart", "status": 400}
    reason_label = CORRECTION_REASONS[reason_key]

    count = clamp(_coalesce(body.get("pomodoros"), 1), 1, 20)
    setup = day_setup(user["id"], task["date"])
    minutes = clamp(_coalesce(body.get("minutes"), setup["workMinutes"]), 1, 180)

    # Boshlanish vaqti: berilgan bo'lsa o'sha, aks holda hozirdan orqaga
    start = _parse_iso(body["startedAt"]) if body.get("startedAt") else None
    if start is None:
        start = datetime.now(timezone.utc) - timedelta(minutes=count * minutes)

    created = []
    for i in range(count):
        frm = start + timedelta(minutes=i * minutes)
        to = frm + timedelta(minutes=minutes)
        rec = {
            "id": uid(), "userId": user["id"], "date": task["date"], "mode": "work",
            "taskId": task["id"], "taskTitle": task["title"],
            "plannedSec": minutes * 60, "actualSec": minutes * 60,
            "pausedSec": 0, "pauseCount": 0, "completed": True,
            "manual": True,                      # qo'lda kiritilgani belgilanadi
            "reason": reason_key, "reasonLabel": reason_label, "reasonNote": note,
            "startedAt": _iso(frm), "endedAt": _iso(to),
        }
        db["sessions"].append(rec)
        created.append(rec)

    task["completedPomodoros"] = (task.get("completedPomodoros") or 0) + count
    task["focusSeconds"] = (task.get("focusSeconds") or 0) + count * minutes * 60
    if not task.get("startedAt"):
        task["startedAt"] = _iso(start)

    # Tuzatishlar tarixi — hisobotda vazifa yonida ko'rsatiladi
    if not isinstance(task.get("corrections"), list):
        task["corrections"] = []
    task["corrections"].append({
        "at": _now_iso(), "pomodoros": count, "minutes": minutes,
        "reason": reason_key, "reasonLabel": reason_label, "reasonNote": note,
        "from": created[0]["startedAt"], "to": created[-1]["endedAt"],
    })

    # Holat taymerdagi kabi o'zgaradi
    if task.get("status") != "bajarildi":
        task["status"] = ("qabulga"
                          if task["completedPomodoros"] >= (task.get("plannedPomodoros") or 0)
                          else "jarayonda")
        task["done"] = False

    persist()
    return {
        "logged": count, "minutes": minutes,
        "reason": reason_key, "reasonLabel": reason_label, "reasonNote": note,
        "task": {"id": task["id"], "title": task["title"],
                 "completedPomodoros": task["completedPomodoros"], "status": task["status"]},
        "from": created[0]["startedAt"], "to": created[-1]["endedAt"],
    }


def copy_tasks(ctx):
    """
    Alohida vazifa(lar)ni boshqa kunga nusxalash.
    Asl vazifa joyida qoladi, nusxa toza holatda ("reja", 0 pomodoro) yaratiladi.
    """
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    if isinstance(body.get("ids"), list):
        ids = body["ids"]
    else:
        ids = [body["id"]] if body.get("id") else []
    if not ids:
        return {"error": "Nusxalanadigan vazifa tanlanmadi", "status": 400}

    to = body.get("to") if is_date(body.get("to")) else add_days(today_local(), 1)

    # Tartibni asl ko'rinishida saqlaymiz
    source = [t for t in (next((x for x in db["tasks"]
                                if x.get("id") == i and x.get("userId") == user["id"]), None)
                          for i in ids) if t]
    source.sort(key=lambda t: t["date"] + str(t.get("order") if t.get("order") is not None else 0))

    if not source:
        return {"error": "Vazifa topilmadi", "status": 404}

    order = _order_max(day_tasks(user["id"], to))
    created = []
    for t in source:
        created.append({
            "id": uid(), "userId": user["id"], "date": to,
            "title": t.get("title"), "note": t.get("note"), "category": t.get("category"),
            "priority": t.get("priority"), "plannedPomodoros": t.get("plannedPomodoros"),
            "completedPomodoros": 0, "focusSeconds": 0, "pausedSeconds": 0,
            "pauses": [], "startedAt": None, "status": "reja", "done": False,
            "order": order, "source": t.get("source") or None,
            "createdAt": _now_iso(), "completedAt": None,
        })
        order += 1

    db["tasks"].extend(created)
    persist()
    return {"created": len(created), "to": to, "titles": [t["title"] for t in created]}


def carry_over(ctx):
    """Bajarilmagan vazifalarni ertangi kunga ko'chirish."""
    user, body = ctx["user"], (ctx["body"] or {})
    frm = body.get("from") if is_date(body.get("from")) else today_local()
    to = body.get("to") if is_date(body.get("to")) else add_days(frm, 1)

    pending = [t for t in day_tasks(user["id"], frm) if not t.get("done")]
    if not pending:
        return {"error": "Ko'chiriladigan bajarilmagan vazifa yo'q", "status": 400}

    order = _order_max(day_tasks(user["id"], to))
    for t in pending:
        t["date"] = to
        t["order"] = order
        order += 1

    persist()
    return {"moved": len(pending), "to": to}


# ═══════════ Ko'p kunlik (haftalik) reja ═══════════

def get_plan_range(ctx):
    """Bir necha kunning yuklamasi — haftalik rejalashtirish oynasi uchun."""
    user, query = ctx["user"], ctx["query"]
    frm = query.get("from") if is_date(query.get("from")) else today_local()
    to = query.get("to") if is_date(query.get("to")) else add_days(frm, 6)
    settings = user_settings(user["id"])

    days = []
    cur = frm
    guard = 0
    while cur <= to and guard < 60:
        guard += 1
        setup = day_setup(user["id"], cur)
        tasks = day_tasks(user["id"], cur)
        summary = build_schedule(tasks, settings, setup)["summary"]
        days.append({
            "date": cur,
            "isWorkday": setup["isWorkday"],
            "weekdayName": setup["weekdayName"],
            "startTime": setup["startTime"],
            "endTime": setup["endTime"],
            "availableMinutes": summary["availableMinutes"],
            "workableMinutes": summary["workableMinutes"],
            "lunch": summary["lunch"],
            "capacityPomodoros": summary["capacityPomodoros"],
            "totalPomodoros": summary["totalPomodoros"],
            "completedPomodoros": summary["completedPomodoros"],
            "totalMinutes": summary["totalMinutes"],
            "freeMinutes": summary["freeMinutes"],
            "fits": summary["fits"],
            "utilizationPercent": summary["utilizationPercent"],
            "tasks": [{
                "id": prop(t, "id"), "title": prop(t, "title"),
                "category": prop(t, "category"), "priority": prop(t, "priority"),
                "plannedPomodoros": prop(t, "plannedPomodoros"),
                "completedPomodoros": prop(t, "completedPomodoros"),
                "status": t.get("status") or "reja", "done": bool(t.get("done")),
            } for t in tasks],
        })
        cur = add_days(cur, 1)

    return {"from": frm, "to": to, "days": days}


def bulk_add_tasks(ctx):
    """Bitta vazifani bir necha kunga birdaniga qo'shish."""
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})

    dates = [d for d in body["dates"] if is_date(d)] if isinstance(body.get("dates"), list) else []
    if isinstance(body.get("items"), list):
        items = body["items"]
    else:
        items = [body] if body.get("title") else []

    if not dates:
        return {"error": "Kamida bitta kun tanlang", "status": 400}
    if not items:
        return {"error": "Kamida bitta vazifa kiriting", "status": 400}

    created = []
    for date in dates[:60]:
        order = _order_max(day_tasks(user["id"], date))
        for item in items[:30]:
            title = s_str(item.get("title"), 200)
            if not title:
                continue
            created.append({
                "id": uid(), "userId": user["id"], "date": date, "title": title,
                "note": s_str(item.get("note"), 1000),
                "category": _norm_category(item.get("category")),
                "priority": item["priority"] if item.get("priority") in PRIORITIES else "orta",
                "plannedPomodoros": clamp(_coalesce(item.get("plannedPomodoros"), 1), 1, 30),
                "completedPomodoros": 0, "focusSeconds": 0, "status": "reja", "done": False,
                "order": order, "source": None,
                "createdAt": _now_iso(), "completedAt": None,
            })
            order += 1

    if not created:
        return {"error": "Vazifa nomi bo'sh bo'lmasligi kerak", "status": 400}
    db["tasks"].extend(created)
    persist()
    return {"created": len(created), "days": len(dates)}


def workdays_in_range(ctx):
    """Haftalik jadvaldagi ish kunlarini oraliqdan ajratib beradi."""
    user, query = ctx["user"], ctx["query"]
    frm = query.get("from") if is_date(query.get("from")) else today_local()
    to = query.get("to") if is_date(query.get("to")) else add_days(frm, 6)
    week = user_work_schedule(user["id"])

    out = []
    cur = frm
    guard = 0
    while cur <= to and guard < 60:
        guard += 1
        wd = weekday_of(cur)
        out.append({"date": cur, "weekday": wd,
                    "isWorkday": bool((week.get(wd) or {}).get("enabled"))})
        cur = add_days(cur, 1)

    return {"from": frm, "to": to, "days": out}
