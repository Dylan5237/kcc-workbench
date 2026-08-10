@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "npm_config_registry=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
echo === KCC Workbench one-click pack ===
echo Using npmmirror for npm, Electron and electron-builder binaries
if /I "%~1"=="fast" echo Fast mode: unpacked app, no tests, output to dist-fast\win-unpacked
echo.
call npm run pack -- %*
echo.
pause
