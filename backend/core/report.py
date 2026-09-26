"""
Hisobot modeli va uni turli formatlarga aylantirish:
HTML (chop etish / PDF), Markdown, CSV, JSON, Confluence storage, Notion bloklari.

Node'dagi `lib/report.js` ning ko'chirmasi.

Saralashlar haqida: Node `localeCompare` ishlatadi. U oddiy kodpoint
solishtirishdan faqat harf registrida farq qiladi ("Vazifa" va "vazifa"),
bu yerdagi saralashlar esa sana va ISO vaqt satrlari ustida — demak
oddiy solishtirish bilan bir xil natija beradi.
"""
from __future__ import annotations

import calendar
import math
import re
from datetime import datetime, timezone

from .actuals import _parse_iso, with_actuals
from .avatars import is_icon_avatar
from .db import day_setup, get_db, user_settings
from .plan import build_schedule
from .util import add_days, days_between, is_date, js_round, today_local

CAT_LABELS = {"ish": "Ish", "oqish": "O'qish", "loyiha": "Loyiha",
              "uy": "Uy ishlari", "sport": "Sport", "boshqa": "Boshqa"}
CAT_COLORS = {"ish": "#ff5f56", "oqish": "#4a9eff", "loyiha": "#a77dff",
              "uy": "#f6b73c", "sport": "#35c88f", "boshqa": "#8a97a8"}
MODE_LABELS = {"work": "Ish", "short": "Qisqa tanaffus", "long": "Uzun tanaffus"}
MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
          "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]
WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"]

_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}

NUQTA = "·"           # ·
QOLDA = "✍ Qo'lda"    # ✍ Qo'lda
MINUS = "−"           # −


def esc(s) -> str:
    out = "" if s is None else str(s)
    return "".join(_ESC.get(c, c) for c in out)


def _dt(d: str) -> datetime:
    return datetime.fromisoformat(d + "T12:00:00")


def _js_weekday(d: datetime) -> int:
    """JS `getDay()` — 0 = yakshanba."""
    return (d.weekday() + 1) % 7


def fmt_date(d: str) -> str:
    t = _dt(d)
    return f"{t.day}-{MONTHS[t.month - 1]} {t.year}"


def fmt_date_full(d: str) -> str:
    return f"{fmt_date(d)}, {WEEKDAYS[_js_weekday(_dt(d))]}"


def fmt_dur(minute) -> str:
    m = js_round(minute or 0)
    if m < 60:
        return f"{m} daq"
    h, rest = m // 60, m % 60
    return f"{h} soat {rest} daq" if rest else f"{h} soat"


def _hhmm(iso) -> str:
    d = _parse_iso(iso)
    if d is None:
        return "NaN:NaN"
    return f"{d.hour:02d}:{d.minute:02d}"


def _local_str(iso) -> str:
    """JS `new Date(iso).toLocaleString('uz-UZ')` — `DD/MM/YYYY, HH:MM:SS`."""
    d = _parse_iso(iso)
    return d.strftime("%d/%m/%Y, %H:%M:%S") if d else ""


def _md_quvur(s) -> str:
    """Markdown jadval katagida `|` ustunni bo'lib yubormasligi uchun qochiriladi."""
    return str(s).replace(chr(124), chr(92) + chr(124))


def _pauza_matni(minutes, count) -> str:
    """`12 daq (3×)` yoki `—`."""
    if not minutes:
        return "—"
    out = fmt_dur(minutes)
    if count:
        out += f" ({count}×)"
    return out


# ═══════════════ Model ═══════════════

def period_range(type_: str, date) -> dict:
    d = date if is_date(date) else today_local()
    if type_ == "weekly":
        dow = (_js_weekday(_dt(d)) + 6) % 7          # dushanba = 0
        frm = add_days(d, -dow)
        return {"type": type_, "from": frm, "to": add_days(frm, 6),
                "label": f"Haftalik hisobot ({fmt_date(frm)} – {fmt_date(add_days(frm, 6))})"}
    if type_ == "monthly":
        frm = d[:8] + "01"
        t = _dt(d)
        last = calendar.monthrange(t.year, t.month)[1]
        return {"type": type_, "from": frm, "to": d[:8] + str(last).rjust(2, "0"),
                "label": f"Oylik hisobot ({MONTHS[t.month - 1]} {t.year})"}
    return {"type": "daily", "from": d, "to": d,
            "label": f"Kunlik hisobot — {fmt_date_full(d)}"}


