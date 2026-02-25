/**
 * Service Worker dosyasını node_modules'dan uygulama köküne kopyalar.
 * FileCacheManager (VP) /file-cache-manager-sw.js adresinde SW arar; yerel sunucu bu dosyayı sunar.
 * Çalıştırma: npm run setup:sw  veya  node scripts/setup-service-worker.js
 */
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const vpDist = path.join(appRoot, 'node_modules', '@ai-music-corp', 'virtual-player', 'dist');
const swSource = path.join(vpDist, 'file-cache-manager-sw.js');
const swDest = path.join(appRoot, 'file-cache-manager-sw.js');

if (!fs.existsSync(swSource)) {
  console.error('Service worker kaynağı bulunamadı:', swSource);
  console.error('Önce: npm install');
  process.exit(1);
}

fs.copyFileSync(swSource, swDest);
let swContent = fs.readFileSync(swDest, 'utf8');
// Source map referansini kaldir; .map dosyasi paketlenmez, 404 uyarisi olmasin
if (swContent.includes('sourceMappingURL') || swContent.includes('sourceMappingURL=')) {
  swContent = swContent.replace(/\n?\/\/#\s*sourceMappingURL=.*$/m, '').trimEnd();
  fs.writeFileSync(swDest, swContent);
}
console.log('Service worker kopyalandi:', swDest);
// .map kopyalama; DevTools 404 vermesin
console.log('Uygulama calistiginda /file-cache-manager-sw.js olarak sunulacak.');
