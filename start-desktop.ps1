# OmniManga Kotatsu Reader - Windows PowerShell Launcher
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   OmniManga Sync & Kotatsu Webtoon Reader (Windows)     " -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

# Detect Node / npm
$npmPath = Get-Command npm -ErrorAction SilentlyContinue

if ($npmPath) {
    Write-Host "[OK] Node.js & npm detected at: $($npmPath.Path)" -ForegroundColor Green
    Write-Host "Launching local server..." -ForegroundColor White
    npm run dev
} else {
    # Check standard install locations
    $commonPaths = @(
        "C:\Program Files\nodejs",
        "C:\Program Files (x86)\nodejs",
        "$env:APPDATA\npm",
        "$env:LOCALAPPDATA\Programs\nodejs"
    )

    $found = $false
    foreach ($p in $commonPaths) {
        if (Test-Path "$p\npm.cmd") {
            $env:Path += ";$p"
            $found = $true
            break
        }
    }

    if ($found) {
        Write-Host "[OK] Node.js detected in standard location. Starting app..." -ForegroundColor Green
        npm run dev
    } else {
        Write-Host "[NOTE] Node.js binary was not found in system PATH." -ForegroundColor Yellow
        Write-Host "Opening live reader web interface in default browser..." -ForegroundColor Cyan
        Start-Process "http://localhost:3000"
    }
}
