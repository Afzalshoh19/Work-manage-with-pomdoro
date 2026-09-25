"""
Vazifalarga oid umumiy qoidalar.

Node'da bular `routes/tasks.js` ichida turadi va `lib/workcard.js`,
`routes/timer.js`, `routes/settings.js`, `routes/profile.js` ularni
o'sha yerdan import qiladi. JS modullari buni ko'taradi, Python esa
haqiqiy import sikliga tushardi — shuning uchun alohida modulga
chiqarildi.
"""
from __future__ import annotations

import re

CATEGORIES = ["ish", "oqish", "loyiha", "uy", "sport", "meet", "uchrashuv", "boshqa"]

# Uchrashuv turidagi kategoriyalar: vaqti belgilangan, tanaffus hisoblanmaydi
MEET_CATEGORIES = {"meet", "uchrashuv"}


def is_meet(c) -> bool:
    return c in MEET_CATEGORIES


# Tanaffusni uchrashuvning qayeriga qo'yish mumkin
BREAK_PLACEMENTS = {
    "boshida": "Boshida",
    "ortasida": "O'rtasida",
    "oxirida": "Oxirida",
    "vaqt": "Belgilangan vaqtda",
}

HHMM = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")


def _mins(t) -> int:
    h, m = str(t).split(":")
    return int(h) * 60 + int(m)


def check_lunch(lunch_start, lunch_end, work_start, work_end) -> str | None:
    """Tushlik ish vaqti ichidami va haddan uzun emasmi. Xato bo'lsa — matni."""
    if not HHMM.match(str(lunch_start)):
        return "Tushlik boshlanish vaqti notogri (soat:daqiqa)"
    if not HHMM.match(str(lunch_end)):
        return "Tushlik tugash vaqti notogri (soat:daqiqa)"

    ls = _mins(lunch_start)
    le = _mins(lunch_end)
    if le <= ls:
        le += 1440
    if le - ls > 240:
        return "Tushlik 4 soatdan uzun bo'lmasligi kerak"

    ws = _mins(work_start)
    we = _mins(work_end)
    if we <= ws:
        we += 1440

    s, e = ls, le
    while s < ws:
        s += 1440
        e += 1440
    if s < ws or e > we:
        return f"Tushlik ish vaqti ichida bo'lishi kerak ({work_start}–{work_end})"
    return None
