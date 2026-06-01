const { app, BrowserWindow, ipcMain, globalShortcut, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { serve } = require('./server.js');

// Windows 7 / düşük RAM (2–4 GB): Electron 22 ile uyumludur; tek pencereli ve yerel sunucu ile kaynak kullanımı sınırlı tutulur.
let mainWindow = null;
let localServer = null;
const args = process.argv.slice(1);
const zoneArg = args.find((arg) => arg.startsWith('--zone='));
const zoneNameRaw = zoneArg ? zoneArg.split('=')[1] : 'default';
const portArg = args.find((arg) => arg.startsWith('--port='));
const portRaw = portArg ? portArg.split('=')[1] : '';
const devToolsEnabled = args.includes('--devtools');
const lowRamMode = args.includes('--low-ram') || args.includes('--disable-hwaccel') || args.includes('--disable-gpu');
let isQuitting = false;
let rendererCrashCount = 0;

if (lowRamMode) {
  app.disableHardwareAcceleration();
}

function sanitizeZoneName(value) {
  const v = String(value || '').trim().toLowerCase();
  const cleaned = v.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'default';
}

function isAllowedExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const u = rawUrl.trim();
  if (!u || u.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch (_) {
    return false;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return true;
  if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') return true;
  return false;
}

function isAllowedIpcSender(event) {
  const u = event && event.senderFrame && event.senderFrame.url ? String(event.senderFrame.url) : '';
  return u.startsWith('http://127.0.0.1:');
}

function getZoneHash(value) {
  const s = String(value || '');
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  return Math.abs(hash) >>> 0;
}

function isValidPort(n) {
  return Number.isInteger(n) && n >= 1024 && n <= 65535;
}

const zoneName = sanitizeZoneName(zoneNameRaw);
const newUserDataPath = path.join(app.getPath('appData'), `MuzikApp-${zoneName}`);
app.setPath('userData', newUserDataPath);

const parsedPort = parseInt(portRaw, 10);
let localPort = isValidPort(parsedPort) ? parsedPort : (2929 + (getZoneHash(zoneName) % 100) * 10);
const pkg = require('./package.json');
const APP_PATH = __dirname;
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
const LOG_MAX_SIZE = 2 * 1024 * 1024;
let isHandlingFatal = false;

function ensureDirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (_) {}
}

function rotateLogIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (!st || !st.size || st.size < LOG_MAX_SIZE) return;
    const rotated = LOG_FILE + '.1';
    try { fs.unlinkSync(rotated); } catch (_) {}
    fs.renameSync(LOG_FILE, rotated);
  } catch (_) {}
}

function formatLogValue(v) {
  if (v instanceof Error) return v.stack || v.message || String(v);
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

function appendLogLine(level, parts) {
  try {
    ensureDirSync(LOG_DIR);
    rotateLogIfNeeded();
    const ts = new Date().toISOString();
    const msg = Array.isArray(parts) ? parts.map(formatLogValue).join(' ') : formatLogValue(parts);
    fs.appendFileSync(LOG_FILE, ts + ' [' + level + '] ' + msg + '\n', 'utf8');
  } catch (_) {}
}

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = (...args) => {
  appendLogLine('error', args);
  originalConsoleError(...args);
};
console.warn = (...args) => {
  appendLogLine('warn', args);
  originalConsoleWarn(...args);
};

function closeLocalServerSafe() {
  try {
    if (localServer) localServer.close();
  } catch (_) {}
}

function handleFatalError(err, source) {
  if (isHandlingFatal) return;
  isHandlingFatal = true;
  const e = err instanceof Error ? err : new Error(formatLogValue(err));
  appendLogLine('fatal', [source, e.stack || e.message || String(e)]);
  closeLocalServerSafe();
  isQuitting = true;
  if (app.isReady()) {
    let res = 1;
    try {
      res = dialog.showMessageBoxSync(mainWindow || null, {
        type: 'error',
        title: 'Kritik hata',
        message: 'Beklenmedik bir hata oluştu. Uygulama yeniden başlatılabilir.',
        detail: e.message || '',
        buttons: ['Yeniden başlat', 'Kapat'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
    } catch (_) {}
    if (res === 0) {
      try { app.relaunch(); } catch (_) {}
    }
    try { app.exit(1); } catch (_) {}
    return;
  }
  try { app.exit(1); } catch (_) {}
}

process.on('uncaughtException', (err) => handleFatalError(err, 'uncaughtException'));
process.on('unhandledRejection', (reason) => handleFatalError(reason, 'unhandledRejection'));

appendLogLine('info', ['start', 'zone=' + zoneName, 'port=' + String(localPort), 'lowRamMode=' + String(lowRamMode)]);

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
    title: 'AI Music Player - ' + zoneName,
    backgroundColor: '#121212',
    show: false,
  });

  mainWindow.setMenu(null);

  mainWindow.loadURL(getAppUrl('login.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    if (isQuitting) return;
    rendererCrashCount++;
    if (rendererCrashCount >= 3) {
      dialog.showErrorBox('Kritik hata', 'Uygulama görüntüleme motoru beklenmedik şekilde kapandı. Uygulama kapatılıyor.');
      app.quit();
      return;
    }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 600);
  });

  mainWindow.on('unresponsive', () => {
    if (isQuitting) return;
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Uygulama yanıt vermiyor',
      message: 'Uygulama yanıt vermiyor. Yeniden yüklemek ister misiniz?',
      buttons: ['Bekle', 'Yeniden yükle'],
      defaultId: 0,
      cancelId: 0,
    }).then((res) => {
      if (res.response === 1 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }).catch(() => {});
  });

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
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('electron-updater yüklenemedi, güncelleme devre dışı:', e.message);
    return;
  }
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
  if (!isAllowedIpcSender(_)) return;
  if (!isAllowedExternalUrl(url)) return;
  shell.openExternal(String(url).trim()).catch(() => {});
});

function serveWithPorts(ports, index) {
  const port = ports[index];
  return serve(APP_PATH, port).then((server) => {
    localPort = port;
    return server;
  }).catch((err) => {
    if (index + 1 >= ports.length) throw err;
    return serveWithPorts(ports, index + 1);
  });
}

app.whenReady().then(() => {
  const portsToTry = [localPort, localPort + 1, localPort + 2].filter((p) => p <= 65535);
  return serveWithPorts(portsToTry, 0).then((server) => {
    localServer = server;
    createWindow();
    registerDevToolsShortcut();
    setOpenAtLogin();
    setupAutoUpdater();
  });
}).catch((err) => {
  console.error('Server start failed:', err);
  dialog.showErrorBox('Başlatma hatası', 'Yerel sunucu başlatılamadı. Port meşgul olabilir. Uygulama kapatılıyor.');
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
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
