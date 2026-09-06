# 🍅 Pomodoro — Ish jarayonini boshqarish tizimi

Kun tartibini kiritish, har bir vazifaga ketadigan vaqtni pomodoro usulida rejalashtirish,
o'sha vaqtni taymer bilan sarflash, tanaffuslarni avtomatik hisoblash va natijani hisobot
qilib chiqarish uchun to'liq tizim.

**Frontend + Backend + ma'lumotlar bazasi + autentifikatsiya + integratsiyalar** — hammasi bitta papkada,
tashqi kutubxonalarsiz.

---

## Ishga tushirish

Node.js 18+ o'rnatilgan bo'lishi kifoya (`npm install` **kerak emas**).

```bash
node server.js
```

Brauzerda oching: **http://127.0.0.1:4123**

Birinchi ochganingizda ro'yxatdan o'tish sahifasi chiqadi. **Birinchi ro'yxatdan o'tgan
foydalanuvchi tizim egasi (owner)** bo'ladi va kirish usullarini sozlash huquqiga ega bo'ladi.

Boshqa portda: `PORT=5000 node server.js` · Tarmoqdagi boshqa qurilmalar uchun: `HOST=0.0.0.0 node server.js`

Windows'da `ishga-tushirish.bat` faylini ikki marta bosing.

---

## 1. Foydalanuvchilar va kirish

- **Email + parol** bilan ro'yxatdan o'tish va kirish (parollar `scrypt` bilan xeshlanadi, ochiq saqlanmaydi).
- **Google** va **GitHub** orqali kirish (OAuth 2.0) — yoqish uchun o'z ilova kalitlaringiz kerak, pastga qarang.
- Sessiyalar `HttpOnly` cookie orqali, 30 kun amal qiladi; parol o'zgartirilganda boshqa qurilmalardagi seanslar yopiladi.
- Kirishga urinish cheklangan: 8 marta xato paroldan keyin 15 daqiqaga bloklanadi.
- Har bir foydalanuvchining vazifalari, sessiyalari, sozlamalari va integratsiyalari **butunlay ajratilgan**.

### Google / GitHub orqali kirishni yoqish

Faqat tizim egasi qila oladi: **Sozlamalar → 🔑 Kirish usullari**.

**Google:** [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) → Credentials →
Create OAuth client ID → Web application. Authorized redirect URI:
```
http://127.0.0.1:4123/api/auth/callback/google
```

**GitHub:** [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App.
Authorization callback URL:
```
http://127.0.0.1:4123/api/auth/callback/github
```

Client ID va Client Secret'ni sozlamalarga kiriting va "Yoqilgan" belgisini qo'ying —
kirish sahifasida tugma darhol paydo bo'ladi. (Boshqa manzil/portda ishlatsangiz, sozlamalar
sahifasida ko'rsatilgan aniq redirect URI'ni nusxalang.)

---

## 2. Profil

**Profilim** bo'limida (yuqori o'ng burchakdagi menyudan) barcha **standart sozlamalar** turadi:

- **⏱ Pomodoro sozlamalari** — pomodoro davomiyligi, qisqa/uzun tanaffus, uzun tanaffus oralig'i,
  kunlik maqsad, avtomatik sikl va 4 ta tayyor shablon. Bular **barcha yangi kunlar uchun standart**.
- **🗓 Haftalik ish jadvali** — quyida batafsil.
- Ism, lavozim, tashkilot, avatar (16 ta emoji) va shaxsiy rang.
- Shaxsiy statistika: jami pomodorolar, fokus soatlari, bajarilgan vazifalar, faol kunlar.
- Parolni o'zgartirish va faol seanslar ro'yxati.
- Hisobni butunlay o'chirish.

---

## 3. Ish jadvali va kun tartibi

### Haftalik ish jadvali

Ro'yxatdan o'tgandan keyin birinchi kirishda **«Ish jadvalingizni belgilang»** oynasi ochiladi.
Keyinchalik **Profil → 🗓 Haftalik ish jadvali** bo'limidan o'zgartirasiz.

