@echo off
REM Start P3 multipod stack (run from services\edge-gateway).
setlocal
set "SCRIPT_DIR=%~dp0"
set "ENV_FILE=%SCRIPT_DIR%..\..\..\.env"
set "COMPOSE_FILE=%SCRIPT_DIR%..\docker-compose.p3-multipod.yml"
if not exist "%ENV_FILE%" (
  echo ERROR: .env not found at %ENV_FILE%
  echo Create it from .env.example at the repo root.
  exit /b 1
)
docker compose --env-file "%ENV_FILE%" -p edge-p3 -f "%COMPOSE_FILE%" up -d --build %*
exit /b %ERRORLEVEL%
