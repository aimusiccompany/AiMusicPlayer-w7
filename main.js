const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, powerSaveBlocker, session } = require('electron');
const path = require('path');
const { serve } = require('./server.js');

// ——— Şarkılar R2'den (cdn.aimusic.com.tr), veritabanı adresi değişmeden ———
// Yeni oynatıcı (1.0.44) ile aynı: veritabanındaki şarkı adresleri Supabase'de kalır (eski
// cihazlar oradan indirmeye devam eder); bu sürüm ağ katmanında Supabase şarkı isteklerini
// R2'ye yönlendirir. Yönlendirme Chromium ağ servisinde yapıldığı için service worker'ın
// önbelleği eski adresle anahtarlanmış kalır: yeniden indirme yok, kütüphaneye dokunulmaz.
// R2'de bulunmayan (404/403) bir dosya bir kez görülürse o dosya için yönlendirme kapatılır;
// R2'ye ulaşılamıyorsa 10 dk boyunca Supabase kullanılır.
const SUPABASE_SONGS_PREFIX = 'https://api.aimusic.com.tr/storage/v1/object/public/songs/';
const R2_SONGS_PREFIX = 'https://cdn.aimusic.com.tr/';
const SONG_OBJECT_PATTERN = /^[a-f0-9]{40}\.(mp3|m4a|wav|ogg)$/i;
const R2_COOLDOWN_MS = 10 * 60 * 1000;
const r2MissingObjects = new Set();
let r2UnavailableUntil = 0;

function markR2Unavailable(reason) {
  const wasAvailable = r2UnavailableUntil <= Date.now();
  r2UnavailableUntil = Date.now() + R2_COOLDOWN_MS;
  if (wasAvailable) console.log('[Media]: R2\'ye ulaşılamıyor (' + reason + '); 10 dk Supabase\'den indirilecek');
}

function installMediaSourceRedirect() {
  try {
    const ses = session.defaultSession;
    ses.webRequest.onBeforeRequest({ urls: [SUPABASE_SONGS_PREFIX + '*'] }, (details, callback) => {
      const objectName = details.url.slice(SUPABASE_SONGS_PREFIX.length).split('?')[0];
      if (!SONG_OBJECT_PATTERN.test(objectName) || r2MissingObjects.has(objectName) || r2UnavailableUntil > Date.now()) {
        callback({});
        return;
      }
      callback({ redirectURL: R2_SONGS_PREFIX + objectName });
    });

    ses.webRequest.onHeadersReceived({ urls: [R2_SONGS_PREFIX + '*'] }, (details, callback) => {
      const objectName = details.url.slice(R2_SONGS_PREFIX.length).split('?')[0];
      if (details.statusCode === 404 || details.statusCode === 403) {
        if (SONG_OBJECT_PATTERN.test(objectName) && !r2MissingObjects.has(objectName)) {
          r2MissingObjects.add(objectName);
          console.log('[Media]: R2\'de bulunamadı (' + details.statusCode + '), Supabase\'e dönülüyor: ' + objectName);
        }
      } else if (details.statusCode >= 500) {
        markR2Unavailable('HTTP ' + details.statusCode);
      }
      callback({});
    });

    ses.webRequest.onErrorOccurred({ urls: [R2_SONGS_PREFIX + '*'] }, (details) => {
      if (details.error && details.error !== 'net::ERR_ABORTED') markR2Unavailable(details.error);
    });

    console.log('[Media]: Şarkı istekleri R2 (cdn.aimusic.com.tr) üzerinden sunulacak');
  } catch (e) {
    console.log('[Media ERROR]: yönlendirme kurulamadı: ' + (e && e.message ? e.message : String(e)));
  }
}

let mainWindow = null;
let localServer = null;
let updateCheckTimer = null;
let tray = null;
// Pencere çarpıya basılınca kapanmaz, tepsiye iner. Gerçek çıkışta bu bayrak açılır.
let isQuitting = false;
let trayBalloonShown = false;
const args = process.argv.slice(1);
const zoneArg = args.find((arg) => arg.startsWith('--zone='));
const zoneNameRaw = zoneArg ? zoneArg.split('=')[1] : 'default';
const portArg = args.find((arg) => arg.startsWith('--port='));
const portRaw = portArg ? portArg.split('=')[1] : '';
const lowRamMode = args.includes('--low-ram') || args.includes('--disable-hwaccel') || args.includes('--disable-gpu');
// Paketlenmemiş çalıştırmada güncelleme kontrolü yapılmaz (her `npm start`'ta 130 MB kurulum indirilmesin).
// Geliştirirken denemek için: electron . --test-update
const forceUpdateCheck = args.includes('--test-update');

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
// userData zona göre ayrışır; tekil örnek kilidi de bu dizine bağlıdır, yani her zona ayrı örnek çalışabilir.
app.setPath('userData', path.join(app.getPath('appData'), `MuzikApp-${zoneName}`));
const parsedPort = parseInt(portRaw, 10);
const basePort = isValidPort(parsedPort) ? parsedPort : (2929 + (getZoneHash(zoneName) % 100) * 10);
let localPort = basePort;
const pkg = require('./package.json');
const APP_PATH = __dirname;

