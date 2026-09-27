# Dizayn topshirig'i — 4 uslub (Glass · Clay · Skeuo · Neu)

Bu papkada Claude Design'da chizilgan maketlarning manba fayllari bor. Ular **maket**:
ilova kodi emas. Vazifa — ilovaning mavjud mantiqini o'zgartirmasdan, ko'rinishini
shu maketlarga moslash.

Joriy holat (git log bo'yicha):
- `c234d53` — to'rt uslubli mavzu tizimi qo'shildi (`public/css/themes.css`, `public/js/theme.js`).
- `827e3a8` — Glassmorphism maketga moslandi (1/4).
- **Qoldi:** Clay (2/4), Skeuo (3/4), Neu (4/4), keyin hamma uslub bo'yicha yakuniy tekshiruv.

## Fayllar xaritasi

| Maket fayli | Ilovadagi joy |
|---|---|
| `<uslub>/bugun.dc.html` | `public/index.html` → «Bugun» tabi (taymer, kun kartalari, Kun tartibi) |
| `<uslub>/statistika.dc.html` | «Statistika» tabi |
| `<uslub>/hisobot.dc.html` | «Hisobot» tabi (xulosa, To'g'rlash ro'yxati, yuklab olish) |
| `<uslub>/tarix.dc.html` | «Tarix» tabi |
| `<uslub>/sozlamalar.dc.html` | Profil / sozlamalar bo'limi (Umumiy, Ish jadvali, Taymer, Xavfsizlik, Integratsiyalar, Ma'lumotlar) |
| `<uslub>/modallar.dc.html` | Ko'p kunlik reja, Yangi vazifa, Pomodoroni to'g'rlash modallari |
| `<uslub>/kirish.dc.html` | `public/login.html` |
| `<uslub>/landing.dc.html` | `public/landing.html` |

`<uslub>` = `glass`, `clay`, `skeuo`, `neu` — `themes.css` dagi `[data-theme="…"]` bilan bir xil.

## `.dc.html` faylni qanday o'qish kerak

- Har bir element **inline `style="…"`** bilan yozilgan — bu aniq spetsifikatsiya
  (rang, radius, soya, bo'shliq, shrift o'lchami). Shu qiymatlarni `themes.css` ga ko'chiring.
- `{{accent}}` — uslubning aksent rangi (pastdagi jadvalda). `{{k.value}}`, `{{d.day}}` kabilar —
  demo ma'lumot; ular fayl oxiridagi `renderVals()` ichida. Haqiqiy ilova o'z ma'lumotini ishlatadi.
- `<sc-for>` — takrorlanuvchi element, `<sc-if>` — shartli. `renderVals()` ichidagi `st`, `card`,
  `track`, `knob` kabi satrlar — **holatga qarab o'zgaradigan stil** (faol/nofaol, tanlangan,
  to'lib ketgan kun). Ularni `.is-active`, `[aria-checked="true"]`, `.is-over` kabi holat sinflariga aylantiring.
- `<x-dc>`, `<helmet>`, `support.js`, `data-props` — maket muharririning ichki qismi, e'tibor bermang.
- Maketlar 1440 px kenglikda chizilgan.

## Uslub tokenlari

| Token | Glass | Clay | Skeuo | Neu |
|---|---|---|---|---|
| Fon | `#0B0E1A` + xira dog'lar (`#FF6B5B`, `#7B5CFF`, `#1FC7B6`, blur 150–170px) | `#F4EEE6` | yog'och: `repeating-linear-gradient(92deg,#4A3224 0,#553A2A 6px,#4A3224 11px,#3F2A1E 18px,#4A3224 26px)` | `#E4E8EF` |
| Karta | `rgba(255,255,255,.07)` + `1px solid rgba(255,255,255,.16)` + `backdrop-filter: blur(24–28px)` | `#FFFAF4`; soya: `14px 18px 34px rgba(140,110,80,.18), inset -6px -8px 14px rgba(180,150,120,.14), inset 6px 6px 12px #fff` | 3 xil yuza: qog'oz `#FBF7EE`, metall panel `linear-gradient(180deg,#E9E9E6,#C9CAC6 48%,#B8B9B4 52%,#D6D7D3)`, qora charm `linear-gradient(180deg,#2E2A27,#1C1A18)` | fon bilan bir xil; soya `10px 10px 20px #C2C8D2, -10px -10px 20px #FFFFFF` |
| Ichkariga bosilgan (input, faol tab) | `rgba(0,0,0,.2)` | `#F6EFE6` + `inset 3px 3px 6px rgba(160,120,90,.2), inset -3px -3px 6px #fff` | LCD: `#1A1A18` + `inset 0 2px 5px rgba(0,0,0,.9)`; qog'ozda — faqat pastki chiziq `2px solid #2A2420` | `inset 4px 4px 8px #C2C8D2, inset -4px -4px 8px #FFFFFF` |
| Matn / ikkinchi darajali | `#F4F6FF` / `rgba(244,246,255,.7)` | `#3A2E4A` / `#6B5C7A` (`#7A6A88`) | qog'ozda `#2A2420` / `#5E554A`; qora panelda `#F3E6CF` / `#D9CCB4` | `#2E3647` / `#56607A` |
| Aksent | `#FF6B5B` → `#FF8F6B` gradient | `#F26B5E` | `#E5533F` (tugma: `linear-gradient(180deg,#FF8C78,#E5533F 50%,#C23B2B)`) | `#E8594C` (aksent matni `#B8372B`) |
| Radius (karta / tugma) | 28 / 14–18 | 32–40 / 18–24 | qog'oz 3–4, metall 18–22, tugma 8 | 24–32 / 14–16 |
| Shriftlar | Sora (sarlavha, taymer 300), Manrope (matn) | Nunito 700–900 | Libre Baskerville (sarlavha), IBM Plex Sans (matn), Share Tech Mono (LCD raqamlar), IBM Plex Mono (yorliqlar), **Caveat** (qo'lyozma: daftar, vazifalar) | Plus Jakarta Sans 600–800 |

Qo'shimcha ranglar:
- **Clay pastel juftlari** (fon / matn): qizil `#FFD9D2`/`#8A3C35`, yashil `#CDEFE0`/`#1F6B4B`, binafsha `#E4DBFF`/`#4F3AA0`, sariq `#FFEDB8`/`#7A5A10`, ko'k `#DCE8FF`/`#2E4E8F`. Statistika kartalari shu tartibda aylanadi.
- **Skeuo LCD:** yashil `#9EFFAA` (glow `0 0 14px rgba(120,255,140,.6)`), qahrabo `#FFB85C`. Fonda `#1B2A1E → #0F1A12`.

## Har bir uslubning o'ziga xos detallari (albatta bo'lsin)

**Clay**
- Taymer — pomidor: aksent rangli shar, tepasida yashil band (`#6FCF97`), ichida krem doira.
- Asosiy «Pauza/Boshlash» tugmasi to'q `#3A2E4A`, «+ Vazifa qo'shish» esa aksent rangda.
- KPI kartalar har biri o'z pastel rangida; progress bar ichkariga botgan chuqurcha ichida.
- Switch'lar: yoqilgan — `#57C08E`.

**Skeuo**
- Chap panel — metall «FOCUS TIMER · MODEL 25» qurilmasi: LCD displey, 3 ta dumaloq fizik tugma (o'rtadagisi katta qizil).
- Kun tartibi va hisobot — **qog'oz**: chiziqli daftar (`#C9D8EA` chiziqlar, qizil hoshiya chizig'i), Caveat shrifti, bajarilgan vazifa qizil chiziq bilan o'chiriladi, faol vazifa sariq marker bilan.
- Hisobot — rasmiy blanka ko'rinishida, «REJA 88% BAJARILDI» dumaloq muhri.
- Statistika grafiklari — katakli qog'ozda shtrixlangan ustunlar; «Eng samarali soatlar» — LCD ichida.
- Taymer sozlamalari — metall burama tugmalar (knob); switch'lar LED chiroqli.
- Ko'p kunlik reja kunlari — taxtaga qadalgan kartochkalar (to'g'nag'ich bilan).
- `theme.js` dagi skeuo shriftlariga **Caveat** va **IBM Plex Mono** qo'shilishi kerak.

**Neu**
- Faol holat = ichiga botgan (`inset`), nofaol = bo'rtib chiqqan. Aksent faqat asosiy tugma, taymer halqasi va progressda.
- Taymer: bo'rtiq disk → ichiga botgan halqa → markazda yana bo'rtiq disk, atrofida aksent yoy.
- Boshqaruv tugmalari dumaloq (58 / 84 / 58 px).
- Kontrast: matn `#2E3647`, ikkinchi darajali kamida `#56607A` — bundan ochroq qilmang.

## Qoidalar

1. Mantiq, API, ma'lumotlar, JS xatti-harakatiga tegmang — faqat CSS va zarur bo'lsa markup sinflari.
2. `dark` va `light` klassik mavzular o'zgarmasin.
3. Tokenlar avval `[data-theme="…"]` ichida; o'ziga xos effektlar (daftar, LCD, pomidor) — alohida qoidalar.
4. Kontrast: oddiy matn ≥ 4.5:1, bosiladigan elementlar ≥ 44 px.
5. Har bir uslubdan keyin alohida commit: `Claymorphism chizmaga to'liq moslandi (2/4)` va h.k.

## Claude Code uchun tayyor prompt

```
design/DESIGN-HANDOFF.md ni o'qi. Glassmorphism allaqachon moslangan (827e3a8).
Endi Claymorphism'ni design/clay/*.dc.html maketlariga to'liq moslashtir:
bugun, statistika, hisobot, tarix, sozlamalar, modallar, kirish va landing sahifalari.
Qiymatlarni maketdagi inline stillardan ol, faqat public/css/themes.css (va kerak bo'lsa
theme.js shriftlari) ni o'zgartir, mantiqqa tegma. Tugagach har bir sahifani
data-theme="clay" da ochib maket bilan solishtir va "(2/4)" deb commit qil.
Keyin xuddi shu tartibda skeuo (3/4) va neu (4/4) ni qil, oxirida 4 ta uslubni
barcha sahifalarda tekshirib chiq.
```
