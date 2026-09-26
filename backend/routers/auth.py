"""
Ro'yxatdan o'tish, kirish va OAuth (Google / GitHub).

Node'dagi `routes/auth.js` ning ko'chirmasi — ko'chirishdagi eng katta va
eng nozik fayl. Uchta joyga alohida e'tibor berildi:

  * `__cookie`, `__redirect` — maxsus javob shakllari, `build_response`
    ularni Node'dagidek talqin qiladi;
  * `delete user.totp` — Python'da `user.pop("totp", None)`, ya'ni maydon
    `null` bo'lib qolmaydi, butunlay yo'qoladi;
  * chipta va `state` yozuvlari bazada turadi (xotirada emas) — server
    qayta yuklanganda kirayotgan odam xato olmasin.
"""
from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse, urlunparse

import httpx

from ..config import app_base_url, env_oauth, oauth_from_env
from ..core.auth import (
    clear_cookie, clear_login_failures, create_session, destroy_all_sessions,
    destroy_session, list_sessions, login_blocked, note_login_failure,
    public_user, revoke_session, session_cookie,
)
from ..core.avatars import AVATAR_ICONS
from ..core.crypto import (
    decrypt_secret, encrypt_secret, hash_password, password_problem,
    random_token, verify_password,
)
from ..core.db import (
    DEFAULT_INTEGRATIONS, DEFAULT_SETTINGS, claim_legacy_data,
    default_work_schedule, find_user_by_email, find_user_by_id, get_db, persist,
)
from ..core.integrations import TIMEOUT
from ..core.mailer import save_smtp, send_mail, smtp_config
from ..core.net import client_ip
from ..core.ratelimit import clear_failures, lock_message, locked_for, note_failure
from ..core.totp import (
    BACKUP_COUNT, DIGITS, PERIOD, group_secret, new_backup_codes, new_secret,
    otpauth_uri, use_backup_code, verify_totp,
)
from ..core.util import encode_uri_component, s_str, uid
from ..core.verify import (
    check_code, check_reset_code, issue_code, issue_reset_code, smtp_ready,
)

COLORS = ["#ff5f56", "#4a9eff", "#35c88f", "#f6b73c", "#a77dff", "#ff8a80"]

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[a-z]{2,}$", re.I)


def is_email(e) -> bool:
    return bool(_EMAIL_RE.match(str(e or "").strip()))


def _now_iso() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _local_tz() -> str:
    """
    JS `Intl.DateTimeFormat().resolvedOptions().timeZone` — IANA nomi
    ("Asia/Tashkent").

    `datetime.now().astimezone().tzinfo` Windows'da o'rniga o'sha zonaning
    Windows nomini beradi ("West Asia Standard Time"), ya'ni Node yozgan
    qiymatdan butunlay boshqacha satr bo'lib qolardi. `tzlocal` Windows
    nomini IANA nomiga o'giradi; aniqlab bo'lmasa Node ham bo'sh satr
    yozadigan holatga tushamiz.
    """
    try:
        from tzlocal import get_localzone_name
        return get_localzone_name() or ""
    except Exception:      # noqa: BLE001 — zona aniqlanmasa bo'sh satr
        return ""


# ═══════════ Foydalanuvchi yaratish ═══════════

def new_user(email, name=None, provider="local", provider_id=None, password=None) -> dict:
    db = get_db()
    is_first = len(db["users"]) == 0
    email_s = str(email).strip()
    user = {
        "id": uid(),
        "email": email_s,
        "emailLower": email_s.lower(),
        "name": s_str(name, 80) or email_s.split("@")[0],
        "avatar": AVATAR_ICONS[len(db["users"]) % len(AVATAR_ICONS)],
        "color": COLORS[len(db["users"]) % len(COLORS)],
        "jobTitle": "",
        "company": "",
        "timezone": _local_tz(),
        "provider": provider,
        "providerIds": {provider: str(provider_id)} if provider_id else {},
        # Google/GitHub emailni o'zi tasdiqlagan; oddiy ro'yxatdan o'tishda kod yuboriladi
        "emailVerified": provider != "local",
        "emailVerifiedAt": _now_iso() if provider != "local" else None,
        "passwordHash": None,
        "passwordSalt": None,
        "role": "owner" if is_first else "user",
        "settings": {**DEFAULT_SETTINGS},
        "workSchedule": default_work_schedule(),
        "onboardedAt": None,
        "integrations": copy.deepcopy(DEFAULT_INTEGRATIONS),
        "createdAt": _now_iso(),
        "lastLoginAt": _now_iso(),
    }
    if password:
        pair = hash_password(password)
        user["passwordSalt"] = pair["salt"]
        user["passwordHash"] = pair["hash"]
    db["users"].append(user)
    if is_first:
        claim_legacy_data(user["id"])
    persist()
    return user


# ═══════════ Email + parol ═══════════

