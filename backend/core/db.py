"""
Oddiy JSON fayl ma'lumotlar bazasi. Node'dagi `lib/db.js` ning ko'chirmasi.

Yozuv atomik: avval `.tmp` faylga yoziladi, keyin `os.replace` bilan
o'rniga qo'yiladi. v2 — ko'p foydalanuvchili sxema.

DIQQAT: `persist()` har chaqirilganda BUTUN bazani qayta yozadi. Bu bitta
jarayonda xavfsiz, lekin bir nechta worker bilan ma'lumot yo'qoladi —
server `--workers 1` bilan ishga tushirilishi shart.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from ..config import DATA_DIR, DB_FILE, TMP_FILE, BACKUP_DIR
from .util import js_ready

SCHEMA_VERSION = 2

DEFAULT_SETTINGS = {
    "workMinutes": 25,
    "shortBreakMinutes": 5,
    "longBreakMinutes": 15,
    "longBreakInterval": 4,      # necha pomodorodan keyin uzun tanaffus
    "autoStartBreaks": True,     # ish tugagach tanaffus avtomat boshlansinmi
    "autoStartWork": True,       # tanaffus tugagach ish avtomat boshlansinmi
    "soundEnabled": True,
    "volume": 0.6,
    "notificationsEnabled": True,
    "tickingEnabled": False,
    "dayStartTime": "09:00",     # ish kuni boshlanish vaqti (standart)
    "dayEndTime": "18:00",       # ish kuni tugash vaqti (standart)
    "lunchEnabled": True,        # tushlik tanaffusi hisobga olinsinmi
    "lunchStart": "13:00",
    "lunchEnd": "14:00",
    "dailyGoal": 8,              # kunlik maqsad (pomodoro)
    "theme": "dark",
    "lang": "uz",
}

# Vazifa holatlari: reja -> jarayonda -> qabulga -> bajarildi
TASK_STATUSES = ["reja", "jarayonda", "qabulga", "bajarildi"]
STATUS_LABELS = {
    "reja": "Rejalashtirilgan",
    "jarayonda": "Jarayonda",
    "qabulga": "Qabul qilishga",
    "bajarildi": "Bajarildi",
}

DEFAULT_INTEGRATIONS = {
    "notion": {"enabled": False, "tokenEnc": None, "parentPageId": "", "databaseId": "",
               "lastExportAt": None, "lastError": None},
    "confluence": {"enabled": False, "baseUrl": "", "email": "", "tokenEnc": None, "spaceKey": "",
                   "parentPageId": "", "lastExportAt": None, "lastError": None},
    "jira": {"enabled": False, "baseUrl": "", "email": "", "tokenEnc": None,
             "jql": "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC",
             "defaultPomodoros": 2, "minutesPerPomodoro": 25,
             "lastImportAt": None, "lastError": None},
}

EMPTY = {
    "version": SCHEMA_VERSION,
    "users": [],
    "authSessions": [],
    "loginAttempts": {},    # eski maydon — o'rniga rateLimits ishlatiladi
    "rateLimits": {},       # { 'savat:kalit': { count, first, until } }
    "oauthStates": {},      # { state: { provider, createdAt } }
    "twoFactorPending": {},  # { ticket: { userId, createdAt } }
    "tasks": [],
    "sessions": [],
    "dayPlans": [],         # { userId, date, startTime, endTime }
    "timers": {},           # { userId: timer }
    "userState": {},        # { userId: { pomodorosSinceLongBreak, lastCycleDate } }
    "smtp": None,
    "oauth": {
        "google": {"enabled": False, "clientId": "", "clientSecretEnc": None},
        "github": {"enabled": False, "clientId": "", "clientSecretEnc": None},
    },
}

_db: dict | None = None


def _now_iso() -> str:
    """Node `new Date().toISOString()` — millisekundli UTC, `Z` bilan."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def _dumps(obj) -> str:
    """
    Node `JSON.stringify(obj, null, 2)` bilan bir xil chiqish.
    `ensure_ascii=False` — o'zbekcha harflar `\\uXXXX` ga aylanmasin.
    """
    return json.dumps(js_ready(obj), indent=2, ensure_ascii=False)


