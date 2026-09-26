"""
Taymer — bir vaqtda ikkitagacha vazifa ustida ishlash mumkin.

Node'dagi `routes/timer.js` ning ko'chirmasi.

Sabab: bir vazifani boshqa odam qilayotgan paytda siz ikkinchisini
tekshirishingiz yoki qilishingiz mumkin — ikkalasi ham hisoblanadi.

Har bir taymer «slot» raqamiga ega (0 yoki 1). Buyruqlar shu raqam,
taymer id'si yoki vazifa id'si orqali manzillanadi; bitta taymer
ochiq bo'lsa manzil ko'rsatish shart emas.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..core.db import day_setup, get_db, persist, user_settings, user_state_of
from ..core.task_rules import is_meet
from ..core.util import clamp, is_date, js_round, today_local, uid

MAX_TIMERS = 2
MODES = ["work", "short", "long"]


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


# ═══════════ Slotlar ═══════════

def timers_of(db: dict, user_id) -> list:
    """
    Foydalanuvchining ochiq taymerlari.
    Eski yozuvda bitta obyekt turardi — o'qishda massivga o'giriladi.
    """
    v = db["timers"].get(user_id)
    if not v:
        return []
    if isinstance(v, list):
        return v
    arr = [{**v, "slot": 0}]
    db["timers"][user_id] = arr
    return arr


def _save_timers(db: dict, user_id, lst: list) -> None:
    if lst:
        db["timers"][user_id] = lst
    else:
        db["timers"].pop(user_id, None)


def _by_slot(lst: list) -> list:
    return sorted(lst, key=lambda t: t.get("slot") or 0)


def _free_slot(lst: list):
    """Bo'sh slot raqami yoki `None`."""
    for s in range(MAX_TIMERS):
        if not any((t.get("slot") or 0) == s for t in lst):
            return s
    return None


def _pick_timer(lst: list, body: dict | None = None) -> dict:
    """
    Buyruq qaysi taymerga tegishli ekanini aniqlaydi.
    Bitta taymer ochiq bo'lsa manzil talab qilinmaydi.
    """
    body = body or {}
    if not lst:
        return {"error": "Faol taymer yo'q", "status": 400}

    if body.get("timerId"):
        t = next((x for x in lst if x.get("id") == body["timerId"]), None)
        return {"timer": t} if t else {"error": "Bunday taymer topilmadi", "status": 404}

    if body.get("slot") is not None:
        try:
            s = int(body["slot"])
        except (TypeError, ValueError):
            s = -1
        t = next((x for x in lst if (x.get("slot") or 0) == s), None)
        return {"timer": t} if t else {"error": f"{s}-slotda taymer yo'q", "status": 404}

    if body.get("taskId"):
        t = next((x for x in lst if x.get("taskId") == body["taskId"]), None)
        return {"timer": t} if t else {"error": "Bu vazifa uchun taymer yo'q", "status": 404}

    if len(lst) == 1:
        return {"timer": lst[0]}

    return {"error": "Ikkita taymer ochiq — qaysi biri ekanini ko'rsating",
            "status": 400, "code": "SLOT_REQUIRED"}


# ═══════════ Uchrashuv ═══════════

def _meet_minutes(task):
    """Uchrashuv davomiyligi (daqiqa) — tanaffus chiqarilgan holda."""
    if not task or not task.get("meetStart") or not task.get("meetEnd"):
        return None

    def m(t):
        parts = str(t).split(":")
        try:
            h = int(parts[0])
        except (ValueError, IndexError):
            h = 0
        try:
            x = int(parts[1])
        except (ValueError, IndexError):
            x = 0
        return h * 60 + x

    d = m(task["meetEnd"]) - m(task["meetStart"])
    if d <= 0:
        d += 1440
    br = task.get("meetBreak") or {}
    if br.get("enabled") and 0 < (br.get("minutes") or 0) < d:
        d -= br["minutes"]
    return d if d > 0 else None


def _mode_minutes(mode, s):
    if mode == "short":
        return s["shortBreakMinutes"]
    if mode == "long":
        return s["longBreakMinutes"]
    return s["workMinutes"]


def _elapsed_of(timer) -> float:
    if not timer:
        return 0
    running = ((_now_ms() - timer["segmentStart"]) / 1000
               if timer.get("status") == "running" else 0)
    return max(0, (timer.get("elapsedSec") or 0) + running)


def _paused_of(timer) -> float:
    """Jamlangan pauza vaqti — davom etayotgan pauza ham qo'shiladi."""
    if not timer:
        return 0
    ongoing = ((_now_ms() - timer["pauseStart"]) / 1000
               if timer.get("status") == "paused" and timer.get("pauseStart") else 0)
    return max(0, (timer.get("pausedSec") or 0) + ongoing)


