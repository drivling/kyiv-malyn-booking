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
const NO_CACHE_FILES = new Set(['/transport-sw.js', '/transport.webmanifest', '/transport/dataset.json', '/transport/routes.json']);

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

export const GONE_HTML =
  '<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>410 — сторінки більше немає</title>' +
  '<meta name="robots" content="noindex"></head><body><p>Цієї сторінки більше немає. ' +
  '<a href="/transport">Транспорт Малина</a> · <a href="/mizhgorodski">Маршрутки та попутки</a></p></body></html>';