async def register(ctx):
    body, req = (ctx["body"] or {}), ctx["req"]
    email = s_str(body.get("email"), 200)
    name = s_str(body.get("name"), 80)
    password = str(body.get("password") or "")
    ip = client_ip(req)

    # Bitta tarmoqdan ommaviy hisob ochishga cheklov
    ip_lock = locked_for("register-ip", ip)
    if ip_lock:
        return {"error": f"Juda ko'p hisob ochildi. {lock_message(ip_lock)}", "status": 429}

    if not is_email(email):
        return {"error": "Email manzili noto'g'ri", "status": 400}
    if not name:
        return {"error": "Ismingizni kiriting", "status": 400}
    pw = password_problem(password)
    if pw:
        return {"error": pw, "status": 400}
    if find_user_by_email(email):
        return {"error": "Bu email allaqachon ro'yxatdan o'tgan", "status": 409}

    note_failure("register-ip", ip)   # har bir yangi hisob shu IP hisobiga yoziladi
    user = new_user(email=email, name=name, provider="local", password=password)

    # Pochta serveri sozlanmagan bo'lsa kodni yetkazib bo'lmaydi — bunday holatda
    # tasdiqlash talab qilinmaydi, aks holda hech kim ro'yxatdan o'ta olmaydi.
    if not smtp_ready():
        user["emailVerified"] = True
        user["emailVerifiedAt"] = _now_iso()
        persist()
        token = create_session(user["id"], req)
        return {"user": public_user(user), "__cookie": session_cookie(token, req),
                "verificationSkipped": True}

    # Email tasdiqlanmaguncha sessiya ochilmaydi
    res = await issue_code(user)
    return {
        "pendingVerification": True,
        "email": user["email"],
        "sent": bool(res.get("sent")),
        "smtpReady": smtp_ready(),
        "message": (f"Tasdiqlash kodi {user['email']} manziliga yuborildi"
                    if res.get("sent")
                    else "Pochta serveri sozlanmagan — kod server jurnaliga yozildi"),
    }


# ═══════════ Email tasdiqlash ═══════════

def verify_email(ctx):
    """Kiritilgan kodni tekshiradi va sessiyani ochadi."""
    body, req = (ctx["body"] or {}), ctx["req"]
    ip = client_ip(req)
    ip_lock = locked_for("code-ip", ip)
    if ip_lock:
        return {"error": f"Juda ko'p urinish. {lock_message(ip_lock)}", "status": 429}

    email = s_str(body.get("email"), 200)
    user = find_user_by_email(email)
    if not user:
        return {"error": "Bunday hisob topilmadi", "status": 404}
    if user.get("emailVerified"):
        return {"error": "Email allaqachon tasdiqlangan", "status": 400}

    res = check_code(user, body.get("code"))
    if not res.get("ok"):
        note_failure("code-ip", ip)
        return {"error": res.get("error"), "status": 400}
    clear_failures("code-ip", ip)

    user["lastLoginAt"] = _now_iso()
    persist()
    token = create_session(user["id"], req)
    return {"user": public_user(user), "__cookie": session_cookie(token, req)}


async def resend_code(ctx):
    """Kodni qayta yuborish."""
    body = ctx["body"] or {}
    email = s_str(body.get("email"), 200)
    user = find_user_by_email(email)
    # Mavjud bo'lmagan hisob haqida ma'lumot bermaymiz
    if not user or user.get("emailVerified"):
        return {"ok": True, "sent": False,
                "message": "Agar bunday hisob bo'lsa, kod yuborildi"}
    res = await issue_code(user)
    if not res.get("ok"):
        return {"error": res.get("error"), "status": 429}
    return {
        "ok": True,
        "sent": bool(res.get("sent")),
        "smtpReady": smtp_ready(),
        "message": ("Yangi kod yuborildi" if res.get("sent")
                    else "Pochta serveri sozlanmagan — kod server jurnaliga yozildi"),
    }


# ═══════════ SMTP sozlamalari (faqat egasi) ═══════════

def get_smtp_settings(ctx):
    user = ctx["user"]
    if user.get("role") != "owner":
        return {"error": "Faqat tizim egasi ko'ra oladi", "status": 403}
    c = smtp_config()
    return {
        "enabled": c["enabled"], "host": c["host"], "port": c["port"],
        "secure": c["secure"], "user": c["user"], "from": c["from"],
        "hasPass": bool(c.get("passPlain") or c.get("passEnc")),
        # Qaysi maydon `.env` dan kelayotgani — interfeys ularni qulflaydi
        "fromEnv": c["fromEnv"],
        "ready": smtp_ready(), "lastError": c.get("lastError"),
        "lastSentAt": c.get("lastSentAt"),
    }


def save_smtp_settings(ctx):
    user = ctx["user"]
    if user.get("role") != "owner":
        return {"error": "Faqat tizim egasi o'zgartira oladi", "status": 403}
    save_smtp(ctx["body"] or {})
    return get_smtp_settings(ctx)


