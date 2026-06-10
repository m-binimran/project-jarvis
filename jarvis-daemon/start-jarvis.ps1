# JARVIS - one-click launcher
# Starts the daemon + interface, waits until healthy, opens the browser.
# Requires: Node.js 22+  (https://nodejs.org).  Optional: Ollama for free local AI (https://ollama.com).

$ErrorActionPreference = "Stop"
$daemonDir   = $PSScriptRoot
$frontendDir = Join-Path (Split-Path $PSScriptRoot -Parent) "jarvis-frontend"

function Test-Url($url) {
  try { $null = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing; return $true } catch { return $false }
}

Write-Host ""
Write-Host "  ===== Starting JARVIS =====" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js present?
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js is not installed." -ForegroundColor Red
  Write-Host "  Install the LTS version from https://nodejs.org then run this again." -ForegroundColor Yellow
  Read-Host "  Press Enter to exit"; exit 1
}

# 2. Frontend folder present?
if (-not (Test-Path $frontendDir)) {
  Write-Host "  Could not find the interface folder next to this one:" -ForegroundColor Red
  Write-Host "    $frontendDir" -ForegroundColor Yellow
  Write-Host "  Keep jarvis-daemon and jarvis-frontend in the same parent folder." -ForegroundColor Yellow
  Read-Host "  Press Enter to exit"; exit 1
}

# 3. Optional: start Ollama for free local AI, if installed and not already running
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  if (-not (Test-Url "http://127.0.0.1:11434/api/tags")) {
    Write-Host "  Starting Ollama for free local AI..." -ForegroundColor DarkGray
    Start-Process -WindowStyle Hidden ollama "serve"
    Start-Sleep -Seconds 2
  }
}

# 4. Start the daemon if it is not already up
if (Test-Url "http://127.0.0.1:9101/health") {
  Write-Host "  Daemon already running." -ForegroundColor Green
} else {
  Write-Host "  Starting JARVIS daemon..." -ForegroundColor DarkGray
  Start-Process -FilePath node -ArgumentList '--experimental-strip-types','src/index.ts' -WorkingDirectory $daemonDir -WindowStyle Minimized
}

# wait for daemon health up to 30s
$ok = $false
for ($i = 0; $i -lt 30; $i++) { if (Test-Url "http://127.0.0.1:9101/health") { $ok = $true; break }; Start-Sleep -Seconds 1 }
if (-not $ok) {
  Write-Host "  Daemon did not come online in time." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}
Write-Host "  Daemon online on port 9101." -ForegroundColor Green

# 5. Start the interface if it is not already up
if (Test-Url "http://127.0.0.1:3020") {
  Write-Host "  Interface already running." -ForegroundColor Green
} else {
  Write-Host "  Starting JARVIS interface..." -ForegroundColor DarkGray
  Start-Process -FilePath node -ArgumentList 'serve.js' -WorkingDirectory $frontendDir -WindowStyle Minimized
}
for ($i = 0; $i -lt 20; $i++) { if (Test-Url "http://127.0.0.1:3020") { break }; Start-Sleep -Seconds 1 }
Write-Host "  Interface online on port 3020." -ForegroundColor Green

# 6. Open the browser
Start-Sleep -Seconds 1
Start-Process "http://127.0.0.1:3020"

Write-Host ""
Write-Host "  JARVIS is running.  Open:  http://127.0.0.1:3020" -ForegroundColor Cyan
Write-Host "  Two minimized windows run the engine - leave them open while you use JARVIS." -ForegroundColor DarkGray
Write-Host "  To stop, run stop-jarvis.bat or close those two windows." -ForegroundColor DarkGray
Write-Host ""
