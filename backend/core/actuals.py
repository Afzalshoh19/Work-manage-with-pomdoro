"""
Vazifaga haqiqatda bajarilgan pomodorolarni biriktirish.

Node'dagi `lib/actuals.js` ning ko'chirmasi.

Foydalanuvchi vazifalarni ro'yxatdagi tartib bilan emas, almashtirib
bajarishi mumkin. Shuning uchun jadval rejadan emas, seans yozuvlaridan
quriladi: har bir pomodoroning o'z boshlanish va tugash vaqti bor.

Vazifa oralig'i = birinchi pomodoro boshlanishi ... oxirgisining tugashi.
Pomodorolar davomiyliklari yig'indisi esa oraliqdan mustaqil — u o'zgarmaydi.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .db import get_db
from .util import js_round


def _to_minutes(t) -> int:
    parts = str(t).split(":")
    h = int(parts[0]) if parts and parts[0].lstrip("-").isdigit() else 0
    m = int(parts[1]) if len(parts) > 1 and parts[1].lstrip("-").isdigit() else 0
    return h * 60 + m


def _parse_iso(iso):
    """
    ISO satrni MAHALLIY vaqtga o'giradi — JS `new Date(iso)` kabi.
    Zonasiz satr mahalliy deb qabul qilinadi, `Z` yoki siljishli satr
    esa mahalliy zonaga keltiriladi.
    """
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return d.astimezone() if d.tzinfo else d


def minutes_of_day(iso, base_date):
    """ISO vaqtni kun boshidan hisoblangan daqiqaga aylantiradi."""
    d = _parse_iso(iso)
    if d is None:
        return None
    m = d.hour * 60 + d.minute
    # Yarim tundan oshgan seans keyingi kunga tegishli — kun o'qida davom etadi
    day_str = d.date().isoformat()
    if base_date and day_str > base_date:
        m += 1440
    return m


def split_pause_minutes(pauses, total_minutes) -> list:
    """
    Pauzalarni soniyadan daqiqaga o'tkazadi. Har birini alohida yaxlitlash
    jamini buzadi (3 ta 40 soniya = 0 daqiqa), shuning uchun eng katta qoldiq
    usuli bilan taqsimlaymiz — yig'indi umumiy daqiqaga aniq teng chiqadi.
    """
    lst = [p for p in (pauses or []) if p and (p.get("seconds") or 0) > 0]
    if not lst or total_minutes <= 0:
        return []

    total_sec = sum(p["seconds"] for p in lst)
    shares = []
    for p in lst:
        exact = (p["seconds"] / total_sec) * total_minutes
        whole = int(exact // 1)
        shares.append({
            "index": p["index"] if p.get("index") is not None else 0,
            "count": p.get("count") or 1,
            "minutes": whole,
            "rest": exact - whole,
        })

    left = total_minutes - sum(s["minutes"] for s in shares)
    # Barqaror tartib: JS `sort` ham teng qoldiqlarda joyini saqlaydi
    for s in sorted(shares, key=lambda x: -x["rest"]):
        if left <= 0:
            break
        s["minutes"] += 1
        left -= 1

    return [{"index": s["index"], "count": s["count"], "minutes": s["minutes"]} for s in shares]


def done_pomodoros_of(user_id, task_id, date) -> list:
    """Vazifaning bajarilgan pomodorolari, vaqti bo'yicha tartiblangan."""
    mine = [s for s in get_db()["sessions"]
            if s.get("userId") == user_id and s.get("taskId") == task_id
            and s.get("mode") == "work" and s.get("completed")]
    mine.sort(key=lambda s: str(s.get("startedAt")))

    out = []
    for s in mine:
        start_min = minutes_of_day(s.get("startedAt"), date)
        if start_min is None:
            continue
        minutes = max(1, js_round((s.get("actualSec") or 0) / 60))
        out.append({
            "startMin": start_min,
            "endMin": start_min + minutes,
            "minutes": minutes,
            "startIso": s.get("startedAt"),
            "endIso": s.get("endedAt"),
            "manual": bool(s.get("manual")),
            "reasonLabel": s.get("reasonLabel") or "",
        })
    return out


def with_actuals(task: dict, date: str) -> dict:
    """Jadval hisoblagichi uchun vazifani tayyorlaydi."""
    total = js_round((task.get("pausedSeconds") or 0) / 60)
    out = {
        **task,
        "pausedMinutes": total,
        "pauseList": split_pause_minutes(task.get("pauses"), total),
        "donePomodoros": done_pomodoros_of(task.get("userId"), task.get("id"), date),
    }

    # Uchrashuv: vaqti belgilangan blok, pomodorolarga bo'linmaydi
    if task.get("meetStart") and task.get("meetEnd"):
        s = _to_minutes(task["meetStart"])
        e = _to_minutes(task["meetEnd"])
        if e <= s:
            e += 1440
        br = task.get("meetBreak") or {}
        out["meet"] = {
            "startMin": s,
            "endMin": e,
            "minutes": e - s,
            "breakEnabled": bool(br.get("enabled")),
            "breakMinutes": min(br.get("minutes") or 0, e - s - 1) if br.get("enabled") else 0,
            "breakPlacement": br.get("placement") or "ortasida",
            "breakAt": _to_minutes(br["at"]) if br.get("at") else None,
        }

    if task.get("startedAt"):
        mins = minutes_of_day(task["startedAt"], date)
        d = _parse_iso(task["startedAt"])
        # DIQQAT: bu yerda UTC sanasi solishtiriladi, `minutes_of_day` esa
        # mahalliy sanani oladi. Node'da ham shunday — ataylab takrorlanmoqda.
        # Manfiy siljishli zonalarda (UTC-5) bu noto'g'ri natija berishi
        # mumkin; tuzatish alohida ish, aks holda ko'chirish ichida xulq
        # jimgina o'zgaradi.
        utc_day = d.astimezone(timezone.utc).date().isoformat() if d else None
        if mins is not None and utc_day is not None and utc_day <= date:
            out["actualStartMinutes"] = mins

    return out
