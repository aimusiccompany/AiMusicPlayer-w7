/**
 * Virtual Player – Kurulum (Setup 1.0.37) ile aynı kullanım:
 * IndexedDB persist, VirtualPlayerState (mode: cached), upcomingSchedule.
 */
import { createClient } from '@supabase/supabase-js'
import {
  VirtualPlayer,
  VirtualPlayerState,
  FileCacheManager,
  createIndexedDBStorage,
  createJSONStorage,
  getLocalStartOfDay
} from '@ai-music-corp/virtual-player'

const DAY = 86400000 // 24 * 60 * 60 * 1000

const SUPABASE_URL = 'https://api.aimusic.com.tr'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1aXN1aHVlcHZxc2Nzd2NvY3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgwNDUzODUsImV4cCI6MjAzMzYyMTM4NX0.Lo0dFFPUNvsLIBxitmsi_mmTtDlVABsqgd74rGrvHq0'

function snapshotToPlayerState(system, playback, playlist, ad, specialAd, stockAd, upcomingSchedule = [], deviceTimeMs = null) {
  const sys = system || {}
  const devMs = deviceTimeMs != null ? deviceTimeMs : getDeviceTimeMs()
  let rec = sys.activeRecord || (playback || {}).activeRecord
  let deviceTimeRecordIndex = -1
  if (!upcomingSchedule || upcomingSchedule.length === 0) {
    rec = null
  } else {
    for (let i = 0; i < upcomingSchedule.length; i++) {
      const r = upcomingSchedule[i]
      const startMs = r.startTime != null ? r.startTime : 0
      const endMs = r.endTime != null ? r.endTime : (startMs + (r.audio && r.audio.duration ? r.audio.duration : 0))
      if (devMs >= startMs && devMs < endMs) {
        rec = r
        deviceTimeRecordIndex = i
        break
      }
    }
    // Hiçbir slotta değilsek (deviceTimeRecordIndex < 0) çalma; 24:00 placeholder tek kayıt olabilir
    if (deviceTimeRecordIndex < 0) rec = null
  }
  // Yayın bitmiş say: sadece gerçekten son kayıt bittiyse (24:00 placeholder hariç)
  let broadcastEnded = false
  if (rec === null && upcomingSchedule && upcomingSchedule.length > 0) {
    const realRecords = upcomingSchedule.filter((r) => {
      const end = r.endTime != null ? r.endTime : (r.startTime != null ? r.startTime + (r.audio && r.audio.duration ? r.audio.duration : 0) : 0)
      return end < DAY
    })
    if (realRecords.length > 0) {
      const lastEnd = realRecords[realRecords.length - 1]
      const lastEndMs = lastEnd.endTime != null ? lastEnd.endTime : (lastEnd.startTime != null ? lastEnd.startTime + (lastEnd.audio && lastEnd.audio.duration ? lastEnd.audio.duration : 0) : 0)
      broadcastEnded = devMs >= lastEndMs
    }
  }
  const songQueue = (playback || {}).songQueue || []
  const playlists = (playlist || {}).playlists || []
  const userPlaylists = (playlist || {}).userPlaylists || []
  const adSchedules = (ad || {}).schedules || []
  const specialAdSchedules = (specialAd || {}).schedules || []
  const stockAdSchedules = (stockAd || {}).schedules || []
  const activePlaylist = sys.activePlaylist
  const songs = activePlaylist && activePlaylist.songs ? activePlaylist.songs : []
  const duration = rec && rec.audio ? rec.audio.duration / 1000 : 0
  const playOffset = rec ? Math.max(0, (devMs - (rec.startTime != null ? rec.startTime : 0)) / 1000) : 0

  // Referans: ana liste VP'nin ürettiği upcomingSchedule (history) ile aynı; her kayıt gerçek startTime/endTime ve coverUrl taşır
  // Yayın bitmişse geçmiş listeyi gösterme; 24:00:00 placeholder kayıtlarını listeden çıkar
  // Boş schedule (API hatası vb.) gelirse önceki listeyi koru – yanlışlıkla silinmesin
  let recordsToMap = broadcastEnded ? [] : ((upcomingSchedule || []).filter((r) => {
    const start = r.startTime != null ? r.startTime : 0
    return start < DAY
  }))
  let fallbackFromPrevPlaylist = false
  if (recordsToMap.length === 0 && !broadcastEnded && typeof window !== 'undefined' && window.playerState && window.playerState.playlist && window.playerState.playlist.length > 0) {
    recordsToMap = window.playerState.playlist.map((item) => ({
      startTime: item.startTimeMs,
      endTime: item.endTimeMs,
      name: item.title,
      type: item.recordType === 'song' ? 'song' : (item.recordType === 'ad' ? 'ad' : (item.recordType === 'specialAd' ? 'specialAd' : 'stockAd')),
      id: item.recordType === 'song' ? item.id : 'rec-' + item.recordType + '-' + (item.id || '') + '-' + (item.startTimeMs || 0),
      album: item.artworkUrl ? { coverUrl: item.artworkUrl, name: item.artist } : null,
      audio: item.audio || null,
      coverUrl: item.artworkUrl || null
    }))
    fallbackFromPrevPlaylist = true
  }
  // upcomingSchedule boş gelip önceki playlist'ten liste doldurduysak, şu anki slotu da bu listeden bul (API hatası vb.)
  if (fallbackFromPrevPlaylist && rec === null && recordsToMap.length > 0) {
    for (let i = 0; i < recordsToMap.length; i++) {
      const r = recordsToMap[i]
      const startMs = r.startTime != null ? r.startTime : 0
      const endMs = r.endTime != null ? r.endTime : (startMs + (r.audio && r.audio.duration ? r.audio.duration : 0))
      if (devMs >= startMs && devMs < endMs) {
        rec = r
        deviceTimeRecordIndex = i
        break
      }
    }
  }
  // VP o günün tüm akışını ve anlık parçayı veriyor; doğrudan recordsToMap kullanıyoruz, ek merge yok
  const mergedPlaylist = recordsToMap.map((record) => {
    const startMs = record.startTime != null ? record.startTime : 0
    const endMs = record.endTime != null ? record.endTime : (startMs + (record.audio && record.audio.duration ? record.audio.duration : 0))
    const durationSec = (record.audio && record.audio.duration) ? record.audio.duration / 1000 : 0
    let tag = 'MÜZİK'
    let tagSlug = 'muzik'
    let artworkUrl = null
    let artist = '—'
    if (record.type === 'song') {
      tag = 'MÜZİK'
      tagSlug = 'muzik'
      artworkUrl = (record.album && record.album.coverUrl) || null
      artist = (record.album && record.album.name) || (record.audio && record.audio.name) || '—'
    } else if (record.type === 'ad') {
      tag = 'Reklam'
      tagSlug = 'reklam'
      artist = 'Reklam'
    } else if (record.type === 'specialAd') {
      tag = 'Özel Gün'
      tagSlug = 'ozel-gun'
      artworkUrl = record.coverUrl || null
      artist = 'Özel Gün'
    } else if (record.type === 'stockAd') {
      tag = 'Stok Sihirbazı'
      tagSlug = 'stok-sihirbazi'
      artworkUrl = record.coverUrl || null
      artist = 'Stok Sihirbazı'
    }
    return {
      id: record.type === 'song' ? record.id : 'rec-' + record.type + '-' + record.id + '-' + startMs,
      startTimeMs: startMs,
      endTimeMs: endMs,
      title: record.name || '—',
      artist,
      genre: artist,
      duration: durationSec,
      time: formatTimeOfDayMs(startMs),
      timeEnd: formatTimeOfDayMs(endMs),
      tag,
      tagSlug,
      recordType: record.type,
      artworkUrl,
      audio: record.audio || null
    }
  })

  let mergedCurrentIndex = deviceTimeRecordIndex >= 0 ? deviceTimeRecordIndex : -1
  if (mergedCurrentIndex < 0 && rec) {
    for (let i = 0; i < mergedPlaylist.length; i++) {
      const item = mergedPlaylist[i]
      const matchBySong = rec.type === 'song' && item.recordType === 'song' && String(item.id) === String(rec.id)
      const matchBySlot = rec.type !== 'song' && item.recordType === rec.type && item.startTimeMs === (rec.startTime != null ? rec.startTime : 0)
      if (matchBySong || matchBySlot) {
        mergedCurrentIndex = i
        break
      }
    }
  }
  if (mergedCurrentIndex < 0 && mergedPlaylist.length > 0 && devMs >= mergedPlaylist[mergedPlaylist.length - 1].endTimeMs) {
    mergedCurrentIndex = mergedPlaylist.length - 1
  }
  if (mergedCurrentIndex < 0 && mergedPlaylist.length > 0) mergedCurrentIndex = 0

  // Sağ panel Reklamlarım: eski kompakt format (başlık, süre, zaman aralığı, etiket)
  const adsForRightPanel = mergedPlaylist
    .filter((item) => item.recordType !== 'song')
    .map((item, i) => ({
      num: i + 1,
      title: item.title || '—',
      duration: item.duration,
      time: item.time || '—',
      timeEnd: item.timeEnd || '—',
      tag: item.tag || 'Anons',
      tagSlug: (item.tagSlug || 'reklam').replace(/\s+/g, '-')
    }))

  return {
    playlist: mergedPlaylist,
    ads: adsForRightPanel,
    upcomingSchedule,
    currentTrackIndex: mergedCurrentIndex,
    isPlaying: (playback || {}).songPlayState === 'playing',
    currentTime: rec ? Math.max(0, playOffset) : 0,
    duration,
    volume: (sys.volume != null ? sys.volume : 1) * 100,
    location: typeof window !== 'undefined' && window.playerState ? window.playerState.location : null,
    status: 'online',
    activeRecord: rec || null
  }
}