def _write(path: Path, text: str) -> None:
    """
    Faylga yozish. `newline="\\n"` shart: Windows'da Python `\\n` ni `\\r\\n`
    ga aylantiradi, Node esa aylantirmaydi — natijada bir xil baza ikki xil
    faylga aylanardi.
    """
    path.write_text(text, encoding="utf-8", newline="\n")


def ensure_dirs() -> None:
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(BACKUP_DIR).mkdir(parents=True, exist_ok=True)


def _migrate(parsed: dict) -> dict:
    """v1 (bitta foydalanuvchi) → v2 (ko'p foydalanuvchi) ko'chirish."""
    if (parsed.get("version") or 1) >= SCHEMA_VERSION:
        return parsed

    out = copy.deepcopy(EMPTY)
    out["tasks"] = [{**t, "userId": t.get("userId") or "legacy"} for t in (parsed.get("tasks") or [])]
    out["sessions"] = [{**s, "userId": s.get("userId") or "legacy"} for s in (parsed.get("sessions") or [])]
    out["legacySettings"] = {**DEFAULT_SETTINGS, **(parsed.get("settings") or {})}
    if parsed.get("state"):
        out["userState"]["legacy"] = parsed["state"]
    if parsed.get("timer"):
        out["timers"]["legacy"] = parsed["timer"]

    stamp = _now_iso().replace(":", "-").replace(".", "-")
    try:
        ensure_dirs()
        _write(Path(BACKUP_DIR) / f"v1-migratsiya-{stamp}.json", _dumps(parsed))
    except OSError:
        pass  # zaxira muvaffaqiyatsiz bo'lsa ham davom etamiz

    print("[db] v1 -> v2 ko'chirildi. Eski ma'lumotlar birinchi ro'yxatdan o'tgan foydalanuvchiga biriktiriladi.")
    return out


def load() -> dict:
    global _db
    ensure_dirs()

    if not Path(DB_FILE).exists():
        _db = copy.deepcopy(EMPTY)
        persist()
        return _db

    try:
        parsed = _migrate(json.loads(Path(DB_FILE).read_text(encoding="utf-8")))
        _db = {
            **copy.deepcopy(EMPTY),
            **parsed,
            "oauth": {
                "google": {**EMPTY["oauth"]["google"], **((parsed.get("oauth") or {}).get("google") or {})},
                "github": {**EMPTY["oauth"]["github"], **((parsed.get("oauth") or {}).get("github") or {})},
            },
            "version": SCHEMA_VERSION,
        }

        # Tasdiqlash joriy qilinishidan oldingi hisoblar tasdiqlangan hisoblanadi
        for u in _db["users"]:
            if "emailVerified" not in u:
                u["emailVerified"] = True
                u["emailVerifiedAt"] = u.get("createdAt") or _now_iso()

        if not _db.get("smtp"):
            _db["smtp"] = None      # sozlanmagunicha bo'sh

        # Eski vazifalarga holat maydonini qo'shamiz
        for t in _db["tasks"]:
            if not t.get("status"):
                done = t.get("completedPomodoros") or 0
                planned = t.get("plannedPomodoros") or 0
                if t.get("done"):
                    t["status"] = "bajarildi"
                elif done >= planned and done > 0:
                    t["status"] = "qabulga"
                elif done > 0:
                    t["status"] = "jarayonda"
                else:
                    t["status"] = "reja"

        persist()
    except Exception as err:
        stamp = _now_iso().replace(":", "-").replace(".", "-")
        try:
            shutil.copyfile(DB_FILE, Path(BACKUP_DIR) / f"buzilgan-{stamp}.json")
        except OSError:
            pass
        print(f"[db] db.json o'qib bo'lmadi, zaxiralandi: {err}")
        _db = copy.deepcopy(EMPTY)
        persist()

    return _db


def get_db() -> dict:
    if _db is None:
        load()
    return _db


def _replace_retry(src, dst, urinish: int = 5) -> None:
    """
    Windows'da faylni boshqa jarayon (antivirus, qidiruv indekslovchisi,
    zaxira dasturi) bir lahzaga ushlab turishi mumkin. Bu o'tkinchi holat,
    shuning uchun bir necha marta qayta uriniladi: 20, 40, 60... ms.
    """
    for i in range(urinish + 1):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i >= urinish:
                raise
            time.sleep(0.02 * (i + 1))


