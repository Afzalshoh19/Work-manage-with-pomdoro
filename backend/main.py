"""
Pomodoro — Ish jarayonini boshqarish tizimi (Python backend)

Node'dagi `server.js` ning o'rnini bosadi. Frontend (`public/`) o'zgarmaydi,
shuning uchun javoblar bayt darajasida bir xil bo'lishi kerak.

Ishga tushirish:
    backend/.venv/Scripts/python -m backend.main
yoki:
    uvicorn backend.main:app --port 4123 --workers 1

DIQQAT: `--workers 1`. Baza — bitta JSON fayl va har yozuvda butunlay
qayta yoziladi; bir nechta worker bir-birining yozuvini yo'q qiladi.
"""
from __future__ import annotations

# `.env` eng boshida o'qilishi kerak — `config` modul yuklanish vaqtida
# `os.environ` ni o'qiydi, shuning uchun tartib muhim.
from .config import load_env_file

_ENV = load_env_file()

import json  # noqa: E402
import sys  # noqa: E402
from urllib.parse import unquote  # noqa: E402

# Windows konsoli standart holda cp1252 — o'zbekcha tire va emoji chiqmaydi.
# Node bunday muammoga duch kelmaydi, shuning uchun bu yerda tenglashtiramiz.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

from fastapi import FastAPI, Request  # noqa: E402
from starlette.responses import Response  # noqa: E402

from . import config  # noqa: E402
from .core import db as DB  # noqa: E402
from .core.auth import has_session, user_from_request  # noqa: E402
from .http_layer import (  # noqa: E402
    MAX_BODY, build_response, json_response, origin_allowed, serve_static,
)
from .routes import ROUTES  # noqa: E402

app = FastAPI(
    title="Pomodoro",
    docs_url=None,       # Node'da yo'q edi — qo'shsak yangi ochiq manzil paydo bo'ladi
    redoc_url=None,
    openapi_url=None,
)


# ═══════════ Marshrut moslash ═══════════

def _match_route(method: str, pathname: str):
    """
    Node'dagi `matchRoute` (server.js:151) semantikasi:
    ANIQ yo'l dinamikdan HAR DOIM ustun — ro'yxatdagi tartibidan qat'i nazar.

    Masalan `/api/tasks/statuses` (aniq) `/api/tasks/:id` (dinamik) bilan
    aralashmaydi, garchi dinamigi ro'yxatda oldinroq bo'lsa ham.
    """
    parts = pathname.split("/")
    dynamic = None

    for route in ROUTES:
        if route["method"] != method:
            continue
        pattern = route["path"]

        if ":" not in pattern:
            if pattern == pathname:
                return {**route, "params": {}}
            continue

        if dynamic:
            continue

        pp = pattern.split("/")
        if len(pp) != len(parts):
            continue

        params = {}
        ok = True
        for a, b in zip(pp, parts):
            if a.startswith(":"):
                params[a[1:]] = unquote(b)
            elif a != b:
                ok = False
                break
        if ok:
            dynamic = {**route, "params": params}

    return dynamic


async def _read_body(req: Request) -> dict:
    """
    Node'dagi `readBody`: 12 MB chegara, bo'sh tana `{}`, har doim JSON.
    `Content-Type` tekshirilmaydi — Node ham tekshirmaydi.

    Tana OQIM bilan o'qiladi va chegaradan oshgan zahoti to'xtatiladi —
    `await req.body()` bo'lsa 13 MB avval butunlay xotiraga tushardi.

    Farq: Node chegaradan oshganda ulanishni uzadi (`req.destroy()`), ya'ni
    mijoz tarmoq xatosini ko'radi. Bu yerda o'sha xabar bilan oddiy javob
    qaytadi — mijoz uchun tushunarliroq, tarmoq darajasida esa ahamiyatsiz.
    """
    chunks: list[bytes] = []
    size = 0
    async for chunk in req.stream():
        size += len(chunk)
        if size > MAX_BODY:
            raise ValueError("Sorov hajmi juda katta")
        chunks.append(chunk)

    if not chunks:
        return {}
    try:
        return json.loads(b"".join(chunks).decode("utf-8"))
    except Exception:
        raise ValueError("JSON formati notogri")


# ═══════════ Yagona kirish nuqtasi ═══════════

