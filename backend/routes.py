"""
Marshrutlar jadvali. Node'dagi `server.js:49-149` ning ko'chirmasi.

Format Node bilan bir xil: metod, yo'l, handler, `open` (autentifikatsiyasiz).
Yo'llarda `:param` — FastAPI sintaksisi emas, chunki moslashtirish
`main._match_route` da qo'lda qilinadi (aniq yo'l dinamikdan ustun).

HOLAT: 79/79 — Node'dagi barcha marshrutlar ko'chirildi.
Moslik `parity.mjs` bilan o'lchanadi: har bir manzilga bir xil so'rov
yuborilib, status, sarlavha va JSON tanasi solishtiriladi.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .core.db import SCHEMA_VERSION
from .routers import auth as Auth
from .routers import export as Data
from .routers import integrations as Integrations
from .routers import profile as Profile
from .routers import report as Report
from .routers import settings as Settings
from .routers import stats as Stats
from .routers import tasks as Tasks
from .routers import timer as Timer


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

    # Profil
    r("GET", "/api/profile", Profile.get_profile),
    r("GET", "/api/profile/card", Profile.get_work_card),
    r("PUT", "/api/profile", Profile.update_profile),
    r("POST", "/api/profile/delete", Profile.delete_account),
    r("POST", "/api/profile/avatar", Profile.upload_avatar),
    r("DELETE", "/api/profile/avatar", Profile.delete_avatar),
    r("GET", "/api/avatar/:id", Profile.get_avatar),
    r("GET", "/api/profile/schedule", Profile.get_work_schedule),
    r("PUT", "/api/profile/schedule", Profile.save_work_schedule),
    r("GET", "/api/integrations", Profile.get_integrations),
    r("PUT", "/api/integrations/:name", Profile.save_integration),

    # Taymer
    r("GET", "/api/timer", Timer.get_timer),
    r("POST", "/api/timer/start", Timer.start_timer),
    r("POST", "/api/timer/pause", Timer.pause_timer),
    r("POST", "/api/timer/resume", Timer.resume_timer),
    r("POST", "/api/timer/complete", Timer.complete_timer),
    r("POST", "/api/timer/stop", Timer.stop_timer),
    r("POST", "/api/timer/skip", Timer.skip_timer),
    r("POST", "/api/timer/cycle-reset", Timer.reset_cycle),

    # Vazifalar va reja
    r("GET", "/api/plan", Tasks.get_plan),
    r("POST", "/api/tasks", Tasks.create_task),
    r("PATCH", "/api/tasks/:id", Tasks.update_task),
    r("DELETE", "/api/tasks/:id", Tasks.delete_task),
    r("POST", "/api/tasks/reorder", Tasks.reorder_tasks),
    r("PUT", "/api/plan/window", Tasks.set_plan_window),
    r("GET", "/api/plan/range", Tasks.get_plan_range),
    r("GET", "/api/plan/workdays", Tasks.workdays_in_range),
    r("POST", "/api/plan/bulk", Tasks.bulk_add_tasks),
    r("GET", "/api/tasks/statuses", Tasks.status_list),
    r("GET", "/api/tasks/categories", Tasks.category_list),
    r("POST", "/api/plan/copy", Tasks.copy_plan),
    r("POST", "/api/tasks/copy", Tasks.copy_tasks),
    r("POST", "/api/tasks/:id/log", Tasks.log_pomodoros),
    r("GET", "/api/tasks/reasons", Tasks.correction_reasons),
    r("POST", "/api/plan/carry", Tasks.carry_over),

    # Tashqi tizimlar.
    # `/api/integrations/jira/preview` aniq yo'l bo'lgani uchun
    # `/api/integrations/:name/...` dan ustun topiladi — `_match_route` shunday.
    r("POST", "/api/integrations/:name/test", Integrations.test_integration),
    r("GET", "/api/integrations/jira/preview", Integrations.jira_preview),
    r("POST", "/api/integrations/jira/import", Integrations.jira_import),
    r("POST", "/api/integrations/:name/export", Integrations.export_report),
    r("POST", "/api/integrations/import", Integrations.generic_import),

    # Autentifikatsiya. `open=True` — sessiyasiz ham kiriladi (13 ta).
    r("GET", "/api/auth/config", Auth.auth_config, True),
    r("POST", "/api/auth/register", Auth.register, True),
    r("POST", "/api/auth/login", Auth.login, True),
    r("POST", "/api/auth/logout", Auth.logout, True),
    r("GET", "/api/auth/me", Auth.me, True),
    r("GET", "/api/auth/start/:provider", Auth.oauth_start, True),
    r("GET", "/api/auth/callback/:provider", Auth.oauth_callback, True),
    r("POST", "/api/auth/password", Auth.change_password),
    r("POST", "/api/auth/verify", Auth.verify_email, True),
    r("POST", "/api/auth/resend-code", Auth.resend_code, True),
    r("POST", "/api/auth/forgot", Auth.forgot_password, True),
    r("POST", "/api/auth/reset", Auth.reset_password, True),

    # Ikki bosqichli tasdiqlash
    r("POST", "/api/auth/2fa/verify", Auth.two_factor_verify, True),
    r("GET", "/api/auth/2fa", Auth.two_factor_status),
    r("POST", "/api/auth/2fa/setup", Auth.two_factor_setup),
    r("POST", "/api/auth/2fa/enable", Auth.two_factor_enable),
    r("POST", "/api/auth/2fa/disable", Auth.two_factor_disable),
    r("POST", "/api/auth/2fa/cancel", Auth.two_factor_cancel),
    r("POST", "/api/auth/2fa/backup-codes", Auth.two_factor_backup_codes),

    # Qurilmalar, SMTP va OAuth sozlamalari.
    # `/api/auth/sessions/revoke-others` `/api/auth/sessions/:id` dan ustun —
    # aniq yo'l dinamikdan oldin topiladi.
    r("GET", "/api/auth/sessions", Auth.my_sessions),
    r("POST", "/api/auth/sessions/revoke-others", Auth.revoke_other_sessions),
    r("DELETE", "/api/auth/sessions/:id", Auth.revoke_my_session),
    r("GET", "/api/auth/smtp", Auth.get_smtp_settings),
    r("PUT", "/api/auth/smtp", Auth.save_smtp_settings),
    r("POST", "/api/auth/smtp/test", Auth.test_smtp),
    r("GET", "/api/auth/oauth-settings", Auth.get_oauth_settings),
    r("PUT", "/api/auth/oauth-settings", Auth.save_oauth_settings),
]