def persist() -> None:
    # `get_db()` — baza hali yuklanmagan bo'lsa fayl ustiga `null` yozilmasin.
    # `load()` ichidan chaqirilganda rekursiya bo'lmaydi: u `persist()` dan
    # oldin `_db` ni to'ldiradi.
    data = get_db()
    ensure_dirs()
    _write(Path(TMP_FILE), _dumps(data))
    _replace_retry(TMP_FILE, DB_FILE)


def commit(fn):
    result = fn(get_db())
    persist()
    return result


# ═══════════ Foydalanuvchi yordamchilari ═══════════

def find_user_by_id(user_id):
    return next((u for u in get_db()["users"] if u.get("id") == user_id), None)


def find_user_by_email(email):
    e = str(email or "").strip().lower()
    return next((u for u in get_db()["users"] if u.get("emailLower") == e), None)


def user_settings(user_id) -> dict:
    u = find_user_by_id(user_id)
    return {**DEFAULT_SETTINGS, **((u or {}).get("settings") or {})}


# ═══════════ Haftalik ish jadvali ═══════════

WEEKDAYS = [
    {"key": 1, "short": "Du", "name": "Dushanba"},
    {"key": 2, "short": "Se", "name": "Seshanba"},
    {"key": 3, "short": "Ch", "name": "Chorshanba"},
    {"key": 4, "short": "Pa", "name": "Payshanba"},
    {"key": 5, "short": "Ju", "name": "Juma"},
    {"key": 6, "short": "Sh", "name": "Shanba"},
    {"key": 0, "short": "Ya", "name": "Yakshanba"},
]


def default_work_schedule(start: str = "09:00", end: str = "18:00", lunch: dict | None = None) -> dict:
    """Standart: dushanba–juma 09:00–18:00, tushlik 13:00–14:00, dam olish kunlari yopiq."""
    lunch = lunch or {}
    out = {}
    for d in WEEKDAYS:
        out[d["key"]] = {
            "enabled": 1 <= d["key"] <= 5,
            "start": start,
            "end": end,
            "lunchEnabled": lunch.get("lunchEnabled") is not False,
            "lunchStart": lunch.get("lunchStart") or "13:00",
            "lunchEnd": lunch.get("lunchEnd") or "14:00",
        }
    return out


def user_work_schedule(user_id) -> dict:
    u = find_user_by_id(user_id)
    s = user_settings(user_id)
    base = default_work_schedule(s["dayStartTime"], s["dayEndTime"], s)
    saved = (u or {}).get("workSchedule")
    if not saved:
        return base
    out = {}
    for d in WEEKDAYS:
        k = d["key"]
        # JSON kalitlari satr bo'lishi mumkin — ikkalasi ham tekshiriladi
        patch = saved.get(k) or saved.get(str(k)) or {}
        out[k] = {**base[k], **patch}
    return out


def weekday_of(date: str) -> int:
    """
    0 = yakshanba — JS `getDay()` bilan bir xil.
    Python `weekday()` da dushanba = 0, shuning uchun siljitiladi.
    """
    d = datetime.fromisoformat(date + "T12:00:00")
    return (d.weekday() + 1) % 7


# ═══════════ Kunlik sozlama ═══════════

DAY_FIELDS = ["startTime", "endTime", "workMinutes", "shortBreakMinutes", "longBreakMinutes",
              "longBreakInterval", "lunchEnabled", "lunchStart", "lunchEnd"]


