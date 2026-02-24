@echo off
chcp 65001 >nul
title AI Music Player - Setup Derleme
echo.
echo ========================================
echo   AI Music Player - Tek tıkla kurulum
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Bagimliliklar yukleniyor...
call npm install
if errorlevel 1 (
    echo.
    echo HATA: npm install basarisiz.
    pause
    exit /b 1
)

echo.
echo [2/2] Windows kurulum paketi (32+64 bit) olusturuluyor...
call npm run dist
if errorlevel 1 (
    echo.
    echo HATA: electron-builder basarisiz.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Tamamlandi.
echo   Kurulum dosyasi: dist\AI Music Player Setup 1.0.0.exe
echo ========================================
echo.
pause
