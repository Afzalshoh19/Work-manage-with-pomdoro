@echo off
title Pomodoro - tashqi havola
cd /d "%~dp0"
chcp 65001 >nul

rem ═══════════════════════════════════════════════════════════════
rem  Tizimga internetdan kirish uchun vaqtinchalik havola ochadi.
rem
rem  Qanday ishlaydi: Cloudflare tunnel shu kompyuterdagi
rem  127.0.0.1:4123 ga ulanadi va unga https manzil beradi.
rem  Portni ochish, router sozlash yoki oq IP kerak emas.
rem
rem  SHARTLAR:
rem    1. Avval server ishga tushgan bo'lsin (ishga-tushirish.bat).
rem    2. Shu oyna OCHIQ turishi kerak — yopilsa havola o'ladi.
rem    3. Kompyuter yoqiq va internetga ulangan bo'lsin.
rem
rem  DIQQAT: manzil har safar YANGIDAN beriladi. Oynani yopib
rem  qaytadan ochsangiz eski havola ishlamaydi.
rem ═══════════════════════════════════════════════════════════════

if not exist "tools\cloudflared.exe" (
  echo.
  echo   tools\cloudflared.exe topilmadi.
  echo   Yuklab oling: tools\OQING.md faylidagi ko'rsatmaga qarang.
  echo.
  pause
  exit /b 1
)

rem Server javob beryaptimi — yo'q bo'lsa havola bo'sh sahifa beradi
curl -s -m 4 -o nul http://127.0.0.1:4123/api/health
if errorlevel 1 (
  echo.
  echo   4123-portda server javob bermayapti.
  echo   Avval ishga-tushirish.bat ni ishga tushiring, keyin shu oynani qayta oching.
  echo.
  pause
  exit /b 1
)

echo.
echo   Havola tayyorlanmoqda... ^(10-20 soniya^)
echo   Pastda "https://....trycloudflare.com" chiqadi - o'sha havolani yuboring.
echo.

"tools\cloudflared.exe" tunnel --url http://127.0.0.1:4123 --no-autoupdate

echo.
echo   Tunnel yopildi. Havola endi ishlamaydi.
pause
