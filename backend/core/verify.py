"""
Bir martalik kodlar: emailni tasdiqlash va parolni tiklash.

Node'dagi `lib/verify.js` ning ko'chirmasi.

Kod ochiq saqlanmaydi — faqat xeshi yoziladi. Urinishlar soni va
amal qilish muddati cheklangan, qayta yuborishda kutish vaqti bor.
"""
from __future__ import annotations

import hashlib
import math
import re
import secrets as _secrets
from datetime import datetime, timezone

from .db import persist
from .mailer import send_mail, smtp_ready

CODE_TTL_MIN = 15       # kod necha daqiqa amal qiladi
MAX_ATTEMPTS = 5        # necha marta xato kiritish mumkin
RESEND_WAIT_SEC = 60    # qayta yuborishgacha kutish

__all__ = ["CODE_TTL_MIN", "MAX_ATTEMPTS", "RESEND_WAIT_SEC",
           "issue_code", "check_code", "issue_reset_code", "check_reset_code",
           "smtp_ready"]


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _hash(code) -> str:
    return hashlib.sha256(str(code).encode("utf-8")).hexdigest()


def _new_code() -> str:
    return str(_secrets.randbelow(1_000_000)).rjust(6, "0")


def _escape_html(s) -> str:
    table = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
    return "".join(table.get(c, c) for c in str(s))


# ═══════════ Umumiy mexanizm ═══════════

async def _issue(user: dict, field: str, compose, tag: str) -> dict:
    """Foydalanuvchiga yangi kod yozadi va xat yuboradi."""
    now = _now_ms()
    prev = user.get(field)

    # Juda tez-tez so'ralmasin
    if prev and prev.get("sentAt") and now - prev["sentAt"] < RESEND_WAIT_SEC * 1000:
        wait = math.ceil((RESEND_WAIT_SEC * 1000 - (now - prev["sentAt"])) / 1000)
        return {"ok": False, "wait": wait,
                "error": f"Yangi kod {wait} soniyadan keyin so'ralsin"}

    code = _new_code()
    user[field] = {
        "codeHash": _hash(code),
        "expiresAt": now + CODE_TTL_MIN * 60000,
        "sentAt": now,
        "attempts": 0,
    }
    persist()

    mail = compose(code)
    res = await send_mail({"to": user["email"], **mail})

    # SMTP sozlanmagan bo'lsa kodni logga chiqaramiz — tizim baribir ishlaydi
    if not res.get("sent"):
        print(f"\n  [{tag}] {user['email']} uchun kod: {code}  ({res.get('error')})\n")
    return {"ok": True, "sent": res.get("sent"), "error": res.get("error") or None}


def _check(user: dict, field: str, given_input) -> dict:
    """Kiritilgan kodni tekshiradi. To'g'ri bo'lsa kod o'chiriladi."""
    v = user.get(field)
    if not v or not v.get("codeHash"):
        return {"ok": False, "error": "Avval kod so'rang"}
    if _now_ms() > v["expiresAt"]:
        return {"ok": False, "error": "Kod muddati tugagan — yangisini so'rang"}
    if v["attempts"] >= MAX_ATTEMPTS:
        return {"ok": False, "error": "Juda ko'p xato urinish — yangi kod so'rang"}

    given = re.sub(r"\D", "", str(given_input or ""))
    if len(given) != 6 or _hash(given) != v["codeHash"]:
        v["attempts"] += 1
        persist()
        left = max(0, MAX_ATTEMPTS - v["attempts"])
        if left:
            return {"ok": False, "error": f"Kod noto'g'ri — {left} ta urinish qoldi"}
        return {"ok": False, "error": "Urinishlar tugadi, yangi kod so'rang"}

    del user[field]
    persist()
    return {"ok": True}


# ═══════════ Xat qolipi ═══════════

def _code_mail(name, lead, code, foot) -> str:
    return (f'<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:420px">\n'
            f'    <p>Assalomu alaykum, <b>{_escape_html(name)}</b>!</p>\n'
            f'    <p>{_escape_html(lead)}</p>\n'
            f'    <p style="font-size:30px;font-weight:700;letter-spacing:6px;'
            f'margin:18px 0">{code}</p>\n'
            f'    <p style="color:#666;font-size:13px">{_escape_html(foot)}</p>\n'
            f'  </div>')


# ═══════════ Emailni tasdiqlash ═══════════

async def issue_code(user: dict) -> dict:
    def compose(code):
        foot = (f"Kod {CODE_TTL_MIN} daqiqa amal qiladi. "
                f"Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.")
        return {
            "subject": f"Tasdiqlash kodi: {code}",
            "text": "\n".join([
                f"Assalomu alaykum, {user['name']}!",
                "",
                f"Pomodoro tizimida emailingizni tasdiqlash kodi: {code}",
                "",
                f"Kod {CODE_TTL_MIN} daqiqa amal qiladi.",
                "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.",
            ]),
            "html": _code_mail(user["name"],
                               "Pomodoro tizimida emailingizni tasdiqlash kodi:",
                               code, foot),
        }
    return await _issue(user, "emailVerify", compose, "tasdiqlash")


def check_code(user: dict, given_input) -> dict:
    res = _check(user, "emailVerify", given_input)
    if res["ok"]:
        user["emailVerified"] = True
        d = datetime.now(timezone.utc)
        user["emailVerifiedAt"] = (d.strftime("%Y-%m-%dT%H:%M:%S.")
                                   + f"{d.microsecond // 1000:03d}Z")
        persist()
    return res


# ═══════════ Parolni tiklash ═══════════

async def issue_reset_code(user: dict) -> dict:
    def compose(code):
        foot = (f"Kod {CODE_TTL_MIN} daqiqa amal qiladi. Agar parolni tiklashni siz "
                f"so'ramagan bo'lsangiz, bu xatga e'tibor bermang — parolingiz o'zgarmaydi.")
        return {
            "subject": f"Parolni tiklash kodi: {code}",
            "text": "\n".join([
                f"Assalomu alaykum, {user['name']}!",
                "",
                f"Pomodoro tizimida parolni tiklash kodi: {code}",
                "",
                f"Kod {CODE_TTL_MIN} daqiqa amal qiladi.",
                "Agar parolni tiklashni siz so'ramagan bo'lsangiz, bu xatga e'tibor bermang —",
                "parolingiz o'zgarmaydi.",
            ]),
            "html": _code_mail(user["name"],
                               "Pomodoro tizimida parolni tiklash kodi:",
                               code, foot),
        }
    return await _issue(user, "passwordReset", compose, "parol tiklash")


def check_reset_code(user: dict, given_input) -> dict:
    return _check(user, "passwordReset", given_input)