def _credit_pause(db: dict, user_id, timer: dict, seconds) -> bool:
    """
    Pauzani vazifaga yozadi: jami vaqt + qaysi pomodoroda bo'lgani.
    Indeks tufayli jadvalda pauza aynan o'sha pomodorodan keyin ko'rinadi.
    """
    if not (seconds > 0) or not timer.get("taskId"):
        return False
    task = next((t for t in db["tasks"]
                 if t.get("id") == timer["taskId"] and t.get("userId") == user_id), None)
    if not task:
        return False

    idx = max(0, timer.get("pomodoroIndex") or 0)
    if not isinstance(task.get("pauses"), list):
        task["pauses"] = []
    rec = next((p for p in task["pauses"] if p.get("index") == idx), None)
    if rec:
        rec["seconds"] += seconds
        rec["count"] = (rec.get("count") or 1) + 1
    else:
        task["pauses"].append({"index": idx, "seconds": seconds, "count": 1,
                               "at": _now_iso()})
    task["pausedSeconds"] = sum(p["seconds"] for p in task["pauses"])
    return True


# ═══════════ Ko'rinish ═══════════

def _view(t: dict) -> dict:
    elapsed = _elapsed_of(t)
    return {
        "id": t.get("id"),
        "slot": t.get("slot") or 0,
        "mode": t.get("mode"),
        "taskId": t.get("taskId"),
        "taskTitle": t.get("taskTitle"),
        "status": t.get("status"),
        "durationSec": t.get("durationSec"),
        "elapsedSec": js_round(elapsed),
        "remainingSec": max(0, js_round(t["durationSec"] - elapsed)),
        "pausedSec": js_round(_paused_of(t)),
        "pauseCount": t.get("pauseCount") or 0,
        "startedAtIso": t.get("startedAtIso"),
    }


def snapshot(user_id) -> dict:
    db = get_db()
    lst = _by_slot(timers_of(db, user_id))
    state = user_state_of(user_id)
    primary = lst[0] if lst else None

    return {
        # Eski mijozlar uchun birinchi taymer alohida ham beriladi
        "timer": _view(primary) if primary else None,
        "timers": [_view(t) for t in lst],
        "freeSlot": _free_slot(lst),
        "maxTimers": MAX_TIMERS,
        "serverTime": int(_now_ms()),
        "cycle": state["pomodorosSinceLongBreak"],
        "nextMode": primary["mode"] if primary else "work",
    }


def _roll_cycle_if_new_day(user_id, date) -> None:
    state = user_state_of(user_id)
    if state.get("lastCycleDate") != date:
        state["lastCycleDate"] = date
        state["pomodorosSinceLongBreak"] = 0


def get_timer(ctx):
    return snapshot(ctx["user"]["id"])


# ═══════════ Boshlash ═══════════

