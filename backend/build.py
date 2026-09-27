"""
Deploy uchun `dist-py/` papkasini yig'adi.

    backend/.venv/Scripts/python backend/build.py

Node tomonidagi `build.mjs` ning o'rnini bosadi, lekin uni ALMASHTIRMAYDI:
Node backendi hali joyida turgani uchun `dist/` (Node) va `dist-py/` (Python)
yonma-yon yig'iladi. Node o'chirilgach `dist-py` `dist` ga aylanadi va
`build.mjs` o'chadi.

Qurish bosqichi yo'q — kod qanday bo'lsa shundayligicha ishlaydi. Bu skript
faqat serverda kerak bo'ladigan fayllarni ajratadi va deploy uchun
konfiguratsiyalarni yozadi.

`data/` hech qachon ko'chirilmaydi: unda baza, parol xeshlari va
shifrlash kaliti bor. `.venv` ham ko'chirilmaydi — u shu kompyuterga
bog'langan, serverda `pip install -r requirements.txt` qaytadan bajariladi.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # pomodoro/
DIST = ROOT / "dist-py"

# Serverda kerak bo'ladigan narsalar
INCLUDE = ["backend", "public", "README.md", "DEPLOY.md"]

# Hech qachon tushmaydigan nomlar
SKIP = {
    "data", "dist", "dist-py", "node_modules", ".git", ".venv",
    "__pycache__", ".pytest_cache", ".mypy_cache", "build.py",
}
SKIP_SUFFIX = (".log", ".tmp", ".secret", ".pyc", ".pyo")

hisob = {"fayl": 0, "bayt": 0}


def _tashlansinmi(nom: str) -> bool:
    return (nom in SKIP
            or nom.startswith(".")
            or nom.endswith(SKIP_SUFFIX)
            or nom == "db.json")


def nusxala(src: Path, dst: Path) -> None:
    if src.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for bola in sorted(src.iterdir()):
            if _tashlansinmi(bola.name):
                continue
            nusxala(bola, dst / bola.name)
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    hisob["fayl"] += 1
    hisob["bayt"] += src.stat().st_size


def yoz(nom: str, matn: str) -> None:
    """Fayl har doim LF bilan yoziladi — Linux serverga boradi."""
    (DIST / nom).write_text(matn, encoding="utf-8", newline="\n")


# ── 1. Toza dist ──
shutil.rmtree(DIST, ignore_errors=True)
DIST.mkdir(parents=True)

for nom in INCLUDE:
    src = ROOT / nom
    if not src.exists():
        print(f"  ! {nom} topilmadi, o'tkazib yuborildi")
        continue
    nusxala(src, DIST / nom)

# `requirements.txt` ildizda ham turadi — `pip install -r requirements.txt`
# qo'lyozmada shunday yoziladi va Dockerfile ham shundan foydalanadi
shutil.copy2(ROOT / "backend" / "requirements.txt", DIST / "requirements.txt")

# ── 2. Muhit o'zgaruvchilari namunasi ──
yoz(".env.example", """# Server qaysi portda tinglaydi
PORT=4123

# Konteynerda yoki serverda tashqaridan ulanish uchun 0.0.0.0 bo'lishi kerak.
# Faqat shu kompyuterdan kirilsa 127.0.0.1 qoldiring.
HOST=0.0.0.0

# Ma'lumotlar papkasi. Deploy qilinganda alohida diskda (volume) bo'lishi kerak,
# aks holda yangilanishda baza yo'qoladi.
DATA_DIR=/var/lib/pomodoro

# ---------- HTTPS ----------
# Variant A: nginx / Caddy orqasida (tavsiya etiladi).
# Proksi X-Forwarded-Proto va X-Forwarded-For yuborishi shart.
# DIQQAT: to'g'ridan-to'g'ri internetga chiqarilgan serverda YOQMANG -
# mijoz o'z IP'sini o'zi yozib, urinishlar cheklovini aylanib o'tadi.
TRUST_PROXY=0

# Variant B: server o'zi TLS bilan ko'tarilsin.
# Ikkalasi berilsa HTTPS yoqiladi.
# TLS_KEY=/etc/letsencrypt/live/domen/privkey.pem
# TLS_CERT=/etc/letsencrypt/live/domen/fullchain.pem
# TLS_CA=

# HSTS muddati (kun). 0 - o'chirish.
HSTS_DAYS=180

# Cookie'ga Secure bayrog'ini MAJBURAN qo'yish.
# Odatda kerak emas: ulanish HTTPS ekani so'rovning o'zidan aniqlanadi.
# SECURE_COOKIES=1

# production rejimi: SECURE_COOKIES o'zi yoqiladi
APP_ENV=production

# ---------- Maxfiy kalitlar ----------
# Bular bazaga YOZILMAYDI - faqat shu fayldan o'qiladi.
# Sabab: baza papkasini nusxalagan odam (zaxira nusxa, disk surati)
# shifrlangan qiymatni ham, data/.secret kalitini ham birga olardi.
# Bazada faqat "yoqilgan/o'chirilgan" bayrog'i qoladi.

