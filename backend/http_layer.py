"""
HTTP qatlami: javob qurish, xavfsizlik sarlavhalari, statik fayllar, CSRF.

Node'dagi `server.js` ning shu qismlari aynan takrorlanadi — frontend
o'zgarmagani uchun javoblar bayt darajasida bir xil bo'lishi kerak.

Nega FastAPI'ning odatiy vositalari emas:
  * `JSONResponse` kalitlar tartibini va ajratgichlarni o'zgartirishi mumkin;
  * FastAPI tekshiruv xatosida 422 qaytaradi, Node esa 400;
  * xavfsizlik sarlavhalari Node'da `__redirect` va `__html` javoblariga
    QO'YILMAYDI — bu ataylab, shuning uchun middleware'ga chiqarilmadi.
Shu sababli javoblar qo'lda quriladi.

NOM HAQIDA: bu fayl ilgari `http.py` edi va standart kutubxonadagi `http`
paketini soya qilardi. `backend/` sys.path ga tushgan har qanday holatda
(masalan shu papkadan `python -c` yurgizilganda) `import http.client` bizning
faylga tushib, `httpx` ham, `starlette` ham import bo'lolmay qolardi.
Nomi shuning uchun `http_layer` — qaytarib `http.py` qilinmasin.
"""
from __future__ import annotations

import json
import math
import mimetypes
from pathlib import Path

from starlette.responses import Response

from .config import HSTS_DAYS, PUBLIC_DIR
from .core.util import js_ready
from .core.net import is_secure_request

# Node'dagi MIME jadvali (server.js:36-45). Zaxira: application/octet-stream
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}

MAX_BODY = 12 * 1024 * 1024   # 12 MB — Node bilan bir xil


def security_headers(req) -> dict:
    """
    Har bir javobga qo'yiladigan xavfsizlik sarlavhalari.
    HSTS faqat HTTPS orqali kelgan so'rovga qo'yiladi — HTTP ustida
    uni yuborish standart bo'yicha ham ma'nosiz, ham zararli.
    """
    h = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "same-origin",
    }
    if HSTS_DAYS > 0 and is_secure_request(req):
        h["Strict-Transport-Security"] = f"max-age={round(HSTS_DAYS * 86400)}; includeSubDomains"
    return h


def dumps(data) -> str:
    """
    `JSON.stringify(data)` — bo'shliqsiz.
    Node `{"a":1}` yozadi, Python esa standart holda `{"a": 1}` — ajratgichlar
    aniq berilmasa `Content-Length` va tana Node'dan farq qiladi.
    """
    return json.dumps(js_ready(data), ensure_ascii=False, separators=(",", ":"))


def json_response(req, status: int, data, cookie: str | None = None) -> Response:
    body = dumps(data).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        # `len(body)` emas: Content-Length BAYTDA o'lchanadi.
        # O'zbekcha matnda har bir `'` va `—` bir necha bayt.
        "Content-Length": str(len(body)),
        "Cache-Control": "no-store",
        **security_headers(req),
    }
    res = Response(content=body, status_code=status, headers=headers)
    if cookie:
        res.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return res


def origin_allowed(req) -> bool:
    """
    Oddiy CSRF himoyasi: o'zgartiruvchi so'rovlar faqat o'z manzilimizdan.

    `Origin` sarlavhasi yo'q bo'lsa so'rov o'tkaziladi — bu ataylab:
    curl va skriptlar uni yubormaydi. Ikkinchi qatlam himoya — `SameSite=Lax`.
    """
    origin = req.headers.get("origin")
    if not origin:
        return True
    try:
        from urllib.parse import urlsplit
        return urlsplit(origin).netloc == (req.headers.get("host") or "")
    except Exception:
        return False


# ═══════════ Statik fayllar ═══════════

def _etag(st) -> str:
    """
    Node: `'"' + mtimeMs.toString(36) + '-' + size.toString(36) + '"'`.

    ETag mtime'ning KASRLI qismidan ham quriladi, shuning uchun uni Node
    bergan `double` ning AYNAN o'zi qilib hisoblash kerak. Uchta yo'lning
    faqat bittasi to'g'ri:

        st_mtime * 1000                  -> c981eaf6240e7a42   (1 ULP xato)
        st_mtime_ns / 1e6                -> c981eaf6240e7a42   (1 ULP xato)
        ns // 10**6 + (ns % 10**6) / 1e6 -> ca81eaf6240e7a42   (Node bilan bir xil)

    Sabab: `st_mtime_ns` ~1.8e18, ya'ni 2**53 dan katta. Uni butunligicha
    float'ga o'girish past bitlarni yo'qotadi. Butun millisekund va kasr
    qismini alohida hisoblasak, ikkalasi ham aniqlik chegarasida qoladi.

    Bir ULP farq base36 da ko'rinadigan farq beradi ("...e8" va "...e7n"),
    ya'ni Node keshlagan faylni Python qaytadan yuklatardi. Hamma mtime'da
    emas, faqat ba'zilarida — shuning uchun uzoq sezilmay qolgan.
    """
    ns = st.st_mtime_ns
    mtime_ms = ns // 10 ** 6 + (ns % 10 ** 6) / 1e6
    return '"' + js_to_string_36(mtime_ms) + "-" + js_to_string_36(st.st_size) + '"'


