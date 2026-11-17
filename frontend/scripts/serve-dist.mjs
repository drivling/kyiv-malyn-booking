/**
 * Static host for Railway: serve dist with directory index.html
 * even without a trailing slash, then SPA fallback to /index.html.
 *
 * vite preview (sirv + SPA) only serves nested index.html for ".../path/" —
 * ".../path" falls through to the root shell, so prerender is invisible to bots.
 *
 * Legacy public URLs get HTTP 301 before SPA shell (Google-friendly redirects).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRedirectPath, apiSearchForCity, cacheHeadersFor, goneHtml, isCityBoundDistFile, isCityTransportPath, isLegacyGonePath, isPrimaryOnlyFile, isRetiredRoutePath, NO_CACHE_HEADERS, parseByteRange, permanentRedirectLocation, robotsHeadersFor, siteTreeDir, splitUrl, stopRedirectLocation } from './serve-dist-rules.mjs';
import { isPrimaryOnlyPath, primaryUrl, resolveSite } from './site-hosts.mjs';
import { API_BASE } from './api-base.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const port = Number(process.env.PORT) || 4173;
const host = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

/** URL path of a resolved file relative to its tree (`/transport/index.html`) — the key for cacheHeadersFor */
function distPath(filePath, root = dist) {
  return `/${path.relative(root, filePath).split(path.sep).join('/')}`;
}

/**
 * File with its length; `Range` → 206 with one byte range (Safari on iPhone plays MP4 only this way — the
 * «Доведе» intro video), a range past the end → 416. HEAD gets the same headers without a body.
 */
function sendFile(req, res, filePath, extraHeaders = {}, root = dist) {
  const ext = path.extname(filePath).toLowerCase();
  const size = fs.statSync(filePath).size;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ...cacheHeadersFor(distPath(filePath, root)),
    ...extraHeaders,
  };
  const range = parseByteRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath, range ?? undefined).pipe(res);
}

function tryResolve(urlPath, root = dist) {
  const base = safeJoin(root, urlPath);
  if (!base) return null;

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  // /foo or /foo/ → /foo/index.html (prerendered corridors / stops)
  const asDir = urlPath.endsWith('/') ? base : base;
  const indexInDir = path.join(asDir, 'index.html');
  if (fs.existsSync(indexInDir) && fs.statSync(indexInDir).isFile()) return indexInDir;

  return null;
}

/** All route ids of the current dataset (written by prerender-transport-stops); null → 410 rule disabled */
function loadKnownRouteIds(root) {
  const p = path.join(root, 'transport', 'routes.json');
  if (!fs.existsSync(p)) return null;
  try {
    const ids = JSON.parse(fs.readFileSync(p, 'utf8'));
    // empty list = dataset was unavailable at build → rule off rather than 410 for everything
    return Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  } catch {
    return null;
  }
}
/** old stop id → live stop id (written by prerender-transport-stops from meta.stopRedirects); null → rule off */
function loadStopRedirects(root) {
  const p = path.join(root, 'transport', 'stop-redirects.json');
  if (!fs.existsSync(p)) return null;
  try {
    const map = JSON.parse(fs.readFileSync(p, 'utf8'));
    return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
  } catch {
    return null;
  }
}
/**
 * Транспорт кожного сайту: корінь dist — Малин; сайт іншого міста — його дерево dist/sites/<key>/ (фаза 10б), якого
 * нема, поки транспорт міста вимкнено. Тоді правила 410 і 301 зупинок вимкнені, а /transport* — оболонка SPA.
 */
const siteTransport = new Map();
function transportOf(site) {
  let entry = siteTransport.get(site.key);
  if (!entry) {
    const root = site.isPrimary ? dist : path.join(dist, siteTreeDir(site.key));
    const exists = fs.existsSync(root);
    entry = {
      root: exists ? root : null,
      knownRouteIds: exists ? loadKnownRouteIds(root) : null,
      stopRedirects: exists ? loadStopRedirects(root) : null,
    };
    siteTransport.set(site.key, entry);
  }
  return entry;
}

/**
 * Файл для запиту. Сайт іншого міста на /transport* бере сторінки й знімки зі свого дерева, а з кореня dist — лише
 * статичні файли (плакати схем), не HTML і не знімки Малина.
 * @returns {{ file: string, root: string } | null}
 */
function resolveForSite(site, urlPath) {
  const { pathname } = splitUrl(urlPath);
  if (!site.isPrimary && isCityTransportPath(pathname)) {
    const { root } = transportOf(site);
    const own = root ? tryResolve(urlPath, root) : null;
    if (own) return { file: own, root };
    const shared = tryResolve(urlPath);
    return shared && !isCityBoundDistFile(distPath(shared)) ? { file: shared, root: dist } : null;
  }
  const file = tryResolve(urlPath === '/' ? '/index.html' : urlPath);
  return file ? { file, root: dist } : null;
}

