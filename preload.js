const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  navigateToApp: () => ipcRenderer.invoke('navigate-to-app'),
  navigateToLogin: (fromLogout) => ipcRenderer.invoke('navigate-to-login', fromLogout),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Güncelleme indirilince modal tetiklemek için
    onUpdateReady: (callback) => ipcRenderer.on('show-update-modal', (event, data) => callback(data)),
    
    // "Hemen Yükle" butonuna basıldığında main'e sinyal göndermek için
    installUpdateNow: () => ipcRenderer.send('install-update-now'),
  
  // Eski tekil event dinleyicin (geriye dönük uyumluluk için aynen koruduk)
  onUpdateAvailable: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('update-available', (_, data) => callback(data));
    }
  },

  // YENİ ENTEGRASYON: Ana süreçten gelen tüm detaylı güncelleme (yüzde, hız, durum) verilerini arayüze taşır
  onUpdaterUpdate: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('auto-updater-channel', (_, data) => callback(data));
    }
  }
});