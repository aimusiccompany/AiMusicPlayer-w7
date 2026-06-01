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

:: Güncel versiyonu ekrana yazdırmak için package.json'dan okuyoruz
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set VERSION=%%i

echo.
echo [1/3] Temiz bagimliliklar yukleniyor (npm ci)...
call npm ci
if errorlevel 1 (
    echo.
    echo HATA: npm ci basarisiz.
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
echo   Tamamlandi. Sürüm: v%VERSION%
echo   Kurulum dosyasi: dist\AI Music Player Setup %VERSION%.exe
echo ========================================
echo.
pause