const { app, BrowserWindow, ipcMain, globalShortcut, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { serve } = require('./server.js');

let mainWindow = null;
let localServer = null;
const args = process.argv.slice(1);
const zoneArg = args.find((arg) => arg.startsWith('--zone='));
const zoneNameRaw = zoneArg ? zoneArg.split('=')[1] : 'default';
const portArg = args.find((arg) => arg.startsWith('--port='));
const portRaw = portArg ? portArg.split('=')[1] : '';
const lowRamMode = args.includes('--low-ram') || args.includes('--disable-hwaccel') || args.includes('--disable-gpu');

if (lowRamMode) { app.disableHardwareAcceleration(); }

function sanitizeZoneName(value) {
  const v = String(value || '').trim().toLowerCase();
  const cleaned = v.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'default';
}

function getZoneHash(value) {
  const s = String(value || '');
  let hash = 5381;
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) + hash) ^ s.charCodeAt(i); }
  return Math.abs(hash) >>> 0;
}

function isValidPort(n) { return Number.isInteger(n) && n >= 1024 && n <= 65535; }

const zoneName = sanitizeZoneName(zoneNameRaw);
app.setPath('userData', path.join(app.getPath('appData'), `MuzikApp-${zoneName}`));
const parsedPort = parseInt(portRaw, 10);
let localPort = isValidPort(parsedPort) ? parsedPort : (2929 + (getZoneHash(zoneName) % 100) * 10);
const pkg = require('./package.json');
const APP_PATH = __dirname;

function setupAutoUpdater() {
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) { return; }

  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.allowUpdatesInDevelopment = true;
  autoUpdater.channel = 'latest';

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'aimusiccompany',
    repo: 'AiMusicPlayer-w7'
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => console.log('[AutoUpdater]: Güncelleme kontrol ediliyor...'));
  autoUpdater.on('update-available', (info) => console.log('[AutoUpdater]: Yeni sürüm bulundu: ' + info.version));
  autoUpdater.on('error', (err) => console.log('[AutoUpdater ERROR]: ' + err.message));

  // GÜNCELLEME MODALI İÇİN EVENT
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater]: İndirme tamamlandı, arayüze gönderiliyor...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-update-modal', { version: info.version });
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => console.error(e));
  }, 5000);
}

// IPC HANDLER TANIMLARI
ipcMain.handle('get-app-version', () => pkg.version || '1.1.27');

ipcMain.handle('navigate-to-app', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL('http://127.0.0.1:' + localPort + '/index.html');
    }
});

ipcMain.on('install-update-now', () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.quitAndInstall(false, true);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    title: 'AI Music Player - ' + zoneName, backgroundColor: '#121212'
  });
  mainWindow.loadURL('http://127.0.0.1:' + localPort + '/login.html');
}

app.whenReady().then(() => {
  serve(APP_PATH, localPort).then((server) => {
    localServer = server;
    createWindow();
    setupAutoUpdater();
  });
});

app.on('window-all-closed', () => { if (localServer) localServer.close(); if (process.platform !== 'darwin') app.quit(); });