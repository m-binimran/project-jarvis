# JARVIS - one-time installer for Windows. Re-runnable (idempotent).
# Installs prerequisites (Node + Ollama via winget), all project dependencies,
# a small local model, and a desktop shortcut. Then JARVIS is double-click ready.

$ErrorActionPreference = "Stop"
$overlay  = $PSScriptRoot
$root     = Split-Path $PSScriptRoot -Parent
$daemon   = Join-Path $root "jarvis-daemon"
$frontend = Join-Path $root "jarvis-frontend"

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host ""
Write-Host "  =====  Installing JARVIS  =====" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js (required)
if (Have node) {
  Write-Host "  Node.js: already installed" -ForegroundColor Green
} elseif (Have winget) {
  Write-Host "  Installing Node.js LTS..." -ForegroundColor Yellow
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
} else {
  Write-Host "  Node.js is required. Install the LTS build from https://nodejs.org then run this again." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}
if (-not (Have node)) {
  Write-Host "  Node was installed but is not on PATH yet. Close this window and run install again." -ForegroundColor Yellow
  Read-Host "  Press Enter to exit"; exit 1
}

# 1b. Node must be new enough for the daemon (needs v22+ for --experimental-strip-types)
$nodeMajor = 0
try { $nodeMajor = [int](((node --version) -replace 'v','').Split('.')[0]) } catch {}
if ($nodeMajor -lt 22) {
  Write-Host ("  Your Node.js is v{0} - JARVIS needs v22 or newer." -f $nodeMajor) -ForegroundColor Yellow
  if (Have winget) {
    Write-Host "  Updating Node.js to the latest LTS..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    try { $nodeMajor = [int](((node --version) -replace 'v','').Split('.')[0]) } catch {}
  }
  if ($nodeMajor -lt 22) {
    Write-Host "  Please install Node.js v22+ (LTS) from https://nodejs.org, then run this installer again." -ForegroundColor Red
    Read-Host "  Press Enter to exit"; exit 1
  }
}
Write-Host ("  Node.js v{0}: OK" -f $nodeMajor) -ForegroundColor Green

# 2. Ollama (optional - free local AI brain)
if (Have ollama) {
  Write-Host "  Ollama: already installed" -ForegroundColor Green
} elseif (Have winget) {
  Write-Host "  Installing Ollama (free local AI)..." -ForegroundColor Yellow
  try {
    winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
  } catch {
    Write-Host "  (Ollama optional - skipped)" -ForegroundColor DarkGray
  }
} else {
  Write-Host "  Optional: install Ollama from https://ollama.com for a free local brain." -ForegroundColor DarkGray
}

# 3. Project dependencies
foreach ($dir in @($daemon, $frontend, $overlay)) {
  if (Test-Path (Join-Path $dir "package.json")) {
    Write-Host ("  Installing dependencies in " + (Split-Path $dir -Leaf) + "...") -ForegroundColor DarkGray
    Push-Location $dir
    try { npm install --no-fund --no-audit --loglevel=error } catch { Write-Host "  npm install had an issue in $dir" -ForegroundColor Yellow }
    Pop-Location
  }
}

# 3b. Voice model for the "Hey Jarvis" wake word (offline speech-to-text, ~40MB, one time)
$voiceSetup = Join-Path $frontend "setup-voice.ps1"
if (Test-Path $voiceSetup) {
  Write-Host "  Setting up offline voice for 'Hey Jarvis' (~40MB, one time)..." -ForegroundColor DarkGray
  try { Start-Process powershell -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$voiceSetup`"" -Wait -NoNewWindow } catch { Write-Host "  (voice model skipped - run setup-voice.ps1 later)" -ForegroundColor DarkGray }
}

# 4. Pull a small local model (only if Ollama is present and it is missing)
if (Have ollama) {
  $models = ""
  try { $models = (& ollama list 2>$null | Out-String) } catch {}
  if ($models -notmatch "llama3\.2:1b") {
    Write-Host "  Pulling local model llama3.2:1b (about 1.3GB, one time)..." -ForegroundColor DarkGray
    try { ollama pull llama3.2:1b } catch { Write-Host "  (model pull skipped - you can do it later)" -ForegroundColor DarkGray }
  } else {
    Write-Host "  Local model llama3.2:1b: present" -ForegroundColor Green
  }
}

# 5. Desktop shortcut
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "JARVIS.lnk"
$wsh = New-Object -ComObject WScript.Shell
$sc  = $wsh.CreateShortcut($lnk)
$sc.TargetPath       = Join-Path $overlay "start-jarvis-app.bat"
$sc.WorkingDirectory = $overlay
$sc.WindowStyle      = 7
$sc.IconLocation     = "C:\Windows\System32\shell32.dll,13"
$sc.Description       = "Start JARVIS"
$sc.Save()
Write-Host "  Desktop shortcut: created" -ForegroundColor Green

Write-Host ""
Write-Host "  =====  JARVIS is installed  =====" -ForegroundColor Green
Write-Host "  Double-click the JARVIS icon on your desktop to start it." -ForegroundColor Cyan
Write-Host ""
