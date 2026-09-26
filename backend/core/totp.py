"""
Ikki bosqichli tasdiqlash — TOTP (RFC 6238).

Node'dagi `lib/totp.js` ning ko'chirmasi.

Google Authenticator, Microsoft Authenticator, Authy, 1Password —
hammasi shu standartda ishlaydi: 30 soniyalik oyna, HMAC-SHA1, 6 xona.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets as _secrets
import struct
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
PERIOD = 30      # bir kod necha soniya amal qiladi
DIGITS = 6
WINDOW = 1       # oldingi/keyingi oynaga ham ruxsat (soat farqi uchun)


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


# ═══════════ Base32 ═══════════
# Python `base64.b32encode` padding (`=`) qo'yadi, Node esa qo'ymaydi —
# shuning uchun kodlash qo'lda, Node bilan aynan bir xil qilinadi.

def base32_encode(buf: bytes) -> str:
    bits = 0
    value = 0
    out = []
    for byte in buf:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            out.append(B32[(value >> (bits - 5)) & 31])
            bits -= 5
    if bits > 0:
        out.append(B32[(value << (5 - bits)) & 31])
    return "".join(out)


def base32_decode(s) -> bytes:
    clean = re.sub(r"[^A-Z2-7]", "", str(s or "").upper())
    bits = 0
    value = 0
    out = bytearray()
    for ch in clean:
        idx = B32.find(ch)
        if idx == -1:
            continue
        value = (value << 5) | idx
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 255)
            bits -= 8
    return bytes(out)


# ═══════════ Kod hisoblash ═══════════

def hotp(secret: bytes, counter: int, digits: int = DIGITS) -> str:
    """Hisoblagich asosidagi kod — HOTP (RFC 4226)."""
    msg = struct.pack(">Q", counter & 0xFFFFFFFFFFFFFFFF)
    h = hmac.new(secret, msg, hashlib.sha1).digest()
    off = h[-1] & 0x0F
    bin_code = (((h[off] & 0x7F) << 24)
                | ((h[off + 1] & 0xFF) << 16)
                | ((h[off + 2] & 0xFF) << 8)
                | (h[off + 3] & 0xFF))
    return str(bin_code % (10 ** digits)).rjust(digits, "0")


def totp(secret_base32, at_ms: float | None = None, digits: int = DIGITS) -> str:
    """Vaqt asosidagi kod."""
    at_ms = _now_ms() if at_ms is None else at_ms
    step = int(at_ms // 1000 // PERIOD)
    return hotp(base32_decode(secret_base32), step, digits)


def verify_totp(secret_base32, code, at_ms: float | None = None,
                window: int = WINDOW, last_step: int | None = None) -> dict:
    """
    Kiritilgan kodni tekshiradi.

    Bir marta ishlatilgan oyna qayta qabul qilinmasligi uchun mos kelgan
    qadam raqami qaytariladi — chaqiruvchi uni saqlab, takrorni to'sadi.
    """
    at_ms = _now_ms() if at_ms is None else at_ms
    given = re.sub(r"\D", "", str(code or ""))
    if len(given) != DIGITS:
        return {"ok": False, "step": None}

    secret = base32_decode(secret_base32)
    if not secret:
        return {"ok": False, "step": None}

    now = int(at_ms // 1000 // PERIOD)
    for d in range(-window, window + 1):
        step = now + d
        if last_step is not None and step <= last_step:
            continue        # takroriy kod
        expect = hotp(secret, step)
        # Vaqt bo'yicha farq qilmaydigan solishtirish
        if hmac.compare_digest(expect.encode("ascii"), given.encode("ascii")):
            return {"ok": True, "step": step}
    return {"ok": False, "step": None}


# ═══════════ Sozlash ═══════════

def new_secret() -> str:
    """Yangi maxfiy kalit — 20 bayt (160 bit), standart tavsiya."""
    return base32_encode(_secrets.token_bytes(20))


def group_secret(s) -> str:
    """Kalitni qo'lda kiritish uchun 4 talab bo'lib ajratamiz."""
    t = str(s)
    return " ".join(t[i:i + 4] for i in range(0, len(t), 4)).strip()


def otpauth_uri(secret_base32, account, issuer: str = "Pomodoro") -> str:
    """Authenticator ilovasi o'qiydigan manzil."""
    label = quote(f"{issuer}:{account}", safe="")
    q = urlencode({
        "secret": secret_base32,
        "issuer": issuer,
        "algorithm": "SHA1",
        "digits": str(DIGITS),
        "period": str(PERIOD),
    })
    return f"otpauth://totp/{label}?{q}"


# ═══════════ Zaxira kodlar ═══════════

BACKUP_COUNT = 10


def _backup_hash(code) -> str:
    clean = re.sub(r"[^A-Z0-9]", "", str(code).upper())
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


def new_backup_codes(count: int = BACKUP_COUNT) -> dict:
    """Telefon yo'qolganda kirish uchun bir martalik kodlar."""
    # Chalkashadiganlari (O/0, I/1) yo'q
    ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes = []
    for _ in range(count):
        c = "".join(ALPHA[_secrets.randbelow(len(ALPHA))] for _ in range(10))
        codes.append(c[:5] + "-" + c[5:])
    return {"codes": codes, "hashes": [_backup_hash(c) for c in codes]}


def use_backup_code(hashes: list, code) -> dict:
    """Zaxira kodni tekshiradi va ishlatilganini ro'yxatdan o'chiradi."""
    h = _backup_hash(code)
    lst = hashes if hashes is not None else []
    try:
        i = lst.index(h)
    except ValueError:
        return {"ok": False, "left": len(lst)}
    lst.pop(i)
    return {"ok": True, "left": len(lst)}
