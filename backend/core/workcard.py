"""
Ish kartasi — profildagi «Umumiy» bo'limining yuqori qismi.

Node'dagi `lib/workcard.js` ning ko'chirmasi.

Hozirgi holat, kun chizig'i, bugungi yuklama va seriya bir joyda
hisoblanadi. Jamoa qo'shilganda aynan shu ma'lumot hamkasblarga
ko'rinadigan bo'ladi, shuning uchun mantiq alohida modulda turibdi.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from .actuals import _parse_iso
from .db import day_setup, get_db, user_work_schedule
from .task_rules import is_meet
from .util import js_round


def _pad(n) -> str:
    return str(n).rjust(2, "0")


def _to_min(t) -> int:
    parts = str(t or "0:0").split(":")
    try:
        h = int(parts[0])
    except (ValueError, IndexError):
        h = 0
    try:
        m = int(parts[1])
    except (ValueError, IndexError):
        m = 0
    return h * 60 + m


def _to_hhmm(minute) -> str:
    return f"{_pad(math.floor(minute / 60) % 24)}:{_pad(js_round(minute) % 60)}"


def _date_str(d: datetime | None = None) -> str:
    """Mahalliy sana — server va foydalanuvchi bir vaqt mintaqasida deb olinadi."""
    return (d or datetime.now()).date().isoformat()


def _shift_date(date: str, days: int) -> str:
    d = datetime.fromisoformat(date + "T12:00:00") + timedelta(days=days)
    return _date_str(d)


def _weekday(d: str) -> int:
    """JS `getDay()` — 0 = yakshanba."""
    return (datetime.fromisoformat(d + "T12:00:00").weekday() + 1) % 7


# ═══════════ Holat ═══════════

STATUS = {
    "ishlayapti": {"label": "Ishlayapti", "tone": "work"},
    "pauzada": {"label": "Pauzada", "tone": "pause"},
    "tanaffus": {"label": "Tanaffusda", "tone": "break"},
    "uchrashuv": {"label": "Uchrashuvda", "tone": "meet"},
    "tushlik": {"label": "Tushlikda", "tone": "lunch"},
    "bosh": {"label": "Ish vaqtida, bo'sh", "tone": "idle"},
    "tashqarida": {"label": "Ish vaqtidan tashqari", "tone": "off"},
}


def _current_status(user_id, setup: dict, now_min: int, date: str) -> dict:
    """
    Hozirgi holatni taymer va ish jadvalidan aniqlaydi.
    Taymer ustuvor: ishlayotgan odam tushlik vaqtida ham "ishlayapti".
    """
    db = get_db()
    open_t = db["timers"].get(user_id)
    lst = open_t if isinstance(open_t, list) else ([open_t] if open_t else [])

    # Ikkita taymer ochiq bo'lishi mumkin: ishlayotgani ustuvor,
    # undan keyin ish rejimi, oxirida qolganlari
    t = (next((x for x in lst if x.get("status") == "running" and x.get("mode") == "work"), None)
         or next((x for x in lst if x.get("mode") == "work"), None)
         or next((x for x in lst if x.get("status") == "running"), None)
         or (lst[0] if lst else None))

    if t:
        task = None
        if t.get("taskId"):
            task = next((x for x in db["tasks"]
                         if x.get("id") == t["taskId"] and x.get("userId") == user_id), None)
        paused = t.get("status") == "paused"
        now_ms = datetime.now().timestamp() * 1000
        elapsed = (t.get("elapsedSec") or 0)
        if t.get("status") == "running":
            elapsed += (now_ms - t["segmentStart"]) / 1000
        left = max(0, js_round((t.get("durationSec") or 0) - elapsed))

        if paused:
            key = "pauzada"
        elif t.get("mode") != "work":
            key = "tanaffus"
        elif task and is_meet(task.get("category")):
            key = "uchrashuv"
        else:
            key = "ishlayapti"

        return {"key": key, "taskTitle": (task or {}).get("title") or "",
                "remainingSec": left, "mode": t.get("mode")}

    if not setup.get("isWorkday"):
        return {"key": "tashqarida", "taskTitle": "", "remainingSec": None, "mode": None}

    start = _to_min(setup.get("startTime"))
    end = _to_min(setup.get("endTime"))
    if not (start <= now_min < end):
        return {"key": "tashqarida", "taskTitle": "", "remainingSec": None, "mode": None}

    if setup.get("lunchEnabled"):
        ls, le = _to_min(setup.get("lunchStart")), _to_min(setup.get("lunchEnd"))
        if ls <= now_min < le:
            return {"key": "tushlik", "taskTitle": "",
                    "remainingSec": (le - now_min) * 60, "mode": None}

    return {"key": "bosh", "taskTitle": "", "remainingSec": None, "mode": None}


# ═══════════ Seriya ═══════════

def streak_of(user_id, today: str | None = None) -> dict:
    """
    Ketma-ket ish kunlari.

    Dam olish kunlari seriyani uzmaydi — ular shunchaki o'tkazib yuboriladi.
    Bugun hali pomodoro qilinmagan bo'lsa ham seriya uzilmaydi: hisob
    kechagi kundan boshlanadi, aks holda har kuni ertalab nol ko'rinardi.
    """
    today = today or _date_str()
    db = get_db()
    week = user_work_schedule(user_id)

    def is_workday(d: str) -> bool:
        return bool((week.get(_weekday(d)) or {}).get("enabled"))

    active = {s["date"] for s in db["sessions"]
              if s.get("userId") == user_id and s.get("mode") == "work" and s.get("completed")}

    current = 0
    day = today if today in active else _shift_date(today, -1)

    # Bir yildan uzoq orqaga qaramaymiz — bu yetarli va tez
    for _ in range(400):
        if not is_workday(day):
            day = _shift_date(day, -1)
            continue
        if day not in active:
            break
        current += 1
        day = _shift_date(day, -1)

    # Eng uzun seriya — barcha faol kunlar bo'yicha
    best = 0
    run = 0
    prev = None
    for d in sorted(active):
        if prev is None:
            run = 1
        else:
            # Oradagi kunlar faqat dam olish bo'lsa seriya davom etadi
            gap_ok = True
            x = _shift_date(prev, 1)
            guard = 0
            while x != d and guard < 31:
                guard += 1
                if is_workday(x):
                    gap_ok = False
                    break
                x = _shift_date(x, 1)
            run = run + 1 if gap_ok else 1
        best = max(best, run)
        prev = d

    return {"current": current, "best": max(best, current)}


# ═══════════ Haftalik natijalar ═══════════

KUNLAR = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"]


def _week_start(date: str) -> str:
    """Shu sana tushgan haftaning dushanbasi."""
    shift = (_weekday(date) + 6) % 7          # dushanba = 0
    return _shift_date(date, -shift)


def _best_hours(sessions: list, today: str):
    """
    Eng samarali oraliq — ikki soatlik oyna.
    Oxirgi 30 kundagi tugallangan pomodorolar bo'yicha: uzoq o'tmish
    odamning hozirgi odatini aks ettirmaydi.
    """
    frm = _shift_date(today, -29)
    by_hour = [0] * 24
    total = 0

    for s in sessions:
        if s["date"] < frm or s["date"] > today:
            continue
        d = _parse_iso(s.get("startedAt"))
        if d is None:
            continue
        h = d.hour
        if 0 <= h < 24:
            by_hour[h] += 1
            total += 1

    if total < 3:
        return None                 # xulosa chiqarish uchun juda kam

    best = 0
    best_sum = -1
    best_head = -1
    for h in range(23):
        s2 = by_hour[h] + by_hour[h + 1]
        # Teng bo'lsa birinchi soati kuchliroq oyna tanlanadi: aks holda
        # hamma ish 10:00 da bo'lsa ham oyna «09:00–11:00» bo'lib chiqardi
        if s2 > best_sum or (s2 == best_sum and by_hour[h] > best_head):
            best_sum = s2
            best_head = by_hour[h]
            best = h

    if best_sum <= 0:
        return None

    return {
        "fromHour": best,
        "toHour": best + 2,
        "from": _pad(best) + ":00",
        "to": _pad(best + 2) + ":00",
        "pomodoros": best_sum,
        "share": js_round((best_sum / total) * 100),
    }


def _category_split(sessions: list, tasks_by_id: dict) -> list:
    """Kategoriyalar bo'yicha taqsimot."""
    rows: dict = {}
    total = 0.0
    for s in sessions:
        cat = (tasks_by_id.get(s.get("taskId")) or {}).get("category") or "boshqa"
        minutes = (s.get("actualSec") or 0) / 60
        row = rows.get(cat) or {"category": cat, "minutes": 0, "pomodoros": 0}
        row["minutes"] += minutes
        row["pomodoros"] += 1
        rows[cat] = row
        total += minutes

    out = [{**c, "minutes": js_round(c["minutes"]),
            "percent": js_round((c["minutes"] / total) * 100) if total else 0}
           for c in rows.values()]
    # JS `sort` barqaror — teng qiymatlarda kiritilish tartibi saqlanadi
    out.sort(key=lambda c: -c["minutes"])
    return out