// Aynı zonda ikinci bir örnek açılırsa: yerel sunucu portu dolu olur ve uygulama
// penceresiz bir zombi süreç olarak kalırdı. Kilit ile mevcut pencereyi öne getiriyoruz.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Tepsideyken kısayola tekrar tıklanırsa pencere geri gelsin.
  app.on('second-instance', showWindow);
  bootstrap();
}

// Port doluysa (başka bir uygulama kaptıysa) sıradaki portları dene.
async function startLocalServer() {
  const attempts = 20;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const port = basePort + i;
    if (!isValidPort(port)) break;
    try {
      const server = await serve(APP_PATH, port);
      localPort = port;
      if (i > 0) console.log('[Server]: ' + basePort + ' dolu, ' + port + ' kullanılıyor.');
      return server;
    } catch (err) {
      lastError = err;
      if (err && err.code !== 'EADDRINUSE') break;
    }
  }
  throw lastError || new Error('Uygun port bulunamadı.');
}

// ——— Açılışta otomatik başlatma ———
// Kapatma seçeneği yok: mağaza cihazı her açıldığında yayın kendiliğinden başlamalı.
// Her açılışta yeniden yazılır; kayıt defteri girdisi silinse bile geri gelir.

// Kurulum başka bir zona/porta göre yapıldıysa otomatik başlatma da aynı argümanlarla olmalı.
function launchArgs() {
  const out = [];
  if (zoneName !== 'default') out.push('--zone=' + zoneName);
  if (isValidPort(parsedPort)) out.push('--port=' + parsedPort);
  if (lowRamMode) out.push('--low-ram');
  return out;
}

function setupAutoLaunch() {
  if (!app.isPackaged) return; // geliştirmede electron.exe'yi başlangıca eklemeyelim
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: launchArgs()
    });
  } catch (e) {
    console.log('[AutoLaunch ERROR]: ' + (e && e.message ? e.message : String(e)));
  }
}

// ——— Güç yönetimi ———
// Windows uygulamayı askıya alırsa yayın durur. Yalnızca uygulama askıya almasını
// engelliyoruz; ekranın uyumasına karışmıyoruz (mağaza ekranı kapanabilir, ses sürer).
let powerSaveBlockerId = null;
function setupPowerSaveBlocker() {
  try {
    if (powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)) return;
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {
    console.log('[PowerSaveBlocker ERROR]: ' + (e && e.message ? e.message : String(e)));
  }
}

