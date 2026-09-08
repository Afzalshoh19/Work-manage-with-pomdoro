@echo off
title Pomodoro server
cd /d "%~dp0"

rem Faqat qo'lda ishga tushirilganda brauzer ochiladi ("auto" - rejalashtiruvchidan)
if not "%~1"=="auto" start "" http://127.0.0.1:4123

:qayta
echo [%date% %time%] server start >> "%~dp0data\server.log"
node server.js >> "%~dp0data\server.log" 2>&1
echo [%date% %time%] server stopped, restarting >> "%~dp0data\server.log"
echo.
echo   Server toxtadi. 3 soniyadan keyin qayta ishga tushadi...
echo   Butunlay yopish uchun shu oynani yoping.
rem timeout konsolsiz ishlamaydi, shuning uchun ping bilan kutamiz
ping -n 4 127.0.0.1 >nul
goto qayta