/** API bazen saniye (0–86400) döndürüyor; gün içi ms’e çevir (tek kaynak) */
function toDayMs(v) {
  if (v == null || isNaN(v)) return 0
  if (v > 0 && v <= 86400) return v * 1000
  return v
}

/** Gün içi ms (0..DAY) → "HH:mm:ss". Gün sonu (DAY = 24h) "24:00:00" olarak gösterilir. */
function formatTimeOfDayMs(ms) {
  if (ms == null || ms < 0) return '—'
  if (ms >= DAY) return '24:00:00'
  const h = Math.floor(ms / 3600000) % 24
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0')
  )
}

function getUpcomingSchedule(player) {
  try {
    const state = player.state.clone()
    // history TEMIZLENMIYOR (onceden `s.history = []` yaziliyordu).
    //
    // Ana oynatici startRealtimeSimulation() icinde gunun basindan su ana kadar
    // simule ediliyor, dolayisiyla history o an calan kayit dahil bugunun
    // tamamini tasiyor. Temizlendiginde simulasyon "su an"dan basliyordu ve
    // history'ye yalnizca su andan SONRA baslayan kayitlar giriyordu; o an calan
    // parca listeye hic girmiyordu. snapshotToPlayerState da
    // `devMs >= startMs && devMs < endMs` eslesmesini bulamadigi icin
    // uygulama yeniden baslatildiginda mevcut sarki calmiyor, bir sonraki
    // parcanin saati bekleniyordu.
    //
    // Klonlama mukerrer kayit uretmez: RaceAssignmentState.subscribe abone
    // olurken prevValue'yu mevcut degerle baslatir ve anlik cagri yalnizca
    // initialCall ile yapilir (kontrolcüler kullanmiyor); notifyInSync sadece
    // valtio'nun senkron bildirim bayragi.
    const tempPlayer = new VirtualPlayer({ state })
    tempPlayer.fastForwardTo(DAY)
    return tempPlayer.state.controllers.playback.state.snapshot().history || []
  } catch (_) {
    return []
  }
}

