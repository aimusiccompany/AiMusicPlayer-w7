# AI Music Player

Electron 22.3.27 ile geliştirilmiş, koyu temalı müzik oynatıcı. E-posta/şifre ile giriş (Supabase), Virtual Player entegrasyonu için hazır yapı.

## Gereksinimler

- Node.js (v14+ önerilir)
- Windows 7+ (Electron 22.x desteği)

## Kurulum

```bash
npm install
```

## Çalıştırma

```bash
npm start
```

Uygulama önce **giriş ekranı** (login) ile açılır. Geçerli e-posta ve şifre ile giriş yaptıktan sonra ana oynatıcı arayüzüne geçilir.

## Giriş ekranı

- **E-posta** ve **Şifre** alanları
- **Şifreyi göster / Gizle** butonu
- **Giriş Yap** ile Supabase (`api.aimusic.com.tr`) üzerinden oturum açılır
- Altta **uygulama sürümü** (package.json `version`) gösterilir

## Yapı

- **main.js** – Electron ana süreç, önce `login.html` yüklenir; IPC: `get-app-version`, `navigate-to-app`, `navigate-to-login`
- **preload.js** – `electronAPI`: getAppVersion, navigateToApp, navigateToLogin
- **login.html / login.css / login.js** – Giriş sayfası (Supabase CDN ile auth)
- **index.html** – Ana sayfa: sidebar, çalma listesi, reklam paneli, alt oynatıcı
- **renderer.js** – Oturum kontrolü (yoksa login’e yönlendirme), kullanıcı bilgisi (users tablosu: konum), `playerState`, UI güncellemeleri, Çıkış Yap (signOut + login’e dön)

## Virtual Player (referans)

Referans uygulama (AI Music Player Setup 1.0.37) yapısı:

- **Giriş:** Supabase `signInWithPassword` → session → `userId = session.user.id`
- **VirtualPlayer** (`@ai-music-corp/virtual-player`): `userId`, Supabase client ve persistStorage ile oluşturuluyor; `state.system` (userId, userInfo.location, currentTime, volume), `state.controllers.playback` (songQueue, nextSongIndex, activeRecord), `state.controllers.playlist` (playlists, userPlaylists), `state.controllers.ad` / specialAd / stockAd (reklam zaman çizelgeleri) kullanılıyor.
- **Veri:** Kullanıcı bilgisi `users` (country, city, district, preferences), çalma listeleri ve reklamlar API/RPC ile çekiliyor.

## Virtual Player root akışı (Provider benzeri)

Giriş sonrası **userId** ile Virtual Player başlatılır; akış real-time modda gelir, **activeRecord** o an çalınacak kaydı verir.

- **Root kurulum:** `client` (Supabase) + `persistStorage` (localStorage tabanlı JSON storage) + `VirtualPlayer({ userId })` → `player.use(client, persistStorage)` → `player.startRealtimeSimulation()`.
- **Akış:** VP state aboneliği (system + playback + playlist) → `window.playerState` ve `virtualplayer-state` / `virtualplayer-activerecord` event’leri.
- **Oynatma:** `virtualplayer-activerecord` ile gelen `url` → `<audio>` ile çalınır; liste ve ilerleme `virtualplayer-state` ile güncellenir.

Gerçek VP bundle’ı oluşturmak için:

1. `@ai-music-corp/virtual-player` paketini kurun (Setup uygulamasının `resources/app-unpacked/node_modules/@ai-music-corp/virtual-player` klasörünü bu projenin `node_modules/@ai-music-corp/` altına kopyalayabilir veya private registry kullanabilirsiniz).
2. `npm install` (esbuild vb. için).
3. `npm run build` → `app.js` oluşur (VP + renderer tek dosya; kaynak: `src/vp-init.js` + `renderer.js`). Ana sayfa sadece `app.js` yükler.

## Windows kurulum paketi (Setup)

Tek bir kurulum dosyası hem **32 bit (ia32)** hem **64 bit (x64)** Windows için kullanılır; kurulum sırasında sistem mimarisi otomatik seçilir.

```bash
npm install
npm run dist
```

Çıktı: `dist/` klasöründe **AI Music Player Setup 1.0.0.exe** (evrensel NSIS kurulumu).

- **npm run dist** — 32 ve 64 bit tek setup üretir.
- **npm run dist:64** — Sadece 64 bit.
- **npm run dist:32** — Sadece 32 bit.

Kurulumda klasör seçilebilir, kısayol oluşturulur, Türkçe dil kullanılır. İkon için `Assets/icon.ico` ekleyebilirsiniz (opsiyonel).
