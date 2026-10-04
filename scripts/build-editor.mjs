import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

// Ship one local module instead of a CDN/import map or a second web server.
await rm('public/studio', { recursive: true, force: true });
await mkdir('public/studio', { recursive: true });
for (const file of ['index.html', 'studio.css', 'assets']) {
  await cp(`editor/${file}`, `public/studio/${file}`, { recursive: true });
}
await build({ entryPoints: ['editor/main.js'], outfile: 'public/studio/studio.js',
  bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof' });

// Keep one catalog markup source for the embedded browser and native window.
const editorHTML=await readFile('editor/index.html','utf8');
const catalog=editorHTML.match(/<dialog id="catalog-dialog"[\s\S]*?<\/dialog>/)?.[0];
if(!catalog)throw new Error('Catalog markup is missing.');
await writeFile('public/studio/catalog.html',`<!doctype html><html lang="en" class="catalog-window"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tana Library</title><link rel="stylesheet" href="./studio.css"></head><body>${catalog.replace('<dialog id="catalog-dialog"','<dialog open id="catalog-dialog"')}<script type="module" src="./catalog-window.js"></script></body></html>`);
await build({entryPoints:['editor/catalog-window.js'],outfile:'public/studio/catalog-window.js',bundle:true,format:'esm',target:'es2022',minify:true});
