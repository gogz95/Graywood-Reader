# Graywood Reader - Windows PowerShell Launcher
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   Graywood Reader (Windows)                              " -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if Graywood Reader is already running on port 3000
try {
    $existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[INFO] Graywood Reader is already running on port 3000." -ForegroundColor Green
        Write-Host "Opening live reader interface in default browser..." -ForegroundColor Cyan
        Start-Process "http://localhost:3000"
        exit 0
    }
} catch { }

# 2. Ensure Node.js and npm are on PATH
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $commonPaths = @(
        "C:\Program Files\nodejs",
        "C:\Program Files (x86)\nodejs",
        "$env:APPDATA\npm",
        "$env:LOCALAPPDATA\Programs\nodejs"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path "$p\npm.cmd") {
            $env:Path += ";$p"
            break
        }
    }
}

# 3. Check for dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[SETUP] Installing project dependencies..." -ForegroundColor Yellow
    npm install
}

# 4. Spawn browser launch watcher when server binds to port 3000
Start-Job -ScriptBlock {
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 800
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                Start-Process "http://localhost:3000"
                break
            }
        } catch { }
    }
} | Out-Null

Write-Host "[START] Launching local Graywood Reader server on port 3000..." -ForegroundColor Green
Write-Host "Browser will open automatically once ready." -ForegroundColor Gray
npm run dev