def start_timer(ctx):
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    lst = timers_of(db, user["id"])
    mode = body.get("mode") if body.get("mode") in MODES else "work"
    date = body.get("date") if is_date(body.get("date")) else today_local()
    _roll_cycle_if_new_day(user["id"], date)

    # Shu vazifa ustida allaqachon ishlanyaptimi
    if body.get("taskId") and any(t.get("taskId") == body["taskId"] for t in lst):
        return {"error": "Bu vazifa ustida ish allaqachon boshlangan",
                "status": 409, "code": "ALREADY_RUNNING"}

    # Slotni tanlaymiz
    if body.get("slot") is not None:
        try:
            slot = int(body["slot"])
        except (TypeError, ValueError):
            slot = None
    else:
        slot = _free_slot(lst)

    if not isinstance(slot, int) or slot < 0 or slot >= MAX_TIMERS:
        return {"error": f"Bir vaqtda ko'pi bilan {MAX_TIMERS} ta vazifa ustida "
                         f"ishlash mumkin", "status": 409, "code": "NO_FREE_SLOT"}

    # So'ralgan slot band bo'lsa — oldingisi yopiladi
    busy = next((t for t in lst if (t.get("slot") or 0) == slot), None)
    if busy:
        _close_timer(db, user["id"], busy, record=True)

    task_id = None
    task_title = ""
    pomodoro_index = 0
    if mode == "work" and body.get("taskId"):
        task = next((t for t in db["tasks"]
                     if t.get("id") == body["taskId"] and t.get("userId") == user["id"]), None)
        # Bajarilgan vazifa ustida ishlashni boshlab bo'lmaydi
        if task and task.get("status") == "bajarildi":
            return {"error": "Bajarilgan vazifa ustida ishlab bo'lmaydi. "
                             "Avval «Qayta ochish» (↩) tugmasini bosing.", "status": 409}
        if task:
            task_id = task["id"]
            task_title = task["title"]
            # Ish boshlangani bilan vazifa "jarayonda" holatiga o'tadi
            if task.get("status") == "reja" or not task.get("status"):
                task["status"] = "jarayonda"
            # Birinchi marta ▶ bosilgan haqiqiy vaqt
            if not task.get("startedAt"):
                task["startedAt"] = _now_iso()
            # Nechanchi pomodoro ustida ishlanyapti
            pomodoro_index = max(0, task.get("completedPomodoros") or 0)

    # Davomiylik shu kunning sozlamasidan. Uchrashuvda esa pomodoro emas —
    # uchrashuvning o'z davomiyligi ishlatiladi.
    setup = day_setup(user["id"], date)
    meet_task = (next((t for t in db["tasks"]
                       if t.get("id") == task_id and t.get("userId") == user["id"]), None)
                 if task_id else None)
    meet_len = (_meet_minutes(meet_task)
                if (mode == "work" and meet_task and is_meet(meet_task.get("category")))
                else None)

    if body.get("durationMinutes") is not None:
        minutes = clamp(body["durationMinutes"], 1, 720)
    else:
        minutes = meet_len if meet_len is not None else _mode_minutes(mode, setup)

    fresh = {
        "id": uid(),
        "slot": slot,
        "mode": mode,
        "date": date,
        "taskId": task_id,
        "taskTitle": task_title,
        "pomodoroIndex": pomodoro_index,
        "durationSec": js_round(minutes * 60),
        "elapsedSec": 0,
        "pausedSec": 0,
        "pauseStart": None,
        "pauseCount": 0,
        "pausedCommitted": 0,
        "segmentStart": int(_now_ms()),
        "startedAtIso": _now_iso(),
        "status": "running",
    }

    nxt = [t for t in timers_of(db, user["id"]) if (t.get("slot") or 0) != slot]
    nxt.append(fresh)
    _save_timers(db, user["id"], nxt)
    persist()
    return snapshot(user["id"])


# ═══════════ Pauza ═══════════

def pause_timer(ctx):
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    found = _pick_timer(timers_of(db, user["id"]), body)
    if found.get("error"):
        return found

    t = found["timer"]
    if t.get("status") != "running":
        return {"error": "Bu taymer ishlamayapti", "status": 400}

    t["elapsedSec"] = _elapsed_of(t)
    t["status"] = "paused"
    t["pauseStart"] = int(_now_ms())        # pauza vaqti shu paytdan sanaladi
    t["pauseCount"] = (t.get("pauseCount") or 0) + 1
    persist()
    return snapshot(user["id"])


def resume_timer(ctx):
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    found = _pick_timer(timers_of(db, user["id"]), body)
    if found.get("error"):
        return found

    t = found["timer"]
    if t.get("status") != "paused":
        return {"error": "Bu taymer pauzada emas", "status": 400}

    # Pauzada turgan vaqt jamlanadi va darhol vazifaga yoziladi —
    # shunda jadval pomodoro tugashini kutmasdan suriladi
    if t.get("pauseStart"):
        seg = (_now_ms() - t["pauseStart"]) / 1000
        t["pausedSec"] = (t.get("pausedSec") or 0) + seg
        if _credit_pause(db, user["id"], t, seg):
            # ikki marta sanalmasin
            t["pausedCommitted"] = (t.get("pausedCommitted") or 0) + seg

    t["pauseStart"] = None
    t["segmentStart"] = int(_now_ms())
    t["status"] = "running"
    persist()
    return snapshot(user["id"])


# ═══════════ Yakunlash ═══════════

def _record_session(db: dict, user_id, timer: dict, completed: bool):
    elapsed = js_round(_elapsed_of(timer))
    paused = js_round(_paused_of(timer))
    db["sessions"].append({
        "id": uid(),
        "userId": user_id,
        "date": timer["date"],
        "mode": timer["mode"],
        "taskId": timer.get("taskId"),
        "taskTitle": timer.get("taskTitle"),
        "plannedSec": timer["durationSec"],
        "actualSec": elapsed,
        "pausedSec": paused,
        "pauseCount": timer.get("pauseCount") or 0,
        "completed": completed,
        "startedAt": timer.get("startedAtIso"),
        "endedAt": _now_iso(),
    })
    # Hali yozilmagan pauza qoldig'i
    _credit_pause(db, user_id, timer, js_round(paused - (timer.get("pausedCommitted") or 0)))
    return elapsed


