/**
 * Arayüz yardımcıları (renderer/VP mantığına dokunmaz).
 * Not: Bu dosya package.json > build.files listesinde olmalı, aksi halde
 * kurulu uygulamada 404 döner.
 *
 * 1) Oynat/duraklat ikonu: renderer düğmenin metnini "▶"/"⏸" olarak değiştiriyor.
 *    Bu semboller Windows 7 yazı tiplerinde eksik olabildiği için ikon CSS ile
 *    çiziliyor; burada yalnızca duruma göre `is-paused` sınıfı işaretleniyor.
 * 2) Esc ile Ayarlar / İletişim modallarını kapatma.
 */
(function () {
  'use strict';

  // ——— 1) Oynat/duraklat ikon durumu ———
  var playBtn = document.getElementById('btn-play');
  var playSymbol = playBtn && playBtn.querySelector('.ctrl-play-symbol');

  if (playBtn && playSymbol) {
    var syncPlayIcon = function () {
      // "▶" = duraklatılmış (tıklayınca devam eder), "⏸" = çalıyor
      var paused = (playSymbol.textContent || '').indexOf('▶') !== -1;
      playBtn.classList.toggle('is-paused', paused);
    };
    syncPlayIcon();
    if (typeof MutationObserver === 'function') {
      // Yalnızca sembol metni değiştiğinde tetiklenir; sürekli çalışan bir iş yok.
      new MutationObserver(syncPlayIcon).observe(playSymbol, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  // ——— 2) Esc ile modal kapatma ———
  var overlayIds = ['settings-overlay', 'contact-overlay'];
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    for (var i = 0; i < overlayIds.length; i++) {
      var el = document.getElementById(overlayIds[i]);
      if (el && el.getAttribute('aria-hidden') === 'false') {
        el.setAttribute('aria-hidden', 'true');
      }
    }
  });
})();