// ——— Sistem tepsisi ———
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'ai-music-logo.ico'));
  } catch (e) {
    console.log('[Tray ERROR]: ' + (e && e.message ? e.message : String(e)));
    return;
  }
  const menu = Menu.buildFromTemplate([
    { label: 'AI Music Player\'ı Göster', click: showWindow },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('AI Music Player - ' + zoneName);
  tray.setContextMenu(menu);
  // Sol tık pencereyi geri getirir; kapatma yalnızca sağ tık menüsünden.
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// ——— Güncellemeyi yayın durunca kendiliğinden kur ———
// Uygulama tepside 7/24 çalıştığı için autoInstallOnAppQuit neredeyse hiç
// tetiklenmiyor. Müşteri hiçbir şeye basmasa da güncelleme kurulmalı, ama
// çalan müzik kesilmemeli: o an bir parça çalmıyorsa (yayın dışı saatler)
// sessizce kurup uygulamayı yeniden açıyoruz.
let idleInstallTimer = null;

async function isBroadcastIdle() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  try {
    return await mainWindow.webContents.executeJavaScript(`(function () {
      try {
        var a = document.getElementById('app-audio');
        if (!a || !a.src) return true;            // yayın dışı: kaynak yok
        if (a.paused || a.ended) return true;
        var dur = (window._trackDurationSec != null) ? window._trackDurationSec : a.duration;
        if (!dur || isNaN(dur)) return true;
        return (dur - a.currentTime) <= 1;        // parça bitmek üzere
      } catch (e) { return false; }
    })()`, true);
  } catch (_) {
    // Sayfa hazır değilse kurma; bir sonraki turda tekrar bakılır.
    return false;
  }
}

/**
 * İndirilmiş güncellemeyi kur. Kurucu "Failed to uninstall old application files: 2"
 * verebiliyordu: eski sürümün kaldırıcısı çalışırken uygulama süreci hâlâ açık kalıyordu
 * (pencere/tepsi/yerel sunucu kapanışı uzuyor). Kurulum öncesi pencere, tepsi ve yerel sunucu
 * kapatılır; kurucu başlatıldıktan sonra süreç 5 sn içinde kendiliğinden bitmezse zorla
 * sonlandırılır ki kaldırıcı dosyaları silebilsin.
 */
let installInProgress = false;
function installDownloadedUpdate(autoUpdater, reason) {
  if (installInProgress) return;
  installInProgress = true;
  isQuitting = true;
  console.log('[AutoUpdater]: Güncelleme kuruluyor (' + reason + ').');
  if (idleInstallTimer) { clearInterval(idleInstallTimer); idleInstallTimer = null; }
  if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
  try { if (tray) { tray.destroy(); tray = null; } } catch (e) { console.log('[AutoUpdater]: tepsi kapatılamadı: ' + (e && e.message)); }
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch (e) { console.log('[AutoUpdater]: pencere kapatılamadı: ' + (e && e.message)); }
  // Sunucu kapanmazsa quitAndInstall sonrası port dolu kalabiliyor.
  if (localServer) { try { localServer.close(); } catch (_) {} localServer = null; }
  const forceExit = setTimeout(() => {
    console.log('[AutoUpdater]: kurulum için süreç zorla sonlandırılıyor');
    app.exit(0);
  }, 5000);
  setImmediate(() => {
    try {
      // isSilent = true → kurulum sihirbazı açılmaz; isForceRunAfter = true → kurulum bitince uygulama açılır.
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      console.log('[AutoUpdater ERROR]: quitAndInstall: ' + (e && e.message ? e.message : String(e)));
      clearTimeout(forceExit);
      installInProgress = false;
      isQuitting = false;
    }
  });
}

function startIdleInstallWatch(autoUpdater) {
  if (idleInstallTimer) return;
  const tick = () => {
    isBroadcastIdle().then((idle) => {
      if (!idle) return;
      clearInterval(idleInstallTimer);
      idleInstallTimer = null;
      installDownloadedUpdate(autoUpdater, 'yayın durdu');
    }).catch(function () {});
  };
  idleInstallTimer = setInterval(tick, 60 * 1000);
  tick();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged && !forceUpdateCheck) {
    console.log('[AutoUpdater]: Geliştirme modu, güncelleme kontrolü atlandı (--test-update ile zorlanabilir).');
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.log('[AutoUpdater ERROR]: electron-updater yüklenemedi: ' + e.message);
    return;
  }

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.allowUpdatesInDevelopment = true;
  }
  autoUpdater.channel = 'latest';
  // DİKKAT: `channel` setter'ı allowDowngrade'i sessizce true yapıyor
  // (electron-updater AppUpdater.js: set channel -> this.allowDowngrade = true).
  // Bu yüzden SONRASINDA açıkça kapatıyoruz. Aksi halde feed bir kez eski bir
  // sürüm gösterirse (silinen release, hatalı yayın, yanlış latest.yml) tüm
  // cihazlar kendini sessizce geri alırdı — otomatik sessiz kurulumla birlikte
  // bu kimsenin fark etmeyeceği bir sürüm düşürmesi demek.
  autoUpdater.allowDowngrade = false;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'aimusiccompany',
    repo: 'AiMusicPlayer-w7'
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater]: Güncelleme kontrol ediliyor...');
    sendToRenderer('auto-updater-channel', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater]: Yeni sürüm bulundu: ' + info.version);
    // renderer.js bu kanalı dinleyip "indiriliyor" toast'ı gösteriyor.
    sendToRenderer('update-available', { version: info.version });
    sendToRenderer('auto-updater-channel', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('auto-updater-channel', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (p) => {
    sendToRenderer('auto-updater-channel', {
      status: 'downloading',
      percent: Math.round(p.percent || 0),
      bytesPerSecond: p.bytesPerSecond || 0,
      transferred: p.transferred || 0,
      total: p.total || 0
    });
  });

  autoUpdater.on('error', (err) => {
    console.log('[AutoUpdater ERROR]: ' + (err && err.message ? err.message : String(err)));
    sendToRenderer('auto-updater-channel', { status: 'error', message: err && err.message ? err.message : '' });
  });

  // GÜNCELLEME MODALI İÇİN EVENT
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater]: İndirme tamamlandı, arayüze gönderiliyor...');
    // İndirme bitti; artık periyodik kontrole gerek yok.
    if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
    sendToRenderer('show-update-modal', { version: info.version });
    sendToRenderer('auto-updater-channel', { status: 'downloaded', version: info.version });
    // Müşteri modala hiç dokunmasa bile yayın durduğunda kendiliğinden kurulsun.
    startIdleInstallWatch(autoUpdater);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.log('[AutoUpdater ERROR]: ' + (e && e.message ? e.message : String(e)));
    });
  };

  setTimeout(check, 5000);
  // Cihaz günlerce açık kalıyor; tek seferlik kontrol yeterli değil.
  updateCheckTimer = setInterval(check, 30 * 60 * 1000);
}

