@echo off
REM Capcraft - Desktop Video Editor
REM Start script for development and production

echo.
echo  =============================================
echo   CAPCRAFT - Desktop Video Editor
echo  =============================================
echo.

REM Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

REM Check if node_modules exists
if not exist "node_modules" (
    echo.
    echo [INFO] Installing dependencies...
    call npm install --ignore-scripts
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.

    REM Install Electron binary
    echo [INFO] Downloading Electron binary...
    cd node_modules\electron
    node install.js
    cd ..\..
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [WARN] Electron binary not found. Trying manual download...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/electron/electron/releases/download/v30.5.1/electron-v30.5.1-win32-x64.zip' -OutFile '%LOCALAPPDATA%\electron\Cache\electron-v30.5.1-win32-x64.zip' -UseBasicParsing"
        powershell -Command "Expand-Archive -Path '%LOCALAPPDATA%\electron\Cache\electron-v30.5.1-win32-x64.zip' -DestinationPath 'node_modules\electron\dist' -Force"
        powershell -Command "[System.IO.File]::WriteAllText('node_modules\electron\path.txt', 'electron.exe')"
    )
)

REM Check FFmpeg
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "resources\bin\ffmpeg.exe" (
        echo.
        echo [WARN] FFmpeg not found on PATH or in resources/bin/
        echo        Video processing features require FFmpeg.
        echo        Download from: https://www.gyan.dev/ffmpeg/builds/
        echo        Place ffmpeg.exe in resources\bin\ or add to PATH.
        echo.
    )
) else (
    echo [OK] FFmpeg found on PATH
)

REM Check Whisper model
if not exist "resources\models\ggml-small.bin" (
    if not exist "models\ggml-small.bin" (
        echo.
        echo [WARN] Whisper model not found. Auto-caption feature requires it.
        echo        Download from: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
        echo        Place in: resources\models\ggml-small.bin
        echo.
    ) else (
        echo [OK] Whisper model found in models/
    )
) else (
    echo [OK] Whisper model found
)

echo.
echo [INFO] Starting Capcraft in development mode...
echo.

call npx electron-vite dev

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start. Check errors above.
    pause
)
