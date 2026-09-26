"""
Umumiy urinish cheklovchisi. Node'dagi `lib/ratelimit.js` ning ko'chirmasi.

Har bir cheklov "savat" (bucket) va "kalit" juftligi bilan aniqlanadi:
`login:email` va `login-ip:1.2.3.4` — alohida hisoblanadi. Shuning uchun
bitta IP'dan minglab turli emailga urinish ham, bitta emailga minglab
IP'dan urinish ham to'siladi.

Hisoblagichlar bazada saqlanadi — server qayta ishga tushsa ham yo'qolmaydi.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from .db import get_db, persist

# Tayyor cheklov qoidalari — bir joyda turgani sozlashni osonlashtiradi
RULES = {
    "login":       {"max": 8,  "windowSec": 15 * 60, "lockSec": 15 * 60},
    "login-ip":    {"max": 30, "windowSec": 15 * 60, "lockSec": 30 * 60},
    "register-ip": {"max": 20, "windowSec": 60 * 60, "lockSec": 60 * 60},
    "forgot":      {"max": 3,  "windowSec": 60 * 60, "lockSec": 60 * 60},
    "forgot-ip":   {"max": 12, "windowSec": 60 * 60, "lockSec": 60 * 60},
    "code-ip":     {"max": 20, "windowSec": 15 * 60, "lockSec": 15 * 60},
    "twofa":       {"max": 6,  "windowSec": 15 * 60, "lockSec": 15 * 60},
}

# IP savati faqat haqiqiy mijoz manzili ma'lum bo'lgandagina ishlaydi.
# Loopback — bu yo TRUST_PROXY yoqilmagan proksi, yo bitta kompyuterdagi
# ish: ikkalasida ham IP bo'yicha ajratish ma'nosiz, hisob bo'yicha
# cheklovlar esa o'z kuchida qoladi.
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "nomalum", ""}


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _is_ip_bucket(bucket) -> bool:
    return str(bucket).endswith("-ip")


def _skip(bucket, key) -> bool:
    return _is_ip_bucket(bucket) and str(key or "").lower() in _LOOPBACK


def _store() -> dict:
    db = get_db()
    if not isinstance(db.get("rateLimits"), dict):
        db["rateLimits"] = {}
    return db["rateLimits"]


def _key_of(bucket, key) -> str:
    return f"{bucket}:{str(key or '').lower()}"


def locked_for(bucket, key) -> int:
    """
    Cheklov holatini tekshiradi — hisoblagichga tegmaydi.
    Qaytaradi: qulf tugashiga qolgan soniya (0 — ochiq).
    """
    if _skip(bucket, key):
        return 0
    rec = _store().get(_key_of(bucket, key))
    if not rec or not rec.get("until"):
        return 0
    left = rec["until"] - _now_ms()
    return math.ceil(left / 1000) if left > 0 else 0


def lock_message(seconds) -> str:
    """Qulf tugashiga qolgan vaqtni odam o'qiydigan ko'rinishda beradi."""
    if seconds <= 90:
        return f"{seconds} soniyadan keyin qayta urining"
    return f"{math.ceil(seconds / 60)} daqiqadan keyin qayta urining"


def note_failure(bucket, key) -> int:
    """
    Muvaffaqiyatsiz urinishni yozadi. Chegaradan oshsa — qulflaydi.
    Qaytaradi: qulflangan bo'lsa qolgan soniya, aks holda 0.
    """
    rule = RULES.get(bucket)
    if not rule or _skip(bucket, key):
        return 0

    s = _store()
    k = _key_of(bucket, key)
    now = _now_ms()
    rec = s.get(k)

    # Oyna tugagan bo'lsa hisob noldan boshlanadi
    oyna_tugadi = (rec and rec.get("first")
                   and now - rec["first"] > rule["windowSec"] * 1000
                   and not (rec.get("until", 0) > now))
    if not rec or oyna_tugadi:
        rec = {"count": 0, "first": now, "until": 0}

    rec["count"] += 1
    if rec["count"] >= rule["max"]:
        rec["until"] = now + rule["lockSec"] * 1000
        rec["count"] = 0
        rec["first"] = now

    s[k] = rec
    persist()
    return math.ceil((rec["until"] - now) / 1000) if rec["until"] > now else 0


def clear_failures(bucket, key) -> None:
    """Muvaffaqiyatli amaldan keyin hisobni tozalaydi."""
    s = _store()
    k = _key_of(bucket, key)
    if k in s:
        del s[k]
        persist()


def check_all(pairs) -> dict:
    """Bir nechta cheklovni birdan tekshiradi."""
    for bucket, key in pairs:
        sec = locked_for(bucket, key)
        if sec:
            return {"locked": True, "seconds": sec, "bucket": bucket}
    return {"locked": False, "seconds": 0, "bucket": None}


def note_all(pairs) -> int:
    """Bir nechta savatga birdan xato yozadi."""
    worst = 0
    for bucket, key in pairs:
        worst = max(worst, note_failure(bucket, key))
    return worst


def clear_all(pairs) -> None:
    """Bir nechta savatni birdan tozalaydi."""
    for bucket, key in pairs:
        clear_failures(bucket, key)


def sweep() -> int:
    """Eskirgan yozuvlarni olib tashlaydi — baza shishib ketmasin."""
    db = get_db()
    s = _store()
    now = _now_ms()
    removed = 0

    for k in list(s.keys()):
        rec = s[k]
        dead = ((not rec.get("until") or rec["until"] < now)
                and (not rec.get("first") or now - rec["first"] > 24 * 3600 * 1000))
        if dead:
            del s[k]
            removed += 1

    # Muddati o'tgan OAuth va 2FA holatlari
    for k in list((db.get("oauthStates") or {}).keys()):
        v = db["oauthStates"][k]
        if not v or not v.get("createdAt") or now - v["createdAt"] > 10 * 60000:
            del db["oauthStates"][k]
            removed += 1
    for k in list((db.get("twoFactorPending") or {}).keys()):
        v = db["twoFactorPending"][k]
        if not v or not v.get("createdAt") or now - v["createdAt"] > 5 * 60000:
            del db["twoFactorPending"][k]
            removed += 1

    if removed:
        persist()
    return removed


def forget_user(user_id, email) -> int:
    """Hisob o'chirilganda unga tegishli barcha qoldiqlarni olib tashlaydi."""
    db = get_db()
    s = _store()
    n = 0

    mail = str(email or "").lower()
    for k in list(s.keys()):
        if mail and k.endswith(":" + mail):
            del s[k]
            n += 1
            continue
        if k == "twofa:" + str(user_id).lower():
            del s[k]
            n += 1

    for k in list((db.get("twoFactorPending") or {}).keys()):
        if (db["twoFactorPending"][k] or {}).get("userId") == user_id:
            del db["twoFactorPending"][k]
            n += 1

    if n:
        persist()
    return n
