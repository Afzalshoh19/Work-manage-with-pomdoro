"""
Kun tartibini pomodoro bloklariga bo'lib, har bir vazifaning
boshlanish/tugash vaqtini va tanaffuslarni hisoblaydi.

Node'dagi `lib/plan.js` ning ko'chirmasi.

Jadval ish kuni oralig'i (boshlanish–tugash) ichida quriladi.
Yarim tundan oshsa, vaqt yoniga kun siljishi (`dayOffset`) qo'shiladi.

Jadval uch xil haqiqiy holatni hisobga oladi:
  1. Pauza vaqti — vazifa bloklaridan keyin "pauza" bloki bo'lib qo'shiladi
     va keyingi hamma narsani surib yuboradi.
  2. Haqiqiy boshlanish — foydalanuvchi vazifani ▶ bilan boshlagan bo'lsa,
     shu vazifa rejadagi emas, haqiqiy vaqtga bog'lanadi.
  3. Tushlik — bu oraliqqa hech qanday ish yoki tanaffus tushmaydi.
"""
from __future__ import annotations

import math

from .util import js_round, minutes_to_time, time_to_minutes


def _at(mins):
    return {"time": minutes_to_time(mins), "dayOffset": math.floor(mins / 1440)}


def _finite(v) -> bool:
    """JS `Number.isFinite` — `True`/`None`/satr o'tmaydi."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _lunch_window(cfg: dict, day_start: int):
    """Tushlik oralig'ini ish kuni o'qiga joylashtiradi."""
    if not cfg.get("lunchEnabled"):
        return None
    ls = cfg.get("lunchStart") or "13:00"
    le = cfg.get("lunchEnd") or "14:00"
    start = time_to_minutes(ls)
    end = time_to_minutes(le)
    if end <= start:
        end += 1440          # tungi smenada yarim tundan oshishi mumkin
    while start < day_start:
        start += 1440
        end += 1440
    if end - start <= 0:
        return None
    return {"start": start, "end": end, "minutes": end - start, "startTime": ls, "endTime": le}


def build_schedule(tasks: list, settings: dict, setup: dict | None = None) -> dict:
    """
    tasks    — tartiblangan vazifalar. Har biri ixtiyoriy ravishda
               `actualStartMinutes` va `pausedMinutes` maydonlarini olishi mumkin.
    settings — foydalanuvchi sozlamalari (zaxira qiymatlar)
    setup    — shu kunning sozlamasi
    """
    cfg = {**settings, **(setup or {})}
    work = max(1, cfg["workMinutes"])
    short_b = max(0, cfg["shortBreakMinutes"])
    long_b = max(0, cfg["longBreakMinutes"])
    interval = max(1, cfg["longBreakInterval"])

    start_time = cfg.get("startTime") or settings["dayStartTime"]
    end_time = cfg.get("endTime") or settings.get("dayEndTime") or "18:00"

    day_start = time_to_minutes(start_time)
    day_end_abs = time_to_minutes(end_time)
    # Tugash boshlanishdan oldin bo'lsa — tungi smena, ertasi kunga o'tadi
    if day_end_abs <= day_start:
        day_end_abs += 1440
    available_minutes = day_end_abs - day_start

    lunch = _lunch_window(cfg, day_start)
    # Ish oynasiga tushadigan tushlik qismi — sig'im hisobidan chiqariladi
    lunch_in_window = (max(0, min(lunch["end"], day_end_abs) - max(lunch["start"], day_start))
                       if lunch else 0)
    workable_minutes = max(0, available_minutes - lunch_in_window)

    # Uchrashuvlar — belgilangan vaqtda turadigan band oynalar.
    # Ish jadvali ular ustidan sakraydi, tanaffus ham hisoblanmaydi.
    meets = sorted(
        ({**t["meet"], "title": t.get("title"), "id": t.get("id")}
         for t in tasks if t.get("meet") and t["meet"].get("minutes", 0) > 0),
        key=lambda m: m["startMin"],
    )
    meet_minutes = sum(m["minutes"] for m in meets)

    def meet_conflict_end(frm, length):
        """Berilgan oraliq uchrashuvga tegsa — uchrashuv tugagan vaqtni qaytaradi."""
        for m in meets:
            if frm < m["endMin"] and frm + length > m["startMin"]:
                return m["endMin"]
        return None

    # Uchrashuvlar pomodoro sanog'iga kirmaydi
    total_pomodoros = sum(0 if t.get("meet") else (t.get("plannedPomodoros") or 0) for t in tasks)

    # Tsikl ichida o'zgaradigan holat — `nonlocal` orqali ko'rinadi
    st = {
        "cursor": day_start, "index": 0, "workMinutes": 0, "breakMinutes": 0,
        "pauseMinutes": 0, "shortCount": 0, "longCount": 0, "lunchPlaced": False,
    }

    def place_lunch(blocks):
        """Tushlik blokini joriy kursordan tushlik oxirigacha qo'yadi."""
        start_at = max(st["cursor"], lunch["start"])
        f, t = _at(start_at), _at(lunch["end"])
        blocks.append({
            "type": "lunch",
            "from": f["time"], "to": t["time"],
            "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
            "abs": start_at,
            "minutes": lunch["end"] - start_at,
            # pomodoro tugashi kutilgani uchun kech boshlandi
            "late": start_at > lunch["start"],
            "overflow": False,
        })
        st["lunchPlaced"] = True
        st["cursor"] = lunch["end"]

    def lunch_before_work(blocks, length) -> bool:
        """
        Ish bloki tushlikka tegsa nima qilish kerakligini hal qiladi.
        Boshlangan pomodoroni bo'lmaymiz: agar u tushlik tugashidan oldin
        yakunlansa — ishlashda davom etadi, tushlikka biroz kech chiqiladi.
        Aks holda blok butunlay tushlikdan keyinga suriladi.

        True — blokdan keyin tushlik qo'yilishi kerak.
        """
        if not lunch or st["lunchPlaced"] or length <= 0:
            return False
        if st["cursor"] >= lunch["end"] or st["cursor"] + length <= lunch["start"]:
            return False
        # Pomodoro tushlikdan oldin boshlangan va tushlik tugashiga ulguradi
        if st["cursor"] < lunch["start"] and st["cursor"] + length <= lunch["end"]:
            return True
        place_lunch(blocks)
        return False

    def lunch_instead_of_break(blocks, length) -> bool:
        """Tanaffus tushlikka tegsa — tushlikning o'zi tanaffus vazifasini bajaradi."""
        if not lunch or st["lunchPlaced"] or length <= 0:
            return False
        if st["cursor"] >= lunch["end"] or st["cursor"] + length <= lunch["start"]:
            return False
        place_lunch(blocks)
        return True

    scheduled = []

    for task in tasks:
        # ── Uchrashuv: belgilangan vaqtda yaxlit blok ──
        if task.get("meet"):
            m = task["meet"]
            blocks: list = []

            def seg(frm, to, typ, _b=blocks, _t=task):
                f, t = _at(frm), _at(to)
                _b.append({
                    "type": typ, "from": f["time"], "to": t["time"],
                    "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                    "abs": frm, "minutes": to - frm,
                    "meetTitle": _t.get("title"),
                    "overflow": to > day_end_abs,
                })

            # Tanaffus uchrashuv ichida — foydalanuvchi joyini o'zi tanlaydi
            br_start = None
            if m.get("breakEnabled") and 0 < m.get("breakMinutes", 0) < m["minutes"]:
                pl = m.get("breakPlacement")
                if pl == "boshida":
                    br_start = m["startMin"]
                elif pl == "oxirida":
                    br_start = m["endMin"] - m["breakMinutes"]
                elif pl == "vaqt" and _finite(m.get("breakAt")):
                    br_start = min(max(m["breakAt"], m["startMin"]), m["endMin"] - m["breakMinutes"])
                else:
                    br_start = m["startMin"] + js_round((m["minutes"] - m["breakMinutes"]) / 2)

            if br_start is None:
                seg(m["startMin"], m["endMin"], "meet")
            else:
                br_end = br_start + m["breakMinutes"]
                if br_start > m["startMin"]:
                    seg(m["startMin"], br_start, "meet")
                seg(br_start, br_end, "meet-break")
                if br_end < m["endMin"]:
                    seg(br_end, m["endMin"], "meet")

            ish_vaqti = m["minutes"] - (0 if br_start is None else m["breakMinutes"])
            st["workMinutes"] += ish_vaqti
            if br_start is not None:
                st["breakMinutes"] += m["breakMinutes"]

            s0, e0 = _at(m["startMin"]), _at(m["endMin"])
            scheduled.append({
                **task,
                "startTime": s0["time"], "endTime": e0["time"],
                "startDayOffset": s0["dayOffset"], "endDayOffset": e0["dayOffset"],
                "overflow": m["endMin"] > day_end_abs,
                "spanMinutes": m["minutes"],
                "focusMinutes": ish_vaqti,
                "estimatedMinutes": m["minutes"],
                "isMeet": True,
                "meetBreakMinutes": 0 if br_start is None else m["breakMinutes"],
                "donePomodoroCount": 0,
                "pomodoros": [],
                "pausedMinutes": 0,
                "pauseCount": 0,
                "pinnedStart": True,
                "blocks": blocks,
            })
            continue

        n = max(0, task.get("plannedPomodoros") or 0)
        blocks = []

        # Haqiqatda bajarilgan pomodorolar — o'z vaqtida turadi, chunki vazifalar
        # tartib bilan emas, almashtirib bajarilishi mumkin
        done = (task.get("donePomodoros") or [])[:n]
        remaining = max(0, n - len(done))

        # Vazifa haqiqatda boshlangan bo'lsa — jadval shu vaqtga bog'lanadi
        pinned = task.get("actualStartMinutes") if _finite(task.get("actualStartMinutes")) else None
        if n > 0 and not done and pinned is not None:
            st["cursor"] = pinned

        task_start = done[0]["startMin"] if done else st["cursor"]

        # Pauzalar pomodoro tartib raqami bo'yicha: { 0: daqiqa, 1: daqiqa, ... }
        pause_by_index: dict = {}
        listed = 0
        for p in (task.get("pauseList") or []):
            mm = js_round(p.get("minutes") or 0)
            if mm <= 0:
                continue
            pause_by_index[p["index"]] = pause_by_index.get(p["index"], 0) + mm
            listed += mm
        # Indekssiz qolgan pauza (eski yozuvlar) — oxiriga qo'shiladi
        trailing = max(0, js_round(task.get("pausedMinutes") or 0) - listed)
        task_pause = 0

        # Har bir pomodoroning boshlanish/tugash vaqti — hisobot va interfeys uchun
        pomodoro_list: list = []

        def put_pause(mins):
            """Pauza blokini joriy o'ringa qo'yadi."""
            nonlocal task_pause
            if not (mins > 0):
                return
            f, t = _at(st["cursor"]), _at(st["cursor"] + mins)
            blocks.append({
                "type": "pause",
                "from": f["time"], "to": t["time"],
                "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                "abs": st["cursor"], "minutes": mins,
                "overflow": st["cursor"] + mins > day_end_abs,
            })
            st["cursor"] += mins
            st["pauseMinutes"] += mins
            task_pause += mins

        # ── 1. Bajarilgan pomodorolar: haqiqiy vaqti bo'yicha ──
        # Ular orasidagi bo'shliq — haqiqatda o'tgan vaqt, sun'iy tanaffus
        # qo'yilmaydi. Shuning uchun pomodorolar yig'indisi o'zgarmaydi.
        for d in done:
            st["index"] += 1
            f, t = _at(d["startMin"]), _at(d["endMin"])
            blocks.append({
                "type": "work", "n": st["index"],
                "from": f["time"], "to": t["time"],
                "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                "abs": d["startMin"], "minutes": d["minutes"],
                "actual": True,                     # reja emas, haqiqatda bajarilgan
                "manual": bool(d.get("manual")),
                "reasonLabel": d.get("reasonLabel") or "",
                "overflow": d["endMin"] > day_end_abs,
            })
            st["workMinutes"] += d["minutes"]
            pomodoro_list.append({
                "n": st["index"], "from": f["time"], "to": t["time"],
                "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                "minutes": d["minutes"], "actual": True,
                "manual": bool(d.get("manual")), "reasonLabel": d.get("reasonLabel") or "",
            })

        # Rejadagi qolgan ish oxirgi haqiqiy pomodorodan keyin boshlanadi
        if done:
            st["cursor"] = max(st["cursor"], done[-1]["endMin"])

        # ── 2. Qolgan pomodorolar: rejadan hisoblanadi ──
        for i in range(remaining):
            st["index"] += 1

            # Uchrashuv — qat'iy majburiyat: unga tushadigan ish keyinga suriladi
            band = meet_conflict_end(st["cursor"], work)
            if band is not None:
                st["cursor"] = band

            # Tushlik ish blokidan oldin kerakmi, yoki blokdan keyingami
            lunch_after_work = lunch_before_work(blocks, work)

            f, t = _at(st["cursor"]), _at(st["cursor"] + work)
            blocks.append({
                "type": "work", "n": st["index"],
                "from": f["time"], "to": t["time"],
                "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                "abs": st["cursor"], "minutes": work,
                "actual": False,
                "overflow": st["cursor"] + work > day_end_abs,   # ish vaqtidan tashqarida
            })
            pomodoro_list.append({
                "n": st["index"], "from": f["time"], "to": t["time"],
                "fromDayOffset": f["dayOffset"], "toDayOffset": t["dayOffset"],
                "minutes": work, "actual": False, "manual": False, "reasonLabel": "",
            })
            st["cursor"] += work
            st["workMinutes"] += work

            # Shu pomodoroda qilingan pauza aynan shu yerda ko'rinadi
            put_pause(pause_by_index.get(len(done) + i) or 0)

            # Pomodoro tushlik ustidan o'tdi — endi tushlikka chiqiladi.
            # Tushlikning o'zi tanaffus bo'lgani uchun keyingi tanaffus
            # qo'yilmaydi: tushlikdan keyingi ish aniq vaqtda boshlanadi.
            lunch_took_break = False
            if lunch_after_work and not st["lunchPlaced"]:
                place_lunch(blocks)
                lunch_took_break = True

            is_last = st["index"] >= total_pomodoros
            if not is_last and not lunch_took_break:
                is_long = st["index"] % interval == 0
                length = long_b if is_long else short_b
                if length > 0:
                    # Tanaffus tushlikka tushsa — tushlikning o'zi tanaffus bo'ladi
                    if lunch_instead_of_break(blocks, length):
                        continue
                    # Uchrashuvga tushadigan tanaffus o'tkazib yuboriladi
                    if meet_conflict_end(st["cursor"], length) is not None:
                        continue
                    bf, bt = _at(st["cursor"]), _at(st["cursor"] + length)
                    blocks.append({
                        "type": "long" if is_long else "short",
                        "from": bf["time"], "to": bt["time"],
                        "fromDayOffset": bf["dayOffset"], "toDayOffset": bt["dayOffset"],
                        "abs": st["cursor"], "minutes": length,
                        "overflow": st["cursor"] + length > day_end_abs,
                    })
                    st["cursor"] += length
                    st["breakMinutes"] += length
                    if is_long:
                        st["longCount"] += 1
                    else:
                        st["shortCount"] += 1

        # Rejadagi pomodorolardan tashqarida qolgan pauza
        if n > 0:
            extra = trailing
            for idx, mm in pause_by_index.items():
                if idx >= n:
                    extra += mm
            put_pause(extra)

        # Vazifa oralig'i: birinchi pomodoro boshlanishidan oxirgisining tugashigacha.
        # Oradagi uzilishlar shu oraliqqa kiradi, lekin sof ish vaqtiga qo'shilmaydi.
        last_end = done[-1]["endMin"] if (done and not remaining) else st["cursor"]

        s, e = _at(task_start), _at(last_end)
        # Sof ish vaqti — pomodorolar davomiyliklari yig'indisi
        focus_minutes = sum(d["minutes"] for d in done) + remaining * work

        scheduled.append({
            **task,
            "startTime": s["time"] if n > 0 else None,
            "endTime": e["time"] if n > 0 else None,
            "startDayOffset": s["dayOffset"] if n > 0 else 0,
            "endDayOffset": e["dayOffset"] if n > 0 else 0,
            "overflow": n > 0 and last_end > day_end_abs,
            "spanMinutes": max(0, last_end - task_start) if n > 0 else 0,
            "focusMinutes": focus_minutes,    # pomodorolar yig'indisi — oraliqdan mustaqil
            "estimatedMinutes": n * work,
            "donePomodoroCount": len(done),
            "pomodoros": pomodoro_list,       # har birining boshlanish/tugash vaqti
            "pausedMinutes": task_pause,
            "pauseCount": sum((p.get("count") or 1) for p in (task.get("pauseList") or [])),
            "pinnedStart": len(done) > 0 or pinned is not None,
            "blocks": blocks,
        })

    # Hech bir vazifaga tushmagan bo'lsa ham tushlik jadvalda ko'rinsin
    lunch_block = None
    if lunch and not st["lunchPlaced"]:
        lf, lt = _at(lunch["start"]), _at(lunch["end"])
        lunch_block = {
            "type": "lunch",
            "from": lf["time"], "to": lt["time"],
            "fromDayOffset": lf["dayOffset"], "toDayOffset": lt["dayOffset"],
            "abs": lunch["start"], "minutes": lunch["minutes"], "overflow": False,
        }

    completed = sum(min(t.get("completedPomodoros") or 0, t.get("plannedPomodoros") or 0)
                    for t in tasks)
    raw_completed = sum((t.get("completedPomodoros") or 0) for t in tasks)
    plan_end_abs = st["cursor"] if total_pomodoros > 0 else day_start
    end = _at(plan_end_abs)
    window_end = _at(day_end_abs)

    total_minutes = st["workMinutes"] + st["breakMinutes"] + st["pauseMinutes"]
    free_minutes = workable_minutes - total_minutes

    # Ish vaqtiga nechta pomodoro sig'adi (tanaffuslar bilan, tushliksiz)
    capacity = 0
    used = 0
    while True:
        nxt = capacity + 1
        need = used + work
        if need > workable_minutes:
            break
        capacity = nxt
        used = need
        br = long_b if (nxt % interval == 0) else short_b
        if used + br > workable_minutes:
            break
        used += br

    return {
        "tasks": scheduled,
        "lunchBlock": lunch_block,
        "summary": {
            "taskCount": len(tasks),
            "doneTaskCount": sum(1 for t in tasks if t.get("done")),
            "totalPomodoros": total_pomodoros,
            "completedPomodoros": raw_completed,
            "remainingPomodoros": max(0, total_pomodoros - completed),
            "workMinutes": st["workMinutes"],
            "breakMinutes": st["breakMinutes"],
            "pauseMinutes": st["pauseMinutes"],
            "lunchMinutes": lunch_in_window,
            "meetMinutes": meet_minutes,
            "meetCount": len(meets),
            "shortBreaks": st["shortCount"],
            "longBreaks": st["longCount"],
            "totalMinutes": total_minutes,
            "dayStart": minutes_to_time(day_start),
            "dayEnd": end["time"],
            "dayEndOffset": end["dayOffset"],
            "overnight": end["dayOffset"] > 0,
            "progressPercent": js_round((completed / total_pomodoros) * 100) if total_pomodoros > 0 else 0,

            # — Shu kunning amaldagi sozlamasi —
            "workMinutesUsed": work,
            "shortBreakUsed": short_b,
            "longBreakUsed": long_b,
            "longBreakIntervalUsed": interval,
            "isWorkday": (setup or {}).get("isWorkday") is not False,
            "weekdayName": (setup or {}).get("weekdayName") or "",
            "customDay": bool((setup or {}).get("custom")),

            # — Tushlik —
            "lunch": ({"enabled": True, "start": lunch["startTime"],
                       "end": lunch["endTime"], "minutes": lunch["minutes"]}
                      if lunch else
                      {"enabled": False, "start": cfg.get("lunchStart") or "13:00",
                       "end": cfg.get("lunchEnd") or "14:00", "minutes": 0}),

            # — Ish vaqti oralig'i —
            "workdayStart": start_time,
            "workdayEnd": end_time,
            "workdayEndOffset": window_end["dayOffset"],
            "availableMinutes": available_minutes,
            "workableMinutes": workable_minutes,
            "freeMinutes": free_minutes,
            "fits": free_minutes >= 0,
            "overflowMinutes": -free_minutes if free_minutes < 0 else 0,
            "capacityPomodoros": capacity,
            "extraPomodoros": max(0, total_pomodoros - capacity),
            "utilizationPercent": js_round((total_minutes / workable_minutes) * 100) if workable_minutes > 0 else 0,
        },
    }


def overlaps_lunch(cfg: dict, day_start_time, from_minutes, length_minutes) -> bool:
    """Berilgan vaqt tushlik oralig'iga tushadimi (daqiqalarda, kun boshidan)."""
    day_start = time_to_minutes(day_start_time)
    lunch = _lunch_window(cfg, day_start)
    if not lunch:
        return False
    return from_minutes < lunch["end"] and from_minutes + length_minutes > lunch["start"]
