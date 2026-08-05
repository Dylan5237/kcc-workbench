@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "npm_config_registry=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
echo === KimiCode Workbench one-click pack ===
echo Using npmmirror for npm, Electron and electron-builder binaries
echo.
call npm run pack -- %*
echo.
pause