/** Playlist/reklam programları değişmediğinde önbellek kullan – fastForwardTo(DAY) ana thread'i bloke ediyor */
let _scheduleCacheKey = null
let _scheduleCache = null
let _scheduleCacheTime = 0
let _scheduleRefreshScheduled = false
let _scheduleCachePrefetch = null // İlk açılışta çalma listesini hızlandırmak için erken doldurulur
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 dk – UI donmasını azaltmak için

/**
 * KALDIRILDI: onceden yeni liste "su an"dan basladigi icin, gunun onceki
 * parcalarini eski cache'ten alip basa ekliyordu. Artik getUpcomingSchedule
 * history'yi temizlemedigi icin gunun tamami zaten geliyor; bu birlestirme
 * gereksiz ve gun devrinde dunun kayitlarini bugune tasima riski tasiyor.
 * Cagri yerlerinde dogrudan `fresh` kullaniliyor.
 */

function getUpcomingScheduleCached(player) {
  const now = Date.now()
  const sys = player.state.system.snapshot()
  const playlist = player.state.controllers.playlist?.state?.snapshot()
  const ad = player.state.controllers.ad?.state?.snapshot()
  const specialAd = player.state.controllers.specialAd?.state?.snapshot()
  const stockAd = player.state.controllers.stockAd?.state?.snapshot()
  const pl = sys.activePlaylist || playlist?.activePlaylist
  const key = [
    pl?.id,
    (pl?.songs || []).length,
    (playlist?.playlists || []).length,
    (playlist?.userPlaylists || []).length,
    (ad?.schedules || []).length,
    (specialAd?.schedules || []).length,
    (stockAd?.schedules || []).length
  ].join('|')
  const cacheValid = key === _scheduleCacheKey && Array.isArray(_scheduleCache)
  const cacheExpired = _scheduleCacheTime && now - _scheduleCacheTime > CACHE_TTL_MS
  if (cacheValid && !cacheExpired) return _scheduleCache

  // Ekranda gösterilecek bir liste zaten varsa, 24 saatlik simülasyonu ASLA ana
  // iş parçacığında çalıştırma. Bu hem TTL dolduğunda hem de programın gerçekten
  // değiştiği durumda geçerli: mevcut liste gösterilmeye devam eder, yeni liste
  // boşta hesaplanır ve hazır olunca requestVPSync ile devreye girer.
  // (Önceden program değişiminde senkron hesaplanıyor ve arayüz donuyordu.)
  // DİKKAT: burada `length > 0` aranmamalı. Bir kez hesaplandıysa (sonuç boş bile
  // olsa) artık ana iş parçacığında tekrar hesaplamıyoruz. Önceden boş sonuç
  // önbelleğe yazılmadığı için, o gün programı olmayan bir işletmede syncState'in
  // her saniyelik turunda yeniden 24 saatlik simülasyon çalışıyor ve arayüz
  // sürekli donuyordu.
  const hasCache = Array.isArray(_scheduleCache)
  if (hasCache) {
    if (!_scheduleRefreshScheduled) {
      _scheduleRefreshScheduled = true
      // Anahtarı yalnızca yenileme planlarken yaz. Zaten bir yenileme sürüyorsa
      // anahtar eski kalır; böylece o yenileme bitince değişiklik tekrar yakalanır.
      _scheduleCacheKey = key
      const doRefresh = () => {
        try {
          const fresh = getUpcomingSchedule(player)
          if (fresh && fresh.length > 0) {
            _scheduleCache = fresh
            if (typeof window !== 'undefined' && window.requestVPSync) window.requestVPSync()
          }
        } catch (_) { /* önbelleği koru */ }
        // Sonuç boş ya da hatalı olsa da zaman damgasını yenile: aksi halde
        // cacheExpired sürekli true kalır ve her saniye yeni bir 24 saatlik
        // simülasyon planlanır (boşta da olsa CPU'yu sürekli meşgul eder).
        _scheduleCacheTime = Date.now()
        _scheduleRefreshScheduled = false
      }
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doRefresh, { timeout: 3000 })
      } else {
        setTimeout(doRefresh, 50)
      }
    }
    return _scheduleCache
  }

  // Buraya yalnızca hayatta bir kez, hiç hesaplanmamışken gelinir.
  // "Yayın akışınız hazırlanıyor" mesajı bu sırada ekranda duruyor.
  _scheduleCacheKey = key
  _scheduleCacheTime = now
  if (Array.isArray(_scheduleCachePrefetch) && _scheduleCachePrefetch.length > 0) {
    _scheduleCache = _scheduleCachePrefetch
    _scheduleCachePrefetch = null
    return _scheduleCache
  }
  let fresh = []
  try {
    fresh = getUpcomingSchedule(player)
  } catch (_) { fresh = [] }
  // Boş sonucu da önbelleğe yaz; bundan sonrası hep ertelenmiş yoldan gider.
  _scheduleCache = (fresh && fresh.length > 0) ? fresh : []
  return _scheduleCache
}
// Yenileme sonrası VP boş dönerse önceki listeyi kaybetmemek için _scheduleCache silinmez; sadece key/süre sıfırlanır
function invalidateScheduleCache() {
  _scheduleCacheKey = null
  _scheduleCacheTime = 0
}