def day_setup(user_id, date: str) -> dict:
    """
    Shu kun uchun amaldagi to'liq sozlama.
    Ustuvorlik: kunlik o'zgartirish → haftalik jadval → umumiy sozlama.
    """
    s = user_settings(user_id)
    week = user_work_schedule(user_id)
    wd = weekday_of(date)
    day = week.get(wd) or {"enabled": True, "start": s["dayStartTime"], "end": s["dayEndTime"]}
    rec = next((d for d in get_db()["dayPlans"]
                if d.get("userId") == user_id and d.get("date") == date), {})

    def coalesce(*vals):
        """JS `??` — faqat None ni o'tkazib yuboradi (False va 0 qoladi)."""
        for v in vals:
            if v is not None:
                return v
        return None

    return {
        "startTime": rec.get("startTime") or day.get("start") or s["dayStartTime"],
        "endTime": rec.get("endTime") or day.get("end") or s["dayEndTime"],
        "workMinutes": coalesce(rec.get("workMinutes"), s["workMinutes"]),
        "shortBreakMinutes": coalesce(rec.get("shortBreakMinutes"), s["shortBreakMinutes"]),
        "longBreakMinutes": coalesce(rec.get("longBreakMinutes"), s["longBreakMinutes"]),
        "longBreakInterval": coalesce(rec.get("longBreakInterval"), s["longBreakInterval"]),
        "lunchEnabled": coalesce(rec.get("lunchEnabled"), day.get("lunchEnabled"), s["lunchEnabled"]),
        "lunchStart": rec.get("lunchStart") or day.get("lunchStart") or s["lunchStart"],
        "lunchEnd": rec.get("lunchEnd") or day.get("lunchEnd") or s["lunchEnd"],
        "isWorkday": bool(day.get("enabled")),
        "weekday": wd,
        "weekdayName": next((w["name"] for w in WEEKDAYS if w["key"] == wd), ""),
        "custom": any(rec.get(f) is not None for f in DAY_FIELDS),
        "overridden": [f for f in DAY_FIELDS if rec.get(f) is not None],
    }


def set_day_setup(user_id, date: str, patch: dict | None) -> dict:
    """Kunlik sozlamani saqlash. `patch=None` bo'lsa — kunlik o'zgartirish o'chiriladi."""
    d = get_db()
    i = next((k for k, x in enumerate(d["dayPlans"])
              if x.get("userId") == user_id and x.get("date") == date), -1)

    if patch is None:
        if i != -1:
            d["dayPlans"].pop(i)
        persist()
        return day_setup(user_id, date)

    rec = {"userId": user_id, "date": date} if i == -1 else d["dayPlans"][i]
    for f in DAY_FIELDS:
        if f in patch and patch[f] is not None:
            rec[f] = patch[f]
    if i == -1:
        d["dayPlans"].append(rec)
    persist()
    return day_setup(user_id, date)


# Eskirgan nom — mos kelishi uchun saqlab qo'yilgan
day_window = day_setup


def user_state_of(user_id) -> dict:
    d = get_db()
    if user_id not in d["userState"]:
        d["userState"][user_id] = {"pomodorosSinceLongBreak": 0, "lastCycleDate": None}
    return d["userState"][user_id]


def claim_legacy_data(user_id) -> int:
    """Birinchi ro'yxatdan o'tgan foydalanuvchiga v1 ma'lumotlarini biriktirish."""
    d = get_db()
    claimed = 0
    for t in d["tasks"]:
        if t.get("userId") == "legacy":
            t["userId"] = user_id
            claimed += 1
    for s in d["sessions"]:
        if s.get("userId") == "legacy":
            s["userId"] = user_id
    if d["userState"].get("legacy"):
        d["userState"][user_id] = d["userState"].pop("legacy")
    if d["timers"].get("legacy"):
        d["timers"][user_id] = d["timers"].pop("legacy")
    if d.get("legacySettings"):
        u = find_user_by_id(user_id)
        if u:
            u["settings"] = {**DEFAULT_SETTINGS, **d["legacySettings"]}
        del d["legacySettings"]
    if claimed:
        print(f"[db] {claimed} ta eski vazifa {user_id} foydalanuvchisiga biriktirildi")
    return claimed


# ═══════════ Zaxira ═══════════

def daily_backup() -> None:
    ensure_dirs()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    file = Path(BACKUP_DIR) / f"db-{day}.json"
    if file.exists():
        return
    try:
        _write(file, _dumps(get_db()))
        files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith("db-"))
        while len(files) > 14:
            old = files.pop(0)
            try:
                os.remove(Path(BACKUP_DIR) / old)
            except OSError:
                pass
    except OSError as err:
        print(f"[db] zaxira xatosi: {err}")


paths = {"DATA_DIR": DATA_DIR, "DB_FILE": DB_FILE, "BACKUP_DIR": BACKUP_DIR}
