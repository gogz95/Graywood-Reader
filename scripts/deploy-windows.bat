@echo off
REM ==============================================================================
REM ONE-COMMAND PRODUCTION DEPLOYMENT SCRIPT FOR WINDOWS SERVER
REM ==============================================================================

echo 🚀 Starting ManhuaSync Production Deployment for Windows...

REM 1. Pull latest code if git repo exists
if exist ".git" (
    echo 📦 Pulling latest code from Git repository...
    git pull
)

REM 2. Install dependencies
echo 📦 Installing npm dependencies...
call npm install

REM 3. Build production frontend bundle
echo 🔨 Building production Vite frontend bundle...
call npm run build

REM 4. Ensure storage directory structure exists
if not exist "data\storage" mkdir "data\storage"

REM 5. Start application
echo 🚀 Launching production server...
call npm run start:prod

echo ==================================================================
echo 🎉 DEPLOYMENT COMPLETE! ManhuaSync running on http://localhost:3000
echo ==================================================================
