/**
 * Post-build prerender of the SPA itself (plan item 1.1).
 *
 * Boots a jsdom window at https://malin.kiev.ua, loads the real app through Vite's SSR module
 * loader (so TS/JSX/CSS/aliases work and Leaflet finds a `window`), renders every public route,
 * waits for the API calls to finish and writes dist/{path}/index.html with the rendered #root and
 * the head tags usePageSeo produced. No page templates are duplicated here.
 *
 * Routes: static list below + every /transport/route/{id} listed in dist/sitemap.xml (written by
 * prerender-transport-stops.mjs from the dataset with rule D1 applied via publishableRouteIds), so
 * sitemap and prerender can never disagree. Corridors and stops keep their dedicated prerenders.
 *
 * Env: PRERENDER_SPA_ONLY=/support/prices,/transport  → render a subset (debugging)
 *      PRERENDER_SITE=korosten → сайт іншого міста (фаза 10б): jsdom на його домені, лише сторінки /transport* зі sitemap.xml
 *      його дерева dist/sites/<key>/ (пише prerender-transport-stops з тією ж змінною), вихід — у те саме дерево. Нема
 *      дерева (транспорт міста ще не опубліковано) — нічого не робимо. Окремий процес: кеші SPA тримають місто.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { API_BASE } from './api-base.mjs';
import { setCanonical, setOg, stripRobots, upsertHeadTag } from './html-head.mjs';
import { siteTreeDir } from './serve-dist-rules.mjs';
import { SITES } from './site-hosts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const distDir = path.join(frontendDir, 'dist');
const shellPath = path.join(distDir, 'index.html');
const SITE_KEY = process.env.PRERENDER_SITE || 'malyn';
const SITE_CONF = SITES[SITE_KEY];
const IS_PRIMARY = Boolean(SITE_CONF?.isPrimary);
const SITE = `https://${SITE_CONF?.domain ?? 'malin.kiev.ua'}`;
/** Куди пишемо й звідки беремо sitemap: Малин — корінь dist, інше місто — його дерево */
const outRoot = IS_PRIMARY ? distDir : path.join(distDir, siteTreeDir(SITE_KEY));

const STATIC_ROUTES = [
  '/mizhgorodski',
  '/zubastyk',
  '/avtostantsiya-malyn',
  '/transport',
  '/transport/scheme',
  '/about',
  '/support',
  '/support/start',
  '/support/travel',
  '/support/prices',
  '/support/transport',
  '/support/bot',
  '/support/site',
  '/support/api',
  '/support/referral',
  '/support/faq',
  '/support/contact',
];

