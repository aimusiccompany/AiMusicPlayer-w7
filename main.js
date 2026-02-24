const { app, BrowserWindow, ipcMain, globalShortcut, shell, dialog } = require('electron');
const path = require('path');
const { serve } = require('./server.js');
const { autoUpdater } = require('electron-updater');

// Windows 7 / düşük RAM (2–4 GB): Electron 22 ile uyumludur; tek pencereli ve yerel sunucu ile kaynak kullanımı sınırlı tutulur.
let mainWindow = null;
let localServer = null;
let localPort = 2929;
const pkg = require('./package.json');
const APP_PATH = __dirname;

// Tek örnek: Uygulama zaten açıksa veya arka planda çalışıyorsa ikinci açılış iptal edilir, mevcut pencere öne getirilir (EADDRINUSE hatası önlenir).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function getAppUrl(page) {
  return 'http://127.0.0.1:' + localPort + '/' + (page || 'index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'AI Music Player',
    backgroundColor: '#121212',
    show: false,
  });

  mainWindow.setMenu(null);

  mainWindow.loadURL(getAppUrl('login.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerDevToolsShortcut() {
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// Bilgisayar açılışıyla birlikte uygulamanın otomatik başlaması (Windows oturum açıldığında).
function setOpenAtLogin() {
  try {
    app.setLoginItemSettings({ openAtLogin: true });
  } catch (e) {
    console.warn('setLoginItemSettings:', e);
  }
}

// Otomatik güncelleme: sadece paketlenmiş (yayınlanmış) sürümde çalışır; güncelleme sunucusundan yeni sürüm varsa indirir ve kullanıcı onayıyla kurar.
// Güncelleme adresi package.json → build.publish[].url (generic sunucu). Yayın için: npm run dist sonrası dist/ içindeki .exe ve latest.yml dosyasını bu URL’e yükleyin.
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: info.version });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    const opts = {
      type: 'info',
      title: 'Güncelleme hazır',
      message: 'Yeni sürüm indirildi (v' + (info && info.version ? info.version : '') + '). Uygulamayı şimdi yeniden başlatarak güncellemeyi uygulayabilirsiniz.',
      buttons: ['Yeniden başlat', 'Daha sonra'],
    };
    dialog.showMessageBox(mainWindow || null, opts).then((res) => {
      if (res.response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on('error', (err) => {
    console.warn('Güncelleme hatası:', err.message || err);
  });

  // Uygulama açıldıktan kısa bir süre sonra güncelleme kontrolü (sunucu hazır olsun diye).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

ipcMain.handle('get-app-version', () => {
  return Promise.resolve(pkg.version || '1.0.0');
});

ipcMain.handle('navigate-to-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(getAppUrl('index.html'));
  }
});

ipcMain.handle('navigate-to-login', (_, fromLogout) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(getAppUrl(fromLogout ? 'login.html?logout=1' : 'login.html'));
  }
});

ipcMain.handle('open-external', (_, url) => {
  if (url && typeof url === 'string') {
    shell.openExternal(url).catch(() => {});
  }
});

app.whenReady().then(() => {
  return serve(APP_PATH, localPort).then((server) => {
    localServer = server;
    createWindow();
    registerDevToolsShortcut();
    setOpenAtLogin();
    setupAutoUpdater();
  });
}).catch((err) => {
  console.error('Server start failed:', err);
  localPort = 2928;
  return serve(APP_PATH, localPort).then((server) => {
    localServer = server;
    createWindow();
    registerDevToolsShortcut();
    setOpenAtLogin();
    setupAutoUpdater();
  });
}).catch((err) => {
  console.error('Server retry failed:', err);
  createWindow();
  registerDevToolsShortcut();
  setOpenAtLogin();
  setupAutoUpdater();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
