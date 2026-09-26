"""
Profil rasmlari. Node'dagi `lib/avatars.js` ning ko'chirmasi.

Rasm bazaga emas, alohida faylga yoziladi: db.json har bir yozuvda
butunlay qayta yoziladi, shuning uchun unga o'nlab kilobaytlik rasm
solish butun tizimni sekinlashtirardi.

Fayl turi kengaytmaga emas, baytlarning o'ziga qarab aniqlanadi —
nomi yoki MIME sarlavhasi soxta bo'lishi mumkin.
"""
from __future__ import annotations

import base64
import os
import re
from pathlib import Path

from ..config import DATA_DIR

# Avatar ikki xil bo'lishi mumkin — rasm yuklanmaganda ishlatiladi:
#   1) SVG belgi — bazada kaliti saqlanadi, chizmasi mijozda (public/js/icons.js)
#   2) Emoji — o'zi saqlanadi
AVATAR_ICONS = [
    "pomodoro", "rocket", "target", "bolt", "star", "flame", "leaf", "wave",
    "book", "briefcase", "bulb", "coffee", "compass", "mountain", "puzzle", "cube",
]

AVATAR_EMOJI = [
    "🍅", "🚀", "🎯", "⚡", "🌟", "🦊", "🐼", "🦉",
    "🌊", "🔥", "🌱", "🎨", "📚", "💼", "🧠", "☕",
]

_ICON_SET = set(AVATAR_ICONS)
_EMOJI_SET = set(AVATAR_EMOJI)


def is_icon_avatar(v) -> bool:
    """Qiymat belgi kalitimi yoki emojimi."""
    return str(v or "") in _ICON_SET


def valid_avatar(value) -> str:
    """Ro'yxatdagi qiymatgina qabul qilinadi, aks holda standarti qaytadi."""
    v = str(value or "")
    return v if (v in _ICON_SET or v in _EMOJI_SET) else AVATAR_ICONS[0]


AVATAR_DIR = Path(DATA_DIR) / "avatars"
MAX_BYTES = 512 * 1024        # 512 KB — 256x256 rasm uchun yetarli


def _is_jpg(b: bytes) -> bool:
    return len(b) > 2 and b[0] == 0xFF and b[1] == 0xD8 and b[2] == 0xFF


def _is_png(b: bytes) -> bool:
    return len(b) > 3 and b[0] == 0x89 and b[1] == 0x50 and b[2] == 0x4E and b[3] == 0x47


def _is_webp(b: bytes) -> bool:
    return len(b) > 12 and b[0:4] == b"RIFF" and b[8:12] == b"WEBP"


# Tartib muhim — Node'da ham shu tartibda tekshiriladi
TYPES = {
    "jpg": {"mime": "image/jpeg", "test": _is_jpg},
    "png": {"mime": "image/png", "test": _is_png},
    "webp": {"mime": "image/webp", "test": _is_webp},
}


def _ensure_dir() -> None:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)


def _file_for(user_id, ext: str) -> Path:
    """Fayl nomi faqat hisob id'sidan quriladi — tashqi matn ishlatilmaydi."""
    safe = re.sub(r"[^\w-]", "", str(user_id))
    return AVATAR_DIR / f"{safe}.{ext}"


def _detect(buf: bytes):
    """Baytlarga qarab turini aniqlaydi."""
    for ext, t in TYPES.items():
        if t["test"](buf):
            return {"ext": ext, "mime": t["mime"]}
    return None


def save_avatar(user_id, data_url) -> dict:
    """`data:image/...` ko'rinishidagi satrni faylga yozadi."""
    m = re.fullmatch(r"data:(image/[a-z+]+);base64,([A-Za-z0-9+/=]+)", str(data_url or "").strip())
    if not m:
        return {"ok": False, "error": "Rasm formati tushunarsiz"}

    try:
        buf = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return {"ok": False, "error": "Rasmni o'qib bo'lmadi"}

    if not buf:
        return {"ok": False, "error": "Rasm bo'sh"}
    if len(buf) > MAX_BYTES:
        from .util import js_round
        return {"ok": False,
                "error": f"Rasm juda katta ({js_round(len(buf) / 1024)} KB). "
                         f"Chegara — {MAX_BYTES // 1024} KB"}

    kind = _detect(buf)
    if not kind:
        return {"ok": False, "error": "Faqat JPG, PNG yoki WebP qabul qilinadi"}

    _ensure_dir()
    remove_avatar(user_id)          # eski kengaytma boshqacha bo'lishi mumkin

    target = _file_for(user_id, kind["ext"])
    tmp = Path(str(target) + ".tmp")
    tmp.write_bytes(buf)
    os.replace(tmp, target)
    return {"ok": True, "ext": kind["ext"]}


def read_avatar(user_id, ext: str | None = None):
    """Saqlangan rasmni qaytaradi."""
    for e in ([ext] if ext else list(TYPES.keys())):
        try:
            return {"buffer": _file_for(user_id, e).read_bytes(),
                    "contentType": TYPES[e]["mime"]}
        except (OSError, KeyError):
            continue        # keyingisini sinaymiz
    return None


def remove_avatar(user_id) -> int:
    """Barcha kengaytmalardagi nusxalarni o'chiradi."""
    removed = 0
    for ext in TYPES:
        try:
            _file_for(user_id, ext).unlink()
            removed += 1
        except OSError:
            pass            # yo'q edi
    return removed


def avatar_url(user) -> str | None:
    """Profilda ko'rsatiladigan manzil — versiya keshni yangilaydi."""
    photo = (user or {}).get("photo") or {}
    if not photo.get("ext"):
        return None
    return f"/api/avatar/{user['id']}?v={photo.get('version') or 1}"
