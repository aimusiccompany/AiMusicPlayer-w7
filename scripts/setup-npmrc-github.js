/**
 * GitHub Packages için .npmrc oluşturur (GITHUB_TOKEN ile).
 * Kullanım: set GITHUB_TOKEN=ghp_... && node scripts/setup-npmrc-github.js
 * Sonra: npm install
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const example = path.join(root, '.npmrc.example');
const npmrc = path.join(root, '.npmrc');
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('GITHUB_TOKEN ortam degiskeni set edin. Ornek: set GITHUB_TOKEN=ghp_...');
  process.exit(1);
}

let content = '';
if (fs.existsSync(example)) {
  content = fs.readFileSync(example, 'utf8').trimEnd() + '\n';
}
content += '//npm.pkg.github.com/:_authToken=' + token + '\n';

fs.writeFileSync(npmrc, content, 'utf8');
console.log('.npmrc olusturuldu (GitHub Packages auth). npm install calistirabilirsiniz.');
