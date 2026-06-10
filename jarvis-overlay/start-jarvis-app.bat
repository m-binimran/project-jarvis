@echo off
title JARVIS App
REM Double-click to launch JARVIS as a native app (the top-center pill).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-jarvis-app.ps1"
if errorlevel 1 pause
