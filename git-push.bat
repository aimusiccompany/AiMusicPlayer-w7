@echo off
chcp 65001 >nul
title AI Music Player - Git Push
cd /d "%~dp0"

echo.
echo ========================================
echo   AI Music Player - GitHub Push
echo ========================================
echo.

for /f "delims=" %%i in ('node scripts/get-commit-msg.js') do set MSG=%%i
echo Commit mesaji: %MSG%
echo.
echo [1/3] Değişiklikler ekleniyor...
git add .
if errorlevel 1 (
    echo HATA: git add basarisiz.
    pause
    exit /b 1
)

echo.
echo [2/3] Commit yapılıyor: %MSG%
git commit -m "%MSG%"
if errorlevel 1 (
    echo.
    echo UYARI: Commit atlandi (değişiklik yok veya hata).
    echo Yine de push denenecek...
)

echo.
echo [3/3] GitHub'a push ediliyor...
git push origin main
if errorlevel 1 (
    echo.
    echo HATA: Push basarisiz.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Tamamlandi.
echo ========================================
echo.
pause