function sendGone(res, extraHeaders = {}, site) {
  res.writeHead(410, { 'Content-Type': MIME['.html'], 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex', ...extraHeaders });
  res.end(goneHtml(site.cityNameUkGenitive));
}

/** Вторинний домен (korosten.kiev.ua) поки не індексуємо: канонічний контент — на malin.kiev.ua */
const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow' };
const NOINDEX_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

const server = http.createServer((req, res) => {
  const urlPath = req.url || '/';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  const site = resolveSite(req.headers.host);
  // «Доведе» до запуску не індексується ні на якому домені (сторінка, ролик, постер)
  const extraHeaders = { ...(site.isPrimary ? {} : NOINDEX_HEADERS), ...robotsHeadersFor(splitUrl(urlPath).pathname) };

  if (!site.isPrimary) {
    const { pathname, search } = splitUrl(urlPath);

    // Адмінка, логін і кабінет живуть тільки на головному домені
    if (isPrimaryOnlyPath(pathname)) {
      res.writeHead(301, { Location: primaryUrl(pathname, search), 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }

    // Service worker і маніфест транспортного PWA — лише на головному домені (Docs/transport-pwa-2026-10.md)
    if (isPrimaryOnlyFile(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_CACHE_HEADERS, ...NOINDEX_HEADERS });
      res.end(req.method === 'HEAD' ? undefined : 'Not found');
      return;
    }

    if (pathname === '/robots.txt') {
      res.writeHead(200, {
        'Content-Type': MIME['.txt'],
        'Cache-Control': 'public, max-age=3600',
        ...NOINDEX_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : NOINDEX_ROBOTS_TXT);
      return;
    }

    if (pathname === '/sitemap.xml') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NOINDEX_HEADERS });
      res.end(req.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
  }

  // www → apex (old Zubustik-era links and Google's memory use www.malin.kiev.ua; needs the
  // www custom domain in Railway + DNS to reach us at all — see Docs/seo-aeo-plan-2026-09.md 1.11)
  const host = String(req.headers.host || '').toLowerCase();
  if (host.startsWith('www.')) {
    res.writeHead(301, { Location: `https://${host.slice(4)}${urlPath}`, 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }

  const redirectTo = permanentRedirectLocation(urlPath);
  if (redirectTo) {
    res.writeHead(301, {
      Location: redirectTo,
      'Cache-Control': 'public, max-age=86400',
      ...extraHeaders,
    });
    res.end();
    return;
  }

  // Merged/removed stops: /transport/stop/<old> → the live stop, for crawlers and bookmarks (the SPA does the same)
  {
    const { pathname, search } = splitUrl(urlPath);
    const target = stopRedirectLocation(pathname, transportOf(site).stopRedirects);
    if (target) {
      res.writeHead(301, { Location: `${target}${search}`, 'Cache-Control': 'public, max-age=86400', ...extraHeaders });
      res.end();
      return;
    }
  }

  // Canonical open-data addresses on our domain → the API (Docs/transport-open-protocols-2026-10.md, phase 1).
  // Before tryResolve/SPA fallback, else the zip would come back as index.html; CDN keeps no copy (.zip/.txt
  // are extensions Cloudflare caches by default).
  {
    const { pathname, search } = splitUrl(urlPath);
    const apiPath = apiRedirectPath(pathname);
    if (apiPath) {
      // Сайт іншого міста питає API про своє місто (без `city` API відповідає за Малин)
      const citySearch = site.isPrimary ? search : apiSearchForCity(search, site.cityCode);
      res.writeHead(302, { Location: `${API_BASE}${apiPath}${citySearch}`, ...NO_CACHE_HEADERS, ...extraHeaders });
      res.end();
      return;
    }
  }

  const resolved = resolveForSite(site, urlPath);
  if (resolved) {
    sendFile(req, res, resolved.file, extraHeaders, resolved.root);
    return;
  }

  // 410 before the SPA fallback: retired city routes (plan 1.5) and old-site leftovers (plan 1.10)
  {
    const { pathname } = splitUrl(urlPath);
    if (isRetiredRoutePath(pathname, transportOf(site).knownRouteIds) || isLegacyGonePath(pathname)) {
      sendGone(res, extraHeaders, site);
      return;
    }
  }

  const spa = path.join(dist, 'index.html');
  if (fs.existsSync(spa)) {
    sendFile(req, res, spa, extraHeaders);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain', ...extraHeaders });
  res.end('Not found');
});

if (!fs.existsSync(dist)) {
  console.error('serve-dist: dist/ missing — run npm run build first');
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`serve-dist: http://${host}:${port} (root ${dist})`);
});
