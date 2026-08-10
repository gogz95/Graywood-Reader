@echo off
title OmniManga Kotatsu Reader

if not exist logs mkdir logs

echo =========================================================
echo    OmniManga Sync and Kotatsu Webtoon Reader
echo =========================================================
echo.

if exist "C:\Program Files\nodejs\npm.cmd" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
if exist "%AppData%\npm\npm.cmd" set "PATH=%AppData%\npm;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\npm.cmd" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

echo Checking Node.js environment...
call node -v
call npm -v
echo.

if not exist node_modules (
    echo Installing project dependencies...
    call npm install
)

echo Starting local server and desktop engine...
call npm run dev

echo.
echo Server stopped.
pause