function getDeviceTimeMs() {
  if (typeof Date === 'undefined') return 0
  const now = new Date()
  return now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds()
}

// ——— Gün devri ———
// VirtualPlayer gün sonunda kendini KALICI olarak durdurur: startRealtimeSimulation
// içindeki scheduleNextAdvance, currentTime >= DAY olunca stopRealtimeSimulation()
// çağırıp çıkar ve bir daha planlama yapmaz. Yerel gün değiştiğinde de DAY'e
// ilerletip yeniden planlamadan çıkar. Ayrıca #advance, currentTime === DAY iken
// hemen döner — yani oynatıcı gün sonunda donar.
//
// Referans VirtualPlayerProvider bunu `currentTime === DAY` aboneliğiyle yakalayıp
// startOfDay'i bir gün ilerletiyor ve YENİ bir VirtualPlayer kuruyor. Bu port o
// bloğu atlamıştı: 24 saat açık kalan cihazlarda yayın gün bitince duruyor ve
// ertesi sabah (örn. 08:00) hiç başlamıyordu.
let _activeStartOfDay = null

function resetScheduleCacheForNewDay() {
  _scheduleCacheKey = null
  _scheduleCache = null
  _scheduleCacheTime = 0
  _scheduleCachePrefetch = null
  _scheduleRefreshScheduled = false
}

