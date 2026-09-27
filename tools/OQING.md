# tools/

Bu papkada tizimga kirmaydigan, lekin yonida turishi qulay bo'lgan tashqi
dasturlar saqlanadi. Ular **git'ga tushmaydi** (`.gitignore` da `tools/*.exe`),
chunki hajmi katta va har kim o'zi yuklab olishi mumkin.

## cloudflared

Cloudflare'ning tunnel dasturi. `havola-ochish.bat` shuni chaqiradi:
kompyuteringizdagi `127.0.0.1:4123` ga tashqaridan kiriladigan vaqtinchalik
`https://...trycloudflare.com` manzilini beradi.

Router sozlash, port ochish yoki oq IP kerak emas — ulanishni cloudflared
o'zi ichkaridan tashqariga qurib oladi.

### Qaytadan yuklab olish

Fayl yo'qolsa yoki eskirsa:

```bash
curl -L -o tools/cloudflared.exe \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
```

Tekshirish:

```bash
tools/cloudflared.exe --version
```

### Bilib qo'yish kerak bo'lgan narsalar

- **Manzil har safar yangi.** Hisobsiz («quick») tunnel doimiy nom bermaydi.
  Oynani yopib qaytadan ochsangiz havola o'zgaradi. Doimiy nom kerak bo'lsa
  Cloudflare'da hisob ochib, «named tunnel» qilinadi.
- **Kafolat yo'q.** Cloudflare hisobsiz tunnellar uchun uzluksiz ishlashni
  kafolatlamaydi. Doimiy foydalanish uchun `DEPLOY.md` dagi yo'l to'g'riroq.
- **Havolani bilgan har kim ro'yxatdan o'ta oladi.** Tizimda taklif kodi yoki
  ruxsat etilgan email ro'yxati yo'q. Kerak bo'lsa qo'shiladi.
- **Mijoz IP manzili.** Tunnel orqali kelgan so'rovlarda ilova hammani
  `127.0.0.1` deb ko'radi va IP bo'yicha urinish cheklovini o'zi o'chiradi
  (aks holda bir necha urinishdan keyin hamma bloklanardi). Hisob bo'yicha
  cheklovlar ishlashda davom etadi. Haqiqiy IP kerak bo'lsa `.env` ga
  `TRUST_PROXY=1` qo'shiladi — lekin **faqat tunnel bilan ishlatilganda**:
  ilova to'g'ridan-to'g'ri internetga chiqarilgan bo'lsa, bu bayroq mijozga
  o'z IP'sini o'zi yozish imkonini beradi.
