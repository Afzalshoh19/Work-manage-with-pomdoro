"""Foydalanuvchi profili va integratsiya sozlamalari. Node'dagi `routes/profile.js`."""
from __future__ import annotations

import copy
import re
from datetime import datetime, timezone

from ..core.auth import clear_cookie, destroy_all_sessions, public_user
from ..core.avatars import (
    AVATAR_EMOJI, AVATAR_ICONS, MAX_BYTES, read_avatar, remove_avatar,
    save_avatar, valid_avatar,
)
from ..core.crypto import decrypt_secret, encrypt_secret, mask_secret, verify_password
from ..core.db import (
    DEFAULT_INTEGRATIONS, WEEKDAYS, get_db, persist, user_work_schedule,
)
from ..core.ratelimit import forget_user
from ..core.task_rules import check_lunch
from ..core.util import clamp, is_date, js_round, s_str
from ..core.workcard import work_card

AVATARS = [*AVATAR_ICONS, *AVATAR_EMOJI]
COLORS = ["#ff5f56", "#4a9eff", "#35c88f", "#f6b73c",
          "#a77dff", "#ff8a80", "#00bcd4", "#8bc34a"]


def _ensure_integrations(user: dict) -> dict:
    if not user.get("integrations"):
        user["integrations"] = copy.deepcopy(DEFAULT_INTEGRATIONS)
    for k in DEFAULT_INTEGRATIONS:
        user["integrations"][k] = {**DEFAULT_INTEGRATIONS[k],
                                   **(user["integrations"].get(k) or {})}
    return user["integrations"]


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


# ═══════════ Ish kartasi ═══════════

def get_work_card(ctx):
    """
    Profildagi ish kartasi uchun ma'lumot.
    Alohida marshrut — holat jonli o'zgaradi, butun profilni qayta
    so'rash esa og'ir (integratsiyalar, seanslar va hokazo).
    """
    user, query = ctx["user"], ctx["query"]
    date = query.get("date") if is_date(query.get("date")) else None
    return {
        "card": work_card(user["id"], date),
        "user": public_user(user),
        "timezone": user.get("timezone") or "",
        "lastLoginAt": user.get("lastLoginAt") or None,
        "createdAt": user.get("createdAt"),
    }


# ═══════════ Profil rasmi ═══════════

def upload_avatar(ctx):
    """Rasmni yuklash — mijoz uni 256x256 ga keltirib yuboradi."""
    user = ctx["user"]
    res = save_avatar(user["id"], (ctx["body"] or {}).get("image"))
    if not res["ok"]:
        return {"error": res["error"], "status": 400}

    user["photo"] = {"ext": res["ext"],
                     "version": int(datetime.now(timezone.utc).timestamp() * 1000)}
    persist()
    return {"ok": True, "user": public_user(user)}


def delete_avatar(ctx):
    """Rasmni olib tashlash — belgi yoki emoji avatarga qaytadi."""
    user = ctx["user"]
    remove_avatar(user["id"])
    user.pop("photo", None)
    persist()
    return {"ok": True, "user": public_user(user)}


def get_avatar(ctx):
    """
    Rasmni berish. Tizimga kirgan har qanday foydalanuvchi ko'ra oladi —
    jamoa ichida bir-birining rasmini ko'rish uchun kerak.
    """
    db = get_db()
    owner = next((u for u in db["users"] if u.get("id") == ctx["params"]["id"]), None)
    if not owner or not (owner.get("photo") or {}).get("ext"):
        return {"error": "Rasm yo'q", "status": 404}

    img = read_avatar(owner["id"], owner["photo"]["ext"])
    if not img:
        return {"error": "Rasm topilmadi", "status": 404}

    return {"__raw": {
        "inline": True,
        "contentType": img["contentType"],
        # Manzilda ?v= bor, shuning uchun uzoq keshlash xavfsiz
        "cacheControl": "private, max-age=604800",
        "body": img["buffer"],
    }}


def avatar_limit_kb():
    return MAX_BYTES / 1024


# ═══════════ Profil ═══════════

def get_profile(ctx):
    db = get_db()
    user = ctx["user"]
    my_tasks = [t for t in db["tasks"] if t.get("userId") == user["id"]]
    my_work = [s for s in db["sessions"]
               if s.get("userId") == user["id"] and s.get("mode") == "work"
               and s.get("completed")]
    active_days = {s["date"] for s in my_work}

    sessions = [{"createdAt": s.get("createdAt"), "expiresAt": s.get("expiresAt"),
                 "userAgent": s.get("userAgent")}
                for s in db["authSessions"] if s.get("userId") == user["id"]]
    sessions.sort(key=lambda s: s["createdAt"], reverse=True)

    return {
        "user": public_user(user),
        "avatars": AVATARS,
        "avatarIcons": AVATAR_ICONS,
        "avatarEmoji": AVATAR_EMOJI,
        "colors": COLORS,
        "photoMaxKb": MAX_BYTES / 1024,
        "stats": {
            "totalTasks": len(my_tasks),
            "doneTasks": sum(1 for t in my_tasks if t.get("done")),
            "totalPomodoros": len(my_work),
            "focusHours": js_round(sum(s["actualSec"] for s in my_work) / 360) / 10,
            "activeDays": len(active_days),
            "memberSince": user.get("createdAt"),
        },
        "sessions": sessions,
    }


