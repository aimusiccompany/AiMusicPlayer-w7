# AiMusicPlayer-w7 - Ilk push (GitHub)
# Bu scripti proje klasorunde (aimusicplayer-win7) calistirin:
#   .\scripts\first-push.ps1
# veya PowerShell'de:
#   cd "C:\Yazılım Çalışmaları\aimusicplayer-win7"
#   .\scripts\first-push.ps1

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/aimusiccompany/AiMusicPlayer-w7.git"

if (-not (Test-Path ".git")) {
  Write-Host "Git init..."
  git init
  git branch -M main
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  Write-Host "Remote ekleniyor: $repoUrl"
  git remote add origin $repoUrl
} elseif ($remote -ne $repoUrl) {
  Write-Host "Mevcut origin: $remote"
  Write-Host "origin'i guncellemek icin: git remote set-url origin $repoUrl"
}

Write-Host "Dosyalar ekleniyor..."
git add .
$status = git status --short
if (-not $status) {
  Write-Host "Commit edilecek degisiklik yok (tum dosyalar zaten commit edilmis olabilir)."
  Write-Host "Push icin: git push -u origin main"
  exit 0
}

Write-Host "Commit ediliyor..."
git commit -m "Initial commit: AI Music Player (Electron, Win7)"

Write-Host "Push ediliyor (origin main)..."
git push -u origin main

Write-Host "Tamamlandi."
