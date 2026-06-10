@echo off
title Stop JARVIS
echo Stopping JARVIS (daemon on 9101 and interface on 3020)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($p in 9101,3020) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }; Write-Host 'JARVIS stopped.' -ForegroundColor Green"
timeout /t 2 >nul