def update_profile(ctx):
    user, body = ctx["user"], (ctx["body"] or {})

    if "name" in body:
        n = s_str(body["name"], 80)
        if not n:
            return {"error": "Ism bo'sh bo'lmasligi kerak", "status": 400}
        user["name"] = n
    if "jobTitle" in body:
        user["jobTitle"] = s_str(body["jobTitle"], 100)
    if "company" in body:
        user["company"] = s_str(body["company"], 100)
    if "timezone" in body:
        user["timezone"] = s_str(body["timezone"], 60)
    if "avatar" in body:
        user["avatar"] = valid_avatar(body["avatar"])
    if "color" in body and body["color"] in COLORS:
        user["color"] = body["color"]

    persist()
    return {"user": public_user(user)}


def delete_account(ctx):
    db = get_db()
    user, body, req = ctx["user"], (ctx["body"] or {}), ctx["req"]

    if user.get("passwordHash") and not verify_password(
            str(body.get("password") or ""), user.get("passwordSalt"), user.get("passwordHash")):
        return {"error": "Parol noto'g'ri", "status": 401}

    owners = [u for u in db["users"] if u.get("role") == "owner"]
    if user.get("role") == "owner" and len(owners) == 1 and len(db["users"]) > 1:
        return {"error": "Tizim egasi hisobini o'chirishdan oldin boshqa "
                         "foydalanuvchiga egalik bering", "status": 400}

    db["tasks"] = [t for t in db["tasks"] if t.get("userId") != user["id"]]
    db["sessions"] = [s for s in db["sessions"] if s.get("userId") != user["id"]]
    forget_user(user["id"], user.get("email"))
    remove_avatar(user["id"])
    db["dayPlans"] = [d for d in db["dayPlans"] if d.get("userId") != user["id"]]
    db["timers"].pop(user["id"], None)
    db["userState"].pop(user["id"], None)
    db["users"] = [u for u in db["users"] if u.get("id") != user["id"]]
    destroy_all_sessions(user["id"])
    persist()
    return {"ok": True, "__cookie": clear_cookie(req)}


# ═══════════ Integratsiya sozlamalari ═══════════

def get_integrations(ctx):
    it = _ensure_integrations(ctx["user"])

    def mask(cfg):
        return mask_secret(decrypt_secret(cfg["tokenEnc"])) if cfg.get("tokenEnc") else ""

    return {
        "notion": {
            "enabled": it["notion"]["enabled"],
            "parentPageId": it["notion"]["parentPageId"],
            "databaseId": it["notion"]["databaseId"],
            "tokenMask": mask(it["notion"]),
            "hasToken": bool(it["notion"]["tokenEnc"]),
            "lastExportAt": it["notion"]["lastExportAt"],
            "lastError": it["notion"]["lastError"],
        },
        "confluence": {
            "enabled": it["confluence"]["enabled"],
            "baseUrl": it["confluence"]["baseUrl"],
            "email": it["confluence"]["email"],
            "spaceKey": it["confluence"]["spaceKey"],
            "parentPageId": it["confluence"]["parentPageId"],
            "tokenMask": mask(it["confluence"]),
            "hasToken": bool(it["confluence"]["tokenEnc"]),
            "lastExportAt": it["confluence"]["lastExportAt"],
            "lastError": it["confluence"]["lastError"],
        },
        "jira": {
            "enabled": it["jira"]["enabled"],
            "baseUrl": it["jira"]["baseUrl"],
            "email": it["jira"]["email"],
            "jql": it["jira"]["jql"],
            "defaultPomodoros": it["jira"]["defaultPomodoros"],
            "minutesPerPomodoro": it["jira"]["minutesPerPomodoro"],
            "tokenMask": mask(it["jira"]),
            "hasToken": bool(it["jira"]["tokenEnc"]),
            "lastImportAt": it["jira"]["lastImportAt"],
            "lastError": it["jira"]["lastError"],
        },
    }


