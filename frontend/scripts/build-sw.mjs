/**
 * Post-build: `dist/transport-sw.js` із шаблону `sw/transport-sw.js` (Docs/transport-pwa-2026-10.md, фаза 4).
 * Іде після пререндерів — потрібен фінальний dist/ (знімок даних пише prerender-transport-stops.mjs).
 * Не Vite-плагін: vitest (`mergeConfig`) і prerender-spa піднімають плагіни vite.config.ts, а цей крок їм не потрібен.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertShellCovered, buildPrecache, renderServiceWorker } from './precache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const dist = path.join(frontendDir, 'dist');
const template = path.join(frontendDir, 'sw/transport-sw.js');

function die(message) {
  console.error(`build-sw: ${message}`);
  process.exit(1);
}

function filesUnder(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}

const REQUIRED = {
  'index.html': 'run `vite build` first',
  'transport.webmanifest': 'public/transport.webmanifest missing',
  'transport/dataset.json': 'prerender-transport-stops.mjs did not write the data snapshot — was the API reachable?',
};
for (const [file, hint] of Object.entries(REQUIRED)) {
  if (!fs.existsSync(path.join(dist, file))) die(`dist/${file} missing — ${hint}`);
}
if (!fs.existsSync(template)) die('sw/transport-sw.js missing');

const assetFiles = filesUnder(path.join(dist, 'assets'), 'assets/');
if (!assetFiles.length) die('dist/assets is empty');
const extraFiles = ['transport.webmanifest', ...filesUnder(path.join(dist, 'icons'), 'icons/'), 'transport/dataset.json'];

const { urls, buildId } = buildPrecache({
  assetFiles,
  extraFiles,
  fileHash: (url) => createHash('sha256').update(fs.readFileSync(path.join(dist, url.slice(1)))).digest('hex'),
});
assertShellCovered(urls, fs.readFileSync(path.join(dist, 'index.html'), 'utf8'));

let bytes = 0;
for (const url of urls) {
  const file = path.join(dist, url.slice(1));
  if (!fs.existsSync(file)) die(`precache names a file that is not in dist: ${url}`);
  bytes += fs.statSync(file).size;
}

fs.writeFileSync(path.join(dist, 'transport-sw.js'), renderServiceWorker(fs.readFileSync(template, 'utf8'), { urls, buildId }), 'utf8');
console.log(`build-sw: transport-sw.js build ${buildId}, ${urls.length} precached URLs, ${(bytes / 1024).toFixed(0)} KB`);