def _close_timer(db: dict, user_id, timer: dict, record: bool = False) -> None:
    """Taymerni ro'yxatdan olib tashlaydi (kerak bo'lsa seansini yozib)."""
    if record:
        elapsed = js_round(_elapsed_of(timer))
        if timer["mode"] == "work" and elapsed >= 60:
            _record_session(db, user_id, timer, completed=False)
            task = next((t for t in db["tasks"]
                         if t.get("id") == timer.get("taskId")
                         and t.get("userId") == user_id), None)
            if task:
                task["focusSeconds"] = (task.get("focusSeconds") or 0) + elapsed
        elif timer["mode"] == "work":
            _credit_pause(db, user_id, timer,
                          js_round(_paused_of(timer) - (timer.get("pausedCommitted") or 0)))

    rest = [t for t in timers_of(db, user_id) if t.get("id") != timer.get("id")]
    _save_timers(db, user_id, rest)


def complete_timer(ctx):
    """Taymer to'liq tugadi."""
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    found = _pick_timer(timers_of(db, user["id"]), body)
    if found.get("error"):
        return found

    timer = found["timer"]
    settings = user_settings(user["id"])
    state = user_state_of(user["id"])

    elapsed = _record_session(db, user["id"], timer, completed=True)

    if timer["mode"] == "work":
        t0 = next((t for t in db["tasks"]
                   if t.get("id") == timer.get("taskId")
                   and t.get("userId") == user["id"]), None)
        # Uchrashuv pomodoro siklini surmaydi
        if not t0 or not is_meet(t0.get("category")):
            state["pomodorosSinceLongBreak"] = (state.get("pomodorosSinceLongBreak") or 0) + 1
        task = t0
        if task:
            task["completedPomodoros"] = (task.get("completedPomodoros") or 0) + 1
            task["focusSeconds"] = (task.get("focusSeconds") or 0) + elapsed
            # Holat avtomatik: jarayonda -> hamma pomodoro bajarilsa "qabul qilishga".
            # "Bajarildi" holatiga faqat foydalanuvchi o'tkazadi.
            if task.get("status") != "bajarildi":
                task["status"] = ("qabulga"
                                  if task["completedPomodoros"] >= (task.get("plannedPomodoros") or 0)
                                  else "jarayonda")
                task["done"] = False

    setup = day_setup(user["id"], timer["date"])
    interval = max(1, setup["longBreakInterval"])
    done_task = next((t for t in db["tasks"]
                      if t.get("id") == timer.get("taskId")
                      and t.get("userId") == user["id"]), None)
    was_meet = bool(done_task) and is_meet(done_task.get("category"))

    next_mode = "work"
    if timer["mode"] == "work" and not was_meet:
        next_mode = "long" if (state["pomodorosSinceLongBreak"] % interval == 0) else "short"

    slot = timer.get("slot") or 0
    _close_timer(db, user["id"], timer)
    persist()

    # Uchrashuvdan keyin tanaffus avtomatik boshlanmaydi
    if was_meet:
        auto = False
    else:
        auto = settings["autoStartBreaks"] if timer["mode"] == "work" else settings["autoStartWork"]

    return {
        **snapshot(user["id"]),
        "finishedMode": timer["mode"],
        "finishedSlot": slot,
        "nextMode": next_mode,
        "nextMinutes": _mode_minutes(next_mode, setup),
        "autoStart": bool(auto),
    }


def stop_timer(ctx):
    """Bekor qilish."""
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    found = _pick_timer(timers_of(db, user["id"]), body)
    if found.get("error"):
        return found

    timer = found["timer"]
    slot = timer.get("slot") or 0
    _close_timer(db, user["id"], timer, record=True)
    persist()
    return {**snapshot(user["id"]), "finishedMode": timer["mode"],
            "finishedSlot": slot, "nextMode": "work", "autoStart": False}


def skip_timer(ctx):
    """Tanaffusni o'tkazib yuborish."""
    db = get_db()
    user, body = ctx["user"], (ctx["body"] or {})
    found = _pick_timer(timers_of(db, user["id"]), body)
    if found.get("error"):
        return found

    timer = found["timer"]
    slot = timer.get("slot") or 0
    _close_timer(db, user["id"], timer)
    persist()
    return {**snapshot(user["id"]), "finishedMode": timer["mode"],
            "finishedSlot": slot, "nextMode": "work", "autoStart": False}


def reset_cycle(ctx):
    state = user_state_of(ctx["user"]["id"])
    state["pomodorosSinceLongBreak"] = 0
    persist()
    return snapshot(ctx["user"]["id"])