Ikki xil kiritish usuli bor:

**1. Umumiy** (standart, tez usul) — ish vaqtingiz har kuni bir xil bo'lsa:
bitta vaqt oralig'i (masalan `10:00 – 19:00`) kiritasiz va ish kunlarini belgilaysiz.
Tez tanlash tugmalari: **Du–Ju (5 kun)** · **Du–Sh (6 kun)** · **Har kuni**.
Pastda darhol xulosa chiqadi: *5 ish kuni · Kuniga 9 soat · Haftasiga 45 soat*.

**2. Har kuni alohida** — kunlar turlicha bo'lsa (masalan juma qisqaroq kun):
har bir kunga o'z vaqtini yozasiz.

Rejimlar orasida erkin o'tish mumkin. «Umumiy»dan «Har kuni alohida»ga o'tsangiz, qatorlar
umumiy qiymatlar bilan to'ldiriladi; teskarisida (kunlar har xil bo'lsa) tizim tasdiq so'raydi.
Jadval keyingi safar ochilganda o'zi mos rejimda ochiladi.

Kun tartibi jadvali shu jadvaldan vaqt oladi. Dam olish kuni deb belgilangan kunda panel
«🌙 … — haftalik jadvalda dam olish kuni» deb ogohlantiradi.

### Har bir kunni alohida sozlash

«Bugun» bo'limidagi panel shu kunning rejimini **ko'rsatadi** (tahrirlanmaydi):
ish vaqti, pomodoro, qisqa/uzun tanaffus va uzun tanaffus oralig'i.

O'zgartirish uchun **«⚙️ Pomodoroni to'g'rlash»** tugmasini bosing — oynada quyidagilarni yozasiz:

| Maydon | Nima |
|---|---|
| **Pomodoro davomiyligi** | Bitta pomodoro necha daqiqa |
| **Qisqa tanaffus** | Qisqa tanaffus davomiyligi |
| **Uzun tanaffus** | Uzun tanaffus davomiyligi |
| **Uzun tanaffus har … pomodorodan keyin** | Uzun tanaffus oralig'i |

Oynada siklning ko'rinishi darhol chiziladi (masalan `25›5›25›5›25›5›25›15`) va bir to'liq siklning
umumiy vaqti hisoblanadi. Tayyor shablonlar ham shu yerda.

O'zgartirish **faqat shu kunga** tegishli. **↺ Standart** tugmasi uni bekor qilib,
Profildagi qiymatlarga qaytaradi.

### Ish vaqtiga sig'ish nazorati

Panel ostida jonli ko'rsatkichlar chiqadi:

- **Mavjud ish vaqti** — belgilangan oraliq necha soat,
- **Sig'adi: N 🍅** — shu oraliqqa tanaffuslar bilan birga nechta pomodoro sig'adi,
- **Yuklama** — rejadagi umumiy vaqt va bandlik foizi,
- **✔ Bo'sh vaqt** yoki **⚠ Ish vaqtidan … oshdi — N ta pomodoro sig'maydi**.

Ish vaqtidan chiqib ketgan vazifalarning vaqt yorlig'i sariq rangda ko'rsatiladi.

## 4. Taymer va vazifa holatlari

### Avtomatik sikl

Pomodoro tugashi bilan **qisqa tanaffus taymeri o'zi ochilib ishga tushadi**, tanaffus tugagach
**keyingi pomodoro o'zi boshlanadi**. Har bosqich orasida 5 soniyalik sanoq chiqadi —
ulgurmasangiz **«Bekor qilish»** tugmasi bilan to'xtatasiz.
Avtomatik siklni Profil → ⏱ Pomodoro sozlamalari bo'limidan o'chirish mumkin.

Faol vazifaning barcha pomodorosi bajarilsa, tizim **o'zi keyingi vazifaga o'tadi**.

