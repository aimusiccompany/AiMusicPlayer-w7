/**
 * Setup uygulamasından Virtual Player paketini node_modules'a kopyalar.
 * Kullanım: node scripts/copy-vp-from-setup.js [Setup klasör yolu]
 * Örnek: node scripts/copy-vp-from-setup.js "C:\Users\Muham\Downloads\AI Music Player Setup 1.0.37"
 */
const fs = require('fs');
const path = require('path');

const setupPath = process.argv[2] || process.env.COPY_VP_FROM;
const unpackedPath = setupPath
  ? path.join(setupPath, 'resources', 'app-unpacked', 'node_modules', '@ai-music-corp', 'virtual-player')
  : null;
const destDir = path.join(__dirname, '..', 'node_modules', '@ai-music-corp', 'virtual-player');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

if (!unpackedPath || !fs.existsSync(unpackedPath)) {
  console.error('Kullanım: node scripts/copy-vp-from-setup.js "C:\\...\\AI Music Player Setup 1.0.37"');
  console.error('Veya COPY_VP_FROM ortam değişkeni ile Setup klasör yolunu verin.');
  process.exit(1);
}

if (!fs.existsSync(path.join(__dirname, '..', 'node_modules'))) {
  fs.mkdirSync(path.join(__dirname, '..', 'node_modules'), { recursive: true });
}
if (!fs.existsSync(path.join(__dirname, '..', 'node_modules', '@ai-music-corp'))) {
  fs.mkdirSync(path.join(__dirname, '..', 'node_modules', '@ai-music-corp'), { recursive: true });
}

if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true });
}
copyRecursive(unpackedPath, destDir);
console.log('@ai-music-corp/virtual-player kopyalandı:', destDir);
