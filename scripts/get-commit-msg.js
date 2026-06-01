/**
 * package.json sürümüne göre commit mesajı üretir: "chore: v1.1.4"
 */
const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
console.log('chore: v' + pkg.version);
