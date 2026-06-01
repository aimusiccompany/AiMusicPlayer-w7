/**
 * package.json sürümünü yükseltir: 1.1.3 -> 1.1.4
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
let content = fs.readFileSync(pkgPath, 'utf8');
const match = content.match(/"version"\s*:\s*"([^"]+)"/);
if (!match) process.exit(1);
const parts = match[1].split('.');
parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
const newVer = parts.join('.');
content = content.replace(/"version"\s*:\s*"[^"]+"/, '"version":"' + newVer + '"');
fs.writeFileSync(pkgPath, content, 'utf8');
console.log('Sürüm: ' + newVer);
