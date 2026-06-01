@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title AI Music Player - GitHub Release
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
echo OK: git>> "%LOG%"

where node >nul 2>&1
if errorlevel 1 (
  echo HATA: node bulunamadi.
  set "FAILED_STEP=node"
  goto :fail
)
echo OK: node>> "%LOG%"

where npm >nul 2>&1
if errorlevel 1 (
  echo HATA: npm bulunamadi.
  set "FAILED_STEP=npm"
  goto :fail
)
echo OK: npm>> "%LOG%"

set "GH="
echo Checking gh...>> "%LOG%"
for /f "usebackq delims=" %%p in (`where gh 2^>nul`) do (
  if not defined GH set "GH=%%p"
)
if not defined GH if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
if not defined GH if exist "%LocalAppData%\Programs\GitHub CLI\gh.exe" set "GH=%LocalAppData%\Programs\GitHub CLI\gh.exe"
if not defined GH (
  echo HATA: GitHub CLI gh bulunamadi.
  set "FAILED_STEP=gh"
  goto :fail
)
echo GH: %GH%>> "%LOG%"
echo OK: gh>> "%LOG%"

echo Checking gh auth...>> "%LOG%"
"%GH%" auth status >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: gh yetkilendirme yok. Once: gh auth login
  set "FAILED_STEP=gh-auth"
  goto :fail
)
echo OK: gh-auth>> "%LOG%"

for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set VERSION=%%i
if "%VERSION%"=="" (
  echo HATA: package.json version okunamadi.
  set "FAILED_STEP=read-version"
  goto :fail
)
echo Version: %VERSION%>> "%LOG%"

set TAG=v%VERSION%
echo Surum: %VERSION%
echo Tag: %TAG%

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo HATA: Bu klasor bir git reposu degil.
  set "FAILED_STEP=git-repo"
  goto :fail
)

git fetch --tags origin >nul 2>&1

git rev-parse "%TAG%" >nul 2>&1
if not errorlevel 1 (
  echo HATA: Tag zaten var: %TAG%
  set "FAILED_STEP=tag-exists"
  goto :fail
)

"%GH%" release view "%TAG%" >nul 2>&1
if not errorlevel 1 (
  echo HATA: GitHub Release zaten var: %TAG%
  set "FAILED_STEP=release-exists"
  goto :fail
)

set DIRTY=
for /f "usebackq delims=" %%i in (`git status --porcelain`) do (
  set DIRTY=1
)

if "%DIRTY%"=="1" (
  echo Degisiklikler commit ediliyor...
  git add .
  if errorlevel 1 (
    echo HATA: git add basarisiz.
    set "FAILED_STEP=git-add-1"
    goto :fail
  )
  git commit -m "chore: release %TAG%" >nul 2>&1
)

echo Bagimliliklar kuruluyor...
call npm ci
if errorlevel 1 (
  echo HATA: npm ci basarisiz.
  set "FAILED_STEP=npm-ci"
  goto :fail
)

echo Bundle uretiliyor...
call npm run build
if errorlevel 1 (
  echo HATA: npm run build basarisiz.
  set "FAILED_STEP=npm-build"
  goto :fail
)

set "UPLOAD_DIR=%cd%\dist\release-upload"
if exist "%UPLOAD_DIR%" rmdir /s /q "%UPLOAD_DIR%"
mkdir "%UPLOAD_DIR%" >nul 2>&1

echo Dist aliniyor (x64)...
call npm run dist:64
if errorlevel 1 (
  echo HATA: npm run dist:64 basarisiz.
  set "FAILED_STEP=npm-dist-x64"
  goto :fail
)

set "SRC_X64_EXE="
for %%f in ("dist\*Setup*.exe") do set "SRC_X64_EXE=%%~ff"
if not defined SRC_X64_EXE (
  echo HATA: x64 Setup exe bulunamadi.
  set "FAILED_STEP=missing-setup-exe-x64"
  goto :fail
)

set "X64_EXE_NAME=AI.Music.Player.Setup.%VERSION%.x64.exe"
copy /y "%SRC_X64_EXE%" "%UPLOAD_DIR%\%X64_EXE_NAME%" >nul 2>&1
if exist "%SRC_X64_EXE%.blockmap" copy /y "%SRC_X64_EXE%.blockmap" "%UPLOAD_DIR%\%X64_EXE_NAME%.blockmap" >nul 2>&1
copy /y "dist\latest.yml" "%UPLOAD_DIR%\latest-x64.yml" >nul 2>&1

del /q "dist\*Setup*.exe" >nul 2>&1
del /q "dist\*Setup*.exe.blockmap" >nul 2>&1
del /q "dist\latest.yml" >nul 2>&1

