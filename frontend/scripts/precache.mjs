/**
 * Що precache-ить service worker транспорту (Docs/transport-pwa-2026-10.md, фаза 4) — чиста функція від
 * вмісту dist/, щоб `src/test/precache.test.ts` міг її закріпити. Зі збірки беремо:
 *   - оболонку `/index.html` (не `/` — він 301, і не пререндерений `/transport` — на `/transport/stop/x`
 *     блимав би планер);
 *   - усе під `assets/` (одна точка входу без code splitting: JS, CSS, картинки Leaflet, усе з `url()`);
 *   - маніфест, іконки і знімок даних `transport/dataset.json`.
 * Свідомо НЕ: пререндерені html (оболонка покриває всі сторінки), постер схеми, robots/sitemap/llms, `routes.json`.
 */
import { createHash } from 'node:crypto';

export const SHELL_URL = '/index.html';

/**
 * @param {object} args
 * @param {string[]} args.assetFiles  dist-relative paths under assets/ ('assets/index-abc.js')
 * @param {string[]} args.extraFiles  other dist-relative files (manifest, icons, snapshot)
 * @param {(url: string) => string} args.fileHash  content hash of a NON-hashed url (everything outside /assets/)
 * @returns {{ urls: string[], buildId: string }}
 */
export function buildPrecache({ assetFiles, extraFiles, fileHash }) {
  const urls = [SHELL_URL, ...[...new Set(assetFiles)].sort().map((f) => `/${f}`), ...[...new Set(extraFiles)].sort().map((f) => `/${f}`)];
  // Id має змінитись, коли змінився список АБО вміст файлу зі сталим URL (оболонка, знімок даних, маніфест):
  // інакше деплой «лише дані» ніколи не дійшов би до встановлених застосунків.
  const hash = createHash('sha256').update(urls.join('\n'));
  for (const url of urls) {
    if (!url.startsWith('/assets/')) hash.update(`\n${url}=${fileHash(url)}`);
  }
  return { urls, buildId: hash.digest('hex').slice(0, 12) };
}

/** `/assets/...` адреси, на які посилається оболонка (script src, link href, modulepreload) */
export function shellAssetRefs(html) {
  return [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))].sort();
}

/** Кидає, якщо оболонка посилається на asset, якого нема в precache — офлайн вона б не відкрилась */
export function assertShellCovered(urls, html) {
  const set = new Set(urls);
  const missing = shellAssetRefs(html).filter((u) => !set.has(u));
  if (missing.length) throw new Error(`precache misses shell assets: ${missing.join(', ')}`);
}

const BUILD_ID_STATEMENT = "const BUILD_ID = '__BUILD_ID__';";
const PRECACHE_STATEMENT = 'const PRECACHE = __PRECACHE__;';

/** Підставляє список і BUILD_ID у шаблон `sw/transport-sw.js` (цілі — самі оператори, не будь-яка згадка в коментарях) */
export function renderServiceWorker(template, { urls, buildId }) {
  if (!template.includes(BUILD_ID_STATEMENT) || !template.includes(PRECACHE_STATEMENT)) throw new Error('sw template placeholders missing');
  const sw = template
    .replace(BUILD_ID_STATEMENT, `const BUILD_ID = ${JSON.stringify(buildId)};`)
    .replace(PRECACHE_STATEMENT, `const PRECACHE = ${JSON.stringify(urls, null, 2)};`);
  if (sw.includes(BUILD_ID_STATEMENT) || sw.includes(PRECACHE_STATEMENT)) throw new Error('sw template placeholders not replaced');
  return sw;
}
