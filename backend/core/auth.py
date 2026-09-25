"""
Sessiyalar va cookie'lar. Node'dagi `lib/auth.js` ning ko'chirmasi.

HOZIRCHA QISMAN: HTTP qatlami ishlashi uchun zarur qismlar ko'chirildi.
Qurilmalar ro'yxati, kirish cheklovi va `publicUser` 3-bosqichda qo'shiladi.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

from ..config import SECURE_COOKIES
from .crypto import random_token
from .db import get_db, persist, find_user_by_id
from .net import client_ip, describe_device, is_secure_request

COOKIE = "pmd_sid"
SESSION_DAYS = 30
# `lastSeenAt` shu oraliqdan tez-tez yangilanmaydi — har so'rovda yozish qimmat
TOUCH_EVERY_MS = 5 * 60 * 1000


def _iso(ms: float) -> str:
    """Node `new Date(ms).toISOString()`."""
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _ms(iso: str) -> float:
    """ISO satrdan millisekundga. Node `new Date(s).getTime()`."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000
    except (ValueError, TypeError):
        return 0.0


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def parse_cookies(req) -> dict:
    out: dict[str, str] = {}
    raw = req.headers.get("cookie")
    if not raw:
        return out
    for part in raw.split(";"):
        i = part.find("=")
        if i == -1:
            continue
        out[part[:i].strip()] = unquote(part[i + 1:].strip())
    return out


def _want_secure(req) -> bool:
    """Shu so'rov uchun Secure bayrog'i kerakmi."""
    return SECURE_COOKIES or (req is not None and is_secure_request(req))


def session_cookie(token: str, req=None, max_age_sec: int = SESSION_DAYS * 86400) -> str:
    parts = [
        f"{COOKIE}={quote(token, safe='')}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age_sec}",
    ]
    # Shifrlangan ulanishda cookie faqat HTTPS orqali qaytariladi
    if _want_secure(req):
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie(req=None) -> str:
    base = f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    return base + ("; Secure" if _want_secure(req) else "")


def create_session(user_id, req) -> str:
    db = get_db()
    token = random_token(32)
    now = _now_ms()
    ua = str(req.headers.get("user-agent") or "")[:200]
    db["authSessions"].append({
        # Token maxfiy — ro'yxatda ko'rsatish va o'chirish uchun alohida ochiq id
        "id": str(uuid.uuid4()),
        "token": token,
        "userId": user_id,
        "createdAt": _iso(now),
        "lastSeenAt": _iso(now),
        "expiresAt": _iso(now + SESSION_DAYS * 86400000),
        "userAgent": ua,
        "device": describe_device(ua),
        "ip": client_ip(req),
    })
    # eskirganlarini tozalaymiz
    db["authSessions"] = [s for s in db["authSessions"] if _ms(s.get("expiresAt")) > now]
    persist()
    return token


def destroy_session(token) -> None:
    db = get_db()
    before = len(db["authSessions"])
    db["authSessions"] = [s for s in db["authSessions"] if s.get("token") != token]
    if len(db["authSessions"]) != before:
        persist()


def destroy_all_sessions(user_id, except_token=None) -> None:
    db = get_db()
    db["authSessions"] = [s for s in db["authSessions"]
                          if s.get("userId") != user_id or s.get("token") == except_token]
    persist()


def _touch_session(s: dict, req) -> None:
    """Sessiyaning oxirgi faolligini belgilaydi — qurilmalar ro'yxati uchun."""
    now = _now_ms()
    last = _ms(s.get("lastSeenAt")) if s.get("lastSeenAt") else 0
    if now - last < TOUCH_EVERY_MS:
        return
    s["lastSeenAt"] = _iso(now)
    ip = client_ip(req)
    if ip:
        s["ip"] = ip
    if not s.get("id"):
        s["id"] = str(uuid.uuid4())
    if not s.get("device"):
        s["device"] = describe_device(s.get("userAgent"))
    persist()


def user_from_request(req):
    """So'rovdan foydalanuvchini aniqlash."""
    token = parse_cookies(req).get(COOKIE)
    if not token:
        return {"user": None, "token": None}
    s = next((x for x in get_db()["authSessions"] if x.get("token") == token), None)
    if not s or _ms(s.get("expiresAt")) < _now_ms():
        return {"user": None, "token": None}
    user = find_user_by_id(s.get("userId"))
    if not user:
        return {"user": None, "token": None}
    _touch_session(s, req)
    return {"user": user, "token": token}


def has_session(req) -> bool:
    """
    Sessiya bor-yo'qligini tekshiradi — bazaga yozmaydi.
    `user_from_request` dan farqi: `_touch_session` chaqirilmaydi, shuning
    uchun har bir sahifa so'rovida ortiqcha yozuv bo'lmaydi.
    """
    token = parse_cookies(req).get(COOKIE)
    if not token:
        return False
    s = next((x for x in get_db()["authSessions"] if x.get("token") == token), None)
    if not s or _ms(s.get("expiresAt")) < _now_ms():
        return False
    return find_user_by_id(s.get("userId")) is not None
