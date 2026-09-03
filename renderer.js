/**
 * AI Music Player - Renderer
 * Giriş: Supabase session. Veriler: Virtual Player / API ile doldurulacak.
 */

(function () {
  'use strict';

  // Service Worker: FileCacheManager ile uyumlu (VP paketi /file-cache-manager-sw.js arar)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/file-cache-manager-sw.js', { scope: '/' }).then(function () {
      // FileCacheManager.activate() bu SW’yi bulacak; cached mod çalışır
    }).catch(function (err) { console.error('[SW] Renderer kayit hatasi:', err); });
  }
  // Çalma listesi + upcomingSchedule (sonraki parçalar) SW prefetch kuyruğuna ekle (Kurulum ile aynı mantık)
  // Düşük RAM/HDD: önceden yüklenecek URL sayısı sınırlı (max 20).
  var PREFETCH_URL_LIMIT = 20;
  window.preloadPlaylistMedia = function () {
    var s = window.playerState;
    if (!s) return;
    var urls = [];
    if (s.playlist && s.playlist.length) {
      var start = s.currentTrackIndex >= 0 ? Math.max(0, s.currentTrackIndex) : 0;
      for (var i = 0; i < s.playlist.length && urls.length < PREFETCH_URL_LIMIT; i++) {
        var idx = (start + i) % s.playlist.length;
        var item = s.playlist[idx];
        if (item && item.audio && item.audio.url) urls.push(item.audio.url);
      }
    }
    if (urls.length < PREFETCH_URL_LIMIT && s.upcomingSchedule && s.upcomingSchedule.length) {
      for (var u = 0; u < s.upcomingSchedule.length && urls.length < PREFETCH_URL_LIMIT; u++) {
        var record = s.upcomingSchedule[u];
        if (record && record.audio && record.audio.url) urls.push(record.audio.url);
      }
    }
    if (!urls.length) return;
    if (!window._prefetchSentUrls) window._prefetchSentUrls = new Set();
    urls.forEach(function (u) { window._prefetchSentUrls.add(u); });
    var controller = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage({ type: 'PREFETCH_FILES', urls: urls });
    } else {
      // SW henüz controller değilse eski usul fetch (sayfa fetch’i SW intercept eder)
      if (!window._preloadedUrls) window._preloadedUrls = new Set();
      var concurrency = 1, idx = 0, running = 0;
      function next() {
        if (idx >= urls.length || running >= concurrency) return;
        var url = urls[idx++];
        if (window._preloadedUrls.has(url)) { next(); return; }
        window._preloadedUrls.add(url);
        running++;
        fetch(url, { mode: 'cors' }).catch(function () {}).finally(function () {
          running--;
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(function () { next(); }, { timeout: 120 });
          } else {
            setTimeout(next, 80);
          }
        });
      }
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(function () { next(); }, { timeout: 250 });
      } else {
        setTimeout(next, 120);
      }
    }
  };
  var preloadPlaylistMediaTimer = null;
  function debouncedPreloadPlaylistMedia() {
    if (preloadPlaylistMediaTimer) clearTimeout(preloadPlaylistMediaTimer);
    preloadPlaylistMediaTimer = setTimeout(function () {
      preloadPlaylistMediaTimer = null;
      if (window.preloadPlaylistMedia) window.preloadPlaylistMedia();
    }, 400);
  }

  // CSP uyumu: inline event handler yok; resim hatalarında fallback JS ile
  // Not: her liste çiziminde çağrılıyor. İşaretleme olmadan sayfadaki sabit
  // görsellere (logo, kapak alanları) her seferinde bir dinleyici daha ekleniyor
  // ve saatler içinde birikiyordu.
  function setupImageFallbacks() {
    document.querySelectorAll('img[data-fallback]').forEach(function (img) {
      if (img._fallbackBound) return;
      img._fallbackBound = true;
      img.addEventListener('error', function () {
        var mode = img.getAttribute('data-fallback');
        if (mode === 'next') {
          img.style.display = 'none';
          var next = img.nextElementSibling;
          if (next) next.style.display = (next.tagName === 'SPAN' || next.classList.contains('logo-fallback')) ? 'inline' : 'flex';
        } else if (mode === 'hide') {
          img.style.display = 'none';
        } else if (mode === 'text') {
          var text = img.getAttribute('data-fallback-text') || '';
          var span = document.createElement('span');
          span.textContent = text;
          span.className = img.className;
          img.parentNode.replaceChild(span, img);
        }
      });
    });
  }
  setupImageFallbacks();

  (function applySavedTheme() {
    var theme = localStorage.getItem('aimusic-theme') || 'dark';
    document.body.setAttribute('data-theme', theme);
  })();

  // Güncelleme bildirimi: paketlenmiş uygulamada yeni sürüm bulunduğunda ekranda toast gösterilir
  var updateToastHideTimer = null;
  function showUpdateToast(text, autoHideMs) {
    var toast = document.getElementById('update-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.setAttribute('aria-hidden', 'false');
    toast.classList.add('update-toast--visible');
    if (updateToastHideTimer) clearTimeout(updateToastHideTimer);
    if (autoHideMs > 0) {
      updateToastHideTimer = setTimeout(function () {
        updateToastHideTimer = null;
        toast.classList.remove('update-toast--visible');
        toast.setAttribute('aria-hidden', 'true');
      }, autoHideMs);
    }
  }

  if (window.electronAPI && typeof window.electronAPI.onUpdateAvailable === 'function') {
    window.electronAPI.onUpdateAvailable(function (data) {
      var v = (data && data.version) ? data.version : '';
      showUpdateToast('Yeni sürüm mevcut (v' + v + '). İndiriliyor… Uygulama kapatıldığında güncelleme kurulacak.', 8000);
    });
  }

  // İndirme yüzdesi: main.js 'auto-updater-channel' üzerinden gönderiyor.
  if (window.electronAPI && typeof window.electronAPI.onUpdaterUpdate === 'function') {
    window.electronAPI.onUpdaterUpdate(function (data) {
      if (!data) return;
      if (data.status === 'downloading' && data.percent != null) {
        showUpdateToast('Güncelleme indiriliyor… %' + data.percent, 0);
      } else if (data.status === 'downloaded') {
        showUpdateToast('Güncelleme indirildi.', 4000);
      } else if (data.status === 'error') {
        showUpdateToast('Güncelleme alınamadı, daha sonra tekrar denenecek.', 6000);
      }
    });
  }

  var SUPABASE_URL = 'https://api.aimusic.com.tr';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1aXN1aHVlcHZxc2Nzd2NvY3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgwNDUzODUsImV4cCI6MjAzMzYyMTM4NX0.Lo0dFFPUNvsLIBxitmsi_mmTtDlVABsqgd74rGrvHq0';

  // ——— Virtual Player entegrasyonu için state (Kurulum ile aynı: playlist, upcomingSchedule, vb.) ———
  window.playerState = {
    playlist: [],
    ads: [],
    upcomingSchedule: [],
    currentTrackIndex: -1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 70,
    savedVolumeBeforeMute: 70,
    mutedByPause: false,
    location: null,
    status: 'offline'
  };

  var currentView = 'playlist';
  // Listedeki arama kutusunun sorgusu (küçük harfe çevrilmiş, boşsa filtre yok)
  var searchQuery = '';
  // Beğeniler kalıcı: aksi halde her açılışta "Beğenilen Şarkılar" boş geliyordu.
  var LIKED_STORAGE_KEY = 'aimusic-liked-songs';
  var likedSet = loadLikedSet();

  function loadLikedSet() {
    try {
      var raw = localStorage.getItem(LIKED_STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveLikedSet() {
    try { localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(Array.from(likedSet))); } catch (_) {}
  }

  // Seçilen hoparlör de kalıcı olmalı; mağaza cihazı her açılışta varsayılana dönmesin.
  var SINK_STORAGE_KEY = 'aimusic-speaker-id';

  function getSavedSinkId() {
    try { return localStorage.getItem(SINK_STORAGE_KEY) || 'default'; } catch (_) { return 'default'; }
  }

  function applySinkId(id) {
    var audio = document.getElementById('app-audio');
    if (!audio || typeof audio.setSinkId !== 'function') return;
    audio.setSinkId(id).catch(function () {
      // Cihaz artık takılı değilse varsayılana dön.
      if (id !== 'default') audio.setSinkId('default').catch(function () {});
    });
  }

  // Standart reklamlarda görsel yok; listede boş kalmasın diye logo
  var AD_LOGO_URL = 'assets/ai-music-logo.png';

  function getCenterList(s) {
    var list = [];
    var currentIndexInList = -1;
    var fullIndex = s.currentTrackIndex;
    var currentItem = fullIndex >= 0 && s.playlist[fullIndex] ? s.playlist[fullIndex] : null;
    if (currentView === 'playlist') {
      if (fullIndex >= 0 && s.playlist.length > 0) {
        var cur = Object.assign({}, s.playlist[fullIndex], { fullIndex: fullIndex });
        var before = s.playlist.slice(0, fullIndex).map(function (item, i) { return Object.assign({}, item, { fullIndex: i }); });
        var after = s.playlist.slice(fullIndex + 1).map(function (item, i) { return Object.assign({}, item, { fullIndex: fullIndex + 1 + i }); });
        list = before.concat([cur]).concat(after);
        currentIndexInList = fullIndex;
      } else {
        s.playlist.forEach(function (item, i) {
          list.push(Object.assign({}, item, { fullIndex: i }));
        });
        currentIndexInList = fullIndex;
      }
    } else if (currentView === 'ads') {
      s.playlist.forEach(function (item, i) {
        if (item.recordType !== 'song') {
          list.push(Object.assign({}, item, { fullIndex: i }));
          if (i === fullIndex) currentIndexInList = list.length - 1;
        }
      });
    } else {
      var seenIds = new Set();
      s.playlist.forEach(function (item, i) {
        if (item.recordType === 'song' && likedSet.has(String(item.id))) {
          var id = String(item.id);
          if (seenIds.has(id)) return;
          seenIds.add(id);
          list.push(Object.assign({}, item, { fullIndex: i }));
          if (currentItem && currentItem.id === item.id) currentIndexInList = list.length - 1;
        }
      });
    }
    if (searchQuery) {
      var currentRef = currentIndexInList >= 0 ? list[currentIndexInList] : null;
      list = list.filter(function (item) {
        return matchesSearch(item, searchQuery);
      });
      currentIndexInList = currentRef ? list.indexOf(currentRef) : -1;
    }
    return { list: list, currentIndexInList: currentIndexInList };
  }

  // Türkçe karakterlerde doğru küçük harf için toLocaleLowerCase('tr') kullanılır.
  function normalizeForSearch(value) {
    return String(value == null ? '' : value).toLocaleLowerCase('tr');
  }

  function matchesSearch(item, query) {
    if (!item) return false;
    var haystack = normalizeForSearch(item.title) + ' ' +
      normalizeForSearch(item.artist) + ' ' +
      normalizeForSearch(item.genre) + ' ' +
      normalizeForSearch(item.tag) + ' ' +
      normalizeForSearch(item.time);
    return haystack.indexOf(query) !== -1;
  }

  // "09:35" → 575 (gün içi dakika). Ayrıştırılamazsa null.
  function timeToMinutes(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value == null ? '' : value).trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function updateContentHeader(view, s, filteredCount) {
    var headingEl = document.getElementById('content-heading');
    var countEl = document.getElementById('content-count');
    if (headingEl) {
      if (view === 'playlist') headingEl.textContent = 'Yayın Akışı';
      else if (view === 'ads') headingEl.textContent = 'Reklamlarım';
      else headingEl.textContent = 'Beğenilen Şarkılar';
    }
    if (!countEl) return;
    if (searchQuery) {
      countEl.textContent = String(filteredCount == null ? 0 : filteredCount) + ' sonuç';
      countEl.style.display = '';
      return;
    }
    if (view === 'playlist') {
      countEl.textContent = String(s.playlist.length) + ' parça';
      countEl.style.display = '';
    } else if (view === 'ads') {
      countEl.style.display = 'none';
    } else {
      var favIds = new Set();
      s.playlist.forEach(function (item) { if (item.recordType === 'song' && likedSet.has(String(item.id))) favIds.add(String(item.id)); });
      countEl.textContent = String(favIds.size) + ' beğeni';
      countEl.style.display = '';
    }
  }

  function setActiveNavView(view) {
    document.querySelectorAll('.nav-link[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === view);
    });
  }

  function initAuthAndRun() {
  window._playlistDataReceived = false;
  // O gün için gerçekten program yoksa "hazırlanıyor" mesajı sonsuza kadar
  // kalmasın; belli bir süre sonra normal boş duruma düş.
  if (window._playlistWaitTimer) clearTimeout(window._playlistWaitTimer);
  window._playlistWaitTimer = setTimeout(function () {
    window._playlistWaitTimer = null;
    if (!window._playlistDataReceived) {
      window._playlistDataReceived = true;
      updateUIFromState();
    }
  }, 45000);
  var uiUpdateScheduled = false;
  function scheduleUIUpdate() {
    if (uiUpdateScheduled) return;
    uiUpdateScheduled = true;
    requestAnimationFrame(function () {
      uiUpdateScheduled = false;
      updateUIFromStateImpl();
    });
  }
  function updateUIFromState() {
    scheduleUIUpdate();
  }
  // UI güncelleme: state → DOM (doğrudan çağrılar için tek seferlik güncelleme)
  // Not: Saat, tarih ve selamlama sadece sidebar saat zamanlayıcısından güncellenir (ekstra yük yok).
  function updateUIFromStateImpl() {
    try {
      var s = window.playerState;
      if (!s) return;

    // Sidebar: sadece state’e bağlı alanlar (saat/tarih/selamlama ayrı timer’da)
    const locMini = document.getElementById('sidebar-location-mini');
    if (locMini) locMini.textContent = s.location || '';
    const statusEl = document.getElementById('sidebar-status-text');
    if (statusEl) statusEl.textContent = s.status === 'online' ? 'Çevrimiçi' : 'Çevrimdışı';
    document.getElementById('sidebar-status')?.classList.toggle('online', s.status === 'online');
    var nameStr = (window.userName || s.userName || '—');
    var line1El = document.getElementById('sidebar-user-line1');
    var line2El = document.getElementById('sidebar-user-line2');
    if (line1El || line2El) {
      var parts = String(nameStr).trim().split(/\s+/);
      if (parts.length >= 2) {
        if (line1El) line1El.textContent = parts.slice(0, -1).join(' ');
        if (line2El) line2El.textContent = parts[parts.length - 1];
      } else {
        if (line1El) line1El.textContent = nameStr;
        if (line2El) line2El.textContent = '';
      }
    }
    if (!window._playlistDataReceived) {
      var loadingEl = document.getElementById('playlist-loading');
      if (loadingEl) loadingEl.setAttribute('aria-hidden', 'false');
      return;
    }
    var loadingEl = document.getElementById('playlist-loading');
    if (loadingEl) loadingEl.setAttribute('aria-hidden', 'true');
    var center = getCenterList(s);
    updateContentHeader(currentView, s, center.list.length);
    updateEmptyState(center.list.length);
    var playlistKey = currentView + '|' + searchQuery + '|' + (s.currentTrackIndex >= 0 ? s.currentTrackIndex : -1) + '|' + (s.playlist ? s.playlist.length : 0) + '|' + (s.playlist && s.playlist[0] ? s.playlist[0].id : '');
    if (playlistKey !== window._lastPlaylistKey) {
      window._lastPlaylistKey = playlistKey;
      var list = center.list;
      var idx = center.currentIndexInList;
      if (list && list.length > 80 && typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(function () { renderPlaylist(list, idx); }, { timeout: 200 });
      } else {
        renderPlaylist(list, idx);
      }
    }

    // Yayın akışı bu saatte var mı? (activeRecord = şu anki slot; pause olsa bile yayın vardır)
    var streamActive = !!(s.activeRecord && s.activeRecord.audio && s.activeRecord.audio.url);

    // Şu an çalınan + alt bar: VP'den gelen activeRecord kullan (yanlışlıkla sıradaki değil, gerçekten çalan)
    var track = null;
    if (streamActive && s.activeRecord && s.activeRecord.name) {
      var rawArt = (s.activeRecord.album && s.activeRecord.album.coverUrl) || s.activeRecord.coverUrl || null;
      var isAdType = s.activeRecord.type === 'ad' || s.activeRecord.type === 'specialAd' || s.activeRecord.type === 'stockAd';
      track = {
        title: s.activeRecord.name,
        artist: (s.activeRecord.album && s.activeRecord.album.name) || (s.activeRecord.type === 'song' ? '—' : (s.activeRecord.type === 'ad' ? 'Reklam' : (s.activeRecord.type === 'stockAd' ? 'Stok Sihirbazı' : (s.activeRecord.type === 'specialAd' ? 'Özel Gün' : '—')))),
        artworkUrl: rawArt || (isAdType ? AD_LOGO_URL : null)
      };
    }
    if (!track && streamActive && s.currentTrackIndex >= 0 && s.playlist[s.currentTrackIndex]) track = s.playlist[s.currentTrackIndex];
    // Sıradaki yayın saati (yayın dışındayken gösterilecek)
    var nextStartLabel = 'Yayın henüz başlamadı';
    if (s.playlist && s.playlist.length > 0 && s.playlist[0].time) {
      var t = String(s.playlist[0].time);
      var parts = t.split(':');
      if (parts.length >= 2) nextStartLabel = 'Sıradaki yayın ' + parts[0] + ':' + parts[1] + '\'da';
      else nextStartLabel = 'Sıradaki yayın ' + t;
    }
    const contentBadge = document.getElementById('content-badge');
    if (contentBadge) contentBadge.textContent = streamActive ? 'Şu an çalınıyor' : 'Yayın dışı';
    const titleEl = document.getElementById('now-playing-title');
    const genreEl = document.getElementById('now-playing-genre');
    const playerTitleEl = document.getElementById('player-title');
    const playerArtistEl = document.getElementById('player-artist');
    const nowArtImg = document.getElementById('now-playing-art-img');
    const nowArtPlace = document.getElementById('now-playing-art-placeholder');
    const playerArtImg = document.getElementById('player-art-img');
    const playerArtPlace = document.getElementById('player-art-placeholder');

    if (track) {
      const title = track.title || '—';
      const artist = track.artist || track.genre || '—';
      if (titleEl) titleEl.textContent = title;
      if (genreEl) genreEl.textContent = artist;
      if (playerTitleEl) playerTitleEl.textContent = title;
      if (playerArtistEl) playerArtistEl.textContent = artist;
      if (track.artworkUrl) {
        if (nowArtImg) { nowArtImg.src = track.artworkUrl; nowArtImg.style.display = 'block'; }
        if (nowArtPlace) { nowArtPlace.style.display = 'none'; nowArtPlace.classList.remove('now-playing-clock'); }
        if (playerArtImg) { playerArtImg.src = track.artworkUrl; playerArtImg.style.display = 'block'; }
        if (playerArtPlace) { playerArtPlace.style.display = 'none'; playerArtPlace.classList.remove('now-playing-clock'); }
      } else {
        if (nowArtPlace) { nowArtPlace.textContent = '—'; nowArtPlace.style.display = 'flex'; nowArtPlace.classList.remove('now-playing-clock'); }
        if (nowArtImg) nowArtImg.style.display = 'none';
        if (playerArtPlace) { playerArtPlace.textContent = '—'; playerArtPlace.style.display = 'flex'; playerArtPlace.classList.remove('now-playing-clock'); }
        if (playerArtImg) playerArtImg.style.display = 'none';
      }
    } else {
      if (titleEl) titleEl.textContent = streamActive ? '—' : 'Yayın henüz başlamadı';
      if (genreEl) genreEl.textContent = streamActive ? '—' : nextStartLabel;
      if (playerTitleEl) playerTitleEl.textContent = streamActive ? '—' : 'Yayın dışı';
      if (playerArtistEl) playerArtistEl.textContent = streamActive ? '—' : nextStartLabel;
      if (nowArtPlace) {
        nowArtPlace.textContent = streamActive ? '—' : '🕐';
        nowArtPlace.style.display = 'flex';
        nowArtPlace.classList.toggle('now-playing-clock', !streamActive);
      }
      if (nowArtImg) nowArtImg.style.display = 'none';
      if (playerArtPlace) {
        playerArtPlace.textContent = streamActive ? '—' : '🕐';
        playerArtPlace.style.display = 'flex';
        playerArtPlace.classList.toggle('now-playing-clock', !streamActive);
      }
      if (playerArtImg) playerArtImg.style.display = 'none';
    }

    // Üst bar butonu: yayın varken Çalınıyor/Duraklatıldı, yokken Yayın yok (mutedByPause = kullanıcı duraklattı)
    const btnNowPlaying = document.getElementById('btn-now-playing-state');
    const btnPlayingText = document.getElementById('btn-playing-text');
    if (btnPlayingText) btnPlayingText.textContent = streamActive ? (s.mutedByPause ? 'Duraklatıldı' : 'Çalınıyor') : 'Yayın yok';
    if (btnNowPlaying) {
      btnNowPlaying.classList.toggle('paused', !streamActive || s.mutedByPause);
      btnNowPlaying.classList.toggle('stream-off', !streamActive);
    }
    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) {
      const sym = btnPlay.querySelector('.ctrl-play-symbol');
      if (sym) sym.textContent = s.mutedByPause ? '▶' : '⏸';
    }
    var volPct = document.getElementById('volume-percent');
    if (volPct) volPct.textContent = (s.mutedByPause ? s.savedVolumeBeforeMute : s.volume) + '%';

    // İlerleme: oynatma sırasında sadece appAudio.currentTime kullan (VP state ile çakışma olmasın)
    const curEl = document.getElementById('progress-current');
    const totEl = document.getElementById('progress-total');
    const fillEl = document.getElementById('progress-fill');
    var displayCurrent = s.currentTime;
    var displayDuration = s.duration;
    if (appAudio && appAudio.src) {
      var at = appAudio.currentTime;
      if (!isNaN(at) && at >= 0) displayCurrent = at;
      displayDuration = (window._trackDurationSec != null ? window._trackDurationSec : (appAudio.duration && !isNaN(appAudio.duration) ? appAudio.duration : s.duration)) || s.duration;
    }
    if (curEl) curEl.textContent = formatTime(displayCurrent);
    if (totEl) totEl.textContent = formatTime(displayDuration);
    var progressPct = (displayDuration > 0 ? (displayCurrent / displayDuration) * 100 : 0);
    if (fillEl) fillEl.style.width = progressPct + '%';
    var heroFill = document.getElementById('np-progress-fill');
    if (heroFill) heroFill.style.width = progressPct + '%';
    var remainEl = document.getElementById('np-remaining');
    if (remainEl) {
      var remain = displayDuration > 0 ? Math.max(0, displayDuration - displayCurrent) : 0;
      remainEl.textContent = (streamActive && displayDuration > 0) ? formatTime(remain) + ' kaldı' : '';
    }

    // Hero: sıradaki kayıt (akış listesinden, yoksa VP'nin upcomingSchedule'ından)
    var nextRecord = null;
    if (s.playlist && s.currentTrackIndex >= 0 && s.playlist[s.currentTrackIndex + 1]) {
      nextRecord = s.playlist[s.currentTrackIndex + 1];
    } else if (s.upcomingSchedule && s.upcomingSchedule.length) {
      nextRecord = s.upcomingSchedule[0];
    }
    var npNext = document.getElementById('np-next');
    var npNextTitle = document.getElementById('np-next-title');
    var npNextTime = document.getElementById('np-next-time');
    if (npNext && npNextTitle) {
      var nextTitle = nextRecord ? (nextRecord.title || nextRecord.name || '') : '';
      if (nextTitle) {
        npNextTitle.textContent = nextTitle;
        if (npNextTime) npNextTime.textContent = nextRecord.time ? String(nextRecord.time).slice(0, 5) : '';
        npNext.setAttribute('aria-hidden', 'false');
      } else {
        npNext.setAttribute('aria-hidden', 'true');
      }
    }

    // Reklam sayısı
    const adsCountEl = document.getElementById('ads-count');
    if (adsCountEl) adsCountEl.textContent = s.ads.length + ' Anons';
    var volSlider = document.getElementById('volume');
    if (volSlider) volSlider.value = s.mutedByPause ? s.savedVolumeBeforeMute : s.volume;

    // Sağ panel reklam listesi (eski format) - sadece değiştiyse çiz
    var adsKey = (s.ads && s.ads.length) ? s.ads.length + '-' + (s.ads[0] && s.ads[0].num) + '-' + (s.ads[s.ads.length - 1] && s.ads[s.ads.length - 1].num) : '0';
    if (adsKey !== window._lastAdsKey) {
      window._lastAdsKey = adsKey;
      renderAds(s.ads);
    }
    } catch (e) { console.warn('[UI]', e); }
  }

  function formatTime(sec) {
    if (sec == null || isNaN(sec)) return '0:00';
    const m = Math.floor(Number(sec) / 60);
    const s = Math.floor(Number(sec) % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function formatDuration(sec) {
    if (sec == null || isNaN(sec)) return '0:00';
    const n = Number(sec);
    if (n >= 3600) {
      const h = Math.floor(n / 3600);
      const m = Math.floor((n % 3600) / 60);
      const s = Math.floor(n % 60);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function renderPlaylist(list, currentIndex) {
    const el = document.getElementById('playlist');
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = '';
      return;
    }
    // Saat ayraçları: yayın akışı bir gün boyunca sürdüğü için satırlar saat
    // bloklarına ayrılır. Beğeniler görünümü kronolojik olmadığından ayraç yok.
    var useHourGroups = currentView !== 'favorites' && !searchQuery;
    var currentHour = null;
    if (currentIndex >= 0 && list[currentIndex]) {
      var ch = /^(\d{1,2}):/.exec(String(list[currentIndex].time || ''));
      if (ch) currentHour = ('0' + ch[1]).slice(-2);
    }
    var lastHour = null;
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var track = list[i];
      const playingClass = i === currentIndex ? ' playing' :
        (currentIndex >= 0 && i < currentIndex ? ' played' : '');
      var dataFull = track.fullIndex != null ? ' data-full-index="' + track.fullIndex + '"' : '';
      const title = escapeHtml(track.title || '—');
      const artist = escapeHtml(track.artist || track.genre || '—');
      const duration = track.duration != null ? formatDuration(track.duration) : '—';
      const time = track.time || '—';
      const tag = track.tag || '—';
      var slug = (track.tagSlug || 'muzik').replace(/\s+/g, '-');
      var artSrc = track.artworkUrl || null;
      if (!artSrc && track.recordType === 'ad') artSrc = AD_LOGO_URL;
      var art = artSrc
        ? '<img src="' + escapeHtml(artSrc) + '" alt="" class="track-art-img' + (track.recordType === 'ad' ? ' track-art-img--ad-logo' : '') + '" style="display:block" data-fallback="next"><div class="track-art-placeholder track-art-placeholder--anon" style="display:none">—</div>'
        : '<div class="track-art-placeholder track-art-placeholder--anon">—</div>';
      var tagLabel = (track.tag && String(track.tag).trim()) ? escapeHtml(track.tag) : 'MÜZİK';
      var num = (track.fullIndex != null ? track.fullIndex + 1 : i + 1);
      var isSong = track.recordType === 'song';
      var likedClass = isSong && likedSet.has(String(track.id)) ? ' liked' : '';
      var actionsHtml = isSong
        ? '<div class="track-actions"><button type="button" class="btn-like' + likedClass + '" title="Beğen">♥</button><button type="button" class="btn-dislike" title="Beğenme">♡</button></div>'
        : '<div class="track-actions track-actions--no-buttons"></div>';

      if (useHourGroups) {
        var hour = /^(\d{1,2}):/.exec(String(track.time || ''));
        var hourKey = hour ? ('0' + hour[1]).slice(-2) : null;
        if (hourKey && hourKey !== lastHour) {
          lastHour = hourKey;
          var isCurrentHour = currentHour != null && hourKey === currentHour;
          parts.push('<li class="hour-sep' + (isCurrentHour ? ' hour-sep--now' : '') + '" aria-hidden="true">' +
            '<span class="hour-sep-time">' + hourKey + ':00</span>' +
            '<span class="hour-sep-line"></span>' +
            (isCurrentHour ? '<span class="hour-sep-now">ŞU AN</span>' : '') +
            '</li>');
        }
      }

      parts.push('<li class="track-item' + playingClass + '" data-index="' + i + '"' + dataFull + '>' +
        '<span class="track-num">' + num + '</span>' +
        '<div class="track-art">' + art + '</div>' +
        '<div><span class="track-title">' + title + '</span><span class="track-artist">' + artist + '</span></div>' +
        '<span class="track-time">' + escapeHtml(time) + '</span>' +
        '<span class="track-duration">' + duration + '</span>' +
        '<span class="track-tag track-tag--' + escapeHtml(slug) + '">' + tagLabel + '</span>' +
        actionsHtml +
        '</li>');
    }
    el.innerHTML = parts.join('');
    // Dinleyiciler listeye bir kez bağlanır (olay delegasyonu). Önceden her
    // yeniden çizimde satır başına üç dinleyici ekleniyordu; günlük akış birkaç
    // yüz satır olduğu için bu her güncellemede binlerce bağlama demekti.
    bindPlaylistDelegation(el);

    // Çalan parça değişmediyse kaydırma; aksi halde kullanıcı listede gezerken
    // her yeniden çizimde görünüm başa atlıyordu.
    var playingLi = currentIndex >= 0 ? el.querySelector('.track-item.playing') : null;
    var scrollKey = currentView + '|' + currentIndex;
    if (playingLi && scrollKey !== window._lastScrollKey) {
      window._lastScrollKey = scrollKey;
      scrollPlayingIntoView(playingLi);
    }
    // CSP uyumu: dinamik eklenen img'lere fallback (inline onerror güvenlik nedeniyle çalışmayabilir)
    setupImageFallbacks();
  }

  /**
   * Çalan satırı yapışkan başlığın hemen altına hizalar.
   *
   * Önceden scrollIntoView({block:'start'}) kullanılıyordu; bu, satırın üst
   * kenarını kaydırma kabının üst kenarıyla hizalar — yani tam da yapışkan
   * "SIRA / Başlık / Zaman" başlığının bulunduğu yere. Sonuç: çalan parça
   * başlığın arkasında kalıyor ve listede ilk görünen satır hep bir sonraki
   * parça oluyordu, yani liste saatin bir tık ilerisinde duruyordu.
   *
   * Ayrıca satırlarda content-visibility:auto var; ekran dışı satırların
   * yüksekliği tahmin ediliyor. Yumuşak kaydırma sırasında satırlar gerçekten
   * çizildikçe tahminler düzeliyor ve hedef kayıyordu. Bu yüzden kaydırma anlık
   * yapılır ve satırlar yerleştikten sonra bir kez daha düzeltilir.
   */
  function scrollPlayingIntoView(li) {
    var wrap = document.querySelector('.playlist-list-wrap');
    if (!wrap || !li) return;
    var toolbar = wrap.querySelector('.playlist-toolbar');
    var headerH = toolbar ? toolbar.offsetHeight : 0;
    var settle = function () {
      if (!li.isConnected) return;
      // offsetParent = .playlist-list-wrap (position: relative), yani offsetTop
      // doğrudan kaydırma içeriğine göredir.
      var target = li.offsetTop - headerH - 8;
      if (target < 0) target = 0;
      var max = wrap.scrollHeight - wrap.clientHeight;
      if (target > max) target = max;
      if (Math.abs(wrap.scrollTop - target) > 1) wrap.scrollTop = target;
    };
    settle();
    requestAnimationFrame(function () { requestAnimationFrame(settle); });
  }

  /** Liste tıklamaları: tek dinleyici, hedefe göre dallanır. */
  function bindPlaylistDelegation(el) {
    if (el._delegationBound) return;
    el._delegationBound = true;
    el.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.track-item') : null;
      if (!li) return;
      var fullIdx = li.dataset.fullIndex != null ? parseInt(li.dataset.fullIndex, 10) : -1;
      var track = (fullIdx >= 0 && window.playerState) ? window.playerState.playlist[fullIdx] : null;
      var likeBtn = e.target.closest('.btn-like');
      var dislikeBtn = e.target.closest('.btn-dislike');

      if (likeBtn) {
        e.stopPropagation();
        if (!track || track.recordType !== 'song') {
          likeBtn.classList.toggle('liked');
          return;
        }
        var id = String(track.id);
        if (likedSet.has(id)) likedSet.delete(id); else likedSet.add(id);
        saveLikedSet();
        likeBtn.classList.toggle('liked', likedSet.has(id));
        var dis = li.querySelector('.btn-dislike');
        if (dis) dis.classList.remove('disliked');
        refreshAfterLikeChange();
        return;
      }

      if (dislikeBtn) {
        e.stopPropagation();
        dislikeBtn.classList.toggle('disliked');
        var lb = li.querySelector('.btn-like');
        if (lb) lb.classList.remove('liked');
        // Kalp işaretini kaldırmak yetmiyor: parça likedSet'te kalırsa
        // "Beğenilen Şarkılar" listesinde görünmeye devam ediyor.
        if (!track || track.recordType !== 'song') return;
        if (!likedSet.delete(String(track.id))) return;
        saveLikedSet();
        refreshAfterLikeChange();
        return;
      }

      if (e.target.closest('.track-actions')) return;
      var idx = fullIdx >= 0 ? fullIdx : parseInt(li.dataset.index, 10);
      if (!isNaN(idx) && idx >= 0 && window.onPlaylistTrackSelect) window.onPlaylistTrackSelect(idx);
    });
  }

  function refreshAfterLikeChange() {
    var center = getCenterList(window.playerState);
    updateContentHeader(currentView, window.playerState, center.list.length);
    if (currentView === 'favorites') {
      renderPlaylist(center.list, center.currentIndexInList);
    }
  }

  // Anonslar cihaz saatine göre "yayınlandı / yayında / sırada" olarak işaretlenir;
  // mağaza sahibi hangi reklamının çaldığını listeye bakarak görebilsin.
  function renderAds(ads) {
    const el = document.getElementById('ads-list');
    if (!el) return;
    if (!ads || ads.length === 0) {
      el.innerHTML = '';
      window._lastAdsStatusKey = null;
      return;
    }
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var upNextMarked = false;
    var doneCount = 0;
    el.innerHTML = ads.map(function (ad, i) {
      var num = ad.num != null ? ad.num : i + 1;
      var title = escapeHtml(ad.title || '—');
      var duration = ad.duration != null ? formatDuration(ad.duration) : '—';
      var startTime = ad.time || '—';
      var tag = escapeHtml(ad.tag || 'Anons');
      var slug = (ad.tagSlug || 'reklam').replace(/\s+/g, '-');

      var startMin = timeToMinutes(ad.time);
      var state = 'next';
      if (startMin != null) {
        var endMin = startMin + Math.max(1, Math.ceil((Number(ad.duration) || 0) / 60));
        if (nowMin >= startMin && nowMin < endMin) {
          state = 'live';
        } else if (nowMin >= endMin) {
          state = 'past';
          doneCount++;
        }
      }
      // Rozet gürültü yapmasın: yalnızca çalan ve sıradaki anons etiketlenir,
      // yayınlananlar zaten sönük görünür.
      var upNext = '';
      var stateLabel = '';
      if (state === 'live') {
        stateLabel = 'Yayında';
      } else if (state === 'next' && !upNextMarked) {
        upNextMarked = true;
        upNext = ' ad-item--upnext';
        stateLabel = 'Sıradaki';
      }

      return '<li class="ad-item ad-item--' + state + upNext + '">' +
        '<div class="ad-rail" aria-hidden="true"></div>' +
        '<div class="ad-body">' +
        '<div class="ad-top">' +
        '<span class="ad-num">' + num + '</span> <span class="ad-title">' + title + '</span>' +
        (stateLabel ? '<span class="ad-state-pill">' + stateLabel + '</span>' : '') +
        '</div>' +
        '<div class="ad-tag-row">' +
        '<span class="ad-tag-pill ad-tag-pill--' + escapeHtml(slug) + '">' + tag + '</span>' +
        '<span class="ad-meta-pill">' + escapeHtml(String(startTime)) + ' · ' + escapeHtml(String(duration)) + '</span>' +
        '</div>' +
        '</div>' +
        '</li>';
    }).join('');

    var progressEl = document.getElementById('ads-progress-fill');
    if (progressEl) progressEl.style.width = (ads.length ? (doneCount / ads.length) * 100 : 0) + '%';
    var progressTextEl = document.getElementById('ads-progress-text');
    if (progressTextEl) progressTextEl.textContent = doneCount + ' / ' + ads.length + ' yayınlandı';
  }

  function escapeHtml(s) {
    if (!escapeHtml._div) escapeHtml._div = document.createElement('div');
    escapeHtml._div.textContent = s;
    return escapeHtml._div.innerHTML;
  }

  document.querySelectorAll('.nav-link[data-view="playlist"], .nav-link[data-view="ads"], .nav-link[data-view="favorites"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var view = this.getAttribute('data-view');
      currentView = view;
      setActiveNavView(view);
      renderCenterList();
    });
  });

  // Listeyi mevcut görünüm + arama sorgusuna göre yeniden çizer.
  function renderCenterList() {
    var center = getCenterList(window.playerState);
    updateContentHeader(currentView, window.playerState, center.list.length);
    renderPlaylist(center.list, center.currentIndexInList);
    updateEmptyState(center.list.length);
  }

  // Liste boşsa nedenine göre bilgi mesajı göster.
  function updateEmptyState(count) {
    var emptyEl = document.getElementById('playlist-empty');
    if (!emptyEl) return;
    var isEmpty = count === 0 && window._playlistDataReceived;
    emptyEl.setAttribute('aria-hidden', isEmpty ? 'false' : 'true');
    if (!isEmpty) return;
    var textEl = document.getElementById('playlist-empty-text');
    if (!textEl) return;
    if (searchQuery) textEl.textContent = 'Aramanızla eşleşen kayıt yok';
    else if (currentView === 'favorites') textEl.textContent = 'Henüz beğendiğiniz şarkı yok';
    else if (currentView === 'ads') textEl.textContent = 'Yayın akışında anons yok';
    else textEl.textContent = 'Yayın akışı boş';
  }

  // ——— Liste araması ———
  (function setupSearch() {
    var input = document.getElementById('playlist-search');
    var clearBtn = document.getElementById('playlist-search-clear');
    if (!input) return;
    var timer = null;
    function apply(value) {
      if (value === searchQuery) return;
      searchQuery = value;
      if (clearBtn) clearBtn.setAttribute('aria-hidden', value ? 'false' : 'true');
      // Önbellek anahtarını sıfırla ki bir sonraki state güncellemesi listeyi yeniden çizsin.
      window._lastPlaylistKey = null;
      renderCenterList();
    }
    input.addEventListener('input', function () {
      var value = normalizeForSearch(this.value).trim();
      if (timer) clearTimeout(timer);
      // Yazarken her tuşta yeniden çizmemek için kısa gecikme (düşük CPU).
      timer = setTimeout(function () { timer = null; apply(value); }, 180);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) { this.value = ''; if (timer) clearTimeout(timer); apply(''); }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        if (timer) clearTimeout(timer);
        apply('');
        input.focus();
      });
    }
  })();

  document.getElementById('settings-refresh-playlist')?.addEventListener('click', function () {
    if (window.requestVPRefresh) window.requestVPRefresh();
    var ind = document.getElementById('playlist-update-indicator');
    if (ind) {
      ind.setAttribute('aria-hidden', 'false');
      if (window._playlistUpdateHideTimer) clearTimeout(window._playlistUpdateHideTimer);
      window._playlistUpdateHideTimer = setTimeout(function () {
        window._playlistUpdateHideTimer = null;
        var i = document.getElementById('playlist-update-indicator');
        if (i) i.setAttribute('aria-hidden', 'true');
      }, 2500);
    }
  });

  // Cihaz saati: sadece bu zamanlayıcı günceller (saniyede bir, ekstra yük yok)
  function updateSidebarClock() {
    var now = new Date();
    var timeEl = document.getElementById('sidebar-time');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    var h = now.getHours();
    // Tarih ve selamlama saniyede bir değişmiyor; toLocaleDateString saniyede bir
    // çağrılmasın diye yalnızca gün/saat dilimi değiştiğinde yazılır.
    var dayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
    if (dayKey !== window._lastClockDayKey) {
      window._lastClockDayKey = dayKey;
      var dateEl = document.getElementById('sidebar-date');
      if (dateEl) dateEl.textContent = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    var greeting = (h >= 0 && h < 6) ? 'İyi geceler' : (h >= 18) ? 'İyi Akşamlar' : 'İyi Günler';
    if (greeting !== window._lastGreeting) {
      window._lastGreeting = greeting;
      var gEl = document.getElementById('now-playing-greeting');
      if (gEl) gEl.textContent = greeting;
    }
    // Anons durumları (yayınlandı/yayında/sırada) dakikada bir tazelenir.
    var minuteKey = h * 60 + now.getMinutes();
    if (minuteKey !== window._lastAdsMinute) {
      window._lastAdsMinute = minuteKey;
      if (window.playerState && window.playerState.ads && window.playerState.ads.length) {
        renderAds(window.playerState.ads);
      }
    }
  }
  updateSidebarClock();
  setInterval(updateSidebarClock, 1000);

  // Üst bar "Çalınıyor/Duraklatıldı" butonu da aynı toggle
  document.getElementById('btn-now-playing-state')?.addEventListener('click', function () {
    var btnPlay = document.getElementById('btn-play');
    if (btnPlay) btnPlay.click();
  });
  // Pause = sadece sesi 0 yap (senkron bozulmasın); Play = sesi geri aç
  document.getElementById('btn-play')?.addEventListener('click', function () {
    var s = window.playerState;
    if (s.mutedByPause) {
      s.mutedByPause = false;
      s.volume = s.savedVolumeBeforeMute;
      if (window.virtualPlayer && window.virtualPlayer.state && window.virtualPlayer.state.controllers.playback) {
        window.virtualPlayer.state.controllers.playback.setDesiredVolume(s.volume / 100);
      }
      if (appAudio) appAudio.volume = s.volume / 100;
      var volEl = document.getElementById('volume');
      if (volEl) volEl.value = s.volume;
      s.isPlaying = true;
    } else {
      s.mutedByPause = true;
      s.savedVolumeBeforeMute = s.volume;
      s.volume = 0;
      if (window.virtualPlayer && window.virtualPlayer.state && window.virtualPlayer.state.controllers.playback) {
        window.virtualPlayer.state.controllers.playback.setDesiredVolume(0);
      }
      if (appAudio) appAudio.volume = 0;
      s.isPlaying = false;
    }
    updateUIFromState();
  });
  // Önceki/Sonraki kaldırıldı – radyo mantığı

  var progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    progressBar.addEventListener('click', function (e) {
      var rect = progressBar.getBoundingClientRect();
      var p = (e.clientX - rect.left) / rect.width;
      if (window.virtualPlayer && typeof window.virtualPlayer.seek === 'function') {
        window.virtualPlayer.seek(p * window.playerState.duration);
      } else {
        window.playerState.currentTime = p * window.playerState.duration;
        updateUIFromState();
      }
    });
  }

  // Ayarlar modal
  var settingsOverlay = document.getElementById('settings-overlay');
  var settingsTheme = document.getElementById('settings-theme');
  var settingsVersion = document.getElementById('settings-version');
  document.querySelector('.nav-link[data-view="settings"]')?.addEventListener('click', function (e) {
    e.preventDefault();
    if (settingsOverlay) {
      settingsOverlay.setAttribute('aria-hidden', 'false');
      var theme = document.body.getAttribute('data-theme') || 'dark';
      if (settingsTheme) settingsTheme.value = theme;
      if (window.electronAPI && window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(function (v) {
          if (settingsVersion) settingsVersion.textContent = v || '—';
        });
      } else if (settingsVersion) settingsVersion.textContent = '1.0.0';
      var speakerSelect = document.getElementById('settings-speaker');
      if (speakerSelect && navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
        navigator.mediaDevices.enumerateDevices().then(function (devices) {
          var outputs = devices.filter(function (d) { return d.kind === 'audiooutput'; });
          var savedId = getSavedSinkId();
          speakerSelect.innerHTML = '<option value="default">Varsayılan</option>';
          outputs.forEach(function (d) {
            var opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || 'Hoparlör ' + (speakerSelect.options.length);
            speakerSelect.appendChild(opt);
          });
          speakerSelect.value = savedId;
        });
      }
    }
  });
  document.getElementById('settings-close')?.addEventListener('click', function () {
    if (settingsOverlay) settingsOverlay.setAttribute('aria-hidden', 'true');
  });
  settingsOverlay?.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) settingsOverlay.setAttribute('aria-hidden', 'true');
  });
  settingsTheme?.addEventListener('change', function () {
    var v = this.value;
    document.body.setAttribute('data-theme', v);
    localStorage.setItem('aimusic-theme', v);
  });
  var speakerSelect = document.getElementById('settings-speaker');
  if (speakerSelect) {
    speakerSelect.addEventListener('change', function () {
      var id = this.value;
      // dataset'te tutulduğu için seçim her yeniden başlatmada varsayılana dönüyordu.
      try { localStorage.setItem(SINK_STORAGE_KEY, id); } catch (_) {}
      applySinkId(id);
    });
  }
  // Kayıtlı hoparlör seçimini açılışta uygula
  applySinkId(getSavedSinkId());

  // İletişim modal
  var contactOverlay = document.getElementById('contact-overlay');
  var contactWhatsAppMsg = 'Ai Music Player hakkında teknik desteğe ihtiyacımız vardır.';
  var contactWhatsAppUrl = 'https://wa.me/905462630902?text=' + encodeURIComponent(contactWhatsAppMsg);
  var contactMailSubject = 'Ai Music Player Teknik Destek';
  var contactMailBody = contactWhatsAppMsg;
  var contactMailUrl = 'mailto:teknik@aimusic.com.tr?subject=' + encodeURIComponent(contactMailSubject) + '&body=' + encodeURIComponent(contactMailBody);
  document.querySelector('.nav-link[data-view="contact"]')?.addEventListener('click', function (e) {
    e.preventDefault();
    if (contactOverlay) contactOverlay.setAttribute('aria-hidden', 'false');
  });
  document.getElementById('contact-close')?.addEventListener('click', function () {
    if (contactOverlay) contactOverlay.setAttribute('aria-hidden', 'true');
  });
  contactOverlay?.addEventListener('click', function (e) {
    if (e.target === contactOverlay) contactOverlay.setAttribute('aria-hidden', 'true');
  });
  document.getElementById('contact-whatsapp')?.addEventListener('click', function () {
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(contactWhatsAppUrl);
    } else {
      window.open(contactWhatsAppUrl, '_blank');
    }
  });
  // Esc ile açık modalları kapat. Onay modalı açıksa Esc = "Vazgeç" demektir,
  // bu yüzden yalnızca o kapanır; arkasındaki modallara dokunulmaz.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    if (logoutOverlay && logoutOverlay.getAttribute('aria-hidden') === 'false') {
      logoutOverlay.setAttribute('aria-hidden', 'true');
      return;
    }
    [settingsOverlay, contactOverlay].forEach(function (ov) {
      if (ov && ov.getAttribute('aria-hidden') === 'false') ov.setAttribute('aria-hidden', 'true');
    });
  });

  document.getElementById('contact-mail')?.addEventListener('click', function () {
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(contactMailUrl);
    } else {
      window.location.href = contactMailUrl;
    }
  });

  // ——— Çıkış Yap (Ayarlar içinde, onaylı) ———
  var logoutOverlay = document.getElementById('logout-overlay');

  function openLogoutConfirm() {
    if (settingsOverlay) settingsOverlay.setAttribute('aria-hidden', 'true');
    if (!logoutOverlay) { doLogout(); return; }
    logoutOverlay.setAttribute('aria-hidden', 'false');
    var cancelBtn = document.getElementById('logout-cancel');
    // Yanlışlıkla onaylanmasın diye odak "Vazgeç" üzerinde başlar.
    if (cancelBtn) cancelBtn.focus();
  }

  function closeLogoutConfirm() {
    if (logoutOverlay) logoutOverlay.setAttribute('aria-hidden', 'true');
  }

  // Oturumu kapat, sonra login'e ?logout=1 ile git ki login sayfası
  // oturum varmış gibi tekrar uygulamaya atlamasın.
  function doLogout() {
    var go = function () {
      if (window.electronAPI && window.electronAPI.navigateToLogin) {
        window.electronAPI.navigateToLogin(true);
      } else {
        window.location.href = 'login.html?logout=1';
      }
    };
    // Sayfa değişimi signOut'u yarıda kesmesin: önce çıkış, sonra yönlendirme.
    if (window.supabaseClient && window.supabaseClient.auth) {
      window.supabaseClient.auth.signOut().then(go).catch(go);
    } else {
      go();
    }
  }

  document.getElementById('settings-logout')?.addEventListener('click', function (e) {
    e.preventDefault();
    openLogoutConfirm();
  });
  document.getElementById('logout-confirm')?.addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Çıkış yapılıyor…';
    doLogout();
  });
  document.getElementById('logout-cancel')?.addEventListener('click', closeLogoutConfirm);
  logoutOverlay?.addEventListener('click', function (e) {
    if (e.target === logoutOverlay) closeLogoutConfirm();
  });

  // Sıradaki parçayı önceden yükle → parça geçişinde canplay gecikmesi azalır
  var nextTrackPreloadAudio = null;
  function preloadNextTrack() {
    var s = window.playerState;
    if (!s || !s.playlist || !s.playlist.length) return;
    var idx = s.currentTrackIndex >= 0 ? s.currentTrackIndex : -1;
    var next = s.playlist[idx + 1];
    var url = next && next.audio && next.audio.url ? next.audio.url : null;
    if (!url) return;
    if (window._prefetchSentUrls && window._prefetchSentUrls.has(url)) return;
    if (!nextTrackPreloadAudio) nextTrackPreloadAudio = new Audio();
    if (nextTrackPreloadAudio.src !== url) {
      nextTrackPreloadAudio.src = url;
      nextTrackPreloadAudio.preload = 'auto';
      nextTrackPreloadAudio.load();
    }
  }

  // Virtual Player: state güncellemesi → UI (pause=mute iken volume 0 kalır)
  window.addEventListener('virtualplayer-state', function (e) {
    if (e.detail && window.playerState) {
      var pl = e.detail.playlist;
      var plSig = pl && pl.length ? pl.length + '-' + (pl[0] && pl[0].id) + '-' + (pl[pl.length - 1] && pl[pl.length - 1].id) : '';
      if (plSig !== undefined) window._lastPlaylistSignature = plSig;
      // İlk kez giriş yapan işletmelerde VP, akış daha hazır değilken boş liste
      // ile birkaç kez tetikleniyor. Bunu "veri geldi" saymak, "hazırlanıyor"
      // mesajını erkenden kapatıp yerine boş liste gösteriyordu. Gerçekten
      // içerik geldiğinde işaretle; akış cidden boşsa aşağıdaki zaman aşımı devreye girer.
      if (!window._playlistDataReceived && pl && pl.length > 0) {
        window._playlistDataReceived = true;
        if (window._playlistWaitTimer) { clearTimeout(window._playlistWaitTimer); window._playlistWaitTimer = null; }
      }
      if (!pl || pl.length === 0) {
        var indEmpty = document.getElementById('playlist-update-indicator');
        if (indEmpty) indEmpty.setAttribute('aria-hidden', 'true');
        if (window._playlistUpdateHideTimer) { clearTimeout(window._playlistUpdateHideTimer); window._playlistUpdateHideTimer = null; }
      }
      if (window.playerState.mutedByPause && e.detail.volume != null) e.detail.volume = 0;
      Object.assign(window.playerState, e.detail);
      updateUIFromState();
      preloadNextTrack();
      if (window.preloadPlaylistMedia && (
        (e.detail.playlist && e.detail.playlist.length > 0) ||
        (e.detail.upcomingSchedule && e.detail.upcomingSchedule.length > 0)
      )) {
        debouncedPreloadPlaylistMedia();
      }
    }
  });

  // Referans (services/utils/timeline): cihaz saati gün içi ms
  function getCurrentTimeInMilliseconds() {
    var now = new Date();
    return now.getHours() * 60 * 60 * 1000 + now.getMinutes() * 60 * 1000 + now.getSeconds() * 1000 + now.getMilliseconds();
  }

  // Virtual Player: activeRecord → ses oynat. Her parça (ilk dahil) cihaz saatine göre olması gereken saniyeden başlar; akış kayması olmaz.
  var appAudio = document.getElementById('app-audio');
  var activeRecordLoadId = 0;
  window._pendingActiveRecord = null;
  window._currentActiveRecordUrl = null;
  function applyActiveRecord(d) {
    if (!d || !d.url) {
      window._trackDurationSec = null;
      window._currentActiveRecordUrl = null;
      activeRecordLoadId++;
      appAudio.pause();
      appAudio.removeAttribute('src');
      if (window.playerState) window.playerState.isPlaying = false;
      updateUIFromState();
      return;
    }
    window._currentActiveRecordUrl = d.url;
    var thisLoadId = ++activeRecordLoadId;
    var startTimeMs = d.startTimeMs != null ? Number(d.startTimeMs) : null;
    var durationMs = d.durationMs != null ? Number(d.durationMs) : 0;
    var startOffset = 0;
    if (startTimeMs != null && durationMs > 0) {
      var nowMs = getCurrentTimeInMilliseconds();
      var elapsedMs = nowMs - startTimeMs;
      if (elapsedMs >= durationMs) {
        activeRecordLoadId++;
        appAudio.pause();
        appAudio.removeAttribute('src');
        if (window.playerState) window.playerState.isPlaying = false;
        updateUIFromState();
        return;
      }
      startOffset = elapsedMs > 0 ? Math.min(elapsedMs / 1000, durationMs / 1000) : 0;
    } else if (d.currentOffset != null && !isNaN(d.currentOffset)) {
      startOffset = Math.max(0, d.currentOffset);
    }
    window._trackDurationSec = d.duration != null && !isNaN(d.duration) ? Number(d.duration) : null;
    appAudio.src = d.url;
    var vol = (window.playerState && window.playerState.volume != null) ? window.playerState.volume / 100 : 1;
    if (window.playerState && window.playerState.mutedByPause) vol = 0;
    appAudio.volume = vol;
    appAudio.currentTime = startOffset;
    if (window.playerState) window.playerState.currentTime = startOffset;
    appAudio.addEventListener('canplay', function onCanPlay() {
      appAudio.removeEventListener('canplay', onCanPlay);
      if (thisLoadId !== activeRecordLoadId) return;
      appAudio.currentTime = startOffset;
      appAudio.play().catch(function (err) { console.warn('Oynatma hatası:', err); });
      if (window.playerState) window.playerState.isPlaying = true;
      updateUIFromState();
    }, { once: true });
    if (window.playerState) window.playerState.isPlaying = true;
    updateUIFromState();
  }
  if (appAudio) {
    window.addEventListener('virtualplayer-activerecord', function (e) {
      try {
        var d = e.detail;
        if (!d || !d.url) {
          window._pendingActiveRecord = null;
          applyActiveRecord(d);
          return;
        }
        var isNewTrack = d.url !== window._currentActiveRecordUrl;
        var dur = window._trackDurationSec != null ? window._trackDurationSec : (appAudio.duration && !isNaN(appAudio.duration) ? appAudio.duration : 0);
        var cur = appAudio.currentTime;
        // Parça bitmeden kesilmesin: mevcut parçada 3 sn'den fazla kaldıysa bitene kadar bekle
        // Aynı dosyaya tekrar istek atmayalım: preloadNextTrack() zaten sıradaki parçayı yüklüyor, ekstra _preloadNextAudio kaldırıldı
        if (isNewTrack && appAudio.src && dur > 0 && cur < dur - 3) {
          window._pendingActiveRecord = d;
          clearTimeout(window._pendingActiveRecordTimeout);
          window._pendingActiveRecordTimeout = setTimeout(function () {
            if (window._pendingActiveRecord) {
              var pending = window._pendingActiveRecord;
              window._pendingActiveRecord = null;
              applyActiveRecord(pending);
              updateUIFromState();
            }
          }, 5000);
          return;
        }
        clearTimeout(window._pendingActiveRecordTimeout);
        window._pendingActiveRecord = null;
        applyActiveRecord(d);
      } catch (err) {
        console.warn('virtualplayer-activerecord:', err);
      }
      var d2 = e.detail;
      if (d2) {
        var nowImg = document.getElementById('now-playing-art-img');
        var nowPl = document.getElementById('now-playing-art-placeholder');
        var plImg = document.getElementById('player-art-img');
        var plPl = document.getElementById('player-art-placeholder');
        var adUrl = (d2.type === 'ad' || d2.type === 'specialAd' || d2.type === 'stockAd') && !d2.artworkUrl ? AD_LOGO_URL : d2.artworkUrl;
        if (adUrl) {
          if (nowImg) { nowImg.src = adUrl; nowImg.style.display = 'block'; }
          if (nowPl) nowPl.style.display = 'none';
          if (plImg) { plImg.src = adUrl; plImg.style.display = 'block'; }
          if (plPl) plPl.style.display = 'none';
        } else {
          if (nowPl) nowPl.style.display = 'flex';
          if (nowImg) nowImg.style.display = 'none';
          if (plPl) plPl.style.display = 'flex';
          if (plImg) plImg.style.display = 'none';
        }
      }
    });
    window.addEventListener('virtualplayer-state', function (e) {
      if (e.detail && e.detail.volume != null && !(window.playerState && window.playerState.mutedByPause))
        appAudio.volume = e.detail.volume / 100;
    });
    appAudio.addEventListener('timeupdate', function () {
      if (!window.playerState || !appAudio.src) return;
      window.playerState.currentTime = appAudio.currentTime;
      window.playerState.duration = appAudio.duration && !isNaN(appAudio.duration) ? appAudio.duration : window.playerState.duration;
      var now = Date.now();
      if (window._lastProgressUpdate != null && now - window._lastProgressUpdate < 250) return;
      window._lastProgressUpdate = now;
      var curEl = document.getElementById('progress-current');
      var totEl = document.getElementById('progress-total');
      var fillEl = document.getElementById('progress-fill');
      if (curEl) curEl.textContent = formatTime(appAudio.currentTime);
      var dur = window._trackDurationSec != null ? window._trackDurationSec : (appAudio.duration && !isNaN(appAudio.duration) ? appAudio.duration : 0);
      if (totEl) totEl.textContent = formatTime(dur);
      var pct = (dur > 0 ? (appAudio.currentTime / dur) * 100 : 0);
      if (fillEl) fillEl.style.width = pct + '%';
      var heroFillEl = document.getElementById('np-progress-fill');
      if (heroFillEl) heroFillEl.style.width = pct + '%';
      var remainingEl = document.getElementById('np-remaining');
      if (remainingEl) remainingEl.textContent = dur > 0 ? formatTime(Math.max(0, dur - appAudio.currentTime)) + ' kaldı' : '';
    });
    appAudio.addEventListener('ended', function () {
      clearTimeout(window._pendingActiveRecordTimeout);
      if (window.playerState) window.playerState.isPlaying = false;
      if (window._pendingActiveRecord) {
        var pending = window._pendingActiveRecord;
        window._pendingActiveRecord = null;
        applyActiveRecord(pending);
        var d2 = pending;
        if (d2 && d2.url) {
          var nowImg = document.getElementById('now-playing-art-img');
          var nowPl = document.getElementById('now-playing-art-placeholder');
          var plImg = document.getElementById('player-art-img');
          var plPl = document.getElementById('player-art-placeholder');
          var adUrl = (d2.type === 'ad' || d2.type === 'specialAd' || d2.type === 'stockAd') && !d2.artworkUrl ? AD_LOGO_URL : d2.artworkUrl;
          if (adUrl) {
            if (nowImg) { nowImg.src = adUrl; nowImg.style.display = 'block'; }
            if (nowPl) nowPl.style.display = 'none';
            if (plImg) { plImg.src = adUrl; plImg.style.display = 'block'; }
            if (plPl) plPl.style.display = 'none';
          } else {
            if (nowPl) nowPl.style.display = 'flex';
            if (nowImg) nowImg.style.display = 'none';
            if (plPl) plPl.style.display = 'flex';
            if (plImg) plImg.style.display = 'none';
          }
        }
      }
      updateUIFromState();
    });
  }

  // Ses slider → VP volume (mute iken sadece bir sonraki “play” için sakla)
  document.getElementById('volume')?.addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    var pct = document.getElementById('volume-percent');
    if (pct) pct.textContent = v + '%';
    if (window.playerState.mutedByPause) {
      window.playerState.savedVolumeBeforeMute = v;
      return;
    }
    window.playerState.volume = v;
    if (window.virtualPlayer && window.virtualPlayer.state && window.virtualPlayer.state.controllers.playback) {
      window.virtualPlayer.state.controllers.playback.setDesiredVolume(v / 100);
    }
    if (appAudio) appAudio.volume = v / 100;
  }, { passive: true });

  // İlk UI
  updateUIFromState();

  // Root: Virtual Player'ı userId ile başlat (Provider benzeri akış)
  // VP paketi app.js sonunda requestAnimationFrame ile ertelenmiş çalışıyor. Oturum
  // yerel önbellekten hızlı gelirse initVirtualPlayer henüz tanımlı olmayabiliyordu ve
  // tek seferlik kontrol sessizce başarısız olup çalma listesi boş kalıyordu.
  var vpStarted = false;
  function startVirtualPlayer() {
    if (vpStarted || !window.userId || typeof window.initVirtualPlayer !== 'function') return;
    vpStarted = true;
    window.initVirtualPlayer(window.userId).then(function () {
      updateUIFromState();
    }).catch(function (err) {
      vpStarted = false;
      console.warn('Virtual Player init:', err);
    });
  }
  window.addEventListener('vp-ready', startVirtualPlayer);
  startVirtualPlayer();
  }

  function runApp() {
    initAuthAndRun();
  }

  // Supabase ve oturum kontrolü; sonra uygulamayı başlat
  if (typeof supabase !== 'undefined') {
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    });
    window.supabaseClient.auth.getSession()
      .then(function (result) {
        var session = result.data && result.data.session;
        if (!session && window.electronAPI && window.electronAPI.navigateToLogin) {
          window.electronAPI.navigateToLogin();
          return;
        }
        if (!session) {
          window.location.href = 'login.html';
          return;
        }
        window.userId = session.user.id;
        window.playerState.status = 'online';
        return window.supabaseClient.from('users').select('name, country, city, district').eq('id', window.userId).maybeSingle();
      })
      .then(function (userRow) {
        if (!window.userId) return;
        if (userRow && userRow.data) {
          var u = userRow.data;
          var loc = [u.district, u.city, u.country].filter(Boolean).join(', ') || null;
          window.playerState.location = loc;
          window.userName = u.name || null;
        }
        runApp();
      })
      .catch(function () {
        if (window.userId) runApp();
        else if (window.electronAPI && window.electronAPI.navigateToLogin) window.electronAPI.navigateToLogin();
      });
  } else {
    window.playerState.status = 'online';
    runApp();
  }
})();
