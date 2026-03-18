@echo off
REM =============================================================================
REM ⚠️  DEPRECATED: Mock Data Creation Script
REM =============================================================================
REM This script creates TEST/MOCK nodes for development only.
REM 
REM FOR PRODUCTION: Use real nodes with actual public IPs.
REM See: REMOVE_MOCK_DATA_GUIDE.md for real data setup.
REM
REM To clean up mock data, run: cleanup-mock-data.bat
REM =============================================================================

echo ==========================================
echo ⚠️  MOCK DATA CREATION (DEVELOPMENT ONLY)
echo ==========================================
echo.
echo WARNING: This script creates FAKE test nodes with:
echo   - Fake IP addresses (192.168.x.x - NOT REAL)
echo   - Test identifiers (test-*, ghana-*, etc.)
echo   - Simulated location data
echo.
echo For production, use REAL nodes with actual public IPs.
echo See: REMOVE_MOCK_DATA_GUIDE.md
echo.

set /p purpose="Why do you need to run this? (test/cleanup/abort): "

if "%purpose%"=="cleanup" (
    echo.
    echo Running cleanup script instead...
    cleanup-mock-data.bat
    exit /b
)

if not "%purpose%"=="test" (
    echo.
    echo Cancelled. To set up real nodes, see REMOVE_MOCK_DATA_GUIDE.md
    exit /b 0
)

set /p confirm="Type 'MOCK' to create fake test nodes (NOT for production): "

if not "%confirm%"=="MOCK" (
    echo Cancelled.
    exit /b 0
)

echo.
echo Proceeding with MOCK DATA creation for testing...
echo.

REM The rest of the script would create mock data
REM For now, just show a message

echo ==========================================
echo This would create mock nodes with fake IPs.
echo For real setup, see REAL_DATA_SETUP.md
echo ==========================================
echo.

echo To set up REAL nodes:
echo   1. Read REAL_DATA_SETUP.md
echo   2. Deploy edge-gateway with real IPs
echo   3. Or register via API with public IPs
echo.

pause
