# Sürüm Yayınlama

**Repo:** [aimusiccompany/AiMusicPlayer-w7](https://github.com/aimusiccompany/AiMusicPlayer-w7)

Uygulamalar güncellemeyi **GitHub Releases** üzerinden alır. Kaynak tek:
`main.js` içindeki `setFeedURL({ provider: 'github', owner: 'aimusiccompany', repo: 'AiMusicPlayer-w7' })`.

Cloudflare R2 artık kullanılmıyor; ilgili workflow ve dokümantasyon kaldırıldı.

## Bir Release'de bulunması gereken üç dosya

| Dosya | Neden gerekli |
|---|---|
| `AI.Music.Player.Setup.<sürüm>.exe` | Kurulum paketi (32+64 bit tek installer) |
| `AI.Music.Player.Setup.<sürüm>.exe.blockmap` | Fark bazlı indirme. Yoksa her güncelleme 130+ MB tam indirmeye düşer |
| `latest.yml` | Güncelleme feed'i. `electron-updater` önce bunu okur |

> **Kritik:** `latest.yml` içindeki `sha512`, yüklenen `.exe` ile birebir aynı olmalıdır.
> Uyuşmazsa `electron-updater` indirmeyi reddeder ve güncelleme **sessizce** kırılır.
> Bu yüzden exe ile `latest.yml` **aynı derlemeden** gelmeli ve dosyalar **tek bir
> kaynaktan** yüklenmelidir. Derlemeler bayt bazında tekrarlanabilir değildir:
> aynı sürümü yeniden derleyip yalnızca exe'yi değiştirmek feed'i bozar.

## Yöntem 1 — GitHub Actions (önerilen)

1. Repo → **Actions** → **"Release: Create and Publish"**
2. **Run workflow** → `version` alanına sürüm (örn. `1.1.38`) → **Run workflow**

Workflow sırasıyla: sürüm biçimini ve tag çakışmasını denetler, `npm ci` + build yapar,
kurulum paketini derler (`--publish never`), `latest.yml` ↔ exe sha512 tutarlılığını
doğrular, sürümü commit'leyip tag atar, Release oluşturup üç dosyayı yükler ve son
olarak yayın feed'inin gerçekten yeni sürümü gösterdiğini doğrular.

## Yöntem 2 — Yerel (`release-github.bat`)

Geliştirme makinesinden çift tıkla çalıştırılır. Sürümü otomatik yükseltir, `npm ci`
ve build yapar, derler, commit + tag atar, `gh` ile Release oluşturup dosyaları yükler.

Gereksinimler: `git`, `node`, `npm`, GitHub CLI (`gh auth login` yapılmış olmalı).

## Gerekli GitHub Secret

| Secret | Açıklama |
|---|---|
| `NPM_TOKEN` | `@ai-music-corp/virtual-player` GitHub Packages'ta private. **classic** PAT, kapsam: `read:packages` |

`GITHUB_TOKEN` bu iş için **kullanılamaz**: repo `aimusiccompany` altında, paket ise
`ai-music-corp` org'una ait; repo kapsamlı token başka bir org'un paketlerine erişemez.

PAT'lerin süresi dolar. `npm ci` adımı `401 Unauthorized` veriyorsa ilk bakılacak yer
budur — hem repo secret'ı hem de geliştirme makinesindeki `.npmrc` yenilenmelidir.

Yerel kontrol:

```bash
npm view @ai-music-corp/virtual-player version
```

## Yayın sonrası doğrulama

Müşterilerin gördüğü adres kimlik doğrulaması olmadan erişilebilmelidir:

```bash
curl -sSL https://github.com/aimusiccompany/AiMusicPlayer-w7/releases/latest/download/latest.yml
```

Dönen `version` yeni sürüm olmalı ve `sha512` Release'deki exe ile eşleşmelidir.

## Güncelleme davranışı

- Kontrol açılıştan 5 sn sonra, ardından **30 dakikada bir** (`main.js`)
- İndirme otomatik; bitince arayüzde "Güncelleme Hazır" modalı çıkar
- Kullanıcı ertelerse güncelleme uygulama kapanırken kurulur (`autoInstallOnAppQuit`)
- **1.1.34 ve öncesi kurulumlar kendini güncelleyemez** (o paketlerde `electron-updater`
  modülü hiç yoktu). O cihazlara güncel sürüm bir kez elle kurulmalıdır.
