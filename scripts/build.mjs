import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all(['index.html', 'styles.css'].map(file => copyFile(`src/${file}`, `dist/${file}`)));
await build({
  entryPoints: ['src/app.js'], outfile: 'dist/app.js', bundle: true,
  minify: true, sourcemap: true, format: 'iife', target: 'chrome130',
  legalComments: 'external',
});
