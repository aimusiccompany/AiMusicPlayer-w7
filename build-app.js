/**
 * Tek bundle: VP + renderer -> app.js (orijinal calisan yapi)
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
  // VP ilk cizimden sonra calissin; requestAnimationFrame + setTimeout ile ana thread once serbest kalsin
  const vpDeferred = "var __runVP=function(){ try { " + vpCode + " } catch(e){ console.error('[VP]', e); } if(typeof window.initVirtualPlayer==='function') window.dispatchEvent(new CustomEvent('vp-ready')); }; if(typeof requestAnimationFrame!='undefined') requestAnimationFrame(function(){ setTimeout(__runVP, 0); }); else setTimeout(__runVP, 0);";
  fs.writeFileSync(outApp, rendererCode + '\n' + vpDeferred, 'utf8');
  console.log('app.js olusturuldu (renderer + VP deferred).');
}).catch((e) => {
  console.error('Build hatasi:', e);
  process.exit(1);
});
