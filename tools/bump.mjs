// Cache-busting for GitHub Pages: stamps ?v=N on every relative JS import, the worker URL,
// the stylesheet and the entry script.   node tools/bump.mjs 2
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const v = process.argv[2];
if (!v) { console.error('usage: node tools/bump.mjs <version>'); process.exit(1); }
const files = readdirSync('js').filter(f => f.endsWith('.js')).map(f => 'js/' + f).concat(['index.html']);
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  s = s.replace(/(from\s+'\.\/[\w-]+\.js)(\?v=\d+)?'/g, `$1?v=${v}'`)
       .replace(/(import\('\.\/[\w-]+\.js)(\?v=\d+)?'\)/g, `$1?v=${v}')`)
       .replace(/(new URL\('\.\/ai-worker\.js)(\?v=\d+)?'/g, `$1?v=${v}'`)
       .replace(/(css\/game\.css|js\/main\.js)(\?v=\d+)?"/g, `$1?v=${v}"`);
  writeFileSync(f, s);
}
console.log('version', v, 'stamped on', files.length, 'files');
