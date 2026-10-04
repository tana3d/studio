import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

// Ship one local module instead of a CDN/import map or a second web server.
await rm('public/studio', { recursive: true, force: true });
await mkdir('public/studio', { recursive: true });
for (const file of ['index.html', 'studio.css', 'assets']) {
  await cp(`editor/${file}`, `public/studio/${file}`, { recursive: true });
}
await build({ entryPoints: ['editor/main.js'], outfile: 'public/studio/studio.js',
  bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof' });
