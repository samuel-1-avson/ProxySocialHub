@echo off
REM Bypasses a Restricted PowerShell execution policy for this file only.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0w12b-permissionless-join.ps1" %*
exit /b %ERRORLEVEL%