/** Rule D1/D2: a route page exists only when the dataset names both termini and it is not retired. */
export function publishableRouteIds(dataset) {
  return (dataset?.routes || [])
    .filter((r) => r && r.id && !String(r.id).endsWith('-old') && !r.unreliable)
    .filter((r) => String(r.fromName || '').trim() && String(r.toName || '').trim())
    .map((r) => String(r.id))
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Шляхи зі sitemap.xml (свого дерева), що відповідають `pathRe` — частина шляху після домену */
export function sitemapPaths(xml, origin, pathRe) {
  const re = new RegExp(`<loc>\\s*${escapeRegExp(origin)}(/[^<\\s]*?)/?\\s*</loc>`, 'g');
  return [...xml.matchAll(re)].map((m) => decodeURIComponent(m[1])).filter((p) => pathRe.test(p));
}

function routePathsFromSitemap() {
  const sitemapPath = path.join(outRoot, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return [];
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  // Сайт іншого міста: хаб, схема й маршрути з його sitemap (зупинки — статичні з prerender-transport-stops)
  const pathRe = IS_PRIMARY ? /^\/transport\/route\/[^/]+$/ : /^\/transport(\/scheme|\/route\/[^/]+)?$/;
  return sitemapPaths(xml, SITE, pathRe);
}

function installJsdomGlobals() {
  const dom = new JSDOM('<!doctype html><html lang="uk"><head></head><body><div id="root"></div></body></html>', {
    url: `${SITE}/`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const keys = [
    'window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'Element', 'Node', 'Text',
    'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle',
    'localStorage', 'sessionStorage', 'DOMParser', 'HTMLAnchorElement', 'HTMLInputElement', 'SVGElement',
    'Image', 'requestAnimationFrame', 'cancelAnimationFrame', 'self',
  ];
  for (const k of keys) {
    if (k in window && !(k in globalThis && k !== 'self')) {
      try {
        Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
      } catch {
        /* read-only global */
      }
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.self = window;
  window.matchMedia ??= () => ({ matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false });
  globalThis.matchMedia = window.matchMedia;
  const noopObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver ??= noopObserver;
  window.IntersectionObserver ??= noopObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
  globalThis.IntersectionObserver = window.IntersectionObserver;
  window.scrollTo ??= () => {};
  window.scroll ??= () => {};
  // Leaflet reads these on the map container; jsdom has no layout.
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  return dom;
}

/** Wrap global fetch: count in-flight calls, rewrite same-origin /api/ calls to the backend. */
function installFetchTracker() {
  const realFetch = globalThis.fetch;
  let pending = 0;
  globalThis.fetch = async (input, init) => {
    let url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.startsWith('/')) url = `${SITE}${url}`;
    if (url.startsWith(`${SITE}/api/`)) url = `${API_BASE}/${url.slice(`${SITE}/api/`.length)}`;
    pending += 1;
    try {
      return await realFetch(url, init);
    } finally {
      pending -= 1;
    }
  };
  globalThis.window.fetch = globalThis.fetch;
  return { pending: () => pending };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildHtml(shell, urlPath, r) {
  const canonical = r.canonical || `${SITE}${urlPath}`;
  let html = shell;
  if (r.title) html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(r.title)}</title>`);
  if (r.description) html = html.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${escapeAttr(r.description)}" />`);
  html = setCanonical(stripRobots(html), escapeAttr(canonical));
  for (const [prop, val] of Object.entries({ ...r.og, 'og:url': canonical })) html = setOg(html, prop, escapeAttr(val));
  const ld = r.jsonLd.filter(Boolean).map((t) => `<script type="application/ld+json">${t}</script>`).join('\n    ');
  if (ld) html = upsertHeadTag(html, /$^/, ld);
  html = html.replace(/<div id="root"><\/div>/i, `<div id="root">${r.rootHtml}</div>`);
  return html;
}

async function main() {
  if (!fs.existsSync(shellPath)) {
    console.error('prerender-spa: dist/index.html missing — run vite build first');
    process.exit(1);
  }
  if (!SITE_CONF) {
    console.error(`prerender-spa: невідомий PRERENDER_SITE=${SITE_KEY}`);
    process.exit(1);
  }
  if (!IS_PRIMARY && !fs.existsSync(path.join(outRoot, 'sitemap.xml'))) {
    console.log(`prerender-spa[${SITE_KEY}]: дерева сайту нема (транспорт міста не опубліковано) — пропускаю`);
    return;
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  process.env.VITE_API_URL = API_BASE;

  let paths = IS_PRIMARY ? [...STATIC_ROUTES, ...routePathsFromSitemap()] : routePathsFromSitemap();
  if (process.env.PRERENDER_SPA_ONLY) {
    const only = new Set(process.env.PRERENDER_SPA_ONLY.split(',').map((s) => s.trim()));
    paths = paths.filter((p) => only.has(p));
  }

  installJsdomGlobals();
  const tracker = installFetchTracker();

  const vite = await createServer({
    root: frontendDir,
    configFile: path.join(frontendDir, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  let failures = 0;
  try {
    const entry = await vite.ssrLoadModule('/src/prerender-entry.tsx');
    for (const urlPath of paths) {
      try {
        const r = await entry.renderRoute(urlPath, tracker);
        const problems = [];
        if (!r.rootHtml || r.rootHtml.length < 500) problems.push(`root too small (${r.rootHtml.length} chars)`);
        if (!r.title) problems.push('no title');
        if (r.pendingFetches > 0) problems.push(`${r.pendingFetches} fetch(es) still pending`);
        if (problems.length) {
          failures += 1;
          console.error(`  FAIL ${urlPath}: ${problems.join('; ')}`);
          continue;
        }
        const outDir = path.join(outRoot, urlPath);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'index.html'), buildHtml(shell, urlPath, r), 'utf8');
        console.log(`  wrote ${urlPath}/ (${r.rootHtml.length} chars, ${r.jsonLd.length} ld+json) — ${r.title}`);
      } catch (err) {
        failures += 1;
        console.error(`  FAIL ${urlPath}: ${err?.stack || err}`);
      }
    }
  } finally {
    await vite.close();
  }
  console.log(`prerender-spa: ${paths.length - failures}/${paths.length} pages written`);
  if (failures) process.exit(1);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
