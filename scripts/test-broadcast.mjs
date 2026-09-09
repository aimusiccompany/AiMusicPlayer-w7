/**
 * Yayın akışı regresyon testleri.
 *
 * Çalıştırma:  npm test
 *
 * Buradaki mantık (gün devri, çalan parçadan devam, ses seviyesi) müşteri
 * tarafında doğrudan yayını etkiliyor ve geçmişte birkaç kez sessizce kırıldı.
 * Değişiklik yapmadan önce ve sonra bu testleri çalıştırın.
 */
import { VirtualPlayerState } from '../node_modules/@ai-music-corp/virtual-player/dist/virtual-player-state.js';
import { snapshotToPlayerState } from '../src/vp-init.js';

let gecti = 0;
let kaldi = 0;

function kontrol(ad, kosul, detay) {
  if (kosul) {
    gecti++;
    console.log('  GECTI  ' + ad);
  } else {
    kaldi++;
    console.log('  KALDI  ' + ad + (detay ? '  -> ' + detay : ''));
  }
}

const hms = (h, m, s = 0) => h * 3600000 + m * 60000 + s * 1000;

const sarkiA = {
  id: 'A', type: 'song', name: 'Onceki Sarki',
  startTime: hms(9, 12), endTime: hms(9, 19),
  audio: { url: 'https://x/a.mp3', duration: hms(0, 7) }, album: { name: 'Alb', coverUrl: null }
};
const reklam = {
  id: 'R', type: 'ad', name: 'Reklam',
  startTime: hms(9, 19), endTime: hms(9, 23, 33),
  audio: { url: 'https://x/r.mp3', duration: hms(0, 4, 33) }
};
const sarkiX = {
  id: 'X', type: 'song', name: 'X Sarkisi',
  startTime: hms(9, 23, 33), endTime: hms(9, 30, 33),
  audio: { url: 'https://x/x.mp3', duration: hms(0, 7) }, album: { name: 'Alb', coverUrl: null }
};
const akis = [sarkiA, reklam, sarkiX];

// ---------------------------------------------------------------------------
console.log('\n1) Yeniden baslatinca o an calan parcadan devam');
// Regresyon: getUpcomingSchedule klondan sonra history'yi temizliyordu; o an
// calan kayit listeye hic girmiyor ve siradaki parcanin saati bekleniyordu.
{
  const out = snapshotToPlayerState(
    { activeRecord: null }, { songPlayState: 'playing' }, null, null, null, null,
    akis, hms(9, 26)
  );
  kontrol('09:26 -> X Sarkisi secildi',
    out.activeRecord && out.activeRecord.id === 'X',
    out.activeRecord && out.activeRecord.id);
  kontrol('offset 2:27 (147 sn)', out.currentTime === 147, out.currentTime + ' sn');
  kontrol('calan index 2', out.currentTrackIndex === 2, String(out.currentTrackIndex));
  kontrol('liste gunun tamami (3 kayit)', out.playlist.length === 3, String(out.playlist.length));
}

// ---------------------------------------------------------------------------
console.log('\n2) Akis siniri durumlari');
{
  // Yayin baslamadan once: calan kayit yok ama liste dolu olmali
  const once = snapshotToPlayerState({}, {}, null, null, null, null, akis, hms(8, 0));
  kontrol('Yayin oncesi calan kayit yok', once.activeRecord === null);
  kontrol('Yayin oncesi liste yine de dolu', once.playlist.length === 3, String(once.playlist.length));

  // Tam parca sinirinda (X'in ilk ms'i)
  const sinir = snapshotToPlayerState({}, {}, null, null, null, null, akis, hms(9, 23, 33));
  kontrol('Parca basi sinirinda X secildi', sinir.activeRecord && sinir.activeRecord.id === 'X');
  kontrol('Parca basinda offset 0', sinir.currentTime === 0, String(sinir.currentTime));

  // Son kayit bittikten sonra: yayin bitti
  const sonra = snapshotToPlayerState({}, {}, null, null, null, null, akis, hms(23, 0));
  kontrol('Yayin bitince calan kayit yok', sonra.activeRecord === null);
}

// ---------------------------------------------------------------------------
console.log('\n3) clone() history\'yi koruyor, mukerrer kayit uretmiyor');
// getUpcomingSchedule artik history'yi temizlemiyor; bu ancak klonlama mukerrer
// kayit uretmiyorsa guvenli.
{
  const rec = {
    id: 'A', type: 'song', startTime: hms(9, 12), endTime: hms(9, 19),
    name: 'Calan', audio: { url: 'https://x/a.mp3', duration: hms(0, 7) }
  };
  const st = new VirtualPlayerState({
    system: { userId: 'u', currentTime: hms(9, 15), deltaTime: 0, activeRecord: rec, mode: 'streaming' },
    controllers: { playback: { history: [rec], songQueue: [], nextSongIndex: 0, songPlayState: 'playing' } }
  });
  const oncekiUzunluk = st.controllers.playback.state.snapshot().history.length;
  const klon = st.clone();
  const sonrakiUzunluk = klon.controllers.playback.state.snapshot().history.length;
  kontrol('history klonda korunuyor', sonrakiUzunluk === oncekiUzunluk && sonrakiUzunluk === 1,
    oncekiUzunluk + ' -> ' + sonrakiUzunluk);
  kontrol('calan kayit klonda mevcut',
    klon.controllers.playback.state.snapshot().history[0].id === 'A');
}

// ---------------------------------------------------------------------------
console.log('\n4) Gun devrinde ses seviyesi korunuyor');
// Regresyon: gece 00:00'da ses %50 iken %100'e firliyordu. Kutuphanede
// userVolume/userMuted diye bir alan YOK; ses system.volume + desiredVolume.
{
  const SES = 0.5;

  const yanlis = new VirtualPlayerState({ system: { mode: 'cached', userMuted: false, userVolume: SES } });
  kontrol('userVolume yok sayiliyor (eski hata ureniyor)',
    yanlis.system.snapshot().volume === 1, String(yanlis.system.snapshot().volume));

  const dogru = new VirtualPlayerState({ system: { mode: 'cached', volume: SES } });
  dogru.controllers.playback.setDesiredVolume(SES);
  kontrol('system.volume tasiniyor', dogru.system.snapshot().volume === SES);
  // desiredVolume de yazilmali: playback.update() her turda system.volume'u
  // desiredVolume'a cekiyor; yazilmazsa ilk tick sesi 1'e geri dondururdu.
  kontrol('desiredVolume tasiniyor',
    dogru.controllers.playback.state.snapshot().desiredVolume === SES);
}

// ---------------------------------------------------------------------------
console.log('\n' + gecti + ' gecti, ' + kaldi + ' kaldi');
process.exit(kaldi === 0 ? 0 : 1);
