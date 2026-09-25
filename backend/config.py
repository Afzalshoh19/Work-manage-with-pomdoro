"""
Yo'llar, bayroqlar va muhitdan keladigan maxfiy kalitlar.

Node tomonidagi `lib/paths.js` va `lib/secrets.js` ning birlashmasi —
ikkalasi ham faqat `process.env` ni o'qigani uchun bitta modulga sig'adi.

MUHIM: bu modul import qilinganda `.env` allaqachon o'qilgan bo'lishi kerak,
chunki quyidagi qiymatlar modul yuklanish vaqtida hisoblanadi. Shuning uchun
`main.py` eng birinchi qator sifatida `load_env_file()` ni chaqiradi.
"""
from __future__ import annotations

import os
from pathlib import Path

# backend/config.py -> backend/ -> pomodoro/
ROOT = Path(__file__).resolve().parent.parent

__all__ = [
    "ROOT", "DATA_DIR", "DB_FILE", "TMP_FILE", "BACKUP_DIR", "SECRET_FILE",
    "PUBLIC_DIR", "PORT", "HOST", "SECURE_COOKIES", "TRUST_PROXY",
    "TLS_KEY", "TLS_CERT", "TLS_CA", "TLS_ENABLED", "FORCE_HTTPS", "HSTS_DAYS",
    "load_env_file", "env_smtp", "smtp_from_env", "env_oauth", "oauth_from_env",
    "app_base_url", "env_names",
]


def _flag(name: str, fallback: bool = False) -> bool:
    """`1`, `true`, `yes` — yoqilgan. Node'dagi `flag()` bilan bir xil."""
    v = os.environ.get(name)
    if v is None:
        return fallback
    return v == "1" or v.lower() == "true" or v.lower() == "yes"


def _env(name: str) -> str | None:
    """Bo'sh satr berilmagan bilan barobar."""
    v = os.environ.get(name)
    if v is None or str(v).strip() == "":
        return None
    return str(v).strip()


# ═══════════ Yo'llar ═══════════

DATA_DIR = Path(os.environ["DATA_DIR"]).resolve() if os.environ.get("DATA_DIR") else ROOT / "data"
DB_FILE = DATA_DIR / "db.json"
TMP_FILE = DATA_DIR / "db.tmp.json"
BACKUP_DIR = DATA_DIR / "backups"
SECRET_FILE = DATA_DIR / ".secret"

# Frontend o'zgarmaydi — o'sha `public/` papkasi beriladi
PUBLIC_DIR = ROOT / "public"

PORT = int(os.environ.get("PORT") or 4123)
HOST = os.environ.get("HOST") or "127.0.0.1"


# ═══════════ Bayroqlar ═══════════

# Cookie'ga Secure bayrog'ini majburan qo'yish. Odatda kerak emas:
# ulanish HTTPS ekani so'rovning o'zidan aniqlanadi (core/net.py).
SECURE_COOKIES = _flag("SECURE_COOKIES", os.environ.get("NODE_ENV") == "production")

# Teskari proksi orqasida X-Forwarded-* sarlavhalariga ishonish.
# To'g'ridan-to'g'ri internetga chiqarilgan serverda YOQILMASIN —
# aks holda mijoz o'z IP'sini o'zi yozib, cheklovlarni aylanib o'tadi.
TRUST_PROXY = _flag("TRUST_PROXY", False)

TLS_KEY = os.environ.get("TLS_KEY") or ""
TLS_CERT = os.environ.get("TLS_CERT") or ""
TLS_CA = os.environ.get("TLS_CA") or ""
TLS_ENABLED = bool(TLS_KEY and TLS_CERT)

FORCE_HTTPS = _flag("FORCE_HTTPS", TLS_ENABLED)
HSTS_DAYS = float(os.environ.get("HSTS_DAYS") or 180)


# ═══════════ .env ═══════════