/**
 * Tek bir yayın günü için oynatıcı kurar.
 * dispose() tüm zamanlayıcı ve abonelikleri bırakır; gün devrinde bunlar
 * temizlenmezse her gün bir kat daha birikirdi.
 */
function buildPlayerForDay(userId, client, persistStorage, startOfDay, carry, onDayEnd) {
  const unsubs = []
  const timers = []

  // DİKKAT: kütüphanede `userVolume` / `userMuted` diye bir alan YOK (grep ile
  // doğrulandı). Ses tek yerden yönetiliyor: playback.desiredVolume ve ondan
  // türeyen system.volume. Gün devrinde taze state kurulunca ikisi de
  // varsayılan 1'e dönüyor ve gece 00:00'da ses %100'e fırlıyordu.
  const carriedVolume = carry && carry.volume != null ? carry.volume : null
  const state = new VirtualPlayerState({
    system: {
      mode: 'cached',
      volume: carriedVolume != null ? carriedVolume : 1
    }
  })

  const player = new VirtualPlayer({ userId, startOfDay, state, maxDeltaTime: 10000 })
  // desiredVolume de taşınmalı: playback.update() her turda
  // system.volume !== desiredVolume ise system.volume'u desiredVolume'a çeker.
  // Yalnızca system.volume yazsaydık ilk tick'te tekrar 1'e dönerdi.
  if (carriedVolume != null) {
    try { player.state.controllers.playback.setDesiredVolume(carriedVolume) } catch (_) {}
  }
  // maxDeltaTime: yerel simülasyon adımı (ağ isteği değil). Ağ: Fetcher 1 dk, presence heartbeat 3 dk.
  // Referans (VirtualPlayerProvider): güne 0'dan başla, sonra startRealtimeSimulation tek sefer getLocalTime() % DAY'e sarar
  player.state.system.unsafeDirectModify({ deltaTime: 0, currentTime: 0 })
  player.use(client, persistStorage)
  player.startRealtimeSimulation()

  // Çalma listesini hızlandır: ilk syncState gelmeden schedule'ı arka planda hesapla
  const doPrefetch = () => {
    // syncState araya girip listeyi zaten hesapladıysa tekrar hesaplama:
    // her hesaplama 24 saatlik senkron simülasyon, yani ikinci bir donma demek.
    if (Array.isArray(_scheduleCache) && _scheduleCache.length > 0) return
    if (Array.isArray(_scheduleCachePrefetch) && _scheduleCachePrefetch.length > 0) return
    try {
      const fresh = getUpcomingSchedule(player)
      if (fresh && fresh.length > 0) _scheduleCachePrefetch = fresh
    } catch (_) {}
  }
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(doPrefetch, { timeout: 200 })
  } else {
    timers.push(setTimeout(doPrefetch, 50))
  }

  if (typeof window !== 'undefined') {
    window.virtualPlayer = player
    window.state = player.state
    window.requestVPSync = syncState
    window.requestVPRefresh = function () {
      invalidateScheduleCache()
      syncState()
    }
  }

  // VP akışı: sadece parça değişince activerecord gönder. Her state tick'te göndermek play() kesintisine yol açar.
  let lastActiveRecordKey = null // 'url' veya url+id; parça değişince güncellenir

  function syncState() {
    const sys = player.state.system.snapshot()
    const playback = player.state.controllers.playback.state.snapshot()
    const playlist = player.state.controllers.playlist ? player.state.controllers.playlist.state.snapshot() : null
    const ad = player.state.controllers.ad ? player.state.controllers.ad.state.snapshot() : null
    const specialAd = player.state.controllers.specialAd ? player.state.controllers.specialAd.state.snapshot() : null
    const stockAd = player.state.controllers.stockAd ? player.state.controllers.stockAd.state.snapshot() : null
    const upcomingSchedule = getUpcomingScheduleCached(player)
    const deviceTimeMs = getDeviceTimeMs()

    let next = snapshotToPlayerState(sys, playback, playlist, ad, specialAd, stockAd, upcomingSchedule, deviceTimeMs)
    // Yenileme sırasında yayın kesilmesin: yeni veri "yayın dışı" veya liste boş dönüyorsa, çalıyorsak önceki listeyi ve parçayı koru
    if (typeof window !== 'undefined' && window.playerState) {
      const hadRecord = window.playerState.activeRecord && window.playerState.activeRecord.audio && window.playerState.activeRecord.audio.url
      const hadList = window.playerState.playlist && window.playerState.playlist.length > 0
      const newSaysOff = !next.activeRecord || !next.activeRecord.audio || !next.activeRecord.audio.url
      const newListEmpty = !next.playlist || next.playlist.length === 0
      if (hadRecord && hadList && (newSaysOff || newListEmpty)) {
        next = Object.assign({}, next, {
          activeRecord: window.playerState.activeRecord,
          playlist: window.playerState.playlist,
          currentTrackIndex: window.playerState.currentTrackIndex,
          ads: window.playerState.ads != null ? window.playerState.ads : next.ads
        })
      }
      Object.assign(window.playerState, next)
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('virtualplayer-state', { detail: next }))
    }

    const rec = next.activeRecord
    const hasRecord = rec && rec.audio && rec.audio.url
    const trackKey = hasRecord ? (rec.audio.url + '|' + (rec.id || '')) : null

    if (trackKey !== lastActiveRecordKey && typeof window !== 'undefined') {
      lastActiveRecordKey = trackKey
      if (hasRecord) {
        const curIdx = next.currentTrackIndex >= 0 ? next.currentTrackIndex : 0
        const pl = next.playlist || []
        const artworkUrl = (rec.album && rec.album.coverUrl) || (pl[curIdx] && pl[curIdx].artworkUrl) || null
        const startTimeMs = rec.startTime != null ? rec.startTime : 0
        const currentOffset = Math.max(0, (deviceTimeMs - startTimeMs) / 1000)
        // Cihaz saati ms → parça içindeki offset; renderer aynı mantıkla başlatır
        const durationMs = (rec.audio && rec.audio.duration) ? rec.audio.duration : 0
        window.dispatchEvent(new CustomEvent('virtualplayer-activerecord', {
          detail: {
            url: rec.audio.url,
            startTime: startTimeMs / 1000,
            startTimeMs,
            durationMs,
            duration: rec.audio.duration / 1000,
            name: rec.name,
            type: rec.type,
            artworkUrl,
            currentOffset
          }
        }))
      } else {
        window.dispatchEvent(new CustomEvent('virtualplayer-activerecord', { detail: {} }))
      }
    }
  }

  // Referans (use-virtual-player): selector değişen değeri döndürmeli; () => true callback'ı tetiklemez (equals aynı kalır).
  const systemSelector = (s) => ({ activeRecord: s.activeRecord, currentTime: s.currentTime })
  unsubs.push(player.state.system.subscribe(systemSelector, syncState, { notifyInSync: true }))
  const playbackSelector = (s) => ({ songPlayState: s.songPlayState, historyLength: (s.history && s.history.length) || 0 })
  unsubs.push(player.state.controllers.playback.state.subscribe(playbackSelector, syncState, { notifyInSync: true }))
  if (player.state.controllers.playlist && player.state.controllers.playlist.state) {
    unsubs.push(player.state.controllers.playlist.state.subscribe((s) => s.activePlaylist, syncState, { notifyInSync: true }))
    unsubs.push(player.state.controllers.playlist.state.subscribe((s) => (s.playlists && s.playlists.length) || 0, syncState, { notifyInSync: true }))
  }
  if (player.state.controllers.ad && player.state.controllers.ad.state) {
    unsubs.push(player.state.controllers.ad.state.subscribe((s) => (s.schedules && s.schedules.length) || 0, syncState, { notifyInSync: true }))
  }
  if (player.state.controllers.specialAd && player.state.controllers.specialAd.state) {
    unsubs.push(player.state.controllers.specialAd.state.subscribe((s) => (s.schedules && s.schedules.length) || 0, syncState, { notifyInSync: true }))
  }
  if (player.state.controllers.stockAd && player.state.controllers.stockAd.state) {
    unsubs.push(player.state.controllers.stockAd.state.subscribe((s) => (s.schedules && s.schedules.length) || 0, syncState, { notifyInSync: true }))
  }

  // Gün sonu tetikleyicisi HER gün için kurulmalı; yalnızca ilk oynatıcıya
  // bağlanırsa devirden sonraki günlerde çalışmaz.
  if (typeof onDayEnd === 'function') {
    unsubs.push(player.state.system.subscribe(
      (s) => s.currentTime >= DAY,
      (isDayEnd) => {
        if (!isDayEnd) return
        // ÖNEMLİ: bu abonelik notifyInSync olduğu için #advance döngüsünün
        // içinden, state.commit() sırasında senkron çağrılıyor. Devri burada
        // yapmak, çalışmakta olan simülasyonun oynatıcısını kendi içinden yok
        // etmek demek. Bir sonraki makro göreve bırakıyoruz.
        setTimeout(onDayEnd, 0)
      },
      { notifyInSync: true }
    ))
  }

  const dispose = () => {
    timers.forEach((t) => { try { clearTimeout(t); clearInterval(t) } catch (_) {} })
    timers.length = 0
    unsubs.forEach((fn) => { try { typeof fn === 'function' && fn() } catch (_) {} })
    unsubs.length = 0
    try { player.stopRealtimeSimulation() } catch (_) {}
  }

  // Referans (React): periyodik fastForwardTo yok; VP startRealtimeSimulation() içinde tek sefer getLocalTime() % DAY'e sarıyor, sonra setTimeout ile senkron kalıyor.
  const ready = player.readyPromise.then(() => {
    syncState()
    timers.push(setTimeout(syncState, 500))
    timers.push(setTimeout(syncState, 1500))
    timers.push(setInterval(syncState, 1000))
    timers.push(setInterval(function () {
      // DİKKAT: burada _scheduleCacheTime = 0 yazılıyordu. 0 falsy olduğu için
      // getUpcomingScheduleCached'deki `cacheExpired` kontrolü false kalıyor,
      // ertelenmiş yenileme yolu atlanıyor ve fastForwardTo(DAY) — yani 24
      // saatlik simülasyon — ana iş parçacığında senkron çalışıyordu. Sonuç:
      // her 5 dakikada bir arayüz (saat dahil) donuyordu.
      // 1 yazınca cache "çok eski" sayılır ve yenileme requestIdleCallback'e alınır.
      _scheduleCacheTime = 1
      syncState()
    }, 5 * 60 * 1000))
    return player
  })

  return { player, dispose, ready }
}

