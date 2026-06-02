@echo off
REM Runs P3 full E2E without changing machine ExecutionPolicy (Bypass for this process only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0p3-multipod-e2e-full.ps1" %*
exit /b %ERRORLEVEL%
