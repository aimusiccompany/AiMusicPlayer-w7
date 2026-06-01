@echo off
chcp 65001 >nul
title AI Music Player - Setup Derleme
echo.
echo ========================================
echo   AI Music Player - Tek tıkla kurulum
echo ========================================
echo.

cd /d "%~dp0"

echo [0/3] Surum yukseltiliyor...
node scripts/bump-version.js
if errorlevel 1 (
    echo HATA: Surum yukseltme basarisiz.
    pause
    exit /b 1
)

echo.
echo [1/3] Bagimliliklar yukleniyor...
call npm install
if errorlevel 1 (
    echo.
    echo HATA: npm install basarisiz.
    pause
    exit /b 1
)

echo.
echo [2/3] Windows kurulum paketi (32+64 bit) olusturuluyor...
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
echo   Kurulum dosyasi: dist\AI Music Player Setup 1.x.x.exe
echo ========================================
echo.
pause