async function initVirtualPlayer(userId) {
  if (!userId) return Promise.reject(new Error('userId gerekli'))

  // Service Worker'ı hemen aktifleştir: parçalar locale cache'ten çalınsın, ağ gecikmesi olmasın
  try {
    await FileCacheManager.activate()
  } catch (e) {
    console.warn('[VP] FileCacheManager.activate:', e)
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  })

  const indexedDBStorage = createIndexedDBStorage()
  const persistStorage = createJSONStorage(() => indexedDBStorage)
  if (!persistStorage) return Promise.reject(new Error('persistStorage oluşturulamadı'))

  let current = null
  let rolling = false

  function startDay(startOfDay, carry) {
    if (current) {
      try { current.dispose() } catch (_) {}
      current = null
    }
    // Yeni günün akışı sıfırdan hesaplansın; dünün listesi taşınmasın.
    resetScheduleCacheForNewDay()
    _activeStartOfDay = startOfDay
    current = buildPlayerForDay(userId, client, persistStorage, startOfDay, carry, maybeRollOver)
    return current.ready
  }

  // Gün gerçekten değiştiyse oynatıcıyı yeniden kur.
  // Yerel gün kontrolü şart: simülasyon yerel gece yarısından birkaç ms önce
  // DAY'e ulaşırsa, tarih hâlâ eski gün olacağı için koşulsuz yeniden kurmak
  // sonsuz döngü yaratırdı.
  /** Çalmakta olan parçadan geriye kalan süre (ms). Yoksa 0. */
  function playingRemainingMs() {
    try {
      if (typeof document === 'undefined') return 0
      const a = document.getElementById('app-audio')
      if (!a || !a.src) return 0
      const dur = (typeof window !== 'undefined' && window._trackDurationSec != null)
        ? window._trackDurationSec
        : (a.duration && !isNaN(a.duration) ? a.duration : 0)
      if (!dur) return 0
      const rem = (dur - a.currentTime) * 1000
      return rem > 0 ? rem : 0
    } catch (_) {
      return 0
    }
  }

  function maybeRollOver() {
    if (rolling) return
    const today = getLocalStartOfDay()
    if (_activeStartOfDay != null && today === _activeStartOfDay) return

    // 00:00'dan önce başlamış parça yarıda kesilmesin: devri parça bitene kadar
    // ertele. Bu sürede eski oynatıcı gün sonunda durmuş durumda, ses çalmaya
    // devam ediyor. Üst sınır, bozuk süre bilgisinde sonsuz ertelemeyi önler.
    const remaining = playingRemainingMs()
    if (remaining > 1000) {
      rolling = true
      setTimeout(() => { rolling = false; maybeRollOver() }, Math.min(remaining + 500, 15 * 60 * 1000))
      return
    }

    rolling = true
    let carry = null
    try {
      const sys = current && current.player.state.system.snapshot()
      const pb = current && current.player.state.controllers.playback.state.snapshot()
      // desiredVolume asıl kaynak; yoksa system.volume.
      const v = (pb && pb.desiredVolume != null) ? pb.desiredVolume : (sys ? sys.volume : null)
      if (v != null) carry = { volume: v }
    } catch (_) {}
    startDay(today, carry)
      .catch((e) => console.warn('[VP] gün devri:', e))
      .then(() => { rolling = false }, () => { rolling = false })
  }

  // Tetikleyici 1: simülasyon gün sonuna ulaştı.
  // Tetikleyici 2: dakikalık kontrol — DAY olayı kaçarsa, cihaz uykuya girip
  // uyanırsa veya saat elle değiştirilirse yine de yakalanır.
  const dayWatch = setInterval(maybeRollOver, 60 * 1000)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      clearInterval(dayWatch)
      if (current) { try { current.dispose() } catch (_) {} }
    })
  }

  return startDay(getLocalStartOfDay(), null)
}

if (typeof window !== 'undefined') {
  window.initVirtualPlayer = initVirtualPlayer
}
// snapshotToPlayerState test edilebilsin diye disa aciliyor (IIFE derlemesinde davranisi degistirmez)
export { initVirtualPlayer, snapshotToPlayerState }
