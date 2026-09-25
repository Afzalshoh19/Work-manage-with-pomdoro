"""
So'rov haqidagi tarmoq ma'lumotlari: ulanish shifrlanganmi va mijoz IP'si.

Server odatda nginx yoki Caddy orqasida turadi — u holda haqiqiy protokol va
IP faqat sarlavhalarda keladi. Bu sarlavhalarni har kimga ishonib bo'lmaydi
(mijoz o'zi yozib yuborishi mumkin), shuning uchun ular faqat TRUST_PROXY
yoqilgandagina o'qiladi.

Node'dagi `lib/net.js` ning ko'chirmasi.
"""
from __future__ import annotations

import re

from ..config import TRUST_PROXY


def is_secure_request(req) -> bool:
    """Ulanish HTTPS ustidanmi."""
    # ASGI `scope["scheme"]` — Node'dagi `socket.encrypted` o'rnida
    if req.url.scheme == "https":
        return True
    if not TRUST_PROXY:
        return False
    proto = str(req.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return proto == "https"


def _normalize_ip(ip) -> str:
    """IPv4-mapped IPv6 (`::ffff:1.2.3.4`) odatiy ko'rinishga keltiriladi."""
    s = str(ip or "").strip()
    if s.startswith("::ffff:"):
        return s[7:]
    return s or "nomalum"


def client_ip(req) -> str:
    """Mijozning IP manzili — cheklovlar shu bo'yicha hisoblanadi."""
    if TRUST_PROXY:
        fwd = str(req.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if fwd:
            return _normalize_ip(fwd)
    return _normalize_ip(req.client.host if req.client else "")


def describe_device(user_agent) -> str:
    """Qurilma nomini brauzer satridan taxminlaymiz — ro'yxatda o'qish uchun."""
    ua = str(user_agent or "")
    if not ua:
        return "Noma'lum qurilma"

    def has(p: str) -> bool:
        return re.search(p, ua, re.I) is not None

    if has(r"Windows"):
        os_name = "Windows"
    elif has(r"Android"):
        os_name = "Android"
    elif has(r"iPhone|iPad|iPod"):
        os_name = "iOS"
    elif has(r"Mac OS X"):
        os_name = "macOS"
    elif has(r"Linux"):
        os_name = "Linux"
    else:
        os_name = ""

    if has(r"Edg/"):
        browser = "Edge"
    elif has(r"OPR/|Opera"):
        browser = "Opera"
    elif has(r"YaBrowser"):
        browser = "Yandex"
    elif has(r"Firefox/"):
        browser = "Firefox"
    elif has(r"Chrome/"):
        browser = "Chrome"
    elif has(r"Safari/"):
        browser = "Safari"
    else:
        browser = ""

    if os_name and browser:
        return f"{browser} · {os_name}"
    return browser or os_name or "Noma'lum qurilma"
