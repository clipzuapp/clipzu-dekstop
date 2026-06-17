@echo off
REM Capcraft - Production Build Script
echo.
echo  =============================================
echo   CAPCRAFT - Production Build
echo  =============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

echo [INFO] Building for production...
echo.

call npx electron-vite build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Vite build failed.
    pause
    exit /b 1
)

echo.
echo [OK] Vite build complete.
echo.

if "%1"=="--pack" (
    echo [INFO] Packaging with electron-builder...
    call npx electron-builder --win
    if %errorlevel% neq 0 (
        echo [ERROR] Packaging failed.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Package created in dist/
) else (
    echo [INFO] Build complete. Output in out/
    echo        Run "build.bat --pack" to create installer.
)

echo.
pause
