"""
Pochta serveri sozlamasi va xat yuborish.

Node'dagi `lib/mailer.js` ning o'rnini bosadi — lekin SMTP mijozi qayta
yozilmadi. U yerda 237 qatorlik qo'lda yozilgan dialog bor edi: STARTTLS,
AUTH PLAIN, nuqta ikkilash, MIME yig'ish, RFC 2047 sarlavha kodlash.
Python'da bularning hammasini stdlib `smtplib` va `email` o'zi qiladi,
shuning uchun o'sha qism tashlandi. Sozlama qatlami esa bayt-ma-bayt
o'sha-o'sha: muhit bazadan ustun, muhitdagi parol bazaga yozilmaydi.

Yuborish bloklovchi amal, shuning uchun u alohida oqimda bajariladi —
aks holda bitta sekin SMTP server butun serverni to'xtatib qo'yardi.
"""
from __future__ import annotations

import asyncio
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

from ..config import env_smtp, smtp_from_env
from .crypto import decrypt_secret, encrypt_secret
from .db import get_db, persist

DEFAULT_SMTP = {
    "enabled": False,
    "host": "",
    "port": 587,
    "secure": False,        # True — 465-portda to'g'ridan-to'g'ri TLS
    "user": "",
    "passEnc": None,
    "from": "",             # "Pomodoro <bot@kompaniya.uz>"; bo'sh bo'lsa user ishlatiladi
    "lastError": None,
    "lastSentAt": None,
}

_TIMEOUT = 15               # soniya — Node tomonda ham shuncha


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def smtp_config() -> dict:
    """
    Amaldagi SMTP sozlamasi.

    Ustuvorlik: muhit o'zgaruvchisi > bazadagi qiymat. Muhitdan kelgan parol
    bazaga umuman yozilmaydi — u faqat xotirada turadi.
    """
    db = get_db()
    if not db.get("smtp"):
        db["smtp"] = {**DEFAULT_SMTP}
    saved = {**DEFAULT_SMTP, **db["smtp"]}
    e = env_smtp()

    out = {**saved}
    for k in ("host", "port", "secure", "user", "from"):
        if e[k] is not None:
            out[k] = e[k]
    # Muhitdagi parol ochiq holda keladi — shifrlangan maydon o'rniga alohida
    out["passPlain"] = e["pass"]
    out["fromEnv"] = smtp_from_env()
    return out


def smtp_password():
    """Amaldagi parol: muhitdan yoki bazadagi shifrdan."""
    c = smtp_config()
    return c["passPlain"] or decrypt_secret(c["passEnc"])


def save_smtp(patch: dict) -> dict:
    """
    Sozlamani saqlaydi.
    Muhit o'zgaruvchisi boshqaradigan maydonlar e'tiborga olinmaydi —
    ularni bazaga yozish faqat chalkashlik tug'dirardi (baribir muhit ustun).
    """
    db = get_db()
    if not db.get("smtp"):
        db["smtp"] = {**DEFAULT_SMTP}
    c = db["smtp"]
    env = smtp_from_env()

    if "host" in patch and not env["host"]:
        c["host"] = str(patch["host"] or "").strip()
    if "port" in patch and not env["port"]:
        try:
            n = int(patch["port"])
        except (TypeError, ValueError):
            n = 587
        c["port"] = min(65535, max(1, n or 587))
    if "secure" in patch and not env["secure"]:
        c["secure"] = bool(patch["secure"])
    if "user" in patch and not env["user"]:
        c["user"] = str(patch["user"] or "").strip()
    if "from" in patch and not env["from"]:
        c["from"] = str(patch["from"] or "").strip()
    if "enabled" in patch:
        c["enabled"] = bool(patch["enabled"])
    if patch.get("pass") and not env["pass"]:
        c["passEnc"] = (None if patch["pass"] == "__clear__"
                        else encrypt_secret(str(patch["pass"]).strip()))
    c["lastError"] = None
    persist()
    return smtp_config()


def smtp_ready() -> bool:
    c = smtp_config()
    return bool(c["enabled"] and c["host"] and c["user"]
                and (c["passPlain"] or c["passEnc"]))


def _build_message(c: dict, to, subject, text, html) -> EmailMessage:
    """
    MIME xabarini yig'adi. `EmailMessage` sarlavhalarni RFC 2047 bo'yicha
    o'zi kodlaydi va `multipart/alternative` ni o'zi quradi.
    """
    msg = EmailMessage()
    msg["From"] = c["from"] or c["user"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text or "", subtype="plain", charset="utf-8")
    if html:
        msg.add_alternative(html, subtype="html", charset="utf-8")
    return msg


def _send_blocking(c: dict, password, msg: EmailMessage) -> None:
    """Haqiqiy yuborish — bloklovchi. `send_mail` uni alohida oqimda chaqiradi."""
    ctx = ssl.create_default_context()
    if c["secure"]:
        # 465 — to'g'ridan-to'g'ri TLS
        with smtplib.SMTP_SSL(c["host"], c["port"], timeout=_TIMEOUT, context=ctx) as s:
            s.login(c["user"], password)
            s.send_message(msg)
    else:
        # 587 — ochiq ulanib, STARTTLS bilan shifrlanadi
        with smtplib.SMTP(c["host"], c["port"], timeout=_TIMEOUT) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
            s.login(c["user"], password)
            s.send_message(msg)


async def send_mail(opts: dict) -> dict:
    """Xat yuboradi. Qaytaradi: `{sent: bool, error?: str}`."""
    c = smtp_config()
    if not smtp_ready():
        return {"sent": False, "error": "SMTP sozlanmagan"}

    password = smtp_password()
    msg = _build_message(c, opts["to"], opts.get("subject"),
                         opts.get("text"), opts.get("html"))

    try:
        await asyncio.to_thread(_send_blocking, c, password, msg)
        db = get_db()
        db["smtp"]["lastSentAt"] = _now_iso()
        db["smtp"]["lastError"] = None
        persist()
        return {"sent": True}
    except Exception as err:
        msg_text = str(err) or repr(err)
        try:
            db = get_db()
            if db.get("smtp"):
                db["smtp"]["lastError"] = msg_text
                persist()
        except Exception:
            pass        # yozib bo'lmasa ham davom etamiz
        print(f"[mail] yuborilmadi: {msg_text}")
        return {"sent": False, "error": msg_text}