async def test_smtp(ctx):
    """Sinov xati — sozlash to'g'riligini tekshirish uchun."""
    user, body = ctx["user"], (ctx["body"] or {})
    if user.get("role") != "owner":
        return {"error": "Faqat tizim egasi", "status": 403}
    if not smtp_ready():
        return {"error": "Avval SMTP ma'lumotlarini to'ldiring va yoqing", "status": 400}
    to = s_str(body.get("to"), 200) or user["email"]
    res = await send_mail({
        "to": to,
        "subject": "Pomodoro — sinov xati",
        "text": ("Bu sinov xati. Agar buni o'qiyotgan bo'lsangiz, "
                 "pochta sozlamasi to'g'ri ishlayapti."),
    })
    if res.get("sent"):
        return {"ok": True, "to": to}
    return {"error": res.get("error") or "Yuborilmadi", "status": 502}


def login(ctx):
    body, req = (ctx["body"] or {}), ctx["req"]
    email = s_str(body.get("email"), 200)
    password = str(body.get("password") or "")
    ip = client_ip(req)

    blocked = login_blocked(email, ip)
    if blocked:
        return {"error": blocked, "status": 429}

    user = find_user_by_email(email)
    if (not user or not user.get("passwordHash")
            or not verify_password(password, user.get("passwordSalt"), user.get("passwordHash"))):
        note_login_failure(email, ip)
        return {"error": "Email yoki parol noto'g'ri", "status": 401}
    clear_login_failures(email, ip)

    # Tasdiqlanmagan hisob — kod so'raladi. Pochta sozlanmagan bo'lsa
    # kodni yetkazib bo'lmaydi, shuning uchun to'sib qo'yilmaydi.
    if (user.get("provider") == "local" and user.get("emailVerified") is False
            and smtp_ready()):
        return {"pendingVerification": True, "email": user["email"],
                "error": "Avval emailingizni tasdiqlang", "status": 403}

    # Ikki bosqichli tasdiqlash yoqilgan bo'lsa — sessiya hali ochilmaydi
    if (user.get("totp") or {}).get("enabled"):
        return {
            "twoFactorRequired": True,
            "ticket": new_ticket(user["id"]),
            "email": user["email"],
            "backupLeft": len(user["totp"].get("backupHashes") or []),
        }

    return finish_login(user, req)


def finish_login(user: dict, req) -> dict:
    """Parol (va kerak bo'lsa 2FA) tekshirilgandan keyingi umumiy qism."""
    user["lastLoginAt"] = _now_iso()
    persist()
    token = create_session(user["id"], req)
    return {"user": public_user(user), "__cookie": session_cookie(token, req)}


def logout(ctx):
    if ctx["authToken"]:
        destroy_session(ctx["authToken"])
    return {"ok": True, "__cookie": clear_cookie(ctx["req"])}


def me(ctx):
    user = ctx["user"]
    if not user:
        return {"user": None}
    return {
        "user": public_user(user),
        "settings": {**DEFAULT_SETTINGS, **(user.get("settings") or {})},
        "onboarded": bool(user.get("onboardedAt")),
    }


def change_password(ctx):
    user, body = ctx["user"], (ctx["body"] or {})
    current = str(body.get("currentPassword") or "")
    nxt = str(body.get("newPassword") or "")
    problem = password_problem(nxt)
    if problem:
        return {"error": problem, "status": 400}

    if user.get("passwordHash") and not verify_password(
            current, user.get("passwordSalt"), user.get("passwordHash")):
        return {"error": "Joriy parol noto'g'ri", "status": 401}
    pair = hash_password(nxt)
    user["passwordSalt"] = pair["salt"]
    user["passwordHash"] = pair["hash"]
    persist()
    destroy_all_sessions(user["id"], ctx["authToken"])
    return {"ok": True,
            "message": "Parol yangilandi. Boshqa qurilmalardagi seanslar yopildi."}


# ═══════════ OAuth ═══════════

# OAuth oqimidagi `state` bazada saqlanadi. Xotirada tursa, server qayta
# yuklanganda yoki ikkinchi nusxa ishga tushganda o'sha paytda kirayotgan
# odam xatolikka uchrardi.
STATE_TTL_MS = 10 * 60000


def _oauth_states() -> dict:
    db = get_db()
    if not isinstance(db.get("oauthStates"), dict):
        db["oauthStates"] = {}
    return db["oauthStates"]


def _clean_pending() -> None:
    st = _oauth_states()
    now = _now_ms()
    eskilar = [k for k, v in st.items()
               if not (v or {}).get("createdAt") or now - v["createdAt"] > STATE_TTL_MS]
    for k in eskilar:
        del st[k]
    if eskilar:
        persist()


def _put_state(state: str, provider: str) -> None:
    _oauth_states()[state] = {"provider": provider, "createdAt": _now_ms()}
    persist()


def _take_state(state):
    """state bir marta ishlatiladi — o'qilgach darhol o'chiriladi."""
    st = _oauth_states()
    kalit = str(state or "")
    rec = st.get(kalit)
    if not rec:
        return None
    del st[kalit]
    persist()
    if _now_ms() - rec["createdAt"] > STATE_TTL_MS:
        return None
    return rec


