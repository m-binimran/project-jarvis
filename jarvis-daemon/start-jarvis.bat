@echo off
title JARVIS
REM Double-click this file to start JARVIS.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-jarvis.ps1"
if errorlevel 1 pause