_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def js_to_string_36(value: float) -> str:
    """
    JS `Number.prototype.toString(36)` — kasrli sonlar uchun ham.

    Kerak, chunki ETag `stat.mtimeMs.toString(36)` dan quriladi va `mtimeMs`
    kasrli: `1789198039470.7788` → `mty2besu.s1c`. Butun qismini olish
    yetarli emas — ikkala server bir xil ETag berishi kerak, aks holda
    Node'da keshlangan fayl Python'da qaytadan yuklanadi.

    Algoritm V8 `DoubleToRadixCString` dan: raqamlar qolgan xatolik yarim
    ULP dan pasaygunicha chiqariladi.

    Cheklov: 2^53 dan katta butun sonlarda V8 bilan farq qiladi (u butun
    qismni suzuvchi nuqtada bo'ladi va xatolik to'planadi). Bu yerda
    ahamiyatsiz — fayl hajmi va `mtimeMs` bu chegaradan ancha past.
    """
    if value != value or value in (float("inf"), float("-inf")):
        return str(value)
    if value == 0:
        return "0"

    negative = value < 0
    value = abs(value)

    integer = math.floor(value)
    fraction = value - integer
    delta = max(math.nextafter(0.0, 1.0), 0.5 * (math.nextafter(value, math.inf) - value))

    frac_digits: list[str] = []
    if fraction >= delta:
        while True:
            fraction *= 36
            delta *= 36
            digit = int(fraction)
            frac_digits.append(_B36[digit])
            fraction -= digit
            if fraction > 0.5 or (fraction == 0.5 and (digit & 1)):
                if fraction + delta > 1:
                    # Yaxlitlash: oxirgi raqamdan boshlab ko'tarib chiqamiz
                    i = len(frac_digits) - 1
                    while True:
                        if i < 0:
                            integer += 1
                            break
                        d = _B36.index(frac_digits[i])
                        if d + 1 < 36:
                            frac_digits[i] = _B36[d + 1]
                            break
                        frac_digits.pop()
                        i -= 1
                    break
            if fraction < delta:
                break

    n = int(integer)
    int_digits = "" if n else "0"
    while n:
        n, rem = divmod(n, 36)
        int_digits = _B36[rem] + int_digits

    out = int_digits + ("." + "".join(frac_digits) if frac_digits else "")
    return "-" + out if negative else out


def serve_static(req, pathname: str, has_session: bool) -> Response:
    """
    `/api/` bilan boshlanmagan har qanday yo'l shu yerga tushadi.

    Bosh manzil: kirmagan mehmonga taqdimot, kirganga ilovaning o'zi.
    """
    rel = ("/index.html" if has_session else "/landing.html") if pathname == "/" else pathname

    root = Path(PUBLIC_DIR).resolve()
    target = (root / rel.lstrip("/\\")).resolve()

    # Yo'ldan chiqib ketishga yo'l qo'yilmaydi
    if root != target and root not in target.parents:
        return Response("Taqiqlangan", status_code=403,
                        headers={"Content-Type": "text/plain; charset=utf-8"})

    if not target.is_file():
        return Response("404 — sahifa topilmadi", status_code=404,
                        headers={"Content-Type": "text/plain; charset=utf-8"})

    st = target.stat()
    ext = target.suffix.lower()
    etag = _etag(st)

    # Fayl o'zgarsa brauzer eski nusxani ishlatmasligi uchun ETag beramiz.
    # HTML umuman keshlanmaydi — shunda yangilangan JS/CSS havolalari
    # darhol yetib boradi.
    if ext != ".html" and req.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})

    headers = {
        "Content-Type": MIME.get(ext) or mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        "Cache-Control": "no-store, must-revalidate" if ext == ".html" else "no-cache",
        "ETag": etag,
        **security_headers(req),
    }
    return Response(content=target.read_bytes(), status_code=200, headers=headers)


# ═══════════ Handler javoblarini javobga aylantirish ═══════════

def build_response(req, result) -> Response:
    """
    Handler qaytargan obyektni HTTP javobga aylantiradi.
    Tartib Node'dagi bilan bir xil (server.js:347-383) — birinchi mos kelgani.
    """
    if result is None:
        return json_response(req, 200, {"ok": True})

    if not isinstance(result, dict):
        return json_response(req, 200, result)

    cookie = result.get("__cookie")

    # 1) Yo'naltirish — xavfsizlik sarlavhalari QO'YILMAYDI (Node ham qo'ymaydi)
    if "__redirect" in result:
        headers = {"Location": result["__redirect"], "Cache-Control": "no-store"}
        res = Response(status_code=302, headers=headers)
        if cookie:
            res.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
        return res

    # 2) Tayyor HTML — bu ham sarlavhalarsiz
    if "__html" in result:
        body = str(result["__html"]).encode("utf-8")
        return Response(content=body, status_code=200, headers={
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": str(len(body)),
            "Cache-Control": "no-store",
        })

    # 3) Fayl yoki xom tana
    if "__raw" in result:
        raw = result["__raw"]
        body = raw["body"]
        if isinstance(body, str):
            body = body.encode("utf-8")
        headers = {
            "Content-Type": raw.get("contentType") or "application/octet-stream",
            "Content-Length": str(len(body)),
            "Cache-Control": raw.get("cacheControl") or "no-store",
            **security_headers(req),
        }
        if not raw.get("inline"):
            headers["Content-Disposition"] = f'attachment; filename="{raw.get("filename", "fayl")}"'
        return Response(content=body, status_code=200, headers=headers)

    # 4) Xato — `status` javobga tushmaydi, qolgan maydonlar tushadi
    if "error" in result:
        data = {k: v for k, v in result.items() if k not in ("status", "__cookie")}
        return json_response(req, result.get("status") or 400, data, cookie)

    # 5) Oddiy javob
    data = {k: v for k, v in result.items() if k != "__cookie"}
    return json_response(req, 200, data, cookie)