def build_report(user: dict, opts: dict | None = None) -> dict:
    opts = opts or {}
    type_ = opts.get("type") or "daily"
    date = opts.get("date")
    frm_opt, to_opt = opts.get("from"), opts.get("to")

    db = get_db()
    settings = user_settings(user["id"])
    if is_date(frm_opt) and is_date(to_opt):
        period = {"type": "custom", "from": frm_opt, "to": to_opt,
                  "label": f"Hisobot ({fmt_date(frm_opt)} – {fmt_date(to_opt)})"}
    else:
        period = period_range(type_, date)

    def in_range(x):
        return (x.get("userId") == user["id"]
                and period["from"] <= x.get("date", "") <= period["to"])

    def order_of(t):
        o = t.get("order")
        return 0 if o is None else o

    tasks = sorted((t for t in db["tasks"] if in_range(t)),
                   key=lambda t: t["date"] + str(order_of(t)))
    sessions = sorted((s for s in db["sessions"] if in_range(s)),
                      key=lambda s: s["startedAt"])
    work_done = [s for s in sessions if s.get("mode") == "work" and s.get("completed")]

    # Bitta kunlik hisobotda jadval vaqtlarini va ish vaqti oralig'ini ham beramiz
    scheduled = tasks
    workday = None
    if period["from"] == period["to"]:
        win = day_setup(user["id"], period["from"])
        ordered = sorted(tasks, key=order_of)
        built = build_schedule([with_actuals(t, period["from"]) for t in ordered], settings, win)
        scheduled = built["tasks"]
        b = built["summary"]
        workday = {
            "start": b["workdayStart"],
            "end": b["workdayEnd"],
            "endsNextDay": b["workdayEndOffset"] > 0,
            "availableMinutes": b["availableMinutes"],
            "plannedMinutes": b["totalMinutes"],
            "freeMinutes": b["freeMinutes"],
            "fits": b["fits"],
            "overflowMinutes": b["overflowMinutes"],
            "capacityPomodoros": b["capacityPomodoros"],
            "utilizationPercent": b["utilizationPercent"],
            "lunch": b["lunch"],
            "workableMinutes": b["workableMinutes"],
            "pauseMinutes": b["pauseMinutes"],
        }

    planned_pomodoros = sum((t.get("plannedPomodoros") or 0) for t in tasks)
    focus_minutes = js_round(sum(s["actualSec"] for s in work_done) / 60)
    break_minutes = js_round(sum(s["actualSec"] for s in sessions
                                 if s.get("mode") != "work" and s.get("completed")) / 60)
    day_count = len(days_between(period["from"], period["to"]))

    # Kategoriyalar
    task_by_id = {t["id"]: t for t in tasks}
    cat_rows: dict = {}
    for s in work_done:
        cat = (task_by_id.get(s.get("taskId")) or {}).get("category") or "boshqa"
        row = cat_rows.get(cat)
        if row is None:
            row = {"category": cat, "label": CAT_LABELS.get(cat, cat),
                   "color": CAT_COLORS.get(cat, CAT_COLORS["boshqa"]),
                   "pomodoros": 0, "minutes": 0}
            cat_rows[cat] = row
        row["pomodoros"] += 1
        row["minutes"] += s["actualSec"] / 60

    categories = []
    for c in cat_rows.values():
        percent = js_round((c["pomodoros"] / len(work_done)) * 100) if work_done else 0
        categories.append({**c, "minutes": js_round(c["minutes"]), "percent": percent})
    categories.sort(key=lambda c: -c["pomodoros"])

    # Kunlar bo'yicha
    days = []
    for d in days_between(period["from"], period["to"]):
        day_work = [s for s in work_done if s["date"] == d]
        day_sess = [s for s in sessions if s["date"] == d]
        days.append({
            "date": d,
            "pomodoros": len(day_work),
            "focusMinutes": js_round(sum(s["actualSec"] for s in day_work) / 60),
            "pauseMinutes": js_round(sum((s.get("pausedSec") or 0) for s in day_sess) / 60),
            "pauseCount": sum((s.get("pauseCount") or 0) for s in day_sess),
            "tasksDone": sum(1 for t in tasks if t["date"] == d and t.get("done")),
            "tasksTotal": sum(1 for t in tasks if t["date"] == d),
        })

    # Soatlar
    hourly = [{"hour": h, "pomodoros": 0} for h in range(24)]
    for s in work_done:
        d = _parse_iso(s["startedAt"])
        if d is not None:
            hourly[d.hour]["pomodoros"] += 1
    best_hour = None
    for h in hourly:
        if h["pomodoros"] > (best_hour["pomodoros"] if best_hour else 0):
            best_hour = h

    # Oldingi davr bilan taqqoslash
    span = len(days_between(period["from"], period["to"]))
    prev_to = add_days(period["from"], -1)
    prev_from = add_days(prev_to, -(span - 1))
    prev_done = [s for s in db["sessions"]
                 if s.get("userId") == user["id"] and s.get("mode") == "work"
                 and s.get("completed") and prev_from <= s.get("date", "") <= prev_to]
    if prev_done:
        delta = js_round(((len(work_done) - len(prev_done)) / len(prev_done)) * 100)
    else:
        delta = None

    tasks_done = sum(1 for t in tasks if t.get("done"))
    interruptions = sum(1 for s in sessions if s.get("mode") == "work" and not s.get("completed"))

    # Hisobotni to'g'rlash: qo'lda kiritilgan pomodorolar va ularning sabablari
    manual_sessions = [s for s in work_done if s.get("manual")]
    corrections = []
    for t in tasks:
        for c in (t.get("corrections") or []):
            corrections.append({
                "taskId": t["id"], "taskTitle": t["title"], "date": t["date"],
                "pomodoros": c["pomodoros"], "minutes": c["minutes"],
                "totalMinutes": c["pomodoros"] * c["minutes"],
                "reason": c.get("reason"), "reasonLabel": c.get("reasonLabel"),
                "reasonNote": c.get("reasonNote") or "",
                "timeRange": _hhmm(c["from"]) + "–" + _hhmm(c["to"]),
                "at": c.get("at"),
            })
    corrections.sort(key=lambda c: str(c["at"]))
    goal = settings["dailyGoal"] * day_count

    summary = {
        "plannedPomodoros": planned_pomodoros,
        "completedPomodoros": len(work_done),
        "planPercent": js_round((len(work_done) / planned_pomodoros) * 100) if planned_pomodoros else 0,
        "focusMinutes": focus_minutes,
        "breakMinutes": break_minutes,
        "totalMinutes": focus_minutes + break_minutes,
        "manualPomodoros": len(manual_sessions),
        "manualMinutes": js_round(sum(s["actualSec"] for s in manual_sessions) / 60),
        "correctionCount": len(corrections),
        "trackedPomodoros": len(work_done) - len(manual_sessions),
        "pauseMinutes": js_round(sum((s.get("pausedSec") or 0) for s in sessions) / 60),
        "pauseCount": sum((s.get("pauseCount") or 0) for s in sessions),
        "interruptions": interruptions,
        "tasksTotal": len(tasks),
        "tasksDone": tasks_done,
        "taskPercent": js_round((tasks_done / len(tasks)) * 100) if tasks else 0,
        "goal": goal,
        "goalPercent": js_round((len(work_done) / goal) * 100) if goal else 0,
        "dayCount": day_count,
        "avgPerDay": js_round((len(work_done) / day_count) * 10) / 10 if day_count else 0,
        "prevPomodoros": len(prev_done),
        "deltaPercent": delta,
        "bestHour": best_hour["hour"] if (best_hour and best_hour["pomodoros"]) else None,
    }

    # Avtomatik xulosalar
    highlights = []
    if summary["completedPomodoros"] == 0:
        highlights.append("Bu davrda yakunlangan pomodoro yo'q.")
    else:
        highlights.append(f"Jami {summary['completedPomodoros']} ta pomodoro yakunlandi "
                          f"— sof fokus vaqti {fmt_dur(focus_minutes)}.")
        if planned_pomodoros:
            if summary["planPercent"] >= 100:
                highlights.append(f"Reja to'liq bajarildi ({summary['planPercent']}%).")
            else:
                highlights.append(f"Reja {summary['planPercent']}% bajarildi "
                                  f"({summary['completedPomodoros']}/{planned_pomodoros}).")
        if categories:
            tirnoq = chr(34)
            highlights.append(f"Eng ko'p vaqt {tirnoq}{categories[0]['label']}{tirnoq} "
                              f"yo'nalishiga sarflandi — {categories[0]['percent']}%.")
        if summary["bestHour"] is not None:
            soat = str(summary["bestHour"]).rjust(2, "0")
            highlights.append(f"Eng samarali vaqt: {soat}:00 atrofi.")
        if delta is not None:
            if delta >= 0:
                highlights.append(f"Oldingi davrga nisbatan {delta}% ko'p ish bajarildi.")
            else:
                highlights.append(f"Oldingi davrga nisbatan {abs(delta)}% kam ish bajarildi.")
        if interruptions:
            highlights.append(f"{interruptions} ta pomodoro yakunlanmay uzilgan.")
        if summary["correctionCount"]:
            highlights.append(
                f"{summary['manualPomodoros']} ta pomodoro qo'lda to'g'rlab kiritilgan "
                f"({summary['correctionCount']} ta tuzatish) — taymer bilan yozilgani "
                f"{summary['trackedPomodoros']} ta.")
        if summary["pauseMinutes"] > 0:
            paused = sorted((t for t in scheduled if (t.get("pausedSeconds") or 0) > 0),
                            key=lambda t: -(t.get("pausedSeconds") or 0))
            top = paused[0] if paused else None
            oxiri = f" — eng ko'pi «{top['title']}» vazifasida." if top else "."
            highlights.append(f"Pauzalarda {fmt_dur(summary['pauseMinutes'])} ketdi "
                              f"({summary['pauseCount']} marta){oxiri}")

    def task_view(t):
        fm = t.get("focusMinutes")
        sonmi = isinstance(fm, (int, float)) and not isinstance(fm, bool) and math.isfinite(fm)
        start_off = t.get("startDayOffset") or 0
        end_off = t.get("endDayOffset") or 0
        if t.get("startTime"):
            time_range = (f"{t['startTime']}{'+1' if start_off > 0 else ''}"
                          f"–{t.get('endTime')}{'+1' if end_off > 0 else ''}")
        else:
            time_range = None

        return {
            "id": t.get("id"), "date": t.get("date"), "title": t.get("title"),
            "category": t.get("category"),
            "categoryLabel": CAT_LABELS.get(t.get("category"), t.get("category")),
            "priority": t.get("priority"),
            "plannedPomodoros": t.get("plannedPomodoros"),
            "completedPomodoros": t.get("completedPomodoros"),
            # jadvaldan: pomodorolar yig'indisi
            "focusMinutes": fm if sonmi else js_round((t.get("focusSeconds") or 0) / 60),
            # birinchi boshlanishdan oxirgi tugashgacha
            "spanMinutes": t.get("spanMinutes") or 0,
            "pomodoros": [{"n": p["n"], "from": p["from"], "to": p["to"], "minutes": p["minutes"],
                           "actual": bool(p.get("actual")), "manual": bool(p.get("manual")),
                           "reasonLabel": p.get("reasonLabel") or ""}
                          for p in (t.get("pomodoros") or [])],
            "donePomodoroCount": t.get("donePomodoroCount") or 0,
            "pauseMinutes": js_round((t.get("pausedSeconds") or 0) / 60),
            "pauseCount": sum((x.get("count") or 1) for x in (t.get("pauses") or [])),
            "status": t.get("status") or ("bajarildi" if t.get("done") else "reja"),
            "manualPomodoros": sum(c["pomodoros"] for c in (t.get("corrections") or [])),
            "corrections": [{"pomodoros": c["pomodoros"], "minutes": c["minutes"],
                             "reason": c.get("reason"), "reasonLabel": c.get("reasonLabel"),
                             "reasonNote": c.get("reasonNote") or ""}
                            for c in (t.get("corrections") or [])],
            "done": t.get("done"),
            "startTime": t.get("startTime") or None,
            "endTime": t.get("endTime") or None,
            "timeRange": time_range,
            "note": t.get("note") or "",
            "source": t.get("source") or None,
        }

    def session_view(s):
        return {
            "date": s["date"], "mode": s["mode"],
            "modeLabel": MODE_LABELS.get(s["mode"], s["mode"]),
            "taskTitle": s.get("taskTitle") or "",
            "start": _hhmm(s["startedAt"]), "end": _hhmm(s.get("endedAt")),
            "minutes": js_round(s["actualSec"] / 60),
            "pauseMinutes": js_round((s.get("pausedSec") or 0) / 60),
            "pauseCount": s.get("pauseCount") or 0,
            "manual": bool(s.get("manual")),
            "reasonLabel": s.get("reasonLabel") or "",
            "reasonNote": s.get("reasonNote") or "",
            "completed": s.get("completed"),
        }

    # Node `new Date().toISOString()` — UTC, millisekund, `Z` bilan.
    # `astimezone().isoformat()` mahalliy vaqt va mikrosekund beradi —
    # bu javobda ko'rinadigan maydon, shuning uchun aynan takrorlanadi.
    _gen = datetime.now(timezone.utc)
    return {
        "generatedAt": _gen.strftime("%Y-%m-%dT%H:%M:%S.") + f"{_gen.microsecond // 1000:03d}Z",
        "workday": workday,
        # Hisobotda faqat emoji ko'rinadi: SVG belgining kaliti matn sifatida ma'nosiz
        "user": {
            "name": user.get("name"), "email": user.get("email"),
            "jobTitle": user.get("jobTitle") or "", "company": user.get("company") or "",
            "avatar": user.get("avatar"),
            "avatarEmoji": "" if is_icon_avatar(user.get("avatar")) else user.get("avatar"),
        },
        "period": period,
        "settings": {"workMinutes": settings["workMinutes"], "dailyGoal": settings["dailyGoal"],
                     "dayStartTime": settings["dayStartTime"]},
        "summary": summary,
        "highlights": highlights,
        "corrections": corrections,
        "categories": categories,
        "days": days,
        "hourly": hourly,
        "tasks": [task_view(t) for t in scheduled],
        "sessions": [session_view(s) for s in sessions],
    }


