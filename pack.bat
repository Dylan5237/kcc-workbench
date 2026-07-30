@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Kimi Desktop one-click pack ===
echo.
call npm run pack -- %*
echo.
pause