// IPC HANDLER TANIMLARI
ipcMain.handle('get-app-version', () => pkg.version);

ipcMain.handle('navigate-to-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL('http://127.0.0.1:' + localPort + '/index.html');
  }
});

ipcMain.handle('navigate-to-login', (_, fromLogout) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    var url = 'http://127.0.0.1:' + localPort + '/login.html';
    if (fromLogout) url += '?logout=1';
    mainWindow.loadURL(url);
  }
});

ipcMain.handle('open-external', (_, url) => {
  if (typeof url !== 'string') return;
  // Yalnızca güvenli şemalar; renderer'dan gelen değer doğrudan kabuğa verilmemeli.
  if (!/^(https?:|mailto:)/i.test(url)) return;
  shell.openExternal(url).catch(function () {});
});

ipcMain.on('install-update-now', () => {
  try {
    const { autoUpdater } = require('electron-updater');
    installDownloadedUpdate(autoUpdater, 'kullanıcı onayı');
  } catch (e) {
    console.log('[AutoUpdater ERROR]: quitAndInstall: ' + (e && e.message ? e.message : String(e)));
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 640, autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // KRİTİK: pencere tepsiye indiğinde gizli sayılır ve Chromium varsayılan
      // olarak setInterval/setTimeout'ları kısar. Yayın senkronizasyonu (VP
      // simülasyonu, syncState, parça geçişleri) tamamen zamanlayıcılara dayandığı
      // için kısma olursa akış kayar. Arka planda da tam hızda çalışmalı.
      backgroundThrottling: false
    },
    title: 'AI Music Player - ' + zoneName, backgroundColor: '#121212'
  });

  // Beyaz ekran yanıp sönmesini engelle
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });

  // Harici bağlantılar uygulama içinde değil, varsayılan tarayıcıda açılsın.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(function () {});
    return { action: 'deny' };
  });

  // Uygulama penceresi yalnızca kendi yerel sunucusunda gezinebilir.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:' + localPort + '/')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url).catch(function () {});
    }
  });

  // Çarpıya basmak uygulamayı kapatmaz: yayın kesilmesin diye tepside çalışmaya devam eder.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayBalloonShown && tray) {
      trayBalloonShown = true;
      try {
        tray.displayBalloon({
          title: 'AI Music Player çalışmaya devam ediyor',
          content: 'Yayın arka planda sürüyor. Tamamen kapatmak için tepsi simgesine sağ tıklayıp Çıkış\'ı seçin.'
        });
      } catch (_) {}
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL('http://127.0.0.1:' + localPort + '/login.html');
}

function bootstrap() {
  app.whenReady().then(() => {
    return startLocalServer().then((server) => {
      localServer = server;
      installMediaSourceRedirect();
      createWindow();
      createTray();
      setupAutoLaunch();
      setupPowerSaveBlocker();
      setupAutoUpdater();
    });
  }).catch((err) => {
    // Sessizce penceresiz kalmak yerine kullanıcıya bildir.
    const message = 'Uygulama yerel sunucusu başlatılamadı.\n\n' +
      'Port aralığı: ' + basePort + '-' + (basePort + 19) + '\n' +
      'Hata: ' + (err && err.message ? err.message : String(err)) + '\n\n' +
      'Farklı bir port denemek için uygulamayı --port=XXXX ile başlatabilirsiniz.';
    try { dialog.showErrorBox('AI Music Player', message); } catch (_) { console.error(message); }
    app.quit();
  });
}

app.on('before-quit', () => { isQuitting = true; });

// Pencere gizlendiği için normalde tetiklenmez; yine de tepsideyken uygulamayı kapatma.
app.on('window-all-closed', () => {
  if (!isQuitting) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
  if (idleInstallTimer) { clearInterval(idleInstallTimer); idleInstallTimer = null; }
  if (localServer) { try { localServer.close(); } catch (_) {} localServer = null; }
  if (tray) { try { tray.destroy(); } catch (_) {} tray = null; }
});
