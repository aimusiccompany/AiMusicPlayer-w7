/**
 * GitHub özel repo için git URL ayarı (npm install öncesi).
 * GITHUB_TOKEN ortam değişkeni set edilmişse HTTPS ile clone için kullanılır.
 * Kullanım: set GITHUB_TOKEN=ghp_xxx && node scripts/git-auth-github.js
 * Token'ı .env veya ortam değişkeninde tutun; asla repoya commit etmeyin.
 */
const { execSync } = require('child_process');
const path = require('path');
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.warn('GITHUB_TOKEN set edilmedi. Özel repo için: set GITHUB_TOKEN=ghp_...');
  process.exit(0);
}
const gitCmd = process.platform === 'win32'
  ? path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git', 'bin', 'git.exe')
  : 'git';
try {
  execSync(
    `"${gitCmd}" config --global url."https://${token}@github.com/".insteadOf "https://github.com/"`,
    { stdio: 'inherit' }
  );
  console.log('GitHub HTTPS URL ayarlandi (token ile).');
} catch (e) {
  console.error('Git URL ayari basarisiz:', e.message);
  process.exit(1);
}
