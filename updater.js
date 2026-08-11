/**
 * Güncelleme modalı: main.js indirmeyi bitirince 'show-update-modal' gönderir.
 * Not: Bu dosya package.json > build.files listesinde olmalı, aksi halde
 * kurulu uygulamada 404 döner ve modal hiç açılmaz.
 */
(function () {
  'use strict';

  if (!window.electronAPI || typeof window.electronAPI.onUpdateReady !== 'function') return;

  var modal = document.getElementById('updateModal');
  var versionSpan = document.getElementById('updateVersionText');
  var installBtn = document.getElementById('btn-install-now');
  var closeBtn = document.getElementById('btn-close-modal');
  if (!modal) return;

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
  }

  // Dinleyiciler bir kez bağlanır; her güncelleme olayında düğüm klonlamaya gerek yok.
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      installBtn.disabled = true;
      installBtn.textContent = 'Yükleniyor…';
      window.electronAPI.installUpdateNow();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal();
  });

  window.electronAPI.onUpdateReady(function (data) {
    if (versionSpan) versionSpan.textContent = (data && data.version) ? data.version : '';
    modal.setAttribute('aria-hidden', 'false');
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.textContent = 'Hemen Yükle 🚀';
    }
  });
})();
