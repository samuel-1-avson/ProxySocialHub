@echo off
REM P1 full criterion benchmarks (Windows wrapper for p1-bench.sh logic).
cd /d "%~dp0.."
cargo bench --bench registry_bench %*
if errorlevel 1 exit /b 1
cargo bench --bench hotpath_bench %*
exit /b %errorlevel%
