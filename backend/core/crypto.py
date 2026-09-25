"""
Parol xeshlash, sessiya tokenlari va integratsiya kalitlarini shifrlash.

Node'dagi `lib/crypto.js` bilan **bayt darajasida mos** bo'lishi shart —
mavjud parollar va shifrlangan kalitlar o'qilishi kerak.

Ikki nozik joy:
  1. scrypt: Node `salt` ni SATR sifatida oladi (hex satrning o'zi), ya'ni
     uni UTF-8 bayt qiladi. Bu yerda ham `salt.encode("utf-8")` — hex'dan
     baytga o'girish EMAS. Aks holda hamma parol noto'g'ri bo'lib qoladi.
  2. `base64url` Node'da padding'siz — `=` belgilari olib tashlanadi.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets as _secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import SECRET_FILE

# scrypt parametrlari — Node bilan bir xil bo'lishi shart
_SCRYPT = {"n": 16384, "r": 8, "p": 1, "dklen": 64}

_KEY: bytes | None = None


def _key() -> bytes:
    """Server maxfiy kaliti — birinchi ishga tushishda yaratiladi."""
    global _KEY
    if _KEY:
        return _KEY

    path = Path(SECRET_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        try:
            k = bytes.fromhex(path.read_text(encoding="utf-8").strip())
            if len(k) == 32:
                _KEY = k
        except ValueError:
            _KEY = None

    if not _KEY:
        _KEY = _secrets.token_bytes(32)
        path.write_text(_KEY.hex(), encoding="utf-8")
        try:
            os.chmod(path, 0o600)   # Windows'da ta'sir qilmaydi, Unix'da muhim
        except OSError:
            pass

    return _KEY


# ═══════════ Parol ═══════════

def hash_password(password) -> dict:
    salt = _secrets.token_bytes(16).hex()
    h = hashlib.scrypt(str(password).encode("utf-8"), salt=salt.encode("utf-8"), **_SCRYPT)
    return {"salt": salt, "hash": h.hex()}


def verify_password(password, salt: str | None, hash_hex: str | None) -> bool:
    if not salt or not hash_hex:
        return False
    try:
        test = hashlib.scrypt(str(password).encode("utf-8"), salt=str(salt).encode("utf-8"), **_SCRYPT)
        known = bytes.fromhex(hash_hex)
        # Node `timingSafeEqual` uzunlik teng bo'lmasa istisno tashlaydi,
        # shuning uchun u yerda ham oldin uzunlik tekshiriladi
        return len(test) == len(known) and hmac.compare_digest(test, known)
    except Exception:
        return False


def password_problem(password) -> str | None:
    """Parol talablari. Matnlar Node bilan bir xil — interfeys ularni ko'rsatadi."""
    p = str(password or "")
    if len(p) < 8:
        return "Parol kamida 8 ta belgidan iborat bo'lishi kerak"
    if not re.search(r"[a-zA-Z]", p):
        return "Parolda kamida bitta harf bo'lishi kerak"
    if not re.search(r"[0-9]", p):
        return "Parolda kamida bitta raqam bo'lishi kerak"
    if len(p) > 200:
        return "Parol juda uzun"
    return None


# ═══════════ Tokenlar ═══════════

def random_token(nbytes: int = 32) -> str:
    """Node: `randomBytes(n).toString('base64url')` — padding'siz."""
    return base64.urlsafe_b64encode(_secrets.token_bytes(nbytes)).rstrip(b"=").decode("ascii")


# ═══════════ Integratsiya kalitlarini shifrlash ═══════════
# Format: iv_hex:tag_hex:data_hex  (IV 12 bayt, tag 16 bayt, AES-256-GCM)

def encrypt_secret(plain) -> str | None:
    if not plain:
        return None
    iv = _secrets.token_bytes(12)
    # AESGCM shifrmatn oxiriga tegni qo'shib qaytaradi — ajratib olamiz,
    # chunki Node ularni alohida maydonda saqlaydi
    sealed = AESGCM(_key()).encrypt(iv, str(plain).encode("utf-8"), None)
    enc, tag = sealed[:-16], sealed[-16:]
    return ":".join((iv.hex(), tag.hex(), enc.hex()))


def decrypt_secret(payload) -> str | None:
    if not payload:
        return None
    try:
        iv_hex, tag_hex, data_hex = str(payload).split(":")
        sealed = bytes.fromhex(data_hex) + bytes.fromhex(tag_hex)
        return AESGCM(_key()).decrypt(bytes.fromhex(iv_hex), sealed, None).decode("utf-8")
    except Exception:
        return None


def mask_secret(plain) -> str:
    """Interfeysda ko'rsatish uchun niqoblangan ko'rinish."""
    if not plain:
        return ""
    s = str(plain)
    if len(s) <= 8:
        return "••••••••"
    return s[:4] + "••••••••" + s[-4:]
