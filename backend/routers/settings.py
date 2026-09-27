"""Foydalanuvchi sozlamalari. Node'dagi `routes/settings.js` ning ko'chirmasi."""
from __future__ import annotations

import re

from ..core.db import DEFAULT_SETTINGS, persist, user_settings
from ..core.task_rules import check_lunch
from ..core.util import clamp

_HHMM_LOOSE = re.compile(r"^\d{1,2}:\d{2}$")


THEMES = ("glass", "clay", "skeuo", "neu", "dark", "light")


def get_settings(ctx):
    user = ctx["user"]
    return {"settings": user_settings(user["id"]), "defaults": DEFAULT_SETTINGS}


def update_settings(ctx):
    user, b = ctx["user"], (ctx["body"] or {})
    s = {**DEFAULT_SETTINGS, **(user.get("settings") or {})}

    if "workMinutes" in b:
        s["workMinutes"] = clamp(b["workMinutes"], 1, 180)
    if "shortBreakMinutes" in b:
        s["shortBreakMinutes"] = clamp(b["shortBreakMinutes"], 0, 60)
    if "longBreakMinutes" in b:
        s["longBreakMinutes"] = clamp(b["longBreakMinutes"], 0, 120)
    if "longBreakInterval" in b:
        s["longBreakInterval"] = clamp(b["longBreakInterval"], 2, 12)
    if "dailyGoal" in b:
        s["dailyGoal"] = clamp(b["dailyGoal"], 1, 30)
    if "volume" in b:
        s["volume"] = clamp(b["volume"], 0, 1)

    if "dayStartTime" in b and _HHMM_LOOSE.match(str(b["dayStartTime"])):
        s["dayStartTime"] = str(b["dayStartTime"]).rjust(5, "0")
    if "dayEndTime" in b and _HHMM_LOOSE.match(str(b["dayEndTime"])):
        s["dayEndTime"] = str(b["dayEndTime"]).rjust(5, "0")

    if "lunchStart" in b or "lunchEnd" in b:
        # JS `??` — faqat `null`/`undefined` da zaxiraga o'tadi
        ls_raw = b.get("lunchStart") if b.get("lunchStart") is not None else s["lunchStart"]
        le_raw = b.get("lunchEnd") if b.get("lunchEnd") is not None else s["lunchEnd"]
        ls = str(ls_raw).rjust(5, "0")
        le = str(le_raw).rjust(5, "0")
        err = check_lunch(ls, le, s["dayStartTime"], s["dayEndTime"])
        if err:
            return {"error": err, "status": 400}
        s["lunchStart"] = ls
        s["lunchEnd"] = le

    for key in ("autoStartBreaks", "autoStartWork", "soundEnabled",
                "notificationsEnabled", "tickingEnabled", "lunchEnabled"):
        if key in b:
            s[key] = bool(b[key])

    # Ko'rinish uslublari. `dark` va `light` — eski klassik ko'rinish;
    # kimning sozlamasida o'sha tursa o'zgarmasin, shuning uchun qoldirildi.
    # Ro'yxat `public/js/theme.js` dagi THEMES bilan bir xil bo'lishi shart.
    if b.get("theme") in THEMES:
        s["theme"] = b["theme"]

    user["settings"] = s
    persist()
    return {"settings": s}


def reset_settings(ctx):
    user = ctx["user"]
    user["settings"] = {**DEFAULT_SETTINGS}
    persist()
    return {"settings": user["settings"]}
