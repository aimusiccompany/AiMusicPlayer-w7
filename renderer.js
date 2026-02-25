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
  function setupImageFallbacks() {
    document.querySelectorAll('img[data-fallback]').forEach(function (img) {
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
  var likedSet = new Set();

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
    return { list: list, currentIndexInList: currentIndexInList };
  }

  function updateContentHeader(view, s) {
    var headingEl = document.getElementById('content-heading');
    var countEl = document.getElementById('content-count');
    var countWrap = countEl && countEl.closest ? countEl : null;
    if (headingEl) {
      if (view === 'playlist') headingEl.textContent = 'Çalma Listesi';
      else if (view === 'ads') headingEl.textContent = 'Reklamlarım';
      else headingEl.textContent = 'Beğenilen Şarkılar';
    }
    if (countEl) {
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
  }

  function setActiveNavView(view) {
    document.querySelectorAll('.nav-link[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === view);
    });
  }

  function initAuthAndRun() {
  window._playlistDataReceived = false;
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
    const s = window.playerState;

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
    updateContentHeader(currentView, s);
    var center = getCenterList(s);
    var playlistKey = currentView + '|' + (s.currentTrackIndex >= 0 ? s.currentTrackIndex : -1) + '|' + (s.playlist ? s.playlist.length : 0);
    if (playlistKey !== window._lastPlaylistKey) {
      window._lastPlaylistKey = playlistKey;
      renderPlaylist(center.list, center.currentIndexInList);
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
    if (fillEl) fillEl.style.width = (displayDuration > 0 ? (displayCurrent / displayDuration) * 100 : 0) + '%';

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
    el.innerHTML = list.map(function (track, i) {
      const playingClass = i === currentIndex ? ' playing' : '';
      var fullIdx = track.fullIndex != null ? track.fullIndex : i;
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
        ? '<img src="' + escapeHtml(artSrc) + '" alt="" class="track-art-img' + (track.recordType === 'ad' ? ' track-art-img--ad-logo' : '') + '" style="display:block" data-fallback="next" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><div class="track-art-placeholder track-art-placeholder--anon" style="display:none">—</div>'
        : '<div class="track-art-placeholder track-art-placeholder--anon">—</div>';
      var tagLabel = (track.tag && String(track.tag).trim()) ? escapeHtml(track.tag) : 'MÜZİK';
      var num = (track.fullIndex != null ? track.fullIndex + 1 : i + 1);
      var isSong = track.recordType === 'song';
      var likedClass = isSong && likedSet.has(String(track.id)) ? ' liked' : '';
      var actionsHtml = isSong
        ? '<div class="track-actions"><button type="button" class="btn-like' + likedClass + '" title="Beğen">♥</button><button type="button" class="btn-dislike" title="Beğenme">♡</button></div>'
        : '<div class="track-actions track-actions--no-buttons"></div>';
      return '<li class="track-item' + playingClass + '" data-index="' + i + '"' + dataFull + '>' +
        '<span class="track-num">' + num + '</span>' +
        '<div class="track-art">' + art + '</div>' +
        '<div><span class="track-title">' + title + '</span><span class="track-artist">' + artist + '</span></div>' +
        '<span class="track-time">' + escapeHtml(time) + '</span>' +
        '<span class="track-duration">' + duration + '</span>' +
        '<span class="track-tag track-tag--' + escapeHtml(slug) + '">' + tagLabel + '</span>' +
        actionsHtml +
        '</li>';
    }).join('');
    el.querySelectorAll('.track-item').forEach(function (li) {
      li.addEventListener('click', function (e) {
        if (e.target.closest('.track-actions')) return;
        var idx = li.dataset.fullIndex != null ? parseInt(li.dataset.fullIndex, 10) : parseInt(li.dataset.index, 10);
        if (!isNaN(idx) && window.onPlaylistTrackSelect) window.onPlaylistTrackSelect(idx);
      });
    });
    el.querySelectorAll('.btn-like').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var li = this.closest('li');
        var fullIdx = li && li.dataset.fullIndex != null ? parseInt(li.dataset.fullIndex, 10) : -1;
        if (fullIdx >= 0 && window.playerState && window.playerState.playlist[fullIdx]) {
          var t = window.playerState.playlist[fullIdx];
          if (t.recordType === 'song') {
            var id = String(t.id);
            if (likedSet.has(id)) likedSet.delete(id); else likedSet.add(id);
            this.classList.toggle('liked', likedSet.has(id));
            var dis = li.querySelector('.btn-dislike');
            if (dis) dis.classList.remove('disliked');
            updateContentHeader(currentView, window.playerState);
            if (currentView === 'favorites') {
              var center = getCenterList(window.playerState);
              renderPlaylist(center.list, center.currentIndexInList);
            }
          }
        } else {
          this.classList.toggle('liked');
          if (li) { var d = li.querySelector('.btn-dislike'); if (d) d.classList.remove('disliked'); }
        }
      });
    });
    el.querySelectorAll('.btn-dislike').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); this.classList.toggle('disliked'); this.closest('li').querySelector('.btn-like').classList.remove('liked'); });
    });
    var playingLi = currentIndex >= 0 ? el.querySelector('.track-item.playing') : null;
    if (playingLi && typeof playingLi.scrollIntoView === 'function') {
      playingLi.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderAds(ads) {
    const el = document.getElementById('ads-list');
    if (!el) return;
    if (!ads || ads.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = ads.map(function (ad, i) {
      var num = ad.num != null ? ad.num : i + 1;
      var title = escapeHtml(ad.title || '—');
      var duration = ad.duration != null ? formatDuration(ad.duration) : '—';
      var startTime = ad.time || '—';
      var tag = escapeHtml(ad.tag || 'Anons');
      var slug = (ad.tagSlug || 'reklam').replace(/\s+/g, '-');
      return '<li>' +
        '<div class="ad-top"><span class="ad-num">' + num + '</span> <span class="ad-title">' + title + '</span></div>' +
        '<div class="ad-tag-row"><span class="ad-tag-pill ad-tag-pill--' + escapeHtml(slug) + '">' + tag + '</span><span class="ad-meta-pill">Süre: ' + escapeHtml(String(duration)) + ' | ' + escapeHtml(String(startTime)) + '</span></div>' +
        '</li>';
    }).join('');
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
      updateContentHeader(view, window.playerState);
      var center = getCenterList(window.playerState);
      renderPlaylist(center.list, center.currentIndexInList);
    });
  });

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
    var dateEl = document.getElementById('sidebar-date');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    var h = now.getHours();
    var greeting = (h >= 0 && h < 6) ? 'İyi geceler' : (h >= 18) ? 'İyi Akşamlar' : 'İyi Günler';
    var gEl = document.getElementById('now-playing-greeting');
    if (gEl) gEl.textContent = greeting;
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
          var savedId = speakerSelect.dataset.sinkId || 'default';
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
      speakerSelect.dataset.sinkId = id;
      var audio = document.getElementById('app-audio');
      if (audio && typeof audio.setSinkId === 'function') {
        audio.setSinkId(id).catch(function () {});
      }
    });
  }

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
  document.getElementById('contact-mail')?.addEventListener('click', function () {
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(contactMailUrl);
    } else {
      window.location.href = contactMailUrl;
    }
  });

  // Çıkış Yap — login'e ?logout=1 ile git ki login sayfası oturum varken tekrar uygulamaya atmasın
  document.querySelector('.nav-link[data-view="logout"]')?.addEventListener('click', function (e) {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.navigateToLogin) {
      window.electronAPI.navigateToLogin(true);
    } else {
      window.location.href = 'login.html?logout=1';
    }
    if (window.supabaseClient && window.supabaseClient.auth) {
      window.supabaseClient.auth.signOut().catch(function () {});
    }
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
      if (!window._playlistDataReceived) window._playlistDataReceived = true;
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

  // Virtual Player: activeRecord → ses oynat. URL'ler Service Worker (file-cache-manager-sw) tarafından intercept edilir; önbellekte varsa ağa gitmeden locale'den döner.
  var appAudio = document.getElementById('app-audio');
  var activeRecordLoadId = 0; // so we only play() after the current source is loaded, avoiding "play() interrupted by new load"
  if (appAudio) {
    window.addEventListener('virtualplayer-activerecord', function (e) {
      try {
        var d = e.detail;
        if (!d || !d.url) {
          window._trackDurationSec = null;
          activeRecordLoadId++;
          appAudio.pause();
          appAudio.removeAttribute('src');
          if (window.playerState) window.playerState.isPlaying = false;
          updateUIFromState();
          return;
        }
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
        updateUIFromState(); // show loading/playing state immediately
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
      if (fillEl) fillEl.style.width = (dur > 0 ? (appAudio.currentTime / dur) * 100 : 0) + '%';
    });
    // Referans (audio.js): onend sadece playerState = 'idle'. Geçişi VP realtime simulation yapar; advance() → activeRecord değişir → abonelik syncState → activerecord dispatch.
    appAudio.addEventListener('ended', function () {
      if (window.playerState) window.playerState.isPlaying = false;
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
  if (window.userId && typeof window.initVirtualPlayer === 'function') {
    window.initVirtualPlayer(window.userId).then(function () {
      updateUIFromState();
    }).catch(function (err) {
      console.warn('Virtual Player init:', err);
    });
  }
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
