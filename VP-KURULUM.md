# Virtual Player Kurulumu (102.18.3)

Virtual Player **GitHub Packages** npm registry'den kurulur: [@ai-music-corp/virtual-player](https://github.com/AI-Music-Corp/backend/pkgs/npm/virtual-player) **102.18.3**.

## 1. Token ve .npmrc

GitHub Packages için [Personal Access Token](https://github.com/settings/tokens) gerekir (scope: `read:packages`). Token’ı repoya yazmayın.

**PowerShell:**
```powershell
$env:GITHUB_TOKEN = "ghp_..."
npm run setup:vp-auth
```

**CMD:**
```cmd
set GITHUB_TOKEN=ghp_...
npm run setup:vp-auth
```

`setup:vp-auth` script’i `GITHUB_TOKEN` ile proje klasöründe `.npmrc` oluşturur (`.npmrc` gitignore’da olduğu için commit edilmez). Bunu **her clone’dan sonra veya token değişince** bir kez çalıştırın; ardından `npm install` çalışır.

## 2. Kurulum

```bash
npm install
npm run build:vp
```

`vp-bundle.js` oluşur; uygulama çalma listesi ve oynatmayı bu bundle üzerinden kullanır.

## Özet

| Adım | Açıklama |
|------|----------|
| `GITHUB_TOKEN` set et | GitHub Packages okuma yetkisi |
| `npm install` | @ai-music-corp/virtual-player@102.18.3 yüklenir |
| `npm run build:vp` | vp-bundle.js üretilir |

**Alternatif (Setup’tan kopyalama):** Daha önce oluşturduğunuz kurulumda VP varsa:
```bash
npm run copy:vp -- "C:\...\AI Music Player Setup 1.0.37"
npm run build:vp
```

---

**Güvenlik:** Token’ı sohbet veya ekran paylaşımında kullandıysanız iptal edin; yeni token oluşturup sadece kendi ortamınızda kullanın.
