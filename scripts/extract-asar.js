const asar = require('@electron/asar');
const path = require('path');
const root = path.join(__dirname, '..');
const asarPath = path.join(root, 'reference', 'app.asar');
const outPath = path.join(root, 'reference-app');
asar.extractAll(asarPath, outPath);
console.log('Extracted to', outPath);