### Vazifa holatlari

Vazifa holati pomodoro ishiga qarab avtomatik o'zgaradi:

| Holat | Qachon |
|---|---|
| ○ **Rejalashtirilgan** | Vazifa yangi qo'shilgan |
| ◐ **Jarayonda** | Shu vazifa ustida pomodoro boshlangan |
| ◉ **Qabul qilishga** | Rejalashtirilgan barcha pomodorolar bajarilgan |
| ✔ **Bajarildi** | **Foydalanuvchi** «✔ Bajarildi» tugmasi bilan tasdiqlagan |

Tizim hech qachon o'zi «Bajarildi» qilmaydi — bu qaror sizniki. Tasdiqlangan vazifani
**↩** tugmasi bilan qayta ochish mumkin.

## 5. Ko'p kunlik reja

«Bugun» bo'limidagi **📅 Ko'p kunlik reja** tugmasi bir necha kunga birdaniga reja tuzish oynasini ochadi:

- Sana oralig'ini tanlaysiz (**Shu hafta** / **Keyingi hafta** tugmalari bor).
- Har kun kartochkasida ish vaqti, joriy yuklama va **sig'imi** (nechta pomodoro sig'adi) ko'rinadi;
  ish kunlari avtomatik belgilanadi, dam olish kunlari alohida ajratiladi.
- Vazifa nomi va pomodoro sonini yozib **«Tanlangan kunlarga qo'shish»** tugmasini bosasiz —
  vazifa barcha tanlangan kunlarga qo'shiladi.
- Qo'shishdan **oldin** har kun kartochkasida yangi yuklama ko'rinadi (`3 +2 / 16 🍅`),
  sig'maydigan kun sariq rangda ogohlantiradi.

## 6. Taymer haqida

- Vazifa nomi + unga necha **pomodoro** kerakligi kiritiladi (kategoriya va muhimlik bilan).
- Tizim avtomatik hisoblaydi: sof ish vaqti, **tanaffuslar soni va davomiyligi**,
  har vazifaning **boshlanish–tugash vaqti**, kunning tugash soati.
- Taymer holati **serverda** saqlanadi — sahifani yangilasangiz ham vaqt to'g'ri davom etadi.
- Ovozli signal (WebAudio orqali generatsiya) + brauzer bildirishnomalari.
- Sozlamalar: 25/5/15 va boshqa vaqtlar, uzun tanaffus oralig'i, kun boshlanish vaqti,
  kunlik maqsad, avtomatik boshlash; 4 ta tayyor shablon.

**Hisob formulasi:** N ta pomodoro uchun N−1 ta tanaffus; har `longBreakInterval`-chi pomodorodan
keyin uzun tanaffus, qolganlarida qisqa. Oxirgi pomodorodan keyin tanaffus qo'shilmaydi.

**Yarim tundan oshgan jadval:** agar reja kun oxiridan oshib ketsa, vaqt yoniga `⁺¹` belgisi
qo'yiladi (masalan `23:10–05:35⁺¹`) va xulosada «ertasi kunga o'tadi» deb ko'rsatiladi.
Hisobotlarda ham xuddi shunday (`+1`).

### Klaviatura yorliqlari

