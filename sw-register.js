(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/file-cache-manager-sw.js', { scope: '/' })
    .then(function (reg) { console.log('[SW] Kayitli:', reg.scope); })
    .catch(function (err) { console.error('[SW] Kayit hatasi:', err); });
})();
