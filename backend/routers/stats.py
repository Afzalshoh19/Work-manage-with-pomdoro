"""Statistika va tarix. Node'dagi `routes/stats.js`."""
from __future__ import annotations

from ..core.actuals import _parse_iso
from ..core.db import get_db, user_settings
from ..core.util import (
    add_days, clamp, days_between, is_date, js_round, prop, today_local,
)
from ..core.workcard import streak_of


def _round1(n):
    return js_round(n * 10) / 10


def get_stats(ctx):
    db = get_db()
    query, user = ctx["query"], ctx["user"]

    date = query.get("date") if is_date(query.get("date")) else today_local()
    days = clamp(query.get("days") if query.get("days") is not None else 30, 7, 365)
    frm = add_days(date, -(days - 1))

    mine = [s for s in db["sessions"] if s.get("userId") == user["id"]]
    my_tasks = [t for t in db["tasks"] if t.get("userId") == user["id"]]
    settings = user_settings(user["id"])
    work = [s for s in mine if s.get("mode") == "work"]
    in_range = [s for s in work if frm <= s.get("date", "") <= date]

    # Kunlik qator
    by_day = {d: {"date": d, "pomodoros": 0, "focusMinutes": 0, "interruptions": 0}
              for d in days_between(frm, date)}
    for s in in_range:
        row = by_day.get(s["date"])
        if not row:
            continue
        if s.get("completed"):
            row["pomodoros"] += 1
            row["focusMinutes"] += s["actualSec"] / 60
        else:
            row["interruptions"] += 1
    series = [{**r, "focusMinutes": js_round(r["focusMinutes"])} for r in by_day.values()]

    # Bugun
    today_sessions = [s for s in work if s["date"] == date]
    today_done = [s for s in today_sessions if s.get("completed")]
    breaks = [s for s in mine
              if s["date"] == date and s.get("mode") != "work" and s.get("completed")]
    today_tasks = [t for t in my_tasks if t.get("date") == date]
    planned = sum((t.get("plannedPomodoros") or 0) for t in today_tasks)

    today = {
        "date": date,
        "pomodoros": len(today_done),
        "focusMinutes": js_round(sum(s["actualSec"] for s in today_done) / 60),
        "breakMinutes": js_round(sum(s["actualSec"] for s in breaks) / 60),
        "interruptions": len(today_sessions) - len(today_done),
        "tasksTotal": len(today_tasks),
        "tasksDone": sum(1 for t in today_tasks if t.get("done")),
        "plannedPomodoros": planned,
        "planPercent": js_round((len(today_done) / planned) * 100) if planned else 0,
        "goal": settings["dailyGoal"],
        "goalPercent": js_round((len(today_done) / max(1, settings["dailyGoal"])) * 100),
    }

    done_in_range = [s for s in in_range if s.get("completed")]

    # Kategoriyalar
    task_by_id = {t["id"]: t for t in my_tasks}
    cat_rows: dict = {}
    for s in done_in_range:
        cat = (task_by_id.get(s.get("taskId")) or {}).get("category") or "boshqa"
        row = cat_rows.get(cat)
        if row is None:
            row = {"category": cat, "pomodoros": 0, "minutes": 0}
            cat_rows[cat] = row
        row["pomodoros"] += 1
        row["minutes"] += s["actualSec"] / 60
    categories = [{**c, "minutes": js_round(c["minutes"])} for c in cat_rows.values()]
    categories.sort(key=lambda c: -c["pomodoros"])

    # Eng ko'p vaqt ketgan vazifalar
    task_rows: dict = {}
    for s in done_in_range:
        key = s.get("taskTitle") or "(vazifasiz)"
        row = task_rows.get(key)
        if row is None:
            row = {"title": key, "pomodoros": 0, "minutes": 0}
            task_rows[key] = row
        row["pomodoros"] += 1
        row["minutes"] += s["actualSec"] / 60
    top_tasks = [{**t, "minutes": js_round(t["minutes"])} for t in task_rows.values()]
    top_tasks.sort(key=lambda t: -t["pomodoros"])
    top_tasks = top_tasks[:8]

    # Soatlar bo'yicha taqsimot
    hourly = [{"hour": h, "pomodoros": 0} for h in range(24)]
    for s in done_in_range:
        d = _parse_iso(s.get("startedAt"))
        if d is not None and 0 <= d.hour < 24:
            hourly[d.hour]["pomodoros"] += 1

    # Ketma-ket kunlar — hisob lib/workcard.js da, bitta joyda
    streak_info = streak_of(user["id"], date)

    all_done = [s for s in work if s.get("completed")]
    active_days = len({s["date"] for s in all_done})

    best = None
    for r in series:
        if r["pomodoros"] > (best["pomodoros"] if best else -1):
            best = r

    return {
        "today": today,
        "series": series,
        "categories": categories,
        "topTasks": top_tasks,
        "hourly": hourly,
        "streak": streak_info["current"],
        "streakBest": streak_info["best"],
        "totals": {
            "pomodoros": len(all_done),
            "focusHours": _round1(sum(s["actualSec"] for s in all_done) / 3600),
            "activeDays": active_days,
            "avgPerActiveDay": _round1(len(all_done) / active_days) if active_days else 0,
            "bestDay": best if (best and best["pomodoros"]) else None,
            "rangePomodoros": sum(r["pomodoros"] for r in series),
            "rangeFocusMinutes": sum(r["focusMinutes"] for r in series),
        },
        "range": {"from": frm, "to": date, "days": days},
    }


