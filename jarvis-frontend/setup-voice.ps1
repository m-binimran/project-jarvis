# setup-voice.ps1 - one-time download of the offline voice model for "Hey Jarvis".
#
# Downloads a ~40 MB Vosk small-English model into .\models so speech-to-text
# works fully offline (no API key, no cloud). Run once:
#     powershell -ExecutionPolicy Bypass -File setup-voice.ps1

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $here "models"
$file = Join-Path $dest "vosk-model-small-en-us-0.15.tar.gz"
$url  = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz"

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

if (Test-Path $file) {
  $mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
  Write-Host "Model already present ($mb MB): $file"
  exit 0
}

Write-Host "Downloading Vosk small English voice model (~40 MB)..."
Write-Host "  from $url"
try {
  $ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster
  Invoke-WebRequest -Uri $url -OutFile $file
} catch {
  Write-Host ""
  Write-Host "Download failed: $($_.Exception.Message)"
  Write-Host "Manual fallback: download any vosk-browser .tar.gz English model and save it as:"
  Write-Host "  $file"
  exit 1
}

$mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
Write-Host "Done. Saved $mb MB to $file"
Write-Host "Now open the talk box (Ctrl+Alt+Space), click the mic, and say 'Hey Jarvis'."
