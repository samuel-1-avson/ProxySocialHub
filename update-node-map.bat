@echo off
REM =============================================================================
REM ProxyHubb Node Map Update Script (Windows)
REM =============================================================================
REM This script rebuilds the web container with all the Node Map fixes
REM Run this from the project root directory
REM =============================================================================

echo ==========================================
echo ProxyHubb Node Map Update
echo ==========================================
echo.

REM Check if docker-compose is available
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] docker-compose not found. Please install Docker Compose.
    exit /b 1
)

REM Check if we're in the right directory
if not exist "docker-compose.yml" (
    echo [ERROR] docker-compose.yml not found. Please run this script from the project root.
    exit /b 1
)

echo Step 1/5: Stopping current web container...
docker-compose stop web 2>nul
docker-compose rm -f web 2>nul
echo [OK] Web container stopped

echo.
echo Step 2/5: Rebuilding web container with new code...
docker-compose build --no-cache web
if errorlevel 1 (
    echo [ERROR] Build failed!
    exit /b 1
)
echo [OK] Web container rebuilt successfully

echo.
echo Step 3/5: Starting all services...
docker-compose up -d
echo [OK] All services started

echo.
echo Step 4/5: Waiting for services to be healthy...
timeout /t 10 /nobreak >nul

echo.
echo Step 5/5: Verifying API connectivity...

REM Test API
curl -s -o nul -w "%%{http_code}" http://localhost:8081/health > api_status.txt 2>nul
set /p API_STATUS=<api_status.txt
del api_status.txt 2>nul

if "%API_STATUS%"=="200" (
    echo [OK] API is responding (HTTP 200)
) else (
    echo [!] API returned HTTP %API_STATUS% (may still be starting up)
)

echo.
echo ==========================================
echo Update Complete!
echo ==========================================
echo.
echo Access the Node Map at:
echo   http://localhost:3000/explorer/map
echo.
echo Useful commands:
echo   View logs:        docker-compose logs -f web
echo   Check status:     docker-compose ps
echo   View API logs:    docker-compose logs -f control-api
echo.
echo Troubleshooting:
echo   - If no nodes appear, wait 30 seconds for NodeSync to run
echo   - Check API: curl http://localhost:8081/v1/explorer/nodes
echo   - Check logs: docker-compose logs control-api ^| findstr nodesync
echo.

pause
