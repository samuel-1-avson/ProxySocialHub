@echo off
chcp 65001 >nul
echo.
echo ==========================================
echo  Node Map Enhancement - Quick Start
echo ==========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running!
    echo Please start Docker Desktop first.
    pause
    exit /b 1
)

echo [1/4] Docker is running
echo.

REM Check if image exists
docker images proxyhubb-web --format "{{.Repository}}" | findstr "proxyhubb-web" >nul
if errorlevel 1 (
    echo [2/4] Building web image (this will take 5-10 minutes)...
    echo.
    docker compose -f docker-compose.dev.yml build web
    if errorlevel 1 (
        echo.
        echo [ERROR] Build failed!
        echo Check DOCKER_BUILD_STATUS.md for troubleshooting.
        pause
        exit /b 1
    )
) else (
    echo [2/4] Web image exists
echo.
)

echo [3/4] Starting containers...
docker compose -f docker-compose.dev.yml up -d web
if errorlevel 1 (
    echo [ERROR] Failed to start containers!
    pause
    exit /b 1
)

echo [4/4] Waiting for startup...
timeout /t 5 /nobreak >nul

echo.
echo ==========================================
echo  ✅ READY! Access the enhanced map at:
echo.
echo  http://localhost:3000/explorer/map
echo.
echo  Demo Pages:
echo  - Effects:  /explorer/map/examples/EffectsDemo
echo  - Themes:   /explorer/map/examples/ThemeDemo
echo  - Panels:   /explorer/map/examples/PanelDemo
echo  - Filters:  /explorer/map/examples/FilterDemo
echo  - Polish:   /explorer/map/examples/FinalDemo
echo.
echo ==========================================
echo.
echo Useful commands:
echo  - View logs: docker compose -f docker-compose.dev.yml logs -f web
echo  - Stop:      docker compose -f docker-compose.dev.yml stop web
echo  - Restart:   docker compose -f docker-compose.dev.yml restart web
echo.
pause