echo Dist aliniyor (ia32)...
call npm run dist:32
if errorlevel 1 (
  echo HATA: npm run dist:32 basarisiz.
  set "FAILED_STEP=npm-dist-ia32"
  goto :fail
)

set "SRC_IA32_EXE="
for %%f in ("dist\*Setup*.exe") do set "SRC_IA32_EXE=%%~ff"
if not defined SRC_IA32_EXE (
  echo HATA: ia32 Setup exe bulunamadi.
  set "FAILED_STEP=missing-setup-exe-ia32"
  goto :fail
)

set "IA32_EXE_NAME=AI.Music.Player.Setup.%VERSION%.ia32.exe"
copy /y "%SRC_IA32_EXE%" "%UPLOAD_DIR%\%IA32_EXE_NAME%" >nul 2>&1
if exist "%SRC_IA32_EXE%.blockmap" copy /y "%SRC_IA32_EXE%.blockmap" "%UPLOAD_DIR%\%IA32_EXE_NAME%.blockmap" >nul 2>&1
copy /y "dist\latest.yml" "%UPLOAD_DIR%\latest-ia32.yml" >nul 2>&1

echo Combined latest.yml olusturuluyor...
node "scripts/make-combined-latest-yml.js" "%UPLOAD_DIR%\latest-x64.yml" "%UPLOAD_DIR%\%X64_EXE_NAME%" "%UPLOAD_DIR%\latest-ia32.yml" "%UPLOAD_DIR%\%IA32_EXE_NAME%" "%UPLOAD_DIR%\latest.yml"
if errorlevel 1 (
  echo HATA: combined latest.yml olusturma basarisiz.
  set "FAILED_STEP=latest-combine"
  goto :fail
)

del /q "%UPLOAD_DIR%\latest-x64.yml" >nul 2>&1
del /q "%UPLOAD_DIR%\latest-ia32.yml" >nul 2>&1

dir /b "%UPLOAD_DIR%\*.exe" >nul 2>&1
if errorlevel 1 (
  echo HATA: dist klasorunde Setup exe bulunamadi.
  set "FAILED_STEP=missing-setup-exe"
  goto :fail
)

if not exist "%UPLOAD_DIR%\latest.yml" (
  echo HATA: dist\latest.yml bulunamadi.
  set "FAILED_STEP=missing-latest-yml"
  goto :fail
)

set DIRTY2=
for /f "usebackq delims=" %%i in (`git status --porcelain`) do (
  set DIRTY2=1
)

if "%DIRTY2%"=="1" (
  echo Build ciktisi degisiklikleri commit ediliyor...
  git add -u
  if errorlevel 1 (
    echo HATA: git add basarisiz.
    set "FAILED_STEP=git-add-2"
    goto :fail
  )
  git commit -m "chore: build %TAG%" >nul 2>&1
)

echo Push ediliyor (main)...
git push origin main
if errorlevel 1 (
  echo HATA: git push basarisiz.
  set "FAILED_STEP=git-push"
  goto :fail
)

echo Tag olusturuluyor...
git tag "%TAG%"
if errorlevel 1 (
  echo HATA: git tag basarisiz.
  set "FAILED_STEP=git-tag"
  goto :fail
)

echo Tag push ediliyor...
git push origin "%TAG%"
if errorlevel 1 (
  echo HATA: tag push basarisiz.
  set "FAILED_STEP=git-push-tag"
  goto :fail
)

set "ASSETS="
for %%f in ("%UPLOAD_DIR%\*.exe") do set ASSETS=!ASSETS! "%%~ff"
for %%f in ("%UPLOAD_DIR%\*.yml") do set ASSETS=!ASSETS! "%%~ff"
for %%f in ("%UPLOAD_DIR%\*.blockmap") do set ASSETS=!ASSETS! "%%~ff"

echo GitHub Release olusturuluyor...
"%GH%" release create "%TAG%" !ASSETS! --title "%TAG%" --notes "Release %TAG% - AI Music Player"
if errorlevel 1 (
  echo HATA: gh release create basarisiz.
  set "FAILED_STEP=gh-release-create"
  goto :fail
)

echo Tamamlandi: %TAG%
echo Success: %TAG%>> "%LOG%"
echo.
pause
exit /b 0

:fail
echo.
echo ========================================
echo   Islem basarisiz: %FAILED_STEP%
echo ========================================
echo FAILED_STEP: %FAILED_STEP%>> "%LOG%"
echo FailedAt: %date% %time%>> "%LOG%"
echo.
pause
exit /b 1
