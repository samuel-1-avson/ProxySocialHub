@echo off
REM =============================================================================
REM Node Map Diagnostic Script (Windows)
REM =============================================================================

echo ==========================================
echo Node Map Diagnostic Tool
echo ==========================================
echo.

set ISSUES_FOUND=0

echo Checking Docker Containers...
echo ------------------------------------------

REM Check web container
docker-compose ps | findstr "web.*Up" >nul
if errorlevel 1 (
    echo [ERROR] Web container is not running
    echo    Fix: docker-compose up -d web
    set /a ISSUES_FOUND+=1
) else (
    echo [OK] Web container is running
)

REM Check control-api
docker-compose ps | findstr "control-api.*Up" >nul
if errorlevel 1 (
    echo [ERROR] Control-API container is not running
    echo    Fix: docker-compose up -d control-api
    set /a ISSUES_FOUND+=1
) else (
    echo [OK] Control-API container is running
)

REM Check postgres
docker-compose ps | findstr "postgres.*Up" >nul
if errorlevel 1 (
    echo [ERROR] PostgreSQL container is not running
    echo    Fix: docker-compose up -d postgres
    set /a ISSUES_FOUND+=1
) else (
    echo [OK] PostgreSQL container is running
)

echo.
echo Checking API Endpoints...
echo ------------------------------------------

REM Check health endpoint
curl -s -o nul -w "%%{http_code}" http://localhost:8081/health > api_health.txt 2>nul
set /p HEALTH_STATUS=<api_health.txt
del api_health.txt 2>nul

if "%HEALTH_STATUS%"=="200" (
    echo [OK] API Health endpoint is responding (HTTP 200)
) else (
    echo [ERROR] API Health endpoint returned HTTP %HEALTH_STATUS%
    echo    Fix: docker-compose restart control-api
    set /a ISSUES_FOUND+=1
)

echo.
echo Checking Database...
echo ------------------------------------------

REM Check nodes table
FOR /F "tokens=* USEBACKQ" %%F IN (`docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" 2^>nul`) DO (
    SET NODES_COUNT=%%F
)
SET NODES_COUNT=%NODES_COUNT: =%
echo Main nodes table: %NODES_COUNT% nodes

REM Check healthy nodes
FOR /F "tokens=* USEBACKQ" %%F IN (`docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes WHERE is_healthy = true;" 2^>nul`) DO (
    SET HEALTHY_COUNT=%%F
)
SET HEALTHY_COUNT=%HEALTHY_COUNT: =%
echo Healthy nodes: %HEALTHY_COUNT%

REM Check explorer_nodes
FOR /F "tokens=* USEBACKQ" %%F IN (`docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM explorer_nodes;" 2^>nul`) DO (
    SET EXPLORER_COUNT=%%F
)
SET EXPLORER_COUNT=%EXPLORER_COUNT: =%
echo Explorer nodes: %EXPLORER_COUNT%

echo.

REM Check for issues
if "%NODES_COUNT%"=="0" (
    echo [WARNING] Main nodes table is empty
    set /a ISSUES_FOUND+=1
)

if "%HEALTHY_COUNT%"=="0" if NOT "%NODES_COUNT%"=="0" (
    echo [WARNING] Nodes exist but none are healthy
    set /a ISSUES_FOUND+=1
)

if "%EXPLORER_COUNT%"=="0" if NOT "%HEALTHY_COUNT%"=="0" (
    echo [WARNING] Healthy nodes exist but not in explorer_nodes
    set /a ISSUES_FOUND+=1
)

echo.
echo Sample Explorer Nodes:
echo ------------------------------------------
if "%EXPLORER_COUNT%"=="0" (
    echo No explorer nodes to display
) else (
    docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT SUBSTRING(node_id, 1, 20) || '...' as node_id, country, region, is_active, is_validator FROM explorer_nodes LIMIT 5;" 2>nul
)

echo.
echo ==========================================
echo Diagnostic Summary
echo ==========================================
echo.

if "%ISSUES_FOUND%"=="0" (
    echo [OK] All checks passed!
    echo.
    echo The Node Map should be working correctly.
    echo If you're still not seeing nodes, try:
    echo    1. Refresh the browser page (Ctrl+F5)
    echo    2. Check browser console for JavaScript errors
) else (
    echo [WARNING] Found %ISSUES_FOUND% issue(s)
    echo.
    echo Quick fixes:
    echo.
    if "%NODES_COUNT%"=="0" (
        echo 1. ADD TEST NODES:
        echo    docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "INSERT INTO nodes (id, ip_address, port, connection_type, is_healthy, region, country, hotkey, created_at, updated_at, last_seen_at) VALUES (gen_random_uuid(), '192.168.1.100', 8080, 'http', true, 'af-west-1', 'Ghana', 'ghana-test', NOW(), NOW(), NOW());"
        echo    docker-compose restart control-api
        echo.
    )
    
    if "%HEALTHY_COUNT%"=="0" if NOT "%NODES_COUNT%"=="0" (
        echo 2. MARK NODES AS HEALTHY:
        echo    docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "UPDATE nodes SET is_healthy = true;"
        echo    docker-compose restart control-api
        echo.
    )
    
    if "%EXPLORER_COUNT%"=="0" if NOT "%HEALTHY_COUNT%"=="0" (
        echo 3. TRIGGER NODESYNC:
        echo    docker-compose restart control-api
        echo    Wait 30 seconds, then refresh the map
        echo.
    )
    
    echo Or run: fix-nodes.bat
)

echo.
pause
