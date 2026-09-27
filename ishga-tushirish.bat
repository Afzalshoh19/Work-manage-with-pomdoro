@echo off
title Pomodoro server
cd /d "%~dp0"

rem ═══════════ Qaysi backend ishga tushadi ═══════════
rem  python  - yangi backend (FastAPI/Uvicorn)   <- HOZIR SHU
rem  node    - eski backend (server.js)
rem
rem Node'ga qaytarish kerak bo'lsa: quyidagi qatorni "node" ga o'zgartirib,
rem oynani yopib qaytadan ochish yetarli. Boshqa hech narsa tegmaydi -
rem ikkovi bir xil data\db.json ni o'qiydi.
rem
rem DIQQAT: ikkisini bir vaqtda ishga tushirmang. Baza har yozuvda butunlay
rem qayta yoziladi, ikkinchisining o'zgarishi izsiz yo'qoladi.
set BACKEND=python

rem Faqat qo'lda ishga tushirilganda brauzer ochiladi ("auto" - rejalashtiruvchidan)
if not "%~1"=="auto" start "" http://127.0.0.1:4123

:qayta
echo [%date% %time%] server start (%BACKEND%) >> "%~dp0data\server.log"
if "%BACKEND%"=="node" (
  node server.js >> "%~dp0data\server.log" 2>&1
) else (
  rem PYTHONUNBUFFERED - jurnal darhol yozilsin, bufer to'lguncha kutmasin
  rem PYTHONIOENCODING - o'zbekcha matn va emoji Windows kodlashida buzilmasin
  set PYTHONUNBUFFERED=1
  set PYTHONIOENCODING=utf-8
  "%~dp0backend\.venv\Scripts\python.exe" -m backend.main >> "%~dp0data\server.log" 2>&1
)
echo [%date% %time%] server stopped, restarting >> "%~dp0data\server.log"
echo.
echo   Server toxtadi. 3 soniyadan keyin qayta ishga tushadi...
echo   Butunlay yopish uchun shu oynani yoping.
rem timeout konsolsiz ishlamaydi, shuning uchun ping bilan kutamiz
ping -n 4 127.0.0.1 >nul
goto qayta
