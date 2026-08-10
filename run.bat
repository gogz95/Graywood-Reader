@echo off
if exist "C:\Program Files\nodejs\npm.cmd" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
if exist "%AppData%\npm\npm.cmd" set "PATH=%AppData%\npm;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\npm.cmd" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

echo Starting Express Server & Kotatsu Webtoon Engine...
call npm run dev
pause
