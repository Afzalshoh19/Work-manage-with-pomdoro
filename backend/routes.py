"""
Marshrutlar jadvali. Node'dagi `server.js:49-149` ning ko'chirmasi.

Format Node bilan bir xil: metod, yo'l, handler, `open` (autentifikatsiyasiz).
Yo'llarda `:param` — FastAPI sintaksisi emas, chunki moslashtirish
`main._match_route` da qo'lda qilinadi (aniq yo'l dinamikdan ustun).

KO'CHIRISH HOLATI: bu yerda faqat Python'da TAYYOR handlerlar turadi.
Hali ko'chirilmagan manzil so'ralsa Node'dagi kabi
`404 {"error": "Bunday API manzili yoq"}` qaytadi — ya'ni yarim ishlagan
javob emas, ochiq "yo'q" javobi. `parity.mjs` qaysi biri qolganini ko'rsatadi.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .core.db import SCHEMA_VERSION
from .routers import export as Data
from .routers import report as Report
from .routers import settings as Settings
from .routers import stats as Stats


def _health(ctx):
    return {
        "ok": True,
        "version": SCHEMA_VERSION,
        "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
                + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
    }


def r(method: str, path: str, handler, open_: bool = False) -> dict:
    return {"method": method, "path": path, "handler": handler, "open": open_}


ROUTES: list[dict] = [
    r("GET", "/api/health", _health, True),

    # Sozlamalar
    r("GET", "/api/settings", Settings.get_settings),
    r("PUT", "/api/settings", Settings.update_settings),
    r("POST", "/api/settings/reset", Settings.reset_settings),

    # Statistika va tarix
    r("GET", "/api/stats", Stats.get_stats),
    r("GET", "/api/history", Stats.get_history),

    # Hisobot
    r("GET", "/api/report", Report.preview_report),
    r("GET", "/api/report/download", Report.download_report),
    r("GET", "/api/report/view", Report.view_report),

    # Ma'lumotlar
    r("GET", "/api/export", Data.export_data),
    r("POST", "/api/import", Data.import_data),
    r("POST", "/api/clear", Data.clear_data),
]

# ═══════════ Hali ko'chirilmagan marshrutlar ═══════════
# Node'da 79 ta bor. Qolganlari shu tartibda qo'shiladi:
#   profile → timer → integrations → tasks → auth
# Har biri qo'shilgach tegishli test to'plami yurgiziladi.
