/**
 * Post-build: Subresource Integrity на бандл сайту (Docs/transport-verifiable-build-2026-10.md, фаза 1 — П7
 * «перевірювана архітектура»). Іде одразу після `vite build` і ДО пререндерів: `prerender-corridors`,
 * `prerender-transport-stops` і `prerender-spa` копіюють `<head>` оболонки `dist/index.html`, тож `integrity`
 * потрапляє і в статичні сторінки; `build-sw.mjs` precache-ить ту саму оболонку пізніше.
 *
 * Підписуємо те, що оболонка тягне з `/assets/`: `<script src="/assets/*.js">` (точка входу і modulepreload, якби
 * він з'явився) і `<link rel="stylesheet" href="/assets/*.css">` — sha384 від вмісту файлу у dist/ плюс явний
 * `crossorigin="anonymous"` (Vite ставить голий `crossorigin`; для same-origin різниці немає, для CDN — є).
 * Service worker не заважає: з кешу приходять ті самі байти, і браузер перевіряє хеш на будь-якій відповіді
 * `type: basic`. `freshBuild.ts` (`BUNDLE_RE` по `src`) і `precache.mjs` (`src|href`) атрибут не бачать.
 *
 * Як звірити людині: `integrity` у джерелі сторінки (view-source) — той самий, що `openssl dgst -sha384 -binary
 * dist/assets/index-<hash>.js | base64` і той, що віддає сервер за цією адресою.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Значення атрибута `integrity` для вмісту файлу */
export function sriOf(buf) {
  return `sha384-${createHash('sha384').update(buf).digest('base64')}`;
}

const TAG_RE = /<(script|link)\b([^>]*?)(\s*\/?)>/g;
const SRC_RE = /\ssrc="(\/assets\/[^"]+\.js)"/;
const HREF_RE = /\shref="(\/assets\/[^"]+\.css)"/;

/** URL під /assets/, який цей тег завантажує і який можна підписати; null — тег не наш */
function signableUrl(name, attrs) {
  if (name === 'script') return SRC_RE.exec(attrs)?.[1] ?? null;
  if (/\srel="stylesheet"/.test(attrs)) return HREF_RE.exec(attrs)?.[1] ?? null;
  return null;
}

/**
 * Проставляє `integrity` + `crossorigin="anonymous"` на теги оболонки, що тягнуть JS/CSS з `/assets/`.
 * Ідемпотентно: старі `integrity`/`crossorigin` знімаються й ставляться заново.
 * @param {string} html  dist/index.html
 * @param {(url: string) => Buffer | null} readAsset  вміст файлу за URL (`/assets/index-abc.js`); null — файлу нема
 * @returns {{ html: string, signed: Record<string, string> }}  підписані URL → integrity
 */
export function addIntegrity(html, readAsset) {
  const signed = {};
  const out = html.replace(TAG_RE, (tag, name, attrs, close) => {
    const url = signableUrl(name, attrs);
    if (!url) return tag;
    const buf = readAsset(url);
    if (!buf) throw new Error(`sri: ${url} is referenced by the shell but missing in dist`);
    const integrity = sriOf(buf);
    const cleaned = attrs.replace(/\s+integrity="[^"]*"/g, '').replace(/\s+crossorigin(="[^"]*")?(?=\s|$)/g, '');
    signed[url] = integrity;
    return `<${name}${cleaned} integrity="${integrity}" crossorigin="anonymous"${close}>`;
  });
  if (!Object.keys(signed).length) throw new Error('sri: the shell references no /assets/*.js or /assets/*.css — run `vite build` first');
  return { html: out, signed };
}

function main() {
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.join(frontendDir, 'dist');
  const shellPath = path.join(dist, 'index.html');
  if (!fs.existsSync(shellPath)) {
    console.error('sri: dist/index.html missing — run `vite build` first');
    process.exit(1);
  }
  try {
    const { html, signed } = addIntegrity(fs.readFileSync(shellPath, 'utf8'), (url) => {
      const file = path.join(dist, url.slice(1));
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    });
    fs.writeFileSync(shellPath, html, 'utf8');
    for (const [url, integrity] of Object.entries(signed)) console.log(`sri: ${url} ${integrity}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
