const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  navigateToApp: () => ipcRenderer.invoke('navigate-to-app'),
  navigateToLogin: (fromLogout) => ipcRenderer.invoke('navigate-to-login', fromLogout),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateAvailable: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('update-available', (_, data) => callback(data));
    }
  },
});
