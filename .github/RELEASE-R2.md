# Release → R2 Otomatik Yükleme

**Repo:** [aimusiccompany/AiMusicPlayer-w7](https://github.com/aimusiccompany/AiMusicPlayer-w7)

GitHub’da bu repoda yeni bir **Release** yayınladığınızda (`release: published`) workflow çalışır: uygulama build edilir ve çıktılar **Cloudflare R2** bucket’ına yüklenir.

## Gerekli GitHub Secrets

Repoda **Settings → Secrets and variables → Actions** altında şu secret’ları tanımlayın:

| Secret | Açıklama |
|--------|----------|
| `R2_ACCOUNT_ID` | Cloudflare hesap ID (R2 dashboard) |
| `R2_ACCESS_KEY_ID` | R2 API token – Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token – Secret Access Key |
| `R2_BUCKET` | R2 bucket adı (örn. `updates`) |

**Mevcut token kullanımı:** Cloudflare’da daha önce oluşturduğunuz, **updates** bucket’ına (veya tüm bucket’lara) **Object Read & Write** yetkisi olan bir token (örn. "R2 User Token", "Electron Forge Publisher") kullanabilirsiniz. Token oluştururken verilen **Access Key ID** ve **Secret Access Key** değerlerini sırasıyla `R2_ACCESS_KEY_ID` ve `R2_SECRET_ACCESS_KEY` secret’larına yazın; bucket adını da `R2_BUCKET` olarak girin (örn. `updates`). Secret Access Key yalnızca token oluşturma anında gösterilir — kaydettiyseniz aynı token’ı kullanın, kaybettiyseniz yeni token oluşturup secret’ları onunla güncellemeniz gerekir.

**Opsiyonel (GitHub Packages için):** `@ai-music-corp` paketleri private ise:

| Secret | Açıklama |
|--------|----------|
| `NPM_TOKEN` | GitHub Personal Access Token (scope: `read:packages`) |

## R2 Tarafında

1. **Bucket:** Zaten **updates** (veya kullandığınız bucket) varsa yeni oluşturmanız gerekmez. Workflow dosyaları bucket içinde `updates/` prefix’i altına yüklenir (`latest.yml`, kurulum `.exe` vb.).
2. **Erişim:** Uygulama güncellemeleri bu dosyaları indireceği için bucket’ı **public** yapın veya **Custom Domain** (örn. `api.aimusic.com.tr`) bağlayıp public erişim verin.
3. **URL:** `package.json` içindeki `build.publish[].url` (örn. `https://api.aimusic.com.tr/updates`) bu adrese işaret etmeli; böylece `latest.yml` adresi `https://api.aimusic.com.tr/updates/latest.yml` olur.

## Nasıl Release Çıkarılır?

### Otomatik (önerilen)

1. GitHub’da repoya gidin → **Actions** sekmesi.
2. Sol menüden **"Release: Create & Publish"** workflow’unu seçin.
3. **Run workflow** → **version** alanına sürüm yazın (örn. `1.1.3`) → **Run workflow**.
4. Workflow: `package.json` sürümünü günceller, commit/tag atar, GitHub Release oluşturur. Release yayınlanınca **Build & Upload to R2 on Release** otomatik çalışır ve dosyalar R2’ye gider.

### Manuel

1. `package.json` içinde `version` değerini artırın (örn. `1.1.3`).
2. Değişiklikleri commit edip push edin.
3. **Releases → Create a new release** ile tag `v1.1.3` ve release oluşturup **Publish** deyin.
4. **Build & Upload to R2** otomatik çalışır; dosyalar R2’de `updates/` altında olur.

## Workflow Dosyaları

- `.github/workflows/release-publish.yml` — Manuel tetikle (Release: Create and Publish): sürüm günceller, tag + release oluşturur (tek tıkla release).
- `.github/workflows/release-r2.yml` — Release yayınlandığında tetiklenir, build alır ve R2’ye yükler.
