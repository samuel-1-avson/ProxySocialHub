@echo off
echo ===================================
echo  ProxySocialHub Web App Launcher
echo ===================================
echo.

REM Check if running in PowerShell
powershell -Command "if ($PSVersionTable.PSVersion.Major -lt 5) { exit 1 }" 2>nul
if %errorlevel% neq 0 (
    echo Error: PowerShell 5.0+ required
    pause
    exit /b 1
)

echo Checking environment...
powershell -ExecutionPolicy Bypass -File scripts\setup-web-app.ps1 %*

echo.
pause
