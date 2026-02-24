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
const mapSource = path.join(vpDist, 'file-cache-manager-sw.js.map');
const mapDest = path.join(appRoot, 'file-cache-manager-sw.js.map');

if (!fs.existsSync(swSource)) {
  console.error('Service worker kaynağı bulunamadı:', swSource);
  console.error('Önce: npm install');
  process.exit(1);
}

fs.copyFileSync(swSource, swDest);
console.log('Service worker kopyalandı:', swDest);
if (fs.existsSync(mapSource)) {
  fs.copyFileSync(mapSource, mapDest);
  console.log('Source map kopyalandı:', mapDest);
}
console.log('Uygulama çalıştığında /file-cache-manager-sw.js olarak sunulacak.');