async def _google_profile(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.get("https://www.googleapis.com/oauth2/v3/userinfo",
                        headers={"Authorization": "Bearer " + access_token})
    if not (200 <= r.status_code < 300):
        raise RuntimeError(f"Google profilini olishda xato ({r.status_code})")
    p = r.json()
    return {"id": p.get("sub"), "email": p.get("email"),
            "name": p.get("name") or p.get("given_name"),
            "verified": p.get("email_verified")}


async def _github_profile(access_token: str) -> dict:
    h = {"Authorization": "Bearer " + access_token,
         "Accept": "application/vnd.github+json",
         "User-Agent": "pomodoro-app"}
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.get("https://api.github.com/user", headers=h)
        if not (200 <= r.status_code < 300):
            raise RuntimeError(f"GitHub profilini olishda xato ({r.status_code})")
        p = r.json()
        email = p.get("email")
        if not email:
            re_ = await c.get("https://api.github.com/user/emails", headers=h)
            if 200 <= re_.status_code < 300:
                lst = re_.json() or []
                tanlangan = (next((e for e in lst if e.get("primary") and e.get("verified")), None)
                             or next((e for e in lst if e.get("verified")), None)
                             or (lst[0] if lst else None))
                email = (tanlangan or {}).get("email")
    return {"id": str(p.get("id")), "email": email,
            "name": p.get("name") or p.get("login"), "verified": True}


PROVIDERS = {
    "google": {
        "name": "Google",
        "authUrl": "https://accounts.google.com/o/oauth2/v2/auth",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
        "profile": _google_profile,
    },
    "github": {
        "name": "GitHub",
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "scope": "read:user user:email",
        "profile": _github_profile,
    },
}


def auth_config(ctx=None):
    """Qaysi kirish usullari yoqilgan."""
    db = get_db()

    # clientId `.env` da bo'lishi mumkin, shuning uchun bazadan emas,
    # `_oauth_conf()` orqali o'qiladi — aks holda tugma umuman chiqmasdi
    def yoqilgan(p):
        c = _oauth_conf(p)
        return bool(c["enabled"] and c["clientId"])

    return {
        "providers": {
            "google": {"enabled": yoqilgan("google"), "name": "Google"},
            "github": {"enabled": yoqilgan("github"), "name": "GitHub"},
        },
        "hasUsers": len(db["users"]) > 0,
    }


def _oauth_conf(provider: str) -> dict:
    """
    Provayder sozlamasi: muhit o'zgaruvchisi bazadagi qiymatdan ustun.
    Muhitdagi secret bazaga umuman yozilmaydi — faqat xotirada.
    """
    db = get_db()
    saved = (db.get("oauth") or {}).get(provider) or {}
    e = env_oauth(provider)
    return {
        "enabled": bool(saved.get("enabled")),
        "clientId": e.get("clientId") or saved.get("clientId") or "",
        "clientSecret": (e.get("clientSecret")
                         or decrypt_secret(saved.get("clientSecretEnc")) or ""),
        "fromEnv": oauth_from_env(provider),
    }


def _redirect_uri(req, provider: str) -> str:
    """
    Qaytish manzili. APP_BASE_URL berilgan bo'lsa shundan quriladi —
    proksi orqasida `Host` sarlavhasi haqiqiy domendan farq qilishi mumkin.
    """
    base = app_base_url()
    if base:
        return f"{base}/api/auth/callback/{provider}"
    host = req.headers.get("host") or "127.0.0.1:4123"
    proto = str(req.headers.get("x-forwarded-proto") or "http").split(",")[0]
    return f"{proto}://{host}/api/auth/callback/{provider}"


def oauth_start(ctx):
    req = ctx["req"]
    provider = ctx["params"]["provider"]
    cfg = PROVIDERS.get(provider)
    conf = _oauth_conf(provider)
    if not cfg or not conf["enabled"] or not conf["clientId"]:
        nom = cfg["name"] if cfg else provider
        return {"error": f"{nom} orqali kirish sozlanmagan", "status": 400}
    _clean_pending()
    state = random_token(16)
    _put_state(state, provider)

    params = {
        "client_id": conf["clientId"],
        "redirect_uri": _redirect_uri(req, provider),
        "response_type": "code",
        "scope": cfg["scope"],
        "state": state,
    }
    if provider == "google":
        params["access_type"] = "online"
        params["prompt"] = "select_account"

    # `URL.searchParams` bilan bir xil kodlash: bo'shliq `+`, qolgani percent
    u = urlparse(cfg["authUrl"])
    return {"__redirect": urlunparse(u._replace(query=urlencode(params)))}


async def oauth_callback(ctx):
    req, query = ctx["req"], ctx["query"]
    provider = ctx["params"]["provider"]
    cfg = PROVIDERS.get(provider)

    def fail(msg):
        return {"__redirect": "/login.html?error=" + encode_uri_component(msg)}

    if not cfg:
        return fail("Noma'lum provayder")
    if query.get("error"):
        return fail(f"{cfg['name']}: {query['error']}")
    rec = _take_state(query.get("state"))
    if not rec or rec.get("provider") != provider:
        return fail("Sessiya eskirgan, qaytadan urining")
    if not query.get("code"):
        return fail("Kod olinmadi")

    conf = _oauth_conf(provider)
    client_secret = conf["clientSecret"]
    if not conf["clientId"] or not client_secret:
        return fail(f"{cfg['name']} sozlamalari to'liq emas")

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token_res = await c.post(
                cfg["tokenUrl"],
                headers={"Content-Type": "application/x-www-form-urlencoded",
                         "Accept": "application/json"},
                content=urlencode({
                    "client_id": conf["clientId"],
                    "client_secret": client_secret,
                    "code": query["code"],
                    "grant_type": "authorization_code",
                    "redirect_uri": _redirect_uri(req, provider),
                }),
            )
        try:
            token_data = token_res.json()
        except ValueError:
            token_data = {}
        if not (200 <= token_res.status_code < 300) or not token_data.get("access_token"):
            sabab = (token_data.get("error_description") or token_data.get("error")
                     or token_res.status_code)
            return fail(f"{cfg['name']} token xatosi: {sabab}")

        profile = await cfg["profile"](token_data["access_token"])
        if not profile.get("email"):
            return fail(f"{cfg['name']} hisobingizda ochiq email topilmadi")

        user = next((u for u in get_db()["users"]
                     if (u.get("providerIds") or {}).get(provider) == profile["id"]), None)
        if not user:
            user = find_user_by_email(profile["email"])
        if user:
            user["providerIds"] = {**(user.get("providerIds") or {}),
                                   provider: profile["id"]}
            user["lastLoginAt"] = _now_iso()
            persist()
        else:
            user = new_user(email=profile["email"], name=profile.get("name"),
                            provider=provider, provider_id=profile["id"])

        # OAuth bilan kirganda ham ikki bosqichli tasdiqlash so'raladi
        if (user.get("totp") or {}).get("enabled"):
            return {"__redirect": "/login.html?twofa="
                                  + encode_uri_component(new_ticket(user["id"]))}
        token = create_session(user["id"], req)
        return {"__redirect": "/", "__cookie": session_cookie(token, req)}
    except Exception as err:      # noqa: BLE001 — Node ham hamma xatoni shu yerda tutadi
        return fail(str(err) or "OAuth xatosi")


# ═══════════ OAuth sozlamalari (faqat egasi) ═══════════

def get_oauth_settings(ctx):
    user = ctx["user"]
    if user.get("role") != "owner":
        return {"error": "Faqat tizim egasi o'zgartira oladi", "status": 403}
    db = get_db()

    def view(p):
        conf = _oauth_conf(p)
        return {
            "enabled": bool(db["oauth"][p].get("enabled")),
            "clientId": conf["clientId"],
            "hasSecret": bool(conf["clientSecret"]),
            "fromEnv": oauth_from_env(p),
        }

    return {"google": view("google"), "github": view("github")}


def save_oauth_settings(ctx):
    user, body, req = ctx["user"], (ctx["body"] or {}), ctx["req"]
    if user.get("role") != "owner":
        return {"error": "Faqat tizim egasi o'zgartira oladi", "status": 403}
    db = get_db()
    provider = "github" if body.get("provider") == "github" else "google"
    conf = db["oauth"][provider]

    # Muhit o'zgaruvchisi boshqaradigan maydon bazaga yozilmaydi —
    # baribir muhit ustun, yozish faqat chalkashlik tug'dirardi
    env = oauth_from_env(provider)

    if "clientId" in body and not env.get("clientId"):
        conf["clientId"] = s_str(body["clientId"], 300)
    if body.get("clientSecret") and not env.get("clientSecret"):
        # Bo'sh qoldirilsa eskisi saqlanadi; "__clear__" — o'chirish
        conf["clientSecretEnc"] = (None if body["clientSecret"] == "__clear__"
                                   else encrypt_secret(str(body["clientSecret"]).strip()))
    if "enabled" in body:
        conf["enabled"] = bool(body["enabled"])
    persist()
    return {**get_oauth_settings(ctx), "redirectUri": _redirect_uri(req, provider)}


# ═══════════ Parolni unutdim ═══════════

async def forgot_password(ctx):
    """
    Tiklash kodini so'rash.
    Javob har doim bir xil — bunday email bor-yo'qligini bildirmaydi.
    """
    body, req = (ctx["body"] or {}), ctx["req"]
    email = s_str(body.get("email"), 200)
    ip = client_ip(req)

    ip_lock = locked_for("forgot-ip", ip)
    if ip_lock:
        return {"error": f"Juda ko'p so'rov. {lock_message(ip_lock)}", "status": 429}
    mail_lock = locked_for("forgot", email)
    if mail_lock:
        return {"error": f"Juda ko'p so'rov. {lock_message(mail_lock)}", "status": 429}

    neutral = {
        "ok": True,
        "smtpReady": smtp_ready(),
        "message": ("Agar bunday hisob mavjud bo'lsa, tiklash kodi emailga yuborildi"
                    if smtp_ready()
                    else "Pochta serveri sozlanmagan — kod server jurnaliga yozildi"),
    }

    # Hisoblagich hisob bor-yo'qligidan qat'i nazar oshiriladi: aks holda
    # tasodifiy manzillarga cheksiz so'rov yuborib, endpointni charchatish mumkin
    note_failure("forgot-ip", ip)
    note_failure("forgot", email)

    user = find_user_by_email(email)
    if not user:
        return neutral

    # Faqat parol bilan kiradigan hisoblar uchun ma'noga ega
    if not user.get("passwordHash") and user.get("provider") != "local":
        return {**neutral,
                "message": (f"Bu hisob {user.get('provider')} orqali ochilgan — "
                            "o'sha xizmat orqali kiring")}

    res = await issue_reset_code(user)
    if not res.get("ok"):
        return {"error": res.get("error"), "status": 429}
    return neutral


def reset_password(ctx):
    """Kod bilan yangi parol o'rnatish."""
    body, req = (ctx["body"] or {}), ctx["req"]
    ip = client_ip(req)
    ip_lock = locked_for("code-ip", ip)
    if ip_lock:
        return {"error": f"Juda ko'p urinish. {lock_message(ip_lock)}", "status": 429}

    email = s_str(body.get("email"), 200)
    password = str(body.get("password") or "")
    problem = password_problem(password)
    if problem:
        return {"error": problem, "status": 400}

    user = find_user_by_email(email)
    if not user:
        note_failure("code-ip", ip)
        return {"error": "Kod yoki email noto'g'ri", "status": 400}

    res = check_reset_code(user, body.get("code"))
    if not res.get("ok"):
        note_failure("code-ip", ip)
        return {"error": res.get("error"), "status": 400}
    clear_failures("code-ip", ip)
    clear_failures("login", email)
    clear_failures("login-ip", ip)

    pair = hash_password(password)
    user["passwordSalt"] = pair["salt"]
    user["passwordHash"] = pair["hash"]
    # Parol tiklangach eski seanslar ishonchsiz — hammasi yopiladi
    destroy_all_sessions(user["id"])
    # Kodni emailga yetkaza olgan bo'lsak, email egasi ekani tasdiqlangan
    if not user.get("emailVerified"):
        user["emailVerified"] = True
        user["emailVerifiedAt"] = _now_iso()
    user["lastLoginAt"] = _now_iso()
    persist()

    # 2FA yoqilgan bo'lsa parol yetarli emas
    if (user.get("totp") or {}).get("enabled"):
        return {
            "passwordChanged": True,
            "twoFactorRequired": True,
            "ticket": new_ticket(user["id"]),
            "email": user["email"],
            "backupLeft": len(user["totp"].get("backupHashes") or []),
        }

    token = create_session(user["id"], req)
    return {
        "user": public_user(user),
        "passwordChanged": True,
        "message": "Parol yangilandi. Barcha qurilmalardagi seanslar yopildi.",
        "__cookie": session_cookie(token, req),
    }


# ═══════════ Qurilmalar (ochiq seanslar) ═══════════

def my_sessions(ctx):
    return {"sessions": list_sessions(ctx["user"]["id"], ctx["authToken"])}


def revoke_my_session(ctx):
    user, token = ctx["user"], ctx["authToken"]
    res = revoke_session(user["id"], ctx["params"]["id"], token)
    if res == "topilmadi":
        return {"error": "Bunday seans topilmadi", "status": 404}
    if res == "joriy":
        return {"error": ("Joriy qurilmani shu yerdan yopib bo'lmaydi — "
                          "«Chiqish» tugmasini bosing"), "status": 400}
    return {"ok": True, "sessions": list_sessions(user["id"], token)}


def revoke_other_sessions(ctx):
    """Joriy qurilmadan tashqari hammasini yopish."""
    user, token = ctx["user"], ctx["authToken"]
    before = len(list_sessions(user["id"], token))
    destroy_all_sessions(user["id"], token)
    after = len(list_sessions(user["id"], token))
    return {"ok": True, "closed": before - after,
            "sessions": list_sessions(user["id"], token)}


# ═══════════ Ikki bosqichli tasdiqlash (2FA) ═══════════

TICKET_TTL_MS = 5 * 60000


def _tickets() -> dict:
    db = get_db()
    if not isinstance(db.get("twoFactorPending"), dict):
        db["twoFactorPending"] = {}
    return db["twoFactorPending"]


def new_ticket(user_id) -> str:
    """Parol to'g'ri, endi kod kutilyapti — shu holat uchun qisqa muddatli chipta."""
    t = _tickets()
    now = _now_ms()
    for k in [k for k, v in t.items() if now - ((v or {}).get("createdAt") or 0) > TICKET_TTL_MS]:
        del t[k]
    ticket = random_token(24)
    t[ticket] = {"userId": user_id, "createdAt": now}
    persist()
    return ticket


def _take_ticket(ticket, consume: bool = True):
    t = _tickets()
    kalit = str(ticket or "")
    rec = t.get(kalit)
    if not rec:
        return None
    if _now_ms() - rec["createdAt"] > TICKET_TTL_MS:
        del t[kalit]
        persist()
        return None
    if consume:
        del t[kalit]
        persist()
    return rec


def two_factor_verify(ctx):
    """Kirish jarayonidagi 2FA kodini tekshirish."""
    body, req = (ctx["body"] or {}), ctx["req"]
    ip = client_ip(req)
    rec = _take_ticket(body.get("ticket"), consume=False)
    if not rec:
        return {"error": "Tasdiqlash muddati tugadi — qaytadan kiring",
                "status": 401, "code": "TICKET_EXPIRED"}

    user = find_user_by_id(rec["userId"])
    if not ((user or {}).get("totp") or {}).get("enabled"):
        return {"error": "Ikki bosqichli tasdiqlash yoqilmagan", "status": 400}

    lock = max(locked_for("twofa", user["id"]), locked_for("code-ip", ip))
    if lock:
        return {"error": f"Juda ko'p urinish. {lock_message(lock)}", "status": 429}

    result = _consume_two_factor(user, str(body.get("code") or "").strip())
    if not result["ok"]:
        note_failure("twofa", user["id"])
        note_failure("code-ip", ip)
        return {"error": result["error"], "status": 401}

    clear_failures("twofa", user["id"])
    clear_failures("code-ip", ip)
    _take_ticket(body.get("ticket"))          # chipta ishlatildi
    out = finish_login(user, req)
    return {**out, "usedBackupCode": result["backup"], "backupLeft": result["left"]}


def _consume_two_factor(user: dict, given: str) -> dict:
    """
    TOTP kodini yoki zaxira kodni tekshiradi.
    Muvaffaqiyatda ishlatilgan oyna/zaxira kod hisobdan chiqariladi.
    """
    t = user["totp"]
    secret = decrypt_secret(t.get("secretEnc"))
    if not secret:
        return {"ok": False, "error": "Kalit o'qilmadi — 2FA ni qaytadan sozlang"}

    digits = re.sub(r"\D", "", str(given))
    if len(digits) == DIGITS:
        r = verify_totp(secret, digits, last_step=t.get("lastStep"))
        if r["ok"]:
            t["lastStep"] = r["step"]          # shu oyna qayta ishlatilmaydi
            persist()
            return {"ok": True, "backup": False,
                    "left": len(t.get("backupHashes") or [])}
        return {"ok": False, "error": "Kod noto'g'ri yoki muddati o'tgan"}

    # Zaxira kod
    b = use_backup_code(t.get("backupHashes"), given)
    if b["ok"]:
        persist()
        return {"ok": True, "backup": True, "left": b["left"]}
    return {"ok": False, "error": "Kod noto'g'ri"}


def two_factor_setup(ctx):
    """1-qadam: kalit yaratish (hali yoqilmaydi)."""
    user = ctx["user"]
    if (user.get("totp") or {}).get("enabled"):
        return {"error": "Ikki bosqichli tasdiqlash allaqachon yoqilgan", "status": 400}
    secret = new_secret()
    user["totp"] = {"enabled": False, "secretEnc": encrypt_secret(secret),
                    "backupHashes": [], "lastStep": None}
    persist()
    return {
        "secret": secret,
        "secretGrouped": group_secret(secret),
        "otpauth": otpauth_uri(secret, user["email"]),
        "account": user["email"],
        "issuer": "Pomodoro",
        "digits": DIGITS,
        "period": PERIOD,
    }


def two_factor_enable(ctx):
    """2-qadam: ilovadagi kod bilan tasdiqlash va yoqish."""
    user, body = ctx["user"], (ctx["body"] or {})
    t = user.get("totp") or {}
    if not t.get("secretEnc"):
        return {"error": "Avval «Sozlashni boshlash» tugmasini bosing", "status": 400}
    if t.get("enabled"):
        return {"error": "Allaqachon yoqilgan", "status": 400}

    lock = locked_for("twofa", user["id"])
    if lock:
        return {"error": f"Juda ko'p urinish. {lock_message(lock)}", "status": 429}

    secret = decrypt_secret(t["secretEnc"])
    r = verify_totp(secret, str(body.get("code") or ""))
    if not r["ok"]:
        note_failure("twofa", user["id"])
        return {"error": "Kod noto'g'ri. Telefon soati to'g'ri ekanini tekshiring",
                "status": 400}
    clear_failures("twofa", user["id"])

    yangi = new_backup_codes()
    t["enabled"] = True
    t["confirmedAt"] = _now_iso()
    t["backupHashes"] = yangi["hashes"]
    t["lastStep"] = r["step"]
    persist()
    # Boshqa qurilmalardagi eski seanslar 2FA'siz ochilgan — yopiladi
    destroy_all_sessions(user["id"], ctx["authToken"])

    return {
        "ok": True,
        "enabled": True,
        "backupCodes": yangi["codes"],
        "message": ("Ikki bosqichli tasdiqlash yoqildi. Zaxira kodlarni saqlab "
                    "qo'ying — ular boshqa ko'rsatilmaydi."),
    }


def two_factor_disable(ctx):
    """O'chirish — joriy parol yoki amaldagi kod bilan tasdiqlanadi."""
    user, body = ctx["user"], (ctx["body"] or {})
    if not (user.get("totp") or {}).get("enabled"):
        return {"error": "Ikki bosqichli tasdiqlash yoqilmagan", "status": 400}

    lock = locked_for("twofa", user["id"])
    if lock:
        return {"error": f"Juda ko'p urinish. {lock_message(lock)}", "status": 429}

    if not _confirm_identity(user, body):
        note_failure("twofa", user["id"])
        return {"error": "Parol yoki kod noto'g'ri", "status": 401}
    clear_failures("twofa", user["id"])

    # JS `delete user.totp` — maydon `null` bo'lib qolmaydi, butunlay yo'qoladi
    user.pop("totp", None)
    persist()
    return {"ok": True, "enabled": False,
            "message": "Ikki bosqichli tasdiqlash o'chirildi"}


def two_factor_backup_codes(ctx):
    """Zaxira kodlarni yangilash — eskilari darhol kuchini yo'qotadi."""
    user, body = ctx["user"], (ctx["body"] or {})
    if not (user.get("totp") or {}).get("enabled"):
        return {"error": "Ikki bosqichli tasdiqlash yoqilmagan", "status": 400}

    lock = locked_for("twofa", user["id"])
    if lock:
        return {"error": f"Juda ko'p urinish. {lock_message(lock)}", "status": 429}

    if not _confirm_identity(user, body):
        note_failure("twofa", user["id"])
        return {"error": "Parol yoki kod noto'g'ri", "status": 401}
    clear_failures("twofa", user["id"])

    yangi = new_backup_codes()
    user["totp"]["backupHashes"] = yangi["hashes"]
    persist()
    return {
        "ok": True,
        "backupCodes": yangi["codes"],
        "count": BACKUP_COUNT,
        "message": "Yangi zaxira kodlar yaratildi. Eskilari endi ishlamaydi.",
    }


def two_factor_status(ctx):
    """Joriy holat — sozlamalar oynasi uchun."""
    user = ctx["user"]
    t = user.get("totp") or {}
    pending = bool(t.get("secretEnc") and not t.get("enabled"))
    out = {
        "enabled": bool(t.get("enabled")),
        "pending": pending,
        "confirmedAt": t.get("confirmedAt") or None,
        "backupLeft": len(t.get("backupHashes") or []) if t.get("enabled") else 0,
        "backupTotal": BACKUP_COUNT,
    }

    # Sozlash tugallanmagan bo'lsa kalit egasiga qaytariladi — sahifa
    # yangilangandan keyin ham davom ettirish imkoni bo'lsin.
    # Yoqilgandan keyin kalit boshqa hech qachon berilmaydi.
    if pending:
        secret = decrypt_secret(t["secretEnc"])
        if secret:
            out["secret"] = secret
            out["secretGrouped"] = group_secret(secret)
            out["otpauth"] = otpauth_uri(secret, user["email"])
            out["account"] = user["email"]
            out["digits"] = DIGITS
            out["period"] = PERIOD
    return out


def two_factor_cancel(ctx):
    """Tugallanmagan sozlashni bekor qiladi."""
    user = ctx["user"]
    if (user.get("totp") or {}).get("enabled"):
        return {"error": "Yoqilgan tasdiqlashni bekor qilib bo'lmaydi", "status": 400}
    if user.get("totp"):
        user.pop("totp", None)
        persist()
    return {"ok": True, "enabled": False, "pending": False}


def _confirm_identity(user: dict, body: dict) -> bool:
    """
    Nozik amallar uchun shaxsni tasdiqlash: parol yoki amaldagi TOTP kodi.
    OAuth orqali kirgan, paroli yo'q foydalanuvchilar kod bilan tasdiqlaydi.
    """
    password = str((body or {}).get("password") or "")
    if (user.get("passwordHash") and password
            and verify_password(password, user.get("passwordSalt"), user["passwordHash"])):
        return True

    code = str((body or {}).get("code") or "").strip()
    totp_cfg = user.get("totp") or {}
    if code and totp_cfg.get("secretEnc"):
        secret = decrypt_secret(totp_cfg["secretEnc"])
        if verify_totp(secret, code)["ok"]:
            return True
        if totp_cfg.get("enabled") and use_backup_code(totp_cfg.get("backupHashes"), code)["ok"]:
            persist()
            return True
    return False
