/**
 * Pure URL rules for scripts/serve-dist.mjs (plan items 1.5 and 1.10, Docs/seo-aeo-plan-2026-09.md).
 * Kept free of fs/http so vitest can cover them.
 */

/** Where booking-intent URLs of the 2016–2022 Zubustik site should land. */
export const LEGACY_LANDING = '/mizhgorodski/malyn-kyiv';

const LEGACY_BOOKING_RE = /^\/(index\.php|pages\/[\w.-]+\.php|pages)$/i;
const LEGACY_GONE_RE = /^\/(script|css|js|img|wp-content|wp-includes|wp-admin|wp-json|feed|comments|cdn-cgi)(\/|$)|^\/(wp-login\.php|xmlrpc\.php|[\w-]+\.php)$/i;

/**
 * 301 for old Zubustik-site URLs that carried booking intent (review §12: the domain was the
 * carrier's online-booking site; its login/index pages still get traffic from old buses/links).
 * @returns {string|null}
 */
export function legacyRedirectLocation(pathname) {
  return LEGACY_BOOKING_RE.test(pathname) ? LEGACY_LANDING : null;
}

/** 410 for old-site assets, WordPress leftovers and any other .php — nothing to redirect to. */
export function isLegacyGonePath(pathname) {
  return LEGACY_GONE_RE.test(pathname) && !LEGACY_BOOKING_RE.test(pathname);
}

const ROUTE_PATH_RE = /^\/transport\/route\/([^/]+)$/;

/**
 * 410 for /transport/route/{id} when {id} is not in the current dataset at all (rule D3:
 * "Маршрут №6 ? — ?" lived in Google's index for weeks after the route was deleted).
 * Routes that exist but are unnamed/unreliable are NOT gone — they still open in the app (noindex shell).
 * @param {string} pathname
 * @param {Set<string>|string[]|null} knownRouteIds  all ids from dist/transport/routes.json; null = unknown → never 410
 */
export function isRetiredRoutePath(pathname, knownRouteIds) {
  if (!knownRouteIds) return false;
  const m = ROUTE_PATH_RE.exec(pathname);
  if (!m) return false;
  let id;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    id = m[1];
  }
  const known = knownRouteIds instanceof Set ? knownRouteIds : new Set(knownRouteIds.map(String));
  return !known.has(id);
}

/**
 * PWA files that exist only on the primary domain (Docs/transport-pwa-2026-10.md, phase 1):
 * korosten.kiev.ua shows the «скоро» stub for /transport, and without this 404 Chrome would offer
 * to install it as an app while a stale registration there could never die.
 */
export const PRIMARY_ONLY_FILES = ['/transport-sw.js', '/transport.webmanifest'];

export function isPrimaryOnlyFile(pathname) {
  return PRIMARY_ONLY_FILES.includes(pathname);
}

/** Revalidated on every request: the worker, the manifest and the per-deploy data snapshots (fixed URLs). */
const NO_CACHE_FILES = new Set(['/transport-sw.js', '/transport.webmanifest', '/transport/dataset.json', '/transport/routes.json', '/transport/stop-redirects.json']);

/**
 * Cache-Control for a file under dist/ (`pathname` = its dist-relative path, e.g. `/transport/index.html`).
 * Hashed Vite assets never change under their name; HTML and the no-cache files above must not be
 * frozen in the HTTP cache (the service worker fetches them with `cache: 'reload'`); icons and the
 * rest (robots, sitemap, poster) live a day or an hour — before phase 1 everything non-HTML was
 * `immutable` for a year.
 */
export function cacheControlFor(pathname) {
  if (/\.html$/i.test(pathname) || NO_CACHE_FILES.has(pathname)) return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/icons/')) return 'public, max-age=86400';
  return 'public, max-age=3600';
}

/**
 * Headers for a response the browser must revalidate every time. `Cache-Control: no-cache` alone is not enough
 * behind Cloudflare: with Origin Cache Control on (every non-Enterprise zone) it means «cache, then revalidate»,
 * so a file Cloudflare caches by extension (`.js` — the worker; `.webmanifest` and `.json` are not on that list)
 * sat at the edge with the zone's 4 h browser TTL written over our header (`cache-control: max-age=14400`,
 * `cf-cache-status: HIT`), and an installed app could pull the previous worker for up to 4 h after a deploy
 * (Docs/transport-pwa-smoke.md, «Вторинний домен і краулери»). `CDN-Cache-Control` (RFC 9213) is what the CDN
 * reads instead of `Cache-Control`; `no-store` there makes Cloudflare skip its cache (`cf-cache-status: BYPASS`)
 * and only a Cache Rule with an Edge TTL override would beat it. Browsers ignore the header.
 */
export const NO_CACHE_HEADERS = Object.freeze({ 'Cache-Control': 'no-cache', 'CDN-Cache-Control': 'no-store' });

/** Cache headers for a file under dist/: `cacheControlFor` plus the CDN opt-out for the `no-cache` files. */
export function cacheHeadersFor(pathname) {
  const cacheControl = cacheControlFor(pathname);
  return cacheControl === 'no-cache' ? { ...NO_CACHE_HEADERS } : { 'Cache-Control': cacheControl };
}

/**
 * Open-data and protocol files that live on the backend but have their canonical address on our domain
 * (Docs/transport-open-protocols-2026-10.md, phase 1): the feed catalogs and the docs name
 * `https://malin.kiev.ua/transport/gtfs.zip`, serve-dist answers 302 to the API. 302, not 301: the API host
 * (Railway today) will move, and clients must not remember today's target for good. Not a proxy: the zip is
 * already cached per revision with an ETag on the backend, and the static host stays dependency-free.
 * The transport service worker never sees these: not navigations (a dot in the last segment), not in precache.
 * @param {string} pathname
 * @returns {string|null} path on the API host to redirect to (same path), or null
 */
export function apiRedirectPath(pathname) {
  if (pathname === '/transport/gtfs.zip' || pathname === '/openapi.yaml' || pathname === '/transport/changes.rss') return pathname;
  if (/^\/transport\/gtfs\/[A-Za-z_]+\.txt$/.test(pathname)) return pathname;
  if (/^\/transport\/route\/[^/]+\/calendar\.ics$/.test(pathname)) return pathname;
  return null;
}

const STOP_PATH_RE = /^\/transport\/stop\/([^/]+)$/;

/**
 * 301 for /transport/stop/{oldId} when the dataset says the stop was merged into another one
 * (Docs/transport-open-protocols-2026-10.md, phase 3; map from dist/transport/stop-redirects.json written by
 * prerender-transport-stops). null = no redirect (unknown id, live stop, no map).
 * @param {string} pathname
 * @param {Record<string,string>|null} redirects
 * @returns {string|null} new pathname
 */
export function stopRedirectLocation(pathname, redirects) {
  if (!redirects) return null;
  const m = STOP_PATH_RE.exec(pathname);
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    id = m[1];
  }
  const target = Object.prototype.hasOwnProperty.call(redirects, id) ? redirects[id] : null;
  return typeof target === 'string' && target && target !== id ? `/transport/stop/${encodeURIComponent(target)}` : null;
}

export const GONE_HTML =
  '<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>410 — сторінки більше немає</title>' +
  '<meta name="robots" content="noindex"></head><body><p>Цієї сторінки більше немає. ' +
  '<a href="/transport">Транспорт Малина</a> · <a href="/mizhgorodski">Маршрутки та попутки</a></p></body></html>';
