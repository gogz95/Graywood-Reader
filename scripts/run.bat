@echo off
title Graywood Reader

if not exist logs mkdir logs

where powershell >nul 2>nul
if %ERRORLEVEL% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-desktop.ps1"
    goto :end
)

echo =========================================================
echo    Graywood Reader
echo =========================================================
echo.

if exist "C:\Program Files\nodejs\npm.cmd" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
if exist "%AppData%\npm\npm.cmd" set "PATH=%AppData%\npm;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\npm.cmd" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

if not exist node_modules (
    echo Installing project dependencies...
    call npm install
)

echo Starting local server and desktop engine...
call npm run dev

:end
echo.
echo Server stopped.
pause