def week_results(user_id, today: str | None = None) -> dict:
    """
    Profil uchun qisqa natijalar: shu hafta, eng samarali vaqt va
    kategoriya taqsimoti. Chuqur tahlil «Statistika» bo'limida qoladi.
    """
    today = today or _date_str()
    db = get_db()
    mine = [s for s in db["sessions"]
            if s.get("userId") == user_id and s.get("mode") == "work" and s.get("completed")]
    tasks_by_id = {t["id"]: t for t in db["tasks"] if t.get("userId") == user_id}

    start = _week_start(today)
    end = _shift_date(start, 6)
    prev_start = _shift_date(start, -7)

    def day_row(date: str) -> dict:
        lst = [s for s in mine if s["date"] == date]
        return {
            "date": date,
            "weekday": KUNLAR[_weekday(date)],
            "pomodoros": len(lst),
            "focusMinutes": js_round(sum((s.get("actualSec") or 0) / 60 for s in lst)),
            "isToday": date == today,
            "isFuture": date > today,
        }

    days = [day_row(_shift_date(start, i)) for i in range(7)]
    week_sessions = [s for s in mine if start <= s["date"] <= end]
    prev_sessions = [s for s in mine if prev_start <= s["date"] < start]

    def total(lst):
        return {"pomodoros": len(lst),
                "focusMinutes": js_round(sum((s.get("actualSec") or 0) / 60 for s in lst))}

    week = total(week_sessions)
    prev = total(prev_sessions)

    return {
        "week": {"from": start, "to": end, "days": days, **week},
        "prevWeek": prev,
        "changePercent": (js_round(((week["focusMinutes"] - prev["focusMinutes"])
                                    / prev["focusMinutes"]) * 100)
                          if prev["focusMinutes"] > 0 else None),
        "bestHours": _best_hours(mine, today),
        "categories": _category_split(week_sessions, tasks_by_id),
    }


