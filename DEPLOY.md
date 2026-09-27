# Deploy qilish

Backend **Python 3.13 + FastAPI/Uvicorn**. Baza — oddiy JSON fayl, ma'lumotlar
bazasi serveri kerak emas.

> **Ko'chirish davom etyapti.** Node backendi (`server.js`, `lib/`, `routes/`)
> hali loyihada turadi va ishlashda davom etadi. Ikkisi ham bir xil bazani
> o'qiydi — bir vaqtda faqat BITTASI ishga tushirilishi kerak. Node uchun
> ko'rsatma oxirgi bo'limda. Node o'chirilgach o'sha bo'lim ham o'chadi.

## 1. `dist-py/` yig'ish

```bash
backend/.venv/Scripts/python backend/build.py
```

Linuxda: `backend/.venv/bin/python backend/build.py`

`dist-py/` papkasi hosil bo'ladi: `backend/`, `public/`, `requirements.txt`
va deploy uchun konfiguratsiyalar (`Dockerfile`, `docker-compose.yml`,
`pomodoro.service`, `.env.example`).

Unga **tushmaydi**: `data/` (baza, parol xeshlari, shifrlash kaliti),
`.venv` (shu kompyuterga bog'langan), `.env`, `__pycache__`.

## 2. Bitta jarayon — bu shart, sozlama emas

Baza har yozuvda **butunlay qayta yoziladi** (`backend/core/db.py`). Ikki
jarayon bir vaqtda yozsa birining o'zgarishi izsiz yo'qoladi.

```bash
# TO'G'RI
python -m backend.main

# XATO — ma'lumot yo'qoladi
uvicorn backend.main:app --workers 4
```

`python -m backend.main` har doim bitta jarayon ko'taradi. Bir necha
worker kerak bo'lsa avval PostgreSQL'ga o'tish kerak.

## 3. Muhit o'zgaruvchilari

| O'zgaruvchi | Standart | Nima uchun |
|---|---|---|
| `PORT` | `4123` | Server tinglaydigan port |
| `HOST` | `127.0.0.1` | **Serverda `0.0.0.0` qilinishi shart**, aks holda tashqaridan ulanib bo'lmaydi |
| `DATA_DIR` | `./data` | Baza saqlanadigan papka. Alohida diskda (volume) bo'lishi kerak |
| `APP_ENV` | — | `production` qilinsa `SECURE_COOKIES` o'zi yoqiladi |
| `NODE_ENV` | — | `APP_ENV` bilan bir xil ishlaydi. Node davridan qolgan nom — mavjud `.env` fayllari buzilmasin deb qoldirilgan |
| `SECURE_COOKIES` | production bo'lsa yoqiq | Cookie'ga `Secure` bayrog'ini **majburan** qo'yadi. Odatda kerak emas — ulanish HTTPS ekani so'rovning o'zidan aniqlanadi |
| `TRUST_PROXY` | `0` | Teskari proksi (nginx, Caddy, Traefik) orqasida **majburiy**. Yoqilsa `X-Forwarded-Proto` va `X-Forwarded-For` o'qiladi |
| `TLS_KEY` | — | O'z sertifikati bilan HTTPS: yopiq kalit fayli (`.pem`) |
| `TLS_CERT` | — | Sertifikat fayli (`.pem`). `TLS_KEY` bilan birga berilsa server HTTPS'da ko'tariladi |
| `TLS_CA` | — | Oraliq sertifikatlar zanjiri (kerak bo'lsa) |
| `HSTS_DAYS` | `180` | HSTS muddati kunda. `0` — o'chirish. Sarlavha **faqat HTTPS orqali kelgan so'rovga** qo'yiladi |
| `FORCE_HTTPS` | HTTPS yoqilgan bo'lsa `1` | Python variantida **ta'siri yo'q** — faqat Node'dagi HTTP→HTTPS yo'naltiruvchini yoqardi. Yo'naltirishni proksi qiladi |
| `ENV_FILE` | `<ildiz>/.env` | Maxfiy kalitlar fayli. Boshqa joyda tursa shu bilan ko'rsatiladi |
| `PYTHONUNBUFFERED` | — | `1` qo'yilsa jurnal darhol yoziladi. `Dockerfile` va `pomodoro.service` da allaqachon bor |

### Maxfiy kalitlar — `.env` fayli

Pochta paroli va OAuth kalitlari **bazaga yozilmaydi**. Ular faqat muhitdan
o'qiladi. Sabab: shifrlash kaliti (`DATA_DIR/.secret`) bazaning yonida turadi —
papkani nusxalagan odam (zaxira nusxa, disk surati, `backups/*.json`) shifrlangan
qiymatni ham, kalitni ham birga olardi. Muhitda turgan qiymat bu nusxaga umuman
tushmaydi.

| O'zgaruvchi | Nima uchun |
|---|---|
| `SMTP_HOST` | Pochta serveri manzili, masalan `smtp.gmail.com` |
| `SMTP_PORT` | `587` (STARTTLS) yoki `465` (to'g'ridan-to'g'ri TLS) |
| `SMTP_SECURE` | `1` — to'g'ridan-to'g'ri TLS. Berilmasa `465` uchun o'zi yoqiladi |
| `SMTP_USER` | Kirish nomi (odatda pochta manzili) |
| `SMTP_PASS` | Parol yoki **ilova kaliti**. Gmail uchun oddiy parol emas |
| `SMTP_FROM` | Xat jo'natuvchisi, masalan `Pomodoro <siz@gmail.com>` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | «Google bilan kirish» |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | «GitHub bilan kirish» |
| `APP_BASE_URL` | Tashqi manzil, masalan `https://pomodoro.kompaniya.uz`. OAuth qaytish manzili shundan quriladi |

`.env` `.gitignore` da — git'ga tushmaydi. Namuna: `dist-py/.env.example`.

```bash
cp .env.example .env
# .env ni ochib kerakli qatorlarning izohini oching va qiymat yozing
chmod 600 .env
```

Muhitda berilgan maydon sozlamalar oynasida **qulflanadi** — tahrirlab
bo'lmaydi va sababi yozib qo'yiladi. Bazada faqat «yoqilgan/o'chirilgan»
bayrog'i qoladi, uni interfeysdan bemalol almashtirish mumkin.

> `APP_BASE_URL` ni proksi orqasida albatta bering: `Host` sarlavhasi ichki
> manzilni ko'rsatsa, OAuth qaytish manzili noto'g'ri quriladi.

> Kalitni almashtirganingizda `.env` ni yangilab, serverni qayta ishga
> tushiring — muhit ishga tushishda bir marta o'qiladi.

### HTTPS ni qanday yoqish

**Variant A — proksi orqasida (tavsiya etiladi).** nginx yoki Caddy TLS'ni o'z
zimmasiga oladi, Pomodoro esa HTTP'da ichki portda turadi:

```bash
HOST=127.0.0.1 PORT=4123 TRUST_PROXY=1 APP_ENV=production python -m backend.main
```

nginx tomonida sarlavhalar uzatilishi shart:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

> `TRUST_PROXY=1` ni **faqat** haqiqatan proksi orqasida yoqing. To'g'ridan-to'g'ri
> internetga chiqarilgan serverda yoqilsa, mijoz o'z IP'sini o'zi yozib,
> urinishlar cheklovini aylanib o'tadi.

**Variant B — Pomodoro o'zi TLS bilan:**

```bash
HOST=0.0.0.0 PORT=443 \
TLS_KEY=/etc/letsencrypt/live/domen/privkey.pem \
TLS_CERT=/etc/letsencrypt/live/domen/fullchain.pem \
APP_ENV=production python -m backend.main
```

> 443-portga oddiy foydalanuvchi bog'lanolmaydi. `setcap` yoki
> systemd'dagi `AmbientCapabilities=CAP_NET_BIND_SERVICE` kerak bo'ladi —
> yoki shunchaki Variant A ni tanlang.

### Mijoz IP'si nima uchun muhim

Kirish urinishlari ham hisob, ham IP bo'yicha cheklanadi. Agar server proksi
orqasida turib `TRUST_PROXY` yoqilmasa, barcha foydalanuvchilar bitta IP
(`127.0.0.1`) sifatida ko'rinadi. Bunday holatda tizim IP bo'yicha cheklovni
**o'zi o'chiradi** — aks holda bir necha urinishdan keyin butun jamoa
bloklanardi. Hisob bo'yicha cheklovlar esa har doim ishlaydi.

> **Muhim:** `DATA_DIR` ni albatta loyiha papkasidan tashqarida ko'rsating. Aks holda
> yangi versiyani yozganda baza ustidan yozilib ketishi mumkin.

## 4. Uch xil usul

### Docker (eng oddiy)

```bash
cd dist-py
docker compose up -d
```

Baza `pomodoro-data` nomli volume'da saqlanadi — konteynerni yangilaganda
yo'qolmaydi. HTTPS orqali (reverse proxy ostida) ishlatsangiz
`docker-compose.yml` da `SECURE_COOKIES` ni `"1"` qiling.

Maxfiy kalitlar uchun `.env` faylini `docker-compose.yml` yonida qoldirib,
`env_file: .env` qatorining izohini oching.

### systemd (oddiy Linux server)

```bash
sudo mkdir -p /opt/pomodoro /var/lib/pomodoro
sudo cp -r dist-py/* dist-py/.env.example /opt/pomodoro/
sudo useradd -r -s /usr/sbin/nologin pomodoro

# Virtual muhit — unit fayli aynan shu yo'lni kutadi
sudo python3 -m venv /opt/pomodoro/.venv
sudo /opt/pomodoro/.venv/bin/pip install -r /opt/pomodoro/requirements.txt

# Maxfiy kalitlar alohida faylda, faqat root o'qiy oladigan
sudo cp /opt/pomodoro/.env.example /etc/pomodoro.env
sudo chmod 600 /etc/pomodoro.env      # ichiga kalitlarni yozing

sudo chown -R pomodoro:pomodoro /var/lib/pomodoro
sudo cp /opt/pomodoro/pomodoro.service /etc/systemd/system/
sudo systemctl enable --now pomodoro
sudo systemctl status pomodoro
```

### Qo'lda

```bash
cd dist-py
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
HOST=0.0.0.0 PORT=4123 DATA_DIR=/var/lib/pomodoro APP_ENV=production \
  .venv/bin/python -m backend.main
```

## 5. Reverse proxy (HTTPS)

```nginx
server {
    listen 443 ssl;
    server_name pomodoro.example.uz;

    ssl_certificate     /etc/letsencrypt/live/pomodoro.example.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pomodoro.example.uz/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4123;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Proksi ortida ishlatganda `TRUST_PROXY=1` qo'yish shart — HTTPS aniqlanishi va
mijoz IP'si shunga bog'liq.

## 6. Birinchi ishga tushirishdan keyin

1. Brauzerda ochib **birinchi foydalanuvchi** sifatida ro'yxatdan o'ting — u avtomatik
   tizim egasi (`owner`) bo'ladi.
2. Profil → Ish jadvali: ish kunlari, vaqti va tushlik oralig'ini belgilang.
3. Google / GitHub orqali kirish kerak bo'lsa: Sozlamalar → OAuth. Callback manzili
   `https://<domeningiz>/api/auth/callback/google` ko'rinishida bo'ladi.

## 7. Zaxira nusxa

Tizim har kuni `DATA_DIR/backups/` ichiga nusxa oladi va oxirgi 14 tasini saqlaydi.
Shu papkani tashqi joyga ham ko'chirib turing:

```bash
0 3 * * * tar -czf /backup/pomodoro-$(date +\%F).tar.gz /var/lib/pomodoro
```

Tiklash uchun `db.json` ni joyiga qaytarib, xizmatni qayta ishga tushirish yetarli.

## 8. Yangilash

```bash
backend/.venv/bin/python backend/build.py     # yangi dist-py
sudo systemctl stop pomodoro
sudo rsync -a --delete --exclude .venv dist-py/ /opt/pomodoro/
sudo /opt/pomodoro/.venv/bin/pip install -r /opt/pomodoro/requirements.txt
sudo systemctl start pomodoro
```

`--exclude .venv` shart: aks holda `rsync` serverdagi virtual muhitni o'chiradi.
`DATA_DIR` tashqarida bo'lgani uchun baza tegilmaydi.

## Xavfsizlik haqida

- Parollar `scrypt` bilan xeshlanadi, integratsiya kalitlari AES-256-GCM bilan
  shifrlanadi. Shifrlash kaliti — `DATA_DIR/.secret`. **Uni yo'qotsangiz saqlangan
  Jira/Notion/Confluence kalitlari ochilmay qoladi.**
- Sessiya cookie'lari `HttpOnly` va `SameSite=Lax`; HTTPS'da `Secure` ham qo'shiladi.
- O'zgartiruvchi so'rovlar `Origin` bo'yicha tekshiriladi (CSRF himoyasi).
- Kirishda urinishlar cheklangan: 8 marta xato → 15 daqiqa bloklanadi.
- `DATA_DIR` ni faqat xizmat foydalanuvchisi o'qiy oladigan qiling (`chmod 700`).
- Tashqi API so'rovlariga (Jira, Notion, Confluence, OAuth) 15 soniyalik
  timeout qo'yilgan — javob bermagan xizmat so'rovni cheksiz ushlab turmaydi.

---

## Node backendi (o'chirilishi kutilyapti)

Ko'chirish tugaguncha Node varianti ham ishlaydi va o'z `dist/` papkasiga
yig'iladi. **Ikkisini bir vaqtda ishga tushirmang** — bir xil `db.json` ga
yozadi.

```bash
node build.mjs                 # dist/ yig'ish
cd dist && NODE_ENV=production node server.js
```

Farqlari faqat shu ikkitasi:

- `APP_ENV` o'rniga `NODE_ENV` ishlatiladi (Python ikkovini ham tushunadi);
- `REDIRECT_PORT` — HTTP→HTTPS yo'naltiruvchi alohida port. Python variantida
  yo'q: proksi (nginx/Caddy) buni o'zi qiladi.

Node o'chirilgach `build.mjs`, `dist/` va shu bo'lim ham o'chadi.