# Pochta serveri
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=0
# SMTP_USER=siz@gmail.com
# SMTP_PASS=ilova-kaliti
# SMTP_FROM=Pomodoro <siz@gmail.com>

# Kirish usullari
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Tashqi manzil - OAuth qaytish manzili shundan quriladi.
# Proksi orqasida Host sarlavhasi haqiqiy domendan farq qilsa kerak bo'ladi.
# APP_BASE_URL=https://pomodoro.kompaniya.uz
""")

# ── 3. Dockerfile ──
# Ikki qatlamli: bog'liqliklar alohida qatlamda o'rnatiladi, shunda kod
# o'zgarganda `pip install` qaytadan bajarilmaydi.
yoz("Dockerfile", """FROM python:3.13-slim AS deps
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/yuklangan -r requirements.txt

FROM python:3.13-slim
WORKDIR /app
COPY --from=deps /yuklangan /usr/local
COPY . .

# Baza konteyner ichida emas, alohida diskda saqlanadi
ENV APP_ENV=production \\
    HOST=0.0.0.0 \\
    PORT=4123 \\
    DATA_DIR=/data \\
    PYTHONUNBUFFERED=1 \\
    PYTHONIOENCODING=utf-8 \\
    PYTHONDONTWRITEBYTECODE=1
VOLUME ["/data"]
EXPOSE 4123

# root emas, cheklangan foydalanuvchi ostida ishlaydi
RUN useradd -r -u 10001 pomodoro \\
 && mkdir -p /data \\
 && chown -R pomodoro:pomodoro /data /app
USER pomodoro

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \\
  CMD python -c "import os,urllib.request,sys; \\
u='http://127.0.0.1:'+os.environ.get('PORT','4123')+'/api/health'; \\
sys.exit(0 if urllib.request.urlopen(u, timeout=4).status==200 else 1)"

# DIQQAT: bitta jarayon. `uvicorn --workers N` ISHLATMANG - baza oddiy JSON
# fayl, har yozuvda butunlay qayta yoziladi. Ikki worker bir vaqtda yozsa
# birining o'zgarishi yo'qoladi. Kengaytirish kerak bo'lsa avval PostgreSQL.
CMD ["python", "-m", "backend.main"]
""")

yoz(".dockerignore", """data
dist
dist-py
node_modules
.git
.venv
__pycache__
**/__pycache__
*.pyc
*.log
.env
""")

# ── 4. docker compose ──
yoz("docker-compose.yml", """services:
  pomodoro:
    build: .
    restart: unless-stopped
    ports:
      - "4123:4123"
    environment:
      APP_ENV: production
      HOST: 0.0.0.0
      PORT: "4123"
      DATA_DIR: /data
      SECURE_COOKIES: "0"   # HTTPS orqali (reverse proxy) ishlatsangiz 1 qiling
    volumes:
      - pomodoro-data:/data
    # Maxfiy kalitlar uchun: .env faylini yonida qoldirib, izohni oching
    # env_file: .env

volumes:
  pomodoro-data:
""")

# ── 5. systemd unit (Docker'siz oddiy server uchun) ──
yoz("pomodoro.service", """[Unit]
Description=Pomodoro - ish jarayonini boshqarish tizimi
After=network.target

[Service]
Type=simple
User=pomodoro
WorkingDirectory=/opt/pomodoro
# Virtual muhit /opt/pomodoro/.venv da yaratiladi (DEPLOY.md ga qarang).
# Bitta jarayon: `uvicorn --workers N` ishlatilmaydi, sababi Dockerfile'da.
ExecStart=/opt/pomodoro/.venv/bin/python -m backend.main
Environment=APP_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=4123
Environment=DATA_DIR=/var/lib/pomodoro
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONIOENCODING=utf-8
# Maxfiy kalitlar alohida faylda, faqat root o'qiy oladigan (chmod 600)
EnvironmentFile=-/etc/pomodoro.env
Restart=always
RestartSec=3

# Xavfsizlik cheklovlari
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pomodoro

[Install]
WantedBy=multi-user.target
""")

# ── 6. Yig'ish ma'lumoti ──
yoz("build-info.json", json.dumps({
    "name": "pomodoro",
    "backend": "python",
    "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
               + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
    "python": sys.version.split()[0],
    "files": hisob["fayl"],
}, indent=2, ensure_ascii=False) + "\n")

print(f"\n  dist-py/ tayyor")
print(f"  {hisob['fayl']} fayl · {hisob['bayt'] / 1024:.0f} KB")
print("  Ishga tushirish:")
print("    cd dist-py")
print("    python -m venv .venv && .venv/bin/pip install -r requirements.txt")
print("    .venv/bin/python -m backend.main\n")
