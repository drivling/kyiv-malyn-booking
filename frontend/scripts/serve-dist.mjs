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
import { GONE_HTML, isLegacyGonePath, isRetiredRoutePath, legacyRedirectLocation } from './serve-dist-rules.mjs';
import { isPrimaryOnlyPath, primaryUrl, resolveSite } from './site-hosts.mjs';

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
};

/** Exact pathname (no trailing slash except `/`) → Location path+optional hash */
const EXACT_REDIRECTS = new Map([
  ['/', '/mizhgorodski'],
  ['/poputky', '/mizhgorodski'],
  ['/booking', '/mizhgorodski'],
  ['/help', '/support'],
  ['/privacy', '/about#privacy-policy'],
  ['/privacy-policy', '/about#privacy-policy'],
]);

function splitUrl(urlPath) {
  const q = urlPath.indexOf('?');
  const pathPart = q >= 0 ? urlPath.slice(0, q) : urlPath;
  const search = q >= 0 ? urlPath.slice(q) : '';
  let pathname;
  try {
    pathname = decodeURIComponent(pathPart.split('#')[0] || '/');
  } catch {
    pathname = pathPart.split('#')[0] || '/';
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return { pathname, search };
}

function withSearch(target, search) {
  if (!search) return target;
  const hashIdx = target.indexOf('#');
  if (hashIdx === -1) return `${target}${search}`;
  return `${target.slice(0, hashIdx)}${search}${target.slice(hashIdx)}`;
}

/** @returns {string|null} absolute path for Location (path + optional query + hash) */
function permanentRedirectLocation(urlPath) {
  const { pathname, search } = splitUrl(urlPath);

  const exact = EXACT_REDIRECTS.get(pathname);
  if (exact) return withSearch(exact, search);

  // Old Zubustik-site booking pages (plan 1.10)
  const legacy = legacyRedirectLocation(pathname);
  if (legacy) return legacy;

  if (pathname === '/localtransport' || pathname.startsWith('/localtransport/')) {
    const next = pathname.replace(/^\/localtransport/, '/transport') || '/transport';
    return `${next}${search}`;
  }

  return null;
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function sendFile(res, filePath, extraHeaders = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    ...extraHeaders,
  });
  fs.createReadStream(filePath).pipe(res);
}

function tryResolve(urlPath) {
  const base = safeJoin(dist, urlPath);
  if (!base) return null;

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  // /foo or /foo/ → /foo/index.html (prerendered corridors / stops)
  const asDir = urlPath.endsWith('/') ? base : base;
  const indexInDir = path.join(asDir, 'index.html');
  if (fs.existsSync(indexInDir) && fs.statSync(indexInDir).isFile()) return indexInDir;

  return null;
}

/** All route ids of the current dataset (written by prerender-transport-stops); null → 410 rule disabled */
function loadKnownRouteIds() {
  const p = path.join(dist, 'transport', 'routes.json');
  if (!fs.existsSync(p)) return null;
  try {
    const ids = JSON.parse(fs.readFileSync(p, 'utf8'));
    // empty list = dataset was unavailable at build → rule off rather than 410 for everything
    return Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  } catch {
    return null;
  }
}
const KNOWN_ROUTE_IDS = loadKnownRouteIds();

function sendGone(res, extraHeaders = {}) {
  res.writeHead(410, { 'Content-Type': MIME['.html'], 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex', ...extraHeaders });
  res.end(GONE_HTML);
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
  const extraHeaders = site.isPrimary ? {} : NOINDEX_HEADERS;

  if (!site.isPrimary) {
    const { pathname, search } = splitUrl(urlPath);

    // Адмінка, логін і кабінет живуть тільки на головному домені
    if (isPrimaryOnlyPath(pathname)) {
      res.writeHead(301, { Location: primaryUrl(pathname, search), 'Cache-Control': 'no-cache' });
      res.end();
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

  const resolved = tryResolve(urlPath === '/' ? '/index.html' : urlPath);
  if (resolved) {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
        ...extraHeaders,
      });
      res.end();
      return;
    }
    sendFile(res, resolved, extraHeaders);
    return;
  }

  // 410 before the SPA fallback: retired city routes (plan 1.5) and old-site leftovers (plan 1.10)
  {
    const { pathname } = splitUrl(urlPath);
    if (isRetiredRoutePath(pathname, KNOWN_ROUTE_IDS) || isLegacyGonePath(pathname)) {
      sendGone(res, extraHeaders);
      return;
    }
  }

  const spa = path.join(dist, 'index.html');
  if (fs.existsSync(spa)) {
    sendFile(res, spa, extraHeaders);
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
