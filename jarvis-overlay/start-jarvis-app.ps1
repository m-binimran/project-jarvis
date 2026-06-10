# JARVIS native app launcher — starts the brain (daemon) + the pill overlay.
# Requires Node.js 22+. Optional: Ollama for free local AI.

$ErrorActionPreference = "Stop"
$overlayDir = $PSScriptRoot
$daemonDir  = Join-Path (Split-Path $PSScriptRoot -Parent) "jarvis-daemon"

function Test-Url($u) {
  try { $null = Invoke-WebRequest -Uri $u -TimeoutSec 2 -UseBasicParsing; return $true } catch { return $false }
}

Write-Host ""
Write-Host "  ===== Starting JARVIS (native app) =====" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js not found. Install LTS from https://nodejs.org and retry." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}

# Ollama (free local AI)
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  if (-not (Test-Url "http://127.0.0.1:11434/api/tags")) {
    Write-Host "  Starting Ollama..." -ForegroundColor DarkGray
    Start-Process -WindowStyle Hidden ollama "serve"; Start-Sleep -Seconds 2
  }
}

# Daemon (the brain)
if (-not (Test-Url "http://127.0.0.1:9101/health")) {
  Write-Host "  Starting JARVIS daemon..." -ForegroundColor DarkGray
  Start-Process -FilePath node -ArgumentList '--experimental-strip-types','src/index.ts' -WorkingDirectory $daemonDir -WindowStyle Minimized
}
$ok = $false
for ($i = 0; $i -lt 30; $i++) { if (Test-Url "http://127.0.0.1:9101/health") { $ok = $true; break }; Start-Sleep -Seconds 1 }
if (-not $ok) { Write-Host "  Daemon did not start." -ForegroundColor Red; Read-Host "  Press Enter to exit"; exit 1 }
Write-Host "  Daemon online." -ForegroundColor Green

# Frontend (the polished UI shown inside the app window when the pill is clicked)
if (-not (Test-Url "http://127.0.0.1:3020")) {
  Write-Host "  Starting JARVIS interface..." -ForegroundColor DarkGray
  $frontendDir = Join-Path (Split-Path $PSScriptRoot -Parent) "jarvis-frontend"
  Start-Process -FilePath node -ArgumentList 'serve.js' -WorkingDirectory $frontendDir -WindowStyle Minimized
  for ($i = 0; $i -lt 15; $i++) { if (Test-Url "http://127.0.0.1:3020") { break }; Start-Sleep -Seconds 1 }
}
Write-Host "  Interface online." -ForegroundColor Green

# The pill overlay (stays in the foreground of THIS window — keeps the app alive).
Write-Host "  Launching the JARVIS pill (top-center of your screen)..." -ForegroundColor Green
Write-Host "  Keep this window open while you use JARVIS. Close it to quit." -ForegroundColor DarkGray
Set-Location $overlayDir
npm start