@app.api_route("/{full_path:path}",
               methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def dispatch(request: Request, full_path: str) -> Response:
    pathname = request.url.path
    method = request.method

    if method == "OPTIONS":
        return Response(status_code=204,
                        headers={"Allow": "GET,POST,PUT,PATCH,DELETE,OPTIONS"})

    # `/api/` bilan boshlanmagan hamma narsa — fayl.
    # Xom yo'l beriladi: Starlette `%2f` ni yo'l ajratgichiga aylantiradi,
    # Node esa aylantirmaydi — `/..%2ffayl` u yerda oddiy fayl nomi bo'lib
    # 404 oladi, bu yerda esa yo'ldan chiqish deb 403 bo'lib qolardi.
    raw = request.scope.get("raw_path")
    raw_path = raw.decode("latin-1").split("?")[0] if raw else pathname
    if not raw_path.startswith("/api/"):
        return serve_static(request, raw_path, has_session(request))

    route = _match_route(method, pathname)
    if not route:
        return json_response(request, 404, {"error": "Bunday API manzili yoq"})

    if method in ("POST", "PUT", "PATCH", "DELETE") and not origin_allowed(request):
        return json_response(request, 403, {"error": "So'rov manbasi ruxsat etilmagan"})

    sess = user_from_request(request)
    user, token = sess["user"], sess["token"]
    if not route.get("open") and not user:
        return json_response(request, 401,
                             {"error": "Avval tizimga kiring", "code": "AUTH_REQUIRED"})

    try:
        body = await _read_body(request) if method in ("POST", "PUT", "PATCH") else {}
        result = route["handler"]({
            "query": dict(request.query_params),
            "body": body,
            "params": route["params"],
            "req": request,
            "user": user,
            "authToken": token,
        })
        if hasattr(result, "__await__"):
            result = await result
        return build_response(request, result)
    except Exception as err:
        # Node ham handler ichidagi istisnoni 500 + xabar bilan qaytaradi
        print(f"[xato] {method} {pathname}: {err}", file=sys.stderr)
        return json_response(request, 500, {"error": str(err)})


# ═══════════ Ishga tushirish ═══════════

def banner(https_active: bool = False) -> None:
    db = DB.get_db()
    proto = "https" if https_active else "http"
    print("")
    print("  🍅  Pomodoro — Ish jarayonini boshqarish tizimi  (Python)")
    print("  ---------------------------------------------")
    print(f"  Manzil : {proto}://{config.HOST}:{config.PORT}")
    if not https_active:
        print("  Eslatma: HTTPS o'chiq. Tashqi manzilga chiqarishdan oldin")
        print("           TLS_KEY va TLS_CERT ni bering yoki nginx orqasiga qo'ying")
        print("           (u holda TRUST_PROXY=1).")
    print(f"  Baza   : {config.DB_FILE}")
    n = len(db["users"])
    print(f"  Hisob  : {n} ta foydalanuvchi" if n else
          "  Hisob  : hali yo'q — brauzerda ro'yxatdan o'ting")
    if _ENV.get("loaded"):
        # Faqat nomlar — qiymatlar hech qachon jurnalga tushmaydi
        names = config.env_names()
        print("  Maxfiy : .env o'qildi" + (" — " + ", ".join(names) if names
                                           else " (maxfiy kalitlar berilmagan)"))
    print(f"  Marshrut: {len(ROUTES)} ta")
    print("  Toxtatish: Ctrl+C")
    print("")
    # Chiqish faylga yoki journald'ga yo'naltirilganda Python stdout'ni
    # blok bo'yicha buferlaydi — banner bufer to'lguncha ko'rinmay turardi,
    # ya'ni `systemctl status` va `docker logs` bo'sh chiqardi.
    sys.stdout.flush()


def main() -> None:
    import uvicorn

    ssl_args = {}
    if config.TLS_ENABLED:
        ssl_args = {"ssl_keyfile": config.TLS_KEY, "ssl_certfile": config.TLS_CERT}
        if config.TLS_CA:
            ssl_args["ssl_ca_certs"] = config.TLS_CA

    banner(bool(ssl_args))
    uvicorn.run(app, host=config.HOST, port=config.PORT,
                log_level="warning", access_log=False, **ssl_args)


if __name__ == "__main__":
    main()
