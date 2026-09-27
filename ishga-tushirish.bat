@echo off
title Pomodoro server
cd /d "%~dp0"

rem Backend — Python (FastAPI/Uvicorn), backend\ papkasida.
rem Virtual muhit bo'lmasa avval yarating:
rem   python -m venv backend\.venv
rem   backend\.venv\Scripts\python -m pip install -r backend\requirements.txt

if not exist "backend\.venv\Scripts\python.exe" (
  echo.
  echo   backend\.venv topilmadi. Avval virtual muhitni yarating:
  echo     python -m venv backend\.venv
  echo     backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
  echo.
  pause
  exit /b 1
)

rem PYTHONUNBUFFERED  - jurnal darhol yozilsin, bufer to'lguncha kutmasin
rem PYTHONIOENCODING  - o'zbekcha matn Windows kodlashida buzilmasin
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8

rem Faqat qo'lda ishga tushirilganda brauzer ochiladi ("auto" - rejalashtiruvchidan)
if not "%~1"=="auto" start "" http://127.0.0.1:4123

:qayta
echo [%date% %time%] server start >> "%~dp0data\server.log"
"%~dp0backend\.venv\Scripts\python.exe" -m backend.main >> "%~dp0data\server.log" 2>&1
echo [%date% %time%] server stopped, restarting >> "%~dp0data\server.log"
echo.
echo   Server toxtadi. 3 soniyadan keyin qayta ishga tushadi...
echo   Butunlay yopish uchun shu oynani yoping.
rem timeout konsolsiz ishlamaydi, shuning uchun ping bilan kutamiz
ping -n 4 127.0.0.1 >nul
goto qayta
