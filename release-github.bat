@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title AI Music Player - Auto Version and Universal GitHub Release
cd /d "%~dp0"

set "FAILED_STEP="
set "LOG=%~dp0release-github-run.log"

echo ======================================== > "%LOG%"
echo Started: %date% %time%>> "%LOG%"
echo Workdir: %cd%>> "%LOG%"
echo ========================================>> "%LOG%"

where git >nul 2>&1
if errorlevel 1 (
  echo HATA: git bulunamadi.
  set "FAILED_STEP=git"
  goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
  echo HATA: node bulunamadi.
  set "FAILED_STEP=node"
  goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo HATA: npm bulunamadi.
  set "FAILED_STEP=npm"
  goto :fail
)

set "GH="
if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
if exist "%LocalAppData%\Programs\GitHub CLI\gh.exe" set "GH=%LocalAppData%\Programs\GitHub CLI\gh.exe"
if not defined GH (
  for /f "usebackq delims=" %%p in (`where gh 2^>nul`) do set "GH=%%p"
)
if not defined GH (
  echo HATA: GitHub CLI gh bulunamadi.
  set "FAILED_STEP=gh"
  goto :fail
)

"%GH%" auth status >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: gh yetkilendirme yok. Once: gh auth login
  set "FAILED_STEP=gh-auth"
  goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo HATA: Bu klasor bir git reposu degil.
  set "FAILED_STEP=git-repo"
  goto :fail
)

git fetch --tags origin >nul 2>&1

echo.
echo [1/6] Otomatik surum yukseltiliyor...
call node scripts/bump-version.js
if errorlevel 1 (
  echo HATA: Surum yukseltme scripti basarisiz oldu.
  set "FAILED_STEP=bump-version"
  goto :fail
)

set "VERSION="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "VERSION=%%i"
if "%VERSION%"=="" (
  echo HATA: package.json version okunamadi.
  set "FAILED_STEP=read-version"
  goto :fail
)

set "TAG=v%VERSION%"
echo Guncel Surum: %VERSION%
echo Guncel Tag: %TAG%

git rev-parse "%TAG%" >nul 2>&1
if not errorlevel 1 (
  echo HATA: Tag zaten yerelde mevcut: %TAG%
  set "FAILED_STEP=tag-exists-local"
  goto :fail
)

"%GH%" release view "%TAG%" >nul 2>&1
if not errorlevel 1 (
  echo HATA: GitHub uzerinde bu Release zaten yayinda: %TAG%
  set "FAILED_STEP=release-exists-github"
  goto :fail
)

echo.
echo [2/6] Temiz bagimliliklar kuruluyor (npm ci)...
call npm ci
if errorlevel 1 (
  echo HATA: npm ci basarisiz.
  set "FAILED_STEP=npm-ci"
  goto :fail
)

echo.
echo [3/6] Frontend bundle uretiliyor...
call npm run build
if errorlevel 1 (
  echo HATA: npm run build basarisiz.
  set "FAILED_STEP=npm-build"
  goto :fail
)

set "UPLOAD_DIR=%cd%\dist\release-upload"
if exist "%UPLOAD_DIR%" rmdir /s /q "%UPLOAD_DIR%"
mkdir "%UPLOAD_DIR%" >nul 2>&1

echo.
echo [4/6] Tek Birlesik (Universal 32+64 Bit) Kurulum Paketi Derleniyor...
call npm run dist
if errorlevel 1 (
  echo HATA: npm run dist basarisiz.
  set "FAILED_STEP=npm-dist"
  goto :fail
)

set "SRC_EXE="
for %%f in ("dist\*Setup*.exe") do set "SRC_EXE=%%~ff"
if not defined SRC_EXE (
  echo HATA: Setup exe bulunamadi.
  set "FAILED_STEP=missing-setup-exe"
  goto :fail
)

set "EXE_NAME=AI.Music.Player.Setup.%VERSION%.exe"
copy /y "%SRC_EXE%" "%UPLOAD_DIR%\%EXE_NAME%" >nul 2>&1
if exist "%SRC_EXE%.blockmap" copy /y "%SRC_EXE%.blockmap" "%UPLOAD_DIR%\%EXE_NAME%.blockmap" >nul 2>&1
copy /y "dist\latest.yml" "%UPLOAD_DIR%\latest.yml" >nul 2>&1

echo.
echo [5/6] Versiyon degisiklikleri Git'e gonderiliyor...
set "DIRTY="
for /f "usebackq delims=" %%i in (`git status --porcelain`) do set "DIRTY=1"

if "%DIRTY%"=="1" (
  git add .
  git commit -m "chore: release !TAG!" >nul 2>&1
)

echo Main branch push ediliyor...
git push origin main
if errorlevel 1 (
  echo HATA: git push basarisiz.
  set "FAILED_STEP=git-push"
  goto :fail
)

echo Tag olusturuluyor ve push ediliyor...
git tag "%TAG%"
git push origin "%TAG%"
if errorlevel 1 (
  echo HATA: Tag push basarisiz.
  set "FAILED_STEP=git-push-tag"
  goto :fail
)

echo.
echo [6/6] GitHub Release olusturuluyor ve dosyalar yukleniyor...
set "ASSETS="
for %%f in ("%UPLOAD_DIR%\*.exe") do set ASSETS=!ASSETS! "%%~ff"
for %%f in ("%UPLOAD_DIR%\*.yml") do set ASSETS=!ASSETS! "%%~ff"
for %%f in ("%UPLOAD_DIR%\*.blockmap") do set ASSETS=!ASSETS! "%%~ff"

"%GH%" release create "%TAG%" !ASSETS! --title "%TAG%" --notes "Release %TAG% - AI Music Player (Universal Installer)"
if errorlevel 1 (
  echo HATA: gh release create basarisiz.
  set "FAILED_STEP=gh-release-create"
  goto :fail
)

echo.
echo ============================================================
echo BASARILI: %TAG% yayina alindi!
echo Dosya: %UPLOAD_DIR%\%EXE_NAME%
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ========================================
echo    Islem Basarisiz Oldu: %FAILED_STEP%
echo ========================================
echo FAILED_STEP: %FAILED_STEP%>> "%LOG%"
echo FailedAt: %date% %time%>> "%LOG%"
echo.
pause
exit /b 1