# ═══════════ Karta ═══════════

def work_card(user_id, today: str | None = None) -> dict:
    today = today or _date_str()
    db = get_db()
    setup = day_setup(user_id, today)
    now = datetime.now()
    now_min = now.hour * 60 + now.minute

    my_tasks = [t for t in db["tasks"] if t.get("userId") == user_id and t.get("date") == today]
    planned = sum(0 if t.get("meetStart") else (t.get("plannedPomodoros") or 0) for t in my_tasks)
    done = sum((t.get("completedPomodoros") or 0) for t in my_tasks)

    today_sessions = [s for s in db["sessions"]
                      if s.get("userId") == user_id and s.get("date") == today
                      and s.get("mode") == "work"]
    focus_sec = sum((s.get("actualSec") or 0) for s in today_sessions)

    all_work = [s for s in db["sessions"]
                if s.get("userId") == user_id and s.get("mode") == "work" and s.get("completed")]

    status = _current_status(user_id, setup, now_min, today)

    return {
        "date": today,
        "status": {**status, **STATUS[status["key"]]},

        "day": {
            "isWorkday": setup["isWorkday"],
            "weekdayName": setup["weekdayName"],
            "start": setup["startTime"],
            "end": setup["endTime"],
            "startMin": _to_min(setup["startTime"]),
            "endMin": _to_min(setup["endTime"]),
            "lunchEnabled": bool(setup["lunchEnabled"]),
            "lunchStart": setup["lunchStart"],
            "lunchEnd": setup["lunchEnd"],
            "lunchStartMin": _to_min(setup["lunchStart"]),
            "lunchEndMin": _to_min(setup["lunchEnd"]),
            "nowMin": now_min,
            "now": _to_hhmm(now_min),
        },

        "today": {
            "plannedPomodoros": planned,
            "donePomodoros": done,
            "tasks": len(my_tasks),
            "doneTasks": sum(1 for t in my_tasks
                             if (t.get("status") or ("bajarildi" if t.get("done") else "reja")) == "bajarildi"),
            "focusMinutes": js_round(focus_sec / 60),
        },

        "streak": streak_of(user_id, today),
        "results": week_results(user_id, today),

        "totals": {
            "pomodoros": len(all_work),
            "focusHours": js_round(sum((s.get("actualSec") or 0) for s in all_work) / 360) / 10,
            "activeDays": len({s["date"] for s in all_work}),
        },
    }
