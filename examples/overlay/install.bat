@echo off
title Install JARVIS
REM Double-click to install JARVIS (prerequisites, dependencies, model, shortcut).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