def save_integration(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    it = _ensure_integrations(user)
    name = ctx["params"]["name"]
    if name not in it:
        return {"error": "Bunday integratsiya yo'q", "status": 404}
    cfg = it[name]

    def set_token(val):
        # Berilmagan yoki bo'sh bo'lsa o'zgarmasin
        if val is None or val == "":
            return
        cfg["tokenEnc"] = None if val == "__clear__" else encrypt_secret(str(val).strip())

    if name == "notion":
        if "parentPageId" in body:
            cfg["parentPageId"] = s_str(body["parentPageId"], 300)
        if "databaseId" in body:
            cfg["databaseId"] = s_str(body["databaseId"], 300)
        set_token(body.get("token"))
    elif name == "confluence":
        if "baseUrl" in body:
            cfg["baseUrl"] = s_str(body["baseUrl"], 300)
        if "email" in body:
            cfg["email"] = s_str(body["email"], 200)
        if "spaceKey" in body:
            cfg["spaceKey"] = s_str(body["spaceKey"], 60).upper()
        if "parentPageId" in body:
            cfg["parentPageId"] = s_str(body["parentPageId"], 60)
        set_token(body.get("token"))
    elif name == "jira":
        if "baseUrl" in body:
            cfg["baseUrl"] = s_str(body["baseUrl"], 300)
        if "email" in body:
            cfg["email"] = s_str(body["email"], 200)
        if "jql" in body:
            cfg["jql"] = s_str(body["jql"], 1000)
        if "defaultPomodoros" in body:
            cfg["defaultPomodoros"] = clamp(body["defaultPomodoros"], 1, 20)
        if "minutesPerPomodoro" in body:
            cfg["minutesPerPomodoro"] = clamp(body["minutesPerPomodoro"], 5, 120)
        set_token(body.get("token"))

    if "enabled" in body:
        cfg["enabled"] = bool(body["enabled"])
    cfg["lastError"] = None
    persist()
    return get_integrations(ctx)


def resolved_config(user: dict, name: str):
    """Shifrlangan kalitlar ochilgan holdagi konfiguratsiya (faqat server ichida)."""
    it = _ensure_integrations(user)
    cfg = it.get(name)
    if not cfg:
        return None
    return {**cfg, "token": decrypt_secret(cfg["tokenEnc"])}


def note_integration_result(user: dict, name: str, error=None,
                            exported_at=None, imported_at=None) -> None:
    it = _ensure_integrations(user)
    it[name]["lastError"] = error
    if exported_at:
        it[name]["lastExportAt"] = exported_at
    if imported_at:
        it[name]["lastImportAt"] = imported_at
    persist()


# ═══════════ Haftalik ish jadvali ═══════════

_HHMM = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")


def _pad(t) -> str:
    return str(t).strip().rjust(5, "0")


def get_work_schedule(ctx):
    user = ctx["user"]
    return {
        "schedule": user_work_schedule(user["id"]),
        "weekdays": WEEKDAYS,
        "onboarded": bool(user.get("onboardedAt")),
    }


def save_work_schedule(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    incoming = body.get("schedule")
    if not incoming or not isinstance(incoming, dict):
        return {"error": "Jadval yuborilmadi", "status": 400}

    out = {}
    enabled_count = 0
    for d in WEEKDAYS:
        k = d["key"]
        # JSON kalitlari satr bo'lishi mumkin — ikkalasi ham tekshiriladi
        raw = incoming.get(k)
        if raw is None:
            raw = incoming.get(str(k))
        if raw is None:
            raw = {}

        start = _pad(s_str(raw.get("start"), 5) or "09:00")
        end = _pad(s_str(raw.get("end"), 5) or "18:00")
        if not _HHMM.match(start) or not _HHMM.match(end):
            return {"error": f"{d['name']} uchun vaqt noto'g'ri kiritilgan", "status": 400}
        if start == end:
            return {"error": f"{d['name']}: boshlanish va tugash vaqti bir xil "
                             f"bo'lmasligi kerak", "status": 400}

        enabled = bool(raw.get("enabled"))
        if enabled:
            enabled_count += 1

        # Tushlik — shu kunning ish vaqti ichida bo'lishi shart
        lunch_enabled = raw.get("lunchEnabled") is not False
        lunch_start = _pad(s_str(raw.get("lunchStart"), 5) or "13:00")
        lunch_end = _pad(s_str(raw.get("lunchEnd"), 5) or "14:00")
        if enabled and lunch_enabled:
            err = check_lunch(lunch_start, lunch_end, start, end)
            if err:
                return {"error": f"{d['name']}: {err}", "status": 400}

        out[k] = {"enabled": enabled, "start": start, "end": end,
                  "lunchEnabled": lunch_enabled,
                  "lunchStart": lunch_start, "lunchEnd": lunch_end}

    if not enabled_count:
        return {"error": "Kamida bitta ish kuni belgilanishi kerak", "status": 400}

    user["workSchedule"] = out
    if body.get("markOnboarded"):
        user["onboardedAt"] = _now_iso()
    persist()
    return {"schedule": user_work_schedule(user["id"]), "weekdays": WEEKDAYS,
            "onboarded": bool(user.get("onboardedAt"))}
