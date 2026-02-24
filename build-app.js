/**
 * Tek bundle: VP (vp-init) + renderer → app.js
 * Programın tek, stabil çıktısı. npm run build
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const outApp = path.join(root, 'app.js');

esbuild.build({
  entryPoints: [path.join(root, 'src', 'vp-init.js')],
  bundle: true,
  format: 'iife',
  globalName: 'VPBundle',
  outfile: path.join(root, '.tmp-vp.js'),
  platform: 'browser',
  target: ['chrome70'],
  minify: true,
  sourcemap: false,
  logLevel: 'info'
}).then(() => {
  const vpCode = fs.readFileSync(path.join(root, '.tmp-vp.js'), 'utf8');
  fs.unlinkSync(path.join(root, '.tmp-vp.js'));
  const rendererCode = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  fs.writeFileSync(outApp, vpCode + '\n' + rendererCode, 'utf8');
  console.log('app.js olusturuldu (VP + renderer).');
}).catch((e) => {
  console.error('Build hatasi:', e);
  process.exit(1);
});
