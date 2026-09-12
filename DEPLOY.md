# Deploy qilish

Loyihada tashqi kutubxona yo'q — `npm install` kerak emas. Faqat **Node.js 18+** bo'lsa yetarli.

## 1. `dist/` yig'ish

```bash
node build.mjs
```

`dist/` papkasi hosil bo'ladi: server kodi, frontend va deploy uchun konfiguratsiyalar.
Ma'lumotlar papkasi (`data/`) unga **tushmaydi** — unda baza, parol xeshlari va shifrlash
kaliti bor.

## 2. Muhit o'zgaruvchilari

| O'zgaruvchi | Standart | Nima uchun |
|---|---|---|
| `PORT` | `4123` | Server tinglaydigan port |
| `HOST` | `127.0.0.1` | **Serverda `0.0.0.0` qilinishi shart**, aks holda tashqaridan ulanib bo'lmaydi |
| `DATA_DIR` | `./data` | Baza saqlanadigan papka. Alohida diskda bo'lishi kerak |
| `SECURE_COOKIES` | `NODE_ENV=production` bo'lsa yoqiq | Cookie'ga `Secure` bayrog'ini **majburan** qo'yadi. Odatda kerak emas — ulanish HTTPS ekani so'rovning o'zidan aniqlanadi |
| `NODE_ENV` | — | `production` qilinsa `SECURE_COOKIES` o'zi yoqiladi |
| `TRUST_PROXY` | `0` | Teskari proksi (nginx, Caddy, Traefik) orqasida **majburiy**. Yoqilsa `X-Forwarded-Proto` va `X-Forwarded-For` o'qiladi |
| `TLS_KEY` | — | O'z sertifikati bilan HTTPS: yopiq kalit fayli (`.pem`) |
| `TLS_CERT` | — | Sertifikat fayli (`.pem`). `TLS_KEY` bilan birga berilsa server HTTPS'da ko'tariladi |
| `TLS_CA` | — | Oraliq sertifikatlar zanjiri (kerak bo'lsa) |
| `FORCE_HTTPS` | HTTPS yoqilgan bo'lsa `1` | HSTS va HTTP→HTTPS yo'naltirish |
| `REDIRECT_PORT` | — | Berilsa, shu portda HTTP so'rovlarini HTTPS'ga yo'naltiruvchi ishga tushadi (odatda `80`) |
| `HSTS_DAYS` | `180` | HSTS muddati. `0` — o'chirish |

### HTTPS ni qanday yoqish

**Variant A — proksi orqasida (tavsiya etiladi).** nginx yoki Caddy TLS'ni o'z
zimmasiga oladi, Pomodoro esa HTTP'da ichki portda turadi:

```bash
HOST=127.0.0.1 PORT=4123 TRUST_PROXY=1 NODE_ENV=production node server.js
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
HOST=0.0.0.0 PORT=443 REDIRECT_PORT=80 \
TLS_KEY=/etc/letsencrypt/live/domen/privkey.pem \
TLS_CERT=/etc/letsencrypt/live/domen/fullchain.pem \
NODE_ENV=production node server.js
```

Sertifikat o'qilmasa server to'xtamaydi — ogohlantirish yozib, HTTP rejimida ishlaydi.

### Mijoz IP'si nima uchun muhim

Kirish urinishlari ham hisob, ham IP bo'yicha cheklanadi. Agar server proksi
orqasida turib `TRUST_PROXY` yoqilmasa, barcha foydalanuvchilar bitta IP
(`127.0.0.1`) sifatida ko'rinadi. Bunday holatda tizim IP bo'yicha cheklovni
**o'zi o'chiradi** — aks holda bir necha urinishdan keyin butun jamoa
bloklanardi. Hisob bo'yicha cheklovlar esa har doim ishlaydi.

`.env.example` faylida shu ro'yxat izohlari bilan turadi.

> **Muhim:** `DATA_DIR` ni albatta loyiha papkasidan tashqarida ko'rsating. Aks holda
> yangi versiyani yozganda baza ustidan yozilib ketishi mumkin.

## 3. Uch xil usul

### Docker (eng oddiy)

```bash
cd dist
docker compose up -d
```

Baza `pomodoro-data` nomli volume'da saqlanadi — konteynerni yangilaganda yo'qolmaydi.
HTTPS orqali (reverse proxy ostida) ishlatsangiz `docker-compose.yml` da
`SECURE_COOKIES` ni `"1"` qiling.

### systemd (oddiy Linux server)

```bash
sudo mkdir -p /opt/pomodoro /var/lib/pomodoro
sudo cp -r dist/* /opt/pomodoro/
sudo useradd -r -s /usr/sbin/nologin pomodoro
sudo chown -R pomodoro:pomodoro /var/lib/pomodoro

sudo cp dist/pomodoro.service /etc/systemd/system/
sudo systemctl enable --now pomodoro
sudo systemctl status pomodoro
```

### Qo'lda

```bash
cd dist
HOST=0.0.0.0 PORT=4123 DATA_DIR=/var/lib/pomodoro NODE_ENV=production node server.js
```

## 4. Reverse proxy (HTTPS)

Tizim o'zi HTTPS'ni qo'llab-quvvatlamaydi — oldiga nginx yoki Caddy qo'yiladi.

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

## 5. Birinchi ishga tushirishdan keyin

1. Brauzerda ochib **birinchi foydalanuvchi** sifatida ro'yxatdan o'ting — u avtomatik
   tizim egasi (`owner`) bo'ladi.
2. Profil → Ish jadvali: ish kunlari, vaqti va tushlik oralig'ini belgilang.
3. Google / GitHub orqali kirish kerak bo'lsa: Sozlamalar → OAuth. Callback manzili
   `https://<domeningiz>/api/auth/callback/google` ko'rinishida bo'ladi.

## 6. Zaxira nusxa

Tizim har kuni `DATA_DIR/backups/` ichiga nusxa oladi va oxirgi 14 tasini saqlaydi.
Shu papkani tashqi joyga ham ko'chirib turing:

```bash
0 3 * * * tar -czf /backup/pomodoro-$(date +\%F).tar.gz /var/lib/pomodoro
```

Tiklash uchun `db.json` ni joyiga qaytarib, xizmatni qayta ishga tushirish yetarli.

## 7. Yangilash

```bash
node build.mjs                      # yangi dist
sudo systemctl stop pomodoro
sudo rsync -a --delete dist/ /opt/pomodoro/
sudo systemctl start pomodoro
```

`DATA_DIR` tashqarida bo'lgani uchun baza tegilmaydi.

## Xavfsizlik haqida

- Parollar `scrypt` bilan xeshlanadi, integratsiya kalitlari AES-256-GCM bilan
  shifrlanadi. Shifrlash kaliti — `DATA_DIR/.secret`. **Uni yo'qotsangiz saqlangan
  Jira/Notion/Confluence kalitlari ochilmay qoladi.**
- Sessiya cookie'lari `HttpOnly` va `SameSite=Lax`; HTTPS'da `Secure` ham qo'shiladi.
- O'zgartiruvchi so'rovlar `Origin` bo'yicha tekshiriladi (CSRF himoyasi).
- Kirishda urinishlar cheklangan: 8 marta xato → 15 daqiqa bloklanadi.
- `DATA_DIR` ni faqat xizmat foydalanuvchisi o'qiy oladigan qiling (`chmod 700`).
