"""
Kichik yordamchilar. Node'dagi `lib/util.js` ning ko'chirmasi.

Sana bilan ishlashda JS xulqi AYNAN takrorlanadi. `addDays` va `daysBetween`
JS'da sanani mahalliy vaqtda quradi (`T12:00:00`), keyin UTC'ga o'girib
kesadi. Soat 12 tanlangani DST siljishidan himoya uchun. Bu ±12 soatdan
katta zonalarda (UTC+13) bir kun xato beradi — lekin tuzatilmaydi: ko'chirish
ichida jimgina xulq o'zgarishi kerak emas.
"""
from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote


def js_round(x):
    """
    JS `Math.round` — yarmi DOIM yuqoriga (+cheksizlik tomon).

    Python `round()` bank yaxlitlashini qiladi: `round(0.5)` → 0, `round(2.5)` → 2.
    JS esa 1 va 3 beradi. Hisobotdagi foizlar va daqiqalar shu yerdan
    bir birlikka farq qilib ketardi.
    """
    if x != x or math.isinf(x):
        return x
    f = math.floor(x)
    diff = x - f
    if diff > 0.5:
        return f + 1
    if diff < 0.5:
        return f
    return f + 1


class _Undefined:
    """
    JS `undefined` ning o'rnini bosuvchi.

    Kerak, chunki `JSON.stringify` mavjud bo'lmagan maydonni butunlay
    TASHLAB KETADI, Python `json.dumps` esa `None` ni `null` deb yozadi.
    Ya'ni `{"done": undefined}` JS'da `{}`, Python'da esa `{"done": null}`
    bo'lib qolardi — bu javobda ko'rinadigan farq.

    `None` esa haqiqiy `null` bo'lib qoladi: ikkovi bir narsa emas.
    """
    __slots__ = ()

    def __repr__(self):
        return "undefined"

    def __bool__(self):
        return False


UNDEFINED = _Undefined()


def prop(d: dict, key: str):
    """
    JS `obj.key` ning aynan o'zi: maydon yo'q bo'lsa `UNDEFINED`,
    bor bo'lsa qiymati (`None` ham qiymat).
    """
    return d[key] if (d is not None and key in d) else UNDEFINED


def js_ready(o):
    """
    JS `JSON.stringify` ga moslash:
      * butun qiymatli son `1.0` emas, `1` bo'lib yoziladi;
      * `UNDEFINED` maydon obyektdan butunlay chiqariladi
        (massivda esa `null` ga aylanadi — JS ham shunday qiladi).
    """
    if isinstance(o, bool):
        return o
    if isinstance(o, _Undefined):
        return None                 # massiv ichida: JS `[undefined]` → `[null]`
    if isinstance(o, float):
        return int(o) if o.is_integer() and abs(o) < 2 ** 53 else o
    if isinstance(o, dict):
        items = [(k, v) for k, v in o.items() if not isinstance(v, _Undefined)]
        return {k: js_ready(v) for k, v in _js_key_order(items)}
    if isinstance(o, (list, tuple)):
        return [js_ready(v) for v in o]
    return o


def _index_key(k):
    """
    Kalit JS «massiv indeksi» bo'la oladimi: butun son yoki nolsiz boshlanuvchi
    raqamli satr. Shunday bo'lsa raqamli qiymati, aks holda `None`.
    """
    if isinstance(k, bool):
        return None
    if isinstance(k, int):
        return k if 0 <= k < 2 ** 32 - 1 else None
    if isinstance(k, str) and k.isdigit() and (k == "0" or k[0] != "0"):
        n = int(k)
        return n if n < 2 ** 32 - 1 else None
    return None


def _js_key_order(items):
    """
    JS obyektlarida kalitlar tartibi: avval RAQAMLI kalitlar o'sish
    bo'yicha, keyin qolganlari kiritilish tartibida.

    Python lug'ati faqat kiritilish tartibini saqlaydi — haftalik jadval
    `{1..6, 0}` bo'lib qolib, Node'dagi `{0..6}` dan farq qilardi.
    """
    raqamli = []
    boshqa = []
    for k, v in items:
        idx = _index_key(k)
        if idx is None:
            boshqa.append((k, v))
        else:
            raqamli.append((idx, k, v))
    raqamli.sort(key=lambda x: x[0])
    return [(k, v) for _, k, v in raqamli] + boshqa


def encode_uri_component(s) -> str:
    """
    JS `encodeURIComponent` ning aynan o'zi.

    Python `quote(s, safe="")` dan farqi: JS `! ~ * ' ( )` belgilarini
    KODLAMAYDI. Shu sababli "Noma'lum provayder" Node'da `Noma'lum%20...`,
    Python'da esa `Noma%27lum%20...` bo'lib, yo'naltirish manzillari
    farq qilardi.
    """
    return quote(str(s), safe="!~*'()")


def uid() -> str:
    return str(uuid.uuid4())


def is_date(s) -> bool:
    return isinstance(s, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) is not None


def _utc_date_of_local(d: datetime) -> str:
    """JS `new Date(<mahalliy>).toISOString().slice(0,10)` ning aynan o'zi."""
    return d.astimezone(timezone.utc).date().isoformat()


def today_local(offset_minutes: float | None = None) -> str:
    """
    Bugungi mahalliy sana.

    JS: `new Date(Date.now() - offset*60000).toISOString().slice(0,10)`,
    bunda `offset` — `getTimezoneOffset()` (UTC+5 uchun -300).
    """
    if offset_minutes is None:
        return datetime.now().date().isoformat()
    d = datetime.now(timezone.utc) - timedelta(minutes=offset_minutes)
    return d.date().isoformat()


def clamp(n, lo, hi):
    """JS `clamp`: son bo'lmasa `lo` qaytadi."""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return lo
    if math.isnan(n) or math.isinf(n):
        return lo
    out = min(hi, max(lo, n))
    # JS'da butun son butun bo'lib qoladi — `540.0` emas, `540`
    return int(out) if float(out).is_integer() and isinstance(lo, int) and isinstance(hi, int) else out


def s_str(v, max_len: int = 500) -> str:
    """JS `str()`: kesadi, keyin chetlarini tozalaydi. Tartib muhim."""
    if v is None:
        return ""
    return str(v)[:max_len].strip()


def time_to_minutes(t) -> int:
    """`"09:00"` → 540. Noto'g'ri qiymat uchun 9*60."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(t or "").strip())
    if not m:
        return 9 * 60
    return clamp(int(m.group(1)), 0, 23) * 60 + clamp(int(m.group(2)), 0, 59)


def minutes_to_time(mins) -> str:
    """540 → `"09:00"`. 24 soatdan oshsa keyingi kunga o'tadi."""
    total = js_round(mins)
    h = (total // 60) % 24
    m = total % 60
    return f"{h:02d}:{m:02d}"


def add_days(date_str: str, n: int) -> str:
    d = datetime.fromisoformat(date_str + "T12:00:00") + timedelta(days=n)
    return _utc_date_of_local(d)


def days_between(frm: str, to: str) -> list[str]:
    out: list[str] = []
    cur = frm
    guard = 0
    while cur <= to and guard < 400:
        guard += 1
        out.append(cur)
        cur = add_days(cur, 1)
    return out