| Tugma | Vazifasi |
|---|---|
| `Probel` | Taymerni boshlash / pauza (fokus tugma yoki matn maydonida bo'lmaganda) |
| `N` | Yangi vazifa maydoniga o'tish |
| `Esc` | Ochiq oynani yopish |

---

## 7. Hisobotlar

**Hisobot** bo'limida davrni tanlang (**kunlik / haftalik / oylik**) — tizim tayyorlaydi:

- Asosiy ko'rsatkichlar: pomodorolar, reja bajarilishi %, sof fokus vaqti, tanaffuslar,
  bajarilgan vazifalar, maqsad bajarilishi, oldingi davr bilan taqqoslash.
- **Avtomatik xulosalar**: eng ko'p vaqt ketgan yo'nalish, eng samarali soat, uzilishlar soni.
- Vazifalar jadvali (vaqt oraliqlari bilan), yo'nalishlar taqsimoti, ish sessiyalari, kunlik dinamika grafigi.

### Yuklab olish formatlari

| Format | Nima uchun |
|---|---|
| **PDF / Chop etish** | Brauzerda ochiladi, `Ctrl+P` → PDF sifatida saqlash |
| **HTML** | Bezatilgan, mustaqil fayl (pochta orqali yuborish uchun) |
| **Markdown** | Notion, Confluence, GitHub, Slack'ga qo'yish uchun |
| **CSV** | Excel / Google Sheets uchun |
| **JSON** | Boshqa tizimlarga ulash uchun |

---

## 8. Integratsiyalar

Barchasi **Sozlamalar → 🔗 Integratsiyalar** bo'limida sozlanadi.
Kiritilgan tokenlar **AES-256-GCM bilan shifrlanadi** va faqat shu kompyuterda saqlanadi
(shifrlash kaliti — `data/.secret`). Interfeysda tokenlar niqoblangan holda ko'rsatiladi.

### Jira — vazifalarni yuklab olish

1. Atlassian API token yarating: [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Manzil (`https://kompaniya.atlassian.net`), email va tokenni kiriting → **Ulanishni tekshirish**.
3. JQL so'rovini yozing, masalan:
   ```
   assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC
   ```
4. **Vazifalarni ko'rish** → keraklilarini belgilang → **Tanlanganlarni bugungi rejaga qo'shish**.

Jira'dagi *Original estimate* bo'lsa, pomodorolar soni shundan hisoblanadi (masalan 2 soat → 5 pomodoro);
bo'lmasa siz belgilagan standart qiymat olinadi. Muhimlik va masala turi ham ko'chiriladi,
bir xil masala ikki marta qo'shilmaydi.

### Notion — hisobotni yuborish

1. Integratsiya yarating: [notion.so/my-integrations](https://www.notion.so/my-integrations) →
   "Internal Integration Secret"ni nusxalang.
2. **Muhim:** hisobotlar saqlanadigan Notion sahifasini oching → `•••` → **Connections** →
   integratsiyangizni qo'shing. Aks holda Notion "sahifa topilmadi" deydi.
3. Sahifa havolasini (yoki baza ID'sini) kiriting → **Ulanishni tekshirish**.
4. **Hisobot** bo'limida → **Notion'ga yuborish**. Yaratilgan sahifaga havola qaytariladi.

### Confluence — hisobotni yuborish

1. Xuddi shu Atlassian API token ishlatiladi.
2. Manzil (`https://kompaniya.atlassian.net/wiki`), email, token va **Space Key** (masalan `HR`) kiriting.
3. Ixtiyoriy: ota sahifa ID'sini bersangiz, hisobot o'sha sahifa ostiga joylashadi.
4. **Hisobot** bo'limida → **Confluence'ga yuborish**.

### Boshqa tizimlar (Trello, Asana, Todoist, ClickUp…)

Ular API'siz ham ishlaydi: task menejeringizdan vazifalarni **CSV** holida eksport qiling va
**Sozlamalar → Integratsiyalar → Boshqa tizimlar** bo'limiga qo'ying (yoki faylni tanlang).

Tizim ustunlarni o'zi taniydi:

| Ustun | Qabul qilinadigan nomlar |
|---|---|
| Vazifa nomi | `title`, `name`, `task`, `task name`, `summary`, `card name`, `content`, `vazifa` |
| Vaqt bahosi | `estimate`, `time estimate`, `duration`, `hours`, `minutes`, `vaqt` |
| Izoh | `description`, `notes`, `details`, `izoh` |
| Muhimlik | `priority` |
| Holat | `status`, `done`, `completed` |

Vaqt bahosi `2h`, `90m`, `1.5` (soat) kabi ko'rinishlarda tushuniladi va pomodorolarga aylantiriladi.

---

## Ma'lumotlar va xavfsizlik

- Hammasi `data/db.json` faylida (atomik yozuv). Har kuni `data/backups/db-YYYY-MM-DD.json`
  zaxira nusxasi yaratiladi, oxirgi 14 kun saqlanadi.
- Parollar `scrypt` (N=16384) bilan xeshlanadi, integratsiya tokenlari AES-256-GCM bilan shifrlanadi.
- Server faqat `127.0.0.1` da tinglaydi — ma'lumotlar kompyuteringizdan chiqmaydi.
  Tashqi so'rovlar faqat siz o'zingiz ulagan Jira / Notion / Confluence xizmatlariga yuboriladi.
- O'zgartiruvchi so'rovlar uchun `SameSite=Lax` cookie + manba (Origin) tekshiruvi.

> ⚠️ `HOST=0.0.0.0` bilan tarmoqqa chiqarsangiz, HTTPS'siz parollar ochiq uzatiladi.
> Bunday holatda oldiga reverse proxy (Caddy / nginx) qo'yib TLS ulang.

---

## Loyiha tuzilishi

```
pomodoro/
├── server.js                    HTTP server, router, autentifikatsiya darvozasi
├── lib/
│   ├── db.js                    JSON baza, v1→v2 migratsiya, zaxiralash
│   ├── auth.js                  sessiyalar, cookie, kirishni cheklash
│   ├── crypto.js                parol xeshi, token shifrlash
│   ├── plan.js                  kun jadvali va tanaffuslar hisobi
│   ├── report.js                hisobot modeli: HTML / MD / CSV / Notion / Confluence
│   ├── util.js
│   └── integrations/
│       ├── jira.js              JQL qidiruv, masalalarni vazifaga aylantirish
│       ├── notion.js            sahifa yaratish (Notion API)
│       └── confluence.js        sahifa yaratish (Confluence REST)
├── routes/                      auth · profile · tasks · timer · settings · stats · report · integrations · export
├── public/
│   ├── index.html · login.html
│   ├── css/style.css · css/extra.css
│   └── js/  app.js · features.js · api.js · charts.js · sound.js · login.js
└── data/
    ├── db.json · .secret
    └── backups/
```

## API

| Metod | Manzil | Vazifasi |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | Kirish |
| GET | `/api/auth/me` · `/api/auth/config` | Joriy foydalanuvchi / kirish usullari |
| GET | `/api/auth/start/:provider` → `/api/auth/callback/:provider` | OAuth (google, github) |
| GET/PUT | `/api/profile` | Profil |
| GET/PUT | `/api/profile/schedule` | Haftalik ish jadvali |
| PUT | `/api/plan/window` | Shu kunning ish vaqti va pomodoro sozlamasi |
| GET/PUT | `/api/integrations` · `/api/integrations/:name` | Integratsiya sozlamalari |
| POST | `/api/integrations/:name/test` | Ulanishni tekshirish |
| GET/POST | `/api/integrations/jira/preview` · `/api/integrations/jira/import` | Jira |
| POST | `/api/integrations/:name/export` | Notion / Confluence'ga yuborish |
| POST | `/api/integrations/import` | CSV / JSON import |
| GET | `/api/report` · `/api/report/download` · `/api/report/view` | Hisobotlar |
| GET | `/api/plan?date=` | Kun tartibi + jadval |
| POST/PATCH/DELETE | `/api/tasks…` | Vazifalar |
| POST | `/api/timer/start` \| `pause` \| `resume` \| `complete` \| `stop` \| `skip` | Taymer |
| GET | `/api/stats` · `/api/history` · `/api/export` | Statistika, tarix, eksport |

Barcha `/api/*` manzillar (kirish bilan bog'liqlaridan tashqari) autentifikatsiya talab qiladi va
faqat o'z foydalanuvchingizning ma'lumotlarini qaytaradi.