def load_env_file(file: str | os.PathLike | None = None) -> dict:
    """
    `.env` ni bir marta o'qiydi. Fayl bo'lmasa jimgina o'tadi —
    sozlamalarni to'g'ridan-to'g'ri muhitdan berish ham mumkin.

    Node'dagi `process.loadEnvFile` o'rnida. Muhitda allaqachon turgan
    qiymat ustun: `.env` uni bosib ketmaydi (`override=False`).
    """
    if file is None:
        file = os.environ.get("ENV_FILE") or (ROOT / ".env")
    path = Path(file)
    try:
        if not path.exists():
            return {"loaded": False, "file": str(path)}
        from dotenv import load_dotenv
        load_dotenv(path, override=False)
        return {"loaded": True, "file": str(path)}
    except Exception as err:
        print(f"  .env o'qilmadi: {err}")
        return {"loaded": False, "file": str(path), "error": str(err)}


# ═══════════ Pochta serveri ═══════════

def env_smtp() -> dict:
    """
    SMTP sozlamasining muhitdan keladigan qismi.
    Berilmagan maydonlar `None` — ularni baza to'ldiradi.
    """
    port_raw = _env("SMTP_PORT")
    secure_raw = _env("SMTP_SECURE")

    if port_raw is None:
        port = None
    else:
        try:
            n = int(port_raw)
        except ValueError:
            n = 587
        if n == 0:
            n = 587          # Node: `Number(port) || 587`
        port = min(65535, max(1, n))

    if secure_raw is None:
        # Ko'rsatilmasa 465-port odatda to'g'ridan-to'g'ri TLS bo'ladi
        secure = True if port == 465 else None
    else:
        secure = secure_raw.lower() in ("1", "true", "yes", "ha")

    return {
        "host": _env("SMTP_HOST"),
        "port": port,
        "secure": secure,
        "user": _env("SMTP_USER"),
        "pass": _env("SMTP_PASS"),
        "from": _env("SMTP_FROM"),
    }


def smtp_from_env() -> dict:
    """Qaysi SMTP maydonlari muhitdan boshqarilyapti — interfeys shuni ko'rsatadi."""
    e = env_smtp()
    return {
        "host": e["host"] is not None,
        "port": e["port"] is not None,
        "secure": e["secure"] is not None,
        "user": e["user"] is not None,
        "pass": e["pass"] is not None,
        "from": e["from"] is not None,
        "any": any(v is not None for v in e.values()),
    }


# ═══════════ Kirish usullari ═══════════

_OAUTH_ENV = {
    "google": {"id": "GOOGLE_CLIENT_ID", "secret": "GOOGLE_CLIENT_SECRET"},
    "github": {"id": "GITHUB_CLIENT_ID", "secret": "GITHUB_CLIENT_SECRET"},
}


def env_oauth(provider: str) -> dict:
    names = _OAUTH_ENV.get(provider)
    if not names:
        return {"clientId": None, "clientSecret": None}
    return {"clientId": _env(names["id"]), "clientSecret": _env(names["secret"])}


def oauth_from_env(provider: str) -> dict:
    e = env_oauth(provider)
    return {
        "clientId": e["clientId"] is not None,
        "clientSecret": e["clientSecret"] is not None,
        "any": bool(e["clientId"] or e["clientSecret"]),
    }


# ═══════════ Ilova manzili ═══════════

def app_base_url() -> str | None:
    """
    Tashqi manzil. Berilsa OAuth qaytish manzili shundan quriladi —
    proksi orqasida `Host` sarlavhasi haqiqiy domendan farq qilishi mumkin.
    """
    v = _env("APP_BASE_URL")
    return v.rstrip("/") if v else None


# ═══════════ Tashxis ═══════════

def env_names() -> list[str]:
    """
    Muhitda berilgan maxfiy kalitlarning **nomlari**.
    Qiymatlar hech qachon qaytarilmaydi — aks holda parol jurnalda qolardi.
    """
    return [
        n for n in (
            "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
            "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
            "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
            "APP_BASE_URL",
        ) if _env(n) is not None
    ]
