#!/usr/bin/env bash
# ==============================================================================
# ONE-COMMAND PRODUCTION DEPLOYMENT SCRIPT FOR LINUX (Ubuntu / Debian / Alpine)
# ==============================================================================

set -e

echo "🚀 Starting Graywood Reader Production Deployment for Linux..."

# 1. Pull latest changes if in git repo
if [ -d ".git" ]; then
    echo "📦 Pulling latest code from Git repository..."
    git pull || true
fi

# 2. Install dependencies
echo "📦 Installing production dependencies..."
npm ci || npm install

# 3. Build production frontend & server bundle
echo "🔨 Building production bundle..."
npm run build

# 4. Ensure storage directory structure exists
mkdir -p data/storage

# 5. Start or Reload process manager (PM2 / systemd / background)
if command -v pm2 &> /dev/null; then
    echo "🔄 Reloading application via PM2 process manager..."
    pm2 reload ecosystem.config.cjs || pm2 start ecosystem.config.cjs
    pm2 save
else
    echo "ℹ️ PM2 not found. You can run 'npm run start:prod' or install PM2 via 'npm i -g pm2'."
fi

echo "=================================================================="
echo "🎉 DEPLOYMENT COMPLETE! Graywood Reader running on http://localhost:3000"
echo "=================================================================="