def get_history(ctx):
    db = get_db()
    query, user = ctx["query"], ctx["user"]

    to = query.get("to") if is_date(query.get("to")) else today_local()
    frm = query.get("from") if is_date(query.get("from")) else add_days(to, -29)

    dates = {s["date"] for s in db["sessions"]
             if s.get("userId") == user["id"] and frm <= s.get("date", "") <= to}
    dates |= {t["date"] for t in db["tasks"]
              if t.get("userId") == user["id"] and frm <= t.get("date", "") <= to}

    def order_of(t):
        o = t.get("order")
        return 0 if o is None else o

    days = []
    for date in sorted(dates, reverse=True):
        sessions = [s for s in db["sessions"]
                    if s.get("userId") == user["id"] and s["date"] == date]
        work_done = [s for s in sessions if s.get("mode") == "work" and s.get("completed")]
        tasks = sorted((t for t in db["tasks"]
                        if t.get("userId") == user["id"] and t.get("date") == date),
                       key=order_of)
        days.append({
            "date": date,
            "pomodoros": len(work_done),
            "focusMinutes": js_round(sum(s["actualSec"] for s in work_done) / 60),
            "breakMinutes": js_round(sum(s["actualSec"] for s in sessions
                                         if s.get("mode") != "work" and s.get("completed")) / 60),
            "interruptions": sum(1 for s in sessions
                                 if s.get("mode") == "work" and not s.get("completed")),
            "pauseMinutes": js_round(sum((s.get("pausedSec") or 0) for s in sessions) / 60),
            "pauseCount": sum((s.get("pauseCount") or 0) for s in sessions),
            # `prop` — JS `t.x`: maydon yo'q bo'lsa javobdan butunlay chiqadi
            "tasks": [{
                "id": prop(t, "id"), "title": prop(t, "title"),
                "category": prop(t, "category"),
                "plannedPomodoros": prop(t, "plannedPomodoros"),
                "completedPomodoros": prop(t, "completedPomodoros"),
                "done": prop(t, "done"),
                "focusMinutes": js_round((t.get("focusSeconds") or 0) / 60),
                "pauseMinutes": js_round((t.get("pausedSeconds") or 0) / 60),
            } for t in tasks],
        })

    return {"from": frm, "to": to, "days": days}
