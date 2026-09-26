"""
Sessiyalar, cookie'lar, qurilmalar ro'yxati va kirishni cheklash.

Node'dagi `lib/auth.js` ning ko'chirmasi.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, unquote

from ..config import SECURE_COOKIES
from .avatars import avatar_url
from .crypto import random_token
from .db import get_db, persist, find_user_by_id
from .net import client_ip, describe_device, is_secure_request
from .ratelimit import clear_all, locked_for, lock_message, note_all
from .util import prop

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


# ═══════════ Qurilmalar ro'yxati ═══════════

def list_sessions(user_id, current_token=None) -> list:
    """Foydalanuvchining ochiq seanslari — token hech qachon qaytarilmaydi."""
    now = _now_ms()
    out = []
    for s in get_db()["authSessions"]:
        if s.get("userId") != user_id or _ms(s.get("expiresAt")) <= now:
            continue
        out.append({
            "id": s.get("id") or None,
            "device": s.get("device") or describe_device(s.get("userAgent")),
            "userAgent": s.get("userAgent") or "",
            "ip": s.get("ip") or "",
            "createdAt": s.get("createdAt"),
            "lastSeenAt": s.get("lastSeenAt") or s.get("createdAt"),
            "expiresAt": s.get("expiresAt"),
            "current": bool(current_token) and s.get("token") == current_token,
        })
    # Eng yangi faollik yuqorida. JS `sort` barqaror — teng vaqtlarda tartib saqlanadi
    out.sort(key=lambda x: -_ms(x["lastSeenAt"]))
    return out


def revoke_session(user_id, session_id, current_token=None) -> str:
    """Bitta seansni yopadi. Qaytaradi: `ok` | `topilmadi` | `joriy`."""
    db = get_db()
    s = next((x for x in db["authSessions"]
              if x.get("userId") == user_id and x.get("id") == session_id), None)
    if not s:
        return "topilmadi"
    if current_token and s.get("token") == current_token:
        return "joriy"
    db["authSessions"] = [x for x in db["authSessions"] if x is not s]
    persist()
    return "ok"


# ═══════════ Kirishni cheklash ═══════════
# Hisob ham, IP ham alohida sanaladi: bitta IP'dan ko'p emailga urinish
# ham, bitta emailga ko'p IP'dan urinish ham to'siladi.

def _login_keys(email, ip):
    return [["login", email], ["login-ip", ip]]


def login_blocked(email, ip):
    """Qulflangan bo'lsa xabar matnini qaytaradi, aks holda `None`."""
    by_email = locked_for("login", email)
    by_ip = locked_for("login-ip", ip)
    sec = max(by_email, by_ip)
    if not sec:
        return None
    if by_ip > by_email:
        return f"Bu tarmoqdan juda ko'p urinish bo'ldi. {lock_message(sec)}"
    return f"Juda ko'p urinish. {lock_message(sec)}"


def note_login_failure(email, ip):
    return note_all(_login_keys(email, ip))


def clear_login_failures(email, ip):
    return clear_all(_login_keys(email, ip))


def login_locked(email) -> int:
    """Eski nom — moslik uchun qoldirildi (daqiqada qaytaradi)."""
    sec = locked_for("login", email)
    return math.ceil(sec / 60) if sec else 0


# ═══════════ Ommaviy foydalanuvchi ko'rinishi ═══════════

def public_user(u):
    if not u:
        return None
    totp_cfg = u.get("totp") or {}
    yoqilgan = bool(totp_cfg.get("enabled"))
    # `prop` — JS `u.x`: maydon yo'q bo'lsa javobdan butunlay chiqadi.
    # `u.get()` bo'lsa `null` yozilib, Node javobidan farq qilardi.
    return {
        "id": prop(u, "id"),
        "email": prop(u, "email"),
        "name": prop(u, "name"),
        "avatar": prop(u, "avatar"),
        "photoUrl": avatar_url(u),
        "color": prop(u, "color"),
        "jobTitle": u.get("jobTitle") or "",
        "company": u.get("company") or "",
        "timezone": u.get("timezone") or "",
        "provider": prop(u, "provider"),
        "hasPassword": bool(u.get("passwordHash")),
        "linkedProviders": list((u.get("providerIds") or {}).keys()),
        "role": prop(u, "role"),
        "twoFactor": yoqilgan,
        "backupCodesLeft": len(totp_cfg.get("backupHashes") or []) if yoqilgan else 0,
        "createdAt": prop(u, "createdAt"),
        "lastLoginAt": prop(u, "lastLoginAt"),
    }