# ═══════════════ HTML (chop etish / PDF) ═══════════════

def _n(v) -> str:
    """JS shablonida son satrga aylanganda `1.0` emas, `1` bo'ladi."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _bar_chart_svg(days: list) -> str:
    if len(days) < 2:
        return ""
    W, H, PAD_L, PAD_B, PAD_T = 720, 170, 34, 26, 10
    mx = max([1] + [d["pomodoros"] for d in days])
    plot_h = H - PAD_B - PAD_T
    step = (W - PAD_L - 10) / len(days)
    bw = min(38, step * 0.6)

    svg = f'<svg viewBox="0 0 {W} {H}" width="100%" height="{H}" xmlns="http://www.w3.org/2000/svg">'
    for t in [0, math.ceil(mx / 2), mx]:
        y = PAD_T + plot_h - (t / mx) * plot_h
        svg += f'<line x1="{PAD_L}" y1="{_n(y)}" x2="{W - 6}" y2="{_n(y)}" stroke="#e3e8f0"/>'
        svg += (f'<text x="{PAD_L - 6}" y="{_n(y + 4)}" text-anchor="end" '
                f'font-size="10" fill="#8a97a8">{t}</text>')
    for i, d in enumerate(days):
        x = PAD_L + i * step + (step - bw) / 2
        h = (d["pomodoros"] / mx) * plot_h
        svg += (f'<rect x="{_n(x)}" y="{_n(PAD_T + plot_h - h)}" width="{_n(bw)}" '
                f'height="{_n(max(2, h))}" rx="3" fill="#ff5f56"/>')
        dt = _dt(d["date"])
        oy = str(dt.month).rjust(2, "0")
        svg += (f'<text x="{_n(x + bw / 2)}" y="{H - 8}" text-anchor="middle" '
                f'font-size="9.5" fill="#8a97a8">{dt.day}.{oy}</text>')
    return svg + "</svg>"


_HTML_CSS = """  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 13px/1.55 "Segoe UI", system-ui, sans-serif; color: #1b2430; background: #f4f6fa; margin: 0; padding: 24px; }
  .sheet { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 32px 34px; box-shadow: 0 6px 24px rgba(20,35,60,.08); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid #ff5f56; padding-bottom: 16px; margin-bottom: 22px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 26px 0 12px; padding-bottom: 7px; border-bottom: 1px solid #e3e8f0; }
  .muted { color: #5c6a7d; font-size: 12px; }
  .who { text-align: right; font-size: 12px; }
  .who b { font-size: 14px; display: block; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { background: #f7f9fc; border: 1px solid #e3e8f0; border-radius: 10px; padding: 12px 13px; }
  .kpi .v { font-size: 22px; font-weight: 650; color: #ff5f56; line-height: 1.15; }
  .kpi .l { font-size: 11px; color: #5c6a7d; margin-top: 3px; }
  .kpi .s { font-size: 10.5px; color: #8a97a8; margin-top: 3px; }
  ul.hl { margin: 12px 0 0; padding-left: 18px; }
  ul.hl li { margin: 4px 0; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8a97a8; border-bottom: 1px solid #e3e8f0; padding: 7px 8px; }
  td { padding: 8px; border-bottom: 1px solid #eef1f6; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.done td { color: #5c6a7d; }
  .tag { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
  .src { font-size: 10px; color: #8a97a8; border: 1px solid #e3e8f0; border-radius: 4px; padding: 1px 5px; }
  .ok { color: #23a06f; } .bad { color: #d9534f; }
  .manual { color: #b8860b; font-weight: 600; }
  .plan { color: #8a97a8; }
  tr.planned td { opacity: .68; }
  .note { font-size: 11.5px; color: #6b788a; margin: -4px 0 10px; }
  .empty { text-align: center; color: #8a97a8; padding: 18px; }
  .cat { display: grid; grid-template-columns: 100px 1fr 190px; gap: 10px; align-items: center; margin: 7px 0; font-size: 12px; }
  .cat-b { height: 8px; background: #eef1f6; border-radius: 99px; overflow: hidden; }
  .cat-b i { display: block; height: 100%; border-radius: 99px; }
  .cat-v { text-align: right; color: #5c6a7d; font-size: 11.5px; }
  footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e3e8f0; font-size: 11px; color: #8a97a8; display: flex; justify-content: space-between; }
  .print { position: fixed; top: 16px; right: 16px; background: #ff5f56; color: #fff; border: 0; border-radius: 9px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(255,95,86,.35); }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; } .print { display: none; } }
"""


def render_html(r: dict) -> str:
    s = r["summary"]

    def kpi(val, lbl, sub=""):
        out = f'<div class="kpi"><div class="v">{esc(val)}</div><div class="l">{esc(lbl)}</div>'
        if sub:
            out += f'<div class="s">{esc(sub)}</div>'
        return out + "</div>"

    # ── Vazifalar jadvali ──
    task_rows = ""
    for t in r["tasks"]:
        src = t.get("source")
        if src:
            kalit = (" " + NUQTA + " " + esc(src["key"])) if src.get("key") else ""
            manba = ' <span class="src">' + esc(src["type"]) + kalit + "</span>"
        else:
            manba = ""
        rang = CAT_COLORS.get(t["category"], "#8a97a8")
        oraliq = fmt_dur(t["spanMinutes"]) if t["spanMinutes"] else "—"
        vaqt = esc(t["timeRange"]) if t["timeRange"] else "—"
        task_rows += f'''
    <tr class="{'done' if t['done'] else ''}">
      <td>{'✔' if t['done'] else '○'}</td>
      <td>{esc(t['title'])}{manba}</td>
      <td><span class="tag" style="background:{rang}22;color:{rang}">{esc(t['categoryLabel'])}</span></td>
      <td class="num">{t['completedPomodoros']}/{t['plannedPomodoros']}</td>
      <td class="num">{fmt_dur(t['focusMinutes'])}</td>
      <td class="num">{oraliq}</td>
      <td class="num">{_pauza_matni(t['pauseMinutes'], t['pauseCount'])}</td>
      <td class="num">{vaqt}</td>
    </tr>'''
    if not r["tasks"]:
        task_rows = '<tr><td colspan="8" class="empty">Vazifa kiritilmagan</td></tr>'

    # ── Sessiyalar ──
    session_rows = ""
    for x in [y for y in r["sessions"] if y["mode"] == "work"][:60]:
        if x["pauseMinutes"]:
            pauza = f"{x['pauseMinutes']} daq"
        else:
            pauza = "<1 daq" if x["pauseCount"] else "—"

        if x["manual"]:
            izoh = (" — " + esc(x["reasonNote"])) if x["reasonNote"] else ""
            holat = ('<span class="manual" title="' + esc(x["reasonLabel"]) + izoh
                     + '">' + QOLDA + "</span>")
        elif x["completed"]:
            holat = '<span class="ok">Tugallandi</span>'
        else:
            holat = '<span class="bad">Uzildi</span>'

        session_rows += f'''
    <tr>
      <td class="num">{esc(x['start'])}–{esc(x['end'])}</td>
      <td>{esc(x['taskTitle'] or '—')}</td>
      <td class="num">{x['minutes']} daq</td>
      <td class="num">{pauza}</td>
      <td>{holat}</td>
    </tr>'''

    # ── Pomodorolar ──
    pomodoro_rows = ""
    for t in r["tasks"]:
        for x in (t.get("pomodoros") or []):
            if not x["actual"]:
                manba = '<span class="plan">Reja</span>'
            elif x["manual"]:
                manba = ('<span class="manual" title="' + esc(x["reasonLabel"])
                         + '">' + QOLDA + "</span>")
            else:
                manba = '<span class="ok">Taymer</span>'
            pomodoro_rows += f'''
    <tr class="{'' if x['actual'] else 'planned'}">
      <td class="num">#{x['n']}</td>
      <td>{esc(t['title'])}</td>
      <td class="num">{esc(x['from'])} – {esc(x['to'])}</td>
      <td class="num">{x['minutes']} daq</td>
      <td>{manba}</td>
    </tr>'''

    # ── Tuzatishlar ──
    correction_rows = ""
    for c in (r.get("corrections") or []):
        correction_rows += f'''
    <tr>
      <td>{esc(c['taskTitle'])}</td>
      <td class="num">{c['pomodoros']}</td>
      <td class="num">{esc(c['timeRange'])} {NUQTA} {fmt_dur(c['totalMinutes'])}</td>
      <td><span class="tag" style="background:#f6b73c22;color:#f6b73c">{esc(c['reasonLabel'])}</span></td>
      <td>{esc(c['reasonNote'] or '—')}</td>
    </tr>'''

    # ── Kategoriyalar ──
    cat_rows = ""
    for c in r["categories"]:
        cat_rows += f'''
    <div class="cat">
      <span class="cat-n">{esc(c['label'])}</span>
      <span class="cat-b"><i style="width:{c['percent']}%;background:{c['color']}"></i></span>
      <span class="cat-v">{c['pomodoros']} 🍅 {NUQTA} {fmt_dur(c['minutes'])} {NUQTA} {c['percent']}%</span>
    </div>'''

    # ── Ish kuni ko'rsatkichlari ──
    w = r["workday"]
    workday_html = ""
    if w:
        lunch = w.get("lunch") or {}
        if lunch.get("enabled"):
            ish_sub = (f"Tushlik {lunch['start']}–{lunch['end']} {NUQTA} "
                       f"ishga {fmt_dur(w['workableMinutes'])}")
        else:
            ish_sub = fmt_dur(w["availableMinutes"]) + " mavjud"

        w1 = kpi(w["start"] + " – " + w["end"] + ("+1" if w["endsNextDay"] else ""),
                 "Ish vaqti", ish_sub)
        w2 = kpi(fmt_dur(w["plannedMinutes"]), "Rejalashtirilgan yuklama",
                 f"Bandlik: {w['utilizationPercent']}%")
        w3 = kpi(fmt_dur(w["freeMinutes"]) if w["fits"] else MINUS + fmt_dur(w["overflowMinutes"]),
                 "Bo'sh vaqt" if w["fits"] else "Ish vaqtidan oshdi",
                 f"Sig'adi: {w['capacityPomodoros']} 🍅")
        workday_html = f'''<div class="kpis" style="margin-top:10px">
    {w1}
    {w2}
    {w3}
  </div>'''

    # ── Asosiy ko'rsatkichlar ──
    pomo_val = str(s["completedPomodoros"])
    if s["plannedPomodoros"]:
        pomo_val += " / " + str(s["plannedPomodoros"])
    if s["manualPomodoros"]:
        pomo_sub = f"Taymer: {s['trackedPomodoros']} {NUQTA} qo'lda: {s['manualPomodoros']}"
    else:
        pomo_sub = f"Reja: {s['planPercent']}%"

    fokus_sub = f"Tanaffus: {fmt_dur(s['breakMinutes'])}"
    if s["pauseMinutes"]:
        fokus_sub += f" {NUQTA} Pauza: {fmt_dur(s['pauseMinutes'])}"

    kpi1 = kpi(pomo_val, "Pomodorolar", pomo_sub)
    kpi2 = kpi(fmt_dur(s["focusMinutes"]), "Sof fokus vaqti", fokus_sub)
    kpi3 = kpi(f"{s['tasksDone']} / {s['tasksTotal']}", "Bajarilgan vazifalar",
               f"{s['taskPercent']}%")
    kpi4 = kpi(f"{s['goalPercent']}%", "Maqsad bajarilishi", f"Maqsad: {s['goal']} 🍅")

    chart = ""
    if len(r["days"]) > 1:
        chart = f"<h2>Kunlar bo'yicha dinamika</h2>{_bar_chart_svg(r['days'])}"

    pomo_block = ""
    if pomodoro_rows:
        pomo_block = f'''<h2>Pomodorolar</h2>
  <p class="note">Har bir pomodoroning boshlanish va tugash vaqti. Vazifa oralig'i cho'zilsa ham
  pomodorolar davomiyliklari yig'indisi o'zgarmaydi.</p>
  <table>
    <thead><tr><th class="num">#</th><th>Vazifa</th><th class="num">Vaqt</th><th class="num">Davomiyligi</th><th>Manba</th></tr></thead>
    <tbody>{pomodoro_rows}</tbody>
  </table>'''

    corr_block = ""
    if correction_rows:
        corr_block = f'''<h2>Hisobot tuzatishlari</h2>
  <p class="note">Quyidagi pomodorolar taymersiz, qo'lda kiritilgan. Har biri uchun sabab ko'rsatilgan.</p>
  <table>
    <thead><tr><th>Vazifa</th><th class="num">🍅</th><th class="num">Vaqt</th><th>Sabab</th><th>Izoh</th></tr></thead>
    <tbody>{correction_rows}</tbody>
  </table>'''

    cat_block = ""
    if r["categories"]:
        cat_block = f"<h2>Yo'nalishlar bo'yicha taqsimot</h2>{cat_rows}"

    sess_block = ""
    if session_rows:
        sess_block = f'''<h2>Ish sessiyalari</h2>
  <table>
    <thead><tr><th>Vaqt</th><th>Vazifa</th><th class="num">Davomiyligi</th><th class="num">⏸ Pauza</th><th>Holat</th></tr></thead>
    <tbody>{session_rows}</tbody>
  </table>'''

    p, u = r["period"], r["user"]
    oraliq_matni = esc(fmt_date(p["from"]))
    if p["from"] != p["to"]:
        oraliq_matni += " – " + esc(fmt_date(p["to"]))

    emoji = (esc(u["avatarEmoji"]) + " ") if u["avatarEmoji"] else ""
    lavozim = (esc(u["jobTitle"]) + "<br>") if u["jobTitle"] else ""
    kompaniya = (esc(u["company"]) + "<br>") if u["company"] else ""
    xulosalar = "".join(f"<li>{esc(h)}</li>" for h in r["highlights"])

    return f'''<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(p['label'])} — {esc(u['name'])}</title>
<style>
{_HTML_CSS}</style></head>
<body>
<button class="print" onclick="window.print()">🖨 Chop etish / PDF</button>
<div class="sheet">
  <header>
    <div>
      <h1>{esc(p['label'])}</h1>
      <div class="muted">{oraliq_matni} {NUQTA} Pomodoro tizimi</div>
    </div>
    <div class="who">
      <b>{emoji}{esc(u['name'])}</b>
      {lavozim}
      {kompaniya}
      <span class="muted">{esc(u['email'])}</span>
    </div>
  </header>

  <div class="kpis">
    {kpi1}
    {kpi2}
    {kpi3}
    {kpi4}
  </div>

  {workday_html}

  <h2>Qisqacha xulosa</h2>
  <ul class="hl">{xulosalar}</ul>

  {chart}

  <h2>Vazifalar</h2>
  <table>
    <thead><tr><th></th><th>Vazifa</th><th>Kategoriya</th><th class="num">🍅</th><th class="num">Sof ish</th><th class="num">Oraliq</th><th class="num">⏸ Pauza</th><th class="num">Vaqt</th></tr></thead>
    <tbody>{task_rows}</tbody>
  </table>

  {pomo_block}

  {corr_block}

  {cat_block}

  {sess_block}

  <footer>
    <span>Pomodoro — Ish jarayoni boshqaruvi</span>
    <span>Yaratildi: {_local_str(r['generatedAt'])}</span>
  </footer>
</div>
</body></html>'''


# ═══════════════ Markdown ═══════════════

def render_markdown(r: dict) -> str:
    s = r["summary"]
    u, p = r["user"], r["period"]
    L: list[str] = []

    L.append(f"# {p['label']}")
    L.append("")
    lavozim = (" " + NUQTA + " " + u["jobTitle"]) if u["jobTitle"] else ""
    kompaniya = (" " + NUQTA + " " + u["company"]) if u["company"] else ""
    L.append(f"**{u['name']}**{lavozim}{kompaniya}  ")
    oraliq = fmt_date(p["from"])
    if p["from"] != p["to"]:
        oraliq += " – " + fmt_date(p["to"])
    L.append(f"{u['email']} {NUQTA} {oraliq}")
    L.append("")
    L.append("## Ko'rsatkichlar")
    L.append("")
    L.append("| Ko'rsatkich | Qiymat |")
    L.append("| --- | --- |")

    w = r["workday"]
    if w:
        keyingi = "+1" if w["endsNextDay"] else ""
        L.append(f"| Ish vaqti | {w['start']} – {w['end']}{keyingi} "
                 f"({fmt_dur(w['availableMinutes'])}) |")
        lunch = w.get("lunch") or {}
        if lunch.get("enabled"):
            L.append(f"| Tushlik | {lunch['start']} – {lunch['end']} "
                     f"({fmt_dur(lunch['minutes'])}) — vazifa belgilanmaydi |")
        L.append(f"| Rejalashtirilgan yuklama | {fmt_dur(w['plannedMinutes'])} — "
                 f"bandlik {w['utilizationPercent']}% |")
        if w["fits"]:
            L.append(f"| Bo'sh vaqt | {fmt_dur(w['freeMinutes'])} |")
        else:
            L.append(f"| Ish vaqtidan oshdi | {fmt_dur(w['overflowMinutes'])} |")

    reja = ""
    if s["plannedPomodoros"]:
        reja = f" / {s['plannedPomodoros']} ({s['planPercent']}%)"
    L.append(f"| Yakunlangan pomodorolar | {s['completedPomodoros']}{reja} |")
    L.append(f"| Sof fokus vaqti | {fmt_dur(s['focusMinutes'])} |")
    L.append(f"| Tanaffus vaqti | {fmt_dur(s['breakMinutes'])} |")
    if s["pauseMinutes"]:
        L.append(f"| Pauzada o'tgan vaqt | {fmt_dur(s['pauseMinutes'])} "
                 f"({s['pauseCount']} marta) |")
    if s["manualPomodoros"]:
        L.append(f"| Qo'lda to'g'rlangan | {s['manualPomodoros']} ta pomodoro "
                 f"({fmt_dur(s['manualMinutes'])}) — taymer bilan {s['trackedPomodoros']} ta |")
    L.append(f"| Bajarilgan vazifalar | {s['tasksDone']} / {s['tasksTotal']} ({s['taskPercent']}%) |")
    L.append(f"| Maqsad bajarilishi | {s['goalPercent']}% (maqsad: {s['goal']}) |")
    if s["interruptions"]:
        L.append(f"| Uzilgan sessiyalar | {s['interruptions']} |")
    if s["dayCount"] > 1:
        L.append(f"| Kunlik o'rtacha | {s['avgPerDay']} |")

    L.append("")
    L.append("## Qisqacha xulosa")
    L.append("")
    for h in r["highlights"]:
        L.append(f"- {h}")
    L.append("")
    L.append("## Vazifalar")
    L.append("")

    if r["tasks"]:
        L.append("| Holat | Vazifa | Kategoriya | Pomodoro | Sof ish | Oraliq | Pauza | Vaqt |")
        L.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for t in r["tasks"]:
            src = t.get("source") or {}
            nom = _md_quvur(t["title"])
            kalit = f" ({src['key']})" if src.get("key") else ""
            oraliq_t = fmt_dur(t["spanMinutes"]) if t["spanMinutes"] else "—"
            L.append(f"| {'✔' if t['done'] else '○'} | {nom}{kalit} | {t['categoryLabel']} | "
                     f"{t['completedPomodoros']}/{t['plannedPomodoros']} | "
                     f"{fmt_dur(t['focusMinutes'])} | {oraliq_t} | "
                     f"{_pauza_matni(t['pauseMinutes'], t['pauseCount'])} | "
                     f"{t['timeRange'] or '—'} |")
    else:
        L.append("_Vazifa kiritilmagan._")

    all_pomos = [{**x, "task": t["title"]} for t in r["tasks"] for x in (t.get("pomodoros") or [])]
    if all_pomos:
        L.append("")
        L.append("## Pomodorolar")
        L.append("")
        L.append("_Har bir pomodoroning boshlanish va tugash vaqti._")
        L.append("")
        L.append("| # | Vazifa | Vaqt | Davomiyligi | Manba |")
        L.append("| --- | --- | --- | --- | --- |")
        for x in all_pomos:
            if x["actual"]:
                manba = "Qo'lda" if x["manual"] else "Taymer"
            else:
                manba = "Reja"
            L.append(f"| {x['n']} | {_md_quvur(x['task'])} | {x['from']} – {x['to']} | "
                     f"{x['minutes']} daq | {manba} |")

    if r.get("corrections"):
        L.append("")
        L.append("## Hisobot tuzatishlari")
        L.append("")
        L.append("_Quyidagi pomodorolar taymersiz, qo'lda kiritilgan._")
        L.append("")
        L.append("| Vazifa | Pomodoro | Vaqt | Sabab | Izoh |")
        L.append("| --- | --- | --- | --- | --- |")
        for c in r["corrections"]:
            nom = _md_quvur(c["taskTitle"])
            izoh = _md_quvur(c["reasonNote"] or "—")
            L.append(f"| {nom} | {c['pomodoros']} | {c['timeRange']} "
                     f"({fmt_dur(c['totalMinutes'])}) | {c['reasonLabel']} | {izoh} |")

    if r["categories"]:
        L.append("")
        L.append("## Yo'nalishlar")
        L.append("")
        for c in r["categories"]:
            L.append(f"- **{c['label']}** — {c['pomodoros']} 🍅 {NUQTA} "
                     f"{fmt_dur(c['minutes'])} {NUQTA} {c['percent']}%")

    if len(r["days"]) > 1:
        L.append("")
        L.append("## Kunlar bo'yicha")
        L.append("")
        L.append("| Sana | Pomodoro | Fokus | Pauza | Vazifalar |")
        L.append("| --- | --- | --- | --- | --- |")
        for d in r["days"]:
            pauza = fmt_dur(d["pauseMinutes"]) if d["pauseMinutes"] else "—"
            L.append(f"| {fmt_date(d['date'])} | {d['pomodoros']} | "
                     f"{fmt_dur(d['focusMinutes'])} | {pauza} | "
                     f"{d['tasksDone']}/{d['tasksTotal']} |")

    L.append("")
    L.append(f"_Yaratildi: {_local_str(r['generatedAt'])} — Pomodoro tizimi_")
    return "\n".join(L)


# ═══════════════ CSV ═══════════════

def render_csv(r: dict) -> str:
    def cell(v) -> str:
        t = "" if v is None else str(v)
        if re.search(r'[",;\n]', t):
            return chr(34) + t.replace(chr(34), chr(34) * 2) + chr(34)
        return t

    def row(a) -> str:
        return ";".join(cell(x) for x in a)

    s = r["summary"]
    L: list[str] = []
    L.append(row([r["period"]["label"]]))
    L.append(row(["Foydalanuvchi", r["user"]["name"], r["user"]["email"]]))
    L.append("")
    L.append(row(["KO'RSATKICH", "QIYMAT"]))

    w = r["workday"]
    if w:
        L.append(row(["Ish vaqti boshlanishi", w["start"]]))
        L.append(row(["Ish vaqti tugashi", w["end"] + (" (+1 kun)" if w["endsNextDay"] else "")]))
        L.append(row(["Mavjud ish vaqti (daq)", w["availableMinutes"]]))
        L.append(row(["Rejalashtirilgan yuklama (daq)", w["plannedMinutes"]]))
        L.append(row(["Bandlik (%)", w["utilizationPercent"]]))
        L.append(row(["Bo'sh vaqt (daq)" if w["fits"] else "Ish vaqtidan oshdi (daq)",
                      w["freeMinutes"] if w["fits"] else w["overflowMinutes"]]))

    L.append(row(["Yakunlangan pomodorolar", s["completedPomodoros"]]))
    L.append(row(["Rejalashtirilgan pomodorolar", s["plannedPomodoros"]]))
    L.append(row(["Reja bajarilishi (%)", s["planPercent"]]))
    L.append(row(["Sof fokus (daq)", s["focusMinutes"]]))
    L.append(row(["Tanaffus (daq)", s["breakMinutes"]]))
    L.append(row(["Vazifalar (bajarilgan/jami)", f"{s['tasksDone']}/{s['tasksTotal']}"]))
    L.append(row(["Uzilishlar", s["interruptions"]]))
    L.append(row(["Pauzada o'tgan vaqt (daq)", s["pauseMinutes"]]))
    L.append(row(["Pauzalar soni", s["pauseCount"]]))
    L.append(row(["Qo'lda to'g'rlangan pomodoro", s["manualPomodoros"]]))
    L.append(row(["Taymer bilan yozilgan", s["trackedPomodoros"]]))
    L.append("")
    L.append(row(["VAZIFA", "Sana", "Kategoriya", "Muhimlik", "Reja", "Bajarildi", "Sof ish (daq)",
                  "Oraliq (daq)", "Pauza (daq)", "Pauza soni", "Boshlanish", "Tugash",
                  "Holat", "Manba"]))
    for t in r["tasks"]:
        src = t.get("source")
        manba = f"{src['type']}:{src.get('key') or ''}" if src else ""
        L.append(row([t["title"], t["date"], t["categoryLabel"], t["priority"],
                      t["plannedPomodoros"], t["completedPomodoros"], t["focusMinutes"],
                      t["spanMinutes"] or 0, t["pauseMinutes"] or 0, t["pauseCount"] or 0,
                      t["startTime"] or "", t["endTime"] or "",
                      "Bajarildi" if t["done"] else "Bajarilmadi", manba]))
    L.append("")

    rows = [{**x, "task": t["title"], "date": t["date"]}
            for t in r["tasks"] for x in (t.get("pomodoros") or [])]
    if rows:
        L.append(row(["POMODORO", "Sana", "Vazifa", "Raqam", "Boshlandi", "Tugadi",
                      "Daqiqa", "Manba"]))
        for x in rows:
            if x["actual"]:
                manba = "Qo'lda" if x["manual"] else "Taymer"
            else:
                manba = "Reja"
            L.append(row(["", x["date"], x["task"], x["n"], x["from"], x["to"],
                          x["minutes"], manba]))
        L.append("")

    if r.get("corrections"):
        L.append(row(["TUZATISH", "Sana", "Vazifa", "Pomodoro", "Daqiqa", "Vaqt",
                      "Sabab", "Izoh"]))
        for c in r["corrections"]:
            L.append(row(["", c["date"], c["taskTitle"], c["pomodoros"], c["totalMinutes"],
                          c["timeRange"], c["reasonLabel"], c["reasonNote"]]))
        L.append("")

    L.append(row(["SESSIYA", "Sana", "Rejim", "Vazifa", "Boshlandi", "Tugadi", "Daqiqa",
                  "Pauza (daq)", "Manba", "Sabab", "Holat"]))
    for x in r["sessions"]:
        if x["manual"]:
            sabab = x["reasonLabel"] + ((" — " + x["reasonNote"]) if x["reasonNote"] else "")
        else:
            sabab = ""
        L.append(row(["", x["date"], x["modeLabel"], x["taskTitle"], x["start"], x["end"],
                      x["minutes"], x["pauseMinutes"] or 0,
                      "Qo'lda" if x["manual"] else "Taymer", sabab,
                      "Tugallandi" if x["completed"] else "Uzildi"]))

    return "﻿" + "\r\n".join(L)


# ═══════════════ Confluence storage format ═══════════════

def render_confluence(r: dict) -> str:
    s = r["summary"]

    def th(a):
        return "<tr>" + "".join(f"<th>{esc(x)}</th>" for x in a) + "</tr>"

    def td(a):
        return "<tr>" + "".join(f"<td>{esc(x)}</td>" for x in a) + "</tr>"

    u, p = r["user"], r["period"]
    lavozim = (" — " + esc(u["jobTitle"])) if u["jobTitle"] else ""
    oraliq = esc(fmt_date(p["from"]))
    if p["from"] != p["to"]:
        oraliq += " – " + esc(fmt_date(p["to"]))

    h = ('<ac:structured-macro ac:name="info"><ac:rich-text-body><p>'
         + esc(u["name"]) + lavozim + " " + NUQTA + " " + oraliq
         + "</p></ac:rich-text-body></ac:structured-macro>")
    h += "<h2>Ko'rsatkichlar</h2><table><tbody>"
    h += th(["Ko'rsatkich", "Qiymat"])

    w = r["workday"]
    if w:
        keyingi = " (+1 kun)" if w["endsNextDay"] else ""
        h += td(["Ish vaqti", f"{w['start']} – {w['end']}{keyingi} {NUQTA} "
                              f"{fmt_dur(w['availableMinutes'])}"])
        h += td(["Rejalashtirilgan yuklama",
                 f"{fmt_dur(w['plannedMinutes'])} {NUQTA} bandlik {w['utilizationPercent']}%"])
        h += td(["Bo'sh vaqt" if w["fits"] else "Ish vaqtidan oshdi",
                 fmt_dur(w["freeMinutes"] if w["fits"] else w["overflowMinutes"])])

    reja = f" / {s['plannedPomodoros']}" if s["plannedPomodoros"] else ""
    h += td(["Yakunlangan pomodorolar", f"{s['completedPomodoros']}{reja}"])
    h += td(["Reja bajarilishi", f"{s['planPercent']}%"])
    h += td(["Sof fokus vaqti", fmt_dur(s["focusMinutes"])])
    h += td(["Tanaffus vaqti", fmt_dur(s["breakMinutes"])])
    if s["pauseMinutes"]:
        h += td(["Pauzada o'tgan vaqt",
                 f"{fmt_dur(s['pauseMinutes'])} ({s['pauseCount']} marta)"])
    if s["manualPomodoros"]:
        h += td(["Qo'lda to'g'rlangan",
                 f"{s['manualPomodoros']} ta (taymer bilan {s['trackedPomodoros']} ta)"])
    h += td(["Bajarilgan vazifalar", f"{s['tasksDone']} / {s['tasksTotal']}"])
    h += td(["Maqsad bajarilishi", f"{s['goalPercent']}%"])
    h += "</tbody></table>"

    h += ("<h2>Qisqacha xulosa</h2><ul>"
          + "".join(f"<li>{esc(x)}</li>" for x in r["highlights"]) + "</ul>")

    h += "<h2>Vazifalar</h2><table><tbody>"
    h += th(["Holat", "Vazifa", "Kategoriya", "Pomodoro", "Fokus", "Pauza", "Vaqt"])
    for t in r["tasks"]:
        src = t.get("source") or {}
        kalit = f" ({src['key']})" if src.get("key") else ""
        h += td(["✔" if t["done"] else "○",
                 t["title"] + kalit,
                 t["categoryLabel"],
                 f"{t['completedPomodoros']}/{t['plannedPomodoros']}",
                 fmt_dur(t["focusMinutes"]),
                 _pauza_matni(t["pauseMinutes"], t["pauseCount"]),
                 t["timeRange"] or "—"])
    h += "</tbody></table>"

    if r.get("corrections"):
        h += "<h2>Hisobot tuzatishlari</h2><table><tbody>"
        h += th(["Vazifa", "Pomodoro", "Vaqt", "Sabab", "Izoh"])
        for c in r["corrections"]:
            h += td([c["taskTitle"], c["pomodoros"],
                     c["timeRange"] + " (" + fmt_dur(c["totalMinutes"]) + ")",
                     c["reasonLabel"], c["reasonNote"] or "—"])
        h += "</tbody></table>"

    if r["categories"]:
        h += "<h2>Yo'nalishlar</h2><ul>"
        for c in r["categories"]:
            h += (f"<li>{esc(c['label'])} — {c['pomodoros']} pomodoro {NUQTA} "
                  f"{esc(fmt_dur(c['minutes']))} {NUQTA} {c['percent']}%</li>")
        h += "</ul>"

    if len(r["days"]) > 1:
        h += "<h2>Kunlar bo'yicha</h2><table><tbody>"
        h += th(["Sana", "Pomodoro", "Fokus", "Pauza", "Vazifalar"])
        for d in r["days"]:
            pauza = fmt_dur(d["pauseMinutes"]) if d["pauseMinutes"] else "—"
            h += td([fmt_date(d["date"]), d["pomodoros"], fmt_dur(d["focusMinutes"]),
                     pauza, f"{d['tasksDone']}/{d['tasksTotal']}"])
        h += "</tbody></table>"

    h += f"<p><em>Yaratildi: {esc(_local_str(r['generatedAt']))} — Pomodoro tizimi</em></p>"
    return h


# ═══════════════ Notion bloklari ═══════════════

def _n_text(content):
    return [{"type": "text", "text": {"content": str(content)[:1900]}}]


def render_notion_blocks(r: dict) -> list:
    s = r["summary"]
    blocks: list = []

    def push(type_, extra):
        blocks.append({"object": "block", "type": type_, type_: extra})

    u, p = r["user"], r["period"]
    lavozim = (" — " + u["jobTitle"]) if u["jobTitle"] else ""
    oraliq = fmt_date(p["from"])
    if p["from"] != p["to"]:
        oraliq += " – " + fmt_date(p["to"])

    push("callout", {
        "rich_text": _n_text(f"{u['name']}{lavozim} {NUQTA} {oraliq}"),
        "icon": {"emoji": "🍅"},
    })

    push("heading_2", {"rich_text": _n_text("Ko'rsatkichlar")})

    metrics = []
    w = r["workday"]
    if w:
        keyingi = " (+1 kun)" if w["endsNextDay"] else ""
        metrics.append(["Ish vaqti", f"{w['start']} – {w['end']}{keyingi} {NUQTA} "
                                     f"{fmt_dur(w['availableMinutes'])}"])
        metrics.append(["Rejalashtirilgan yuklama",
                        f"{fmt_dur(w['plannedMinutes'])} {NUQTA} "
                        f"bandlik {w['utilizationPercent']}%"])
        metrics.append(["Bo'sh vaqt" if w["fits"] else "Ish vaqtidan oshdi",
                        fmt_dur(w["freeMinutes"] if w["fits"] else w["overflowMinutes"])])
        lunch = w.get("lunch") or {}
        if lunch.get("enabled"):
            metrics.append(["Tushlik", f"{lunch['start']} – {lunch['end']} {NUQTA} "
                                       f"ishga {fmt_dur(w['workableMinutes'])}"])

    reja = f" / {s['plannedPomodoros']} ({s['planPercent']}%)" if s["plannedPomodoros"] else ""
    metrics.append(["Yakunlangan pomodorolar", f"{s['completedPomodoros']}{reja}"])
    metrics.append(["Sof fokus vaqti", fmt_dur(s["focusMinutes"])])
    metrics.append(["Tanaffus vaqti", fmt_dur(s["breakMinutes"])])
    metrics.append(["Bajarilgan vazifalar",
                    f"{s['tasksDone']} / {s['tasksTotal']} ({s['taskPercent']}%)"])
    metrics.append(["Maqsad bajarilishi", f"{s['goalPercent']}% (maqsad: {s['goal']})"])

    if s["interruptions"]:
        metrics.append(["Uzilgan sessiyalar", str(s["interruptions"])])
    if s["pauseMinutes"]:
        metrics.append(["Pauzada o'tgan vaqt",
                        f"{fmt_dur(s['pauseMinutes'])} ({s['pauseCount']} marta)"])
    if s["manualPomodoros"]:
        metrics.append(["Qo'lda to'g'rlangan",
                        f"{s['manualPomodoros']} ta (taymer bilan {s['trackedPomodoros']} ta)"])

    for k, v in metrics:
        push("bulleted_list_item", {"rich_text": [
            {"type": "text", "text": {"content": k + ": "}, "annotations": {"bold": True}},
            {"type": "text", "text": {"content": v}},
        ]})

    push("heading_2", {"rich_text": _n_text("Qisqacha xulosa")})
    for h in r["highlights"]:
        push("bulleted_list_item", {"rich_text": _n_text(h)})

    push("heading_2", {"rich_text": _n_text("Vazifalar")})
    if r["tasks"]:
        for t in r["tasks"]:
            src = t.get("source") or {}
            qism = (f"  {t['completedPomodoros']}/{t['plannedPomodoros']} 🍅 {NUQTA} "
                    f"{fmt_dur(t['focusMinutes'])}")
            if t["pauseMinutes"]:
                qism += " " + NUQTA + " ⏸ " + fmt_dur(t["pauseMinutes"])
            if t["timeRange"]:
                qism += " " + NUQTA + " " + t["timeRange"]
            if src.get("key"):
                qism += " " + NUQTA + " " + src["key"]
            push("to_do", {
                "checked": bool(t["done"]),
                "rich_text": [
                    {"type": "text", "text": {"content": t["title"]}},
                    {"type": "text", "text": {"content": qism}, "annotations": {"code": True}},
                ],
            })
    else:
        push("paragraph", {"rich_text": _n_text("Vazifa kiritilmagan.")})

    if r.get("corrections"):
        push("heading_2", {"rich_text": _n_text("Hisobot tuzatishlari")})
        for c in r["corrections"]:
            izoh = (": " + c["reasonNote"]) if c["reasonNote"] else ""
            push("bulleted_list_item", {"rich_text": [
                {"type": "text", "text": {"content": c["taskTitle"]},
                 "annotations": {"bold": True}},
                {"type": "text", "text": {"content":
                    f" — {c['pomodoros']} 🍅 ({fmt_dur(c['totalMinutes'])}, "
                    f"{c['timeRange']}) {NUQTA} {c['reasonLabel']}{izoh}"}},
            ]})

    if r["categories"]:
        push("heading_2", {"rich_text": _n_text("Yo'nalishlar")})
        for c in r["categories"]:
            push("bulleted_list_item", {"rich_text": _n_text(
                f"{c['label']} — {c['pomodoros']} pomodoro {NUQTA} "
                f"{fmt_dur(c['minutes'])} {NUQTA} {c['percent']}%")})

    if len(r["days"]) > 1:
        push("heading_2", {"rich_text": _n_text("Kunlar bo'yicha")})
        for d in r["days"]:
            push("bulleted_list_item", {"rich_text": _n_text(
                f"{fmt_date(d['date'])} — {d['pomodoros']} pomodoro {NUQTA} "
                f"{fmt_dur(d['focusMinutes'])} {NUQTA} "
                f"vazifalar {d['tasksDone']}/{d['tasksTotal']}")})

    push("divider", {})
    push("paragraph", {"rich_text": _n_text(
        f"Yaratildi: {_local_str(r['generatedAt'])} — Pomodoro tizimi")})

    return blocks[:100]   # Notion API bir so'rovda 100 blok qabul qiladi
