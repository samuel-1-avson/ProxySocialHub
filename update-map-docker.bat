@echo off
chcp 65001 >nul
REM Docker Update Script for Node Map Enhancement
REM This script rebuilds the web container with the new map components

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║     Node Map Enhancement - Docker Update Script             ║
echo ║                                                              ║
echo ║  Phases: 1 2 3 4 5 6                                         ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

set "ENVIRONMENT=dev"
set "SKIP_BUILD="
set "KEEP_CACHE="
set "INSTALL_DEPS="

REM Parse arguments
:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--dev" set "ENVIRONMENT=dev"
if "%~1"=="--prod" set "ENVIRONMENT=prod"
if "%~1"=="--full" set "ENVIRONMENT=full"
if "%~1"=="--skip-build" set "SKIP_BUILD=1"
if "%~1"=="--keep-cache" set "KEEP_CACHE=1"
if "%~1"=="--install-deps" set "INSTALL_DEPS=1"
shift
goto :parse_args
:done_args

echo Environment: %ENVIRONMENT%
echo.

REM Determine compose file
if "%ENVIRONMENT%"=="dev" set "COMPOSE_FILE=docker-compose.dev.yml"
if "%ENVIRONMENT%"=="prod" set "COMPOSE_FILE=docker-compose.prod.yml"
if "%ENVIRONMENT%"=="full" set "COMPOSE_FILE=docker-compose.full.yml"
if not exist %COMPOSE_FILE% set "COMPOSE_FILE=docker-compose.yml"

echo Using compose file: %COMPOSE_FILE%
echo.

REM Check Docker is running
echo [1/6] Checking Docker...
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    exit /b 1
)
echo [OK] Docker is running
echo.

REM Install dependencies if requested
if defined INSTALL_DEPS (
    echo [2/6] Installing dependencies...
    cd apps\web
    call npm install framer-motion three @react-three/fiber @react-three/drei recharts
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install dependencies
        cd ..\..
        exit /b 1
    )
    echo [OK] Dependencies installed
    cd ..\..
) else (
    echo [2/6] Skipping dependency installation (use --install-deps to install)
)
echo.

REM Stop the web container
echo [3/6] Stopping web container...
docker compose -f %COMPOSE_FILE% stop web 2>nul
echo [OK] Web container stopped
echo.

REM Remove old container
echo [4/6] Removing old web container...
docker compose -f %COMPOSE_FILE% rm -f web 2>nul
echo [OK] Old container removed
echo.

REM Build if not skipped
if not defined SKIP_BUILD (
    echo [5/6] Rebuilding web container...
    if defined KEEP_CACHE (
        docker compose -f %COMPOSE_FILE% build web
    ) else (
        docker compose -f %COMPOSE_FILE% build --no-cache web
    )
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to build web container
        exit /b 1
    )
    echo [OK] Web container rebuilt
) else (
    echo [5/6] Skipping build (use --skip-build to skip)
)
echo.

REM Start container
echo [6/6] Starting web container...
docker compose -f %COMPOSE_FILE% up -d web
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to start web container
    exit /b 1
)
echo [OK] Web container started
echo.

REM Show status
timeout /t 3 /nobreak >nul
echo Container status:
docker compose -f %COMPOSE_FILE% ps web
echo.

echo ╔══════════════════════════════════════════════════════════════╗
echo ║                     UPDATE COMPLETE!                         ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo 🌐 Access the enhanced map at: http://localhost:3000/explorer/map
echo.
echo 📚 Features now available:
echo    • Animated node markers with particle effects
echo    • 5 visual themes (dark, light, satellite, cyberpunk, minimal)
echo    • 3D Globe view
echo    • Animated connection lines between nodes
echo    • Detailed node panels with charts
echo    • Real-time activity feed
echo    • Advanced filters and search
echo    • Smooth transitions and loading states
echo.

pause
