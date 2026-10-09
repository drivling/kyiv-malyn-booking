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

export const GONE_HTML =
  '<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>410 — сторінки більше немає</title>' +
  '<meta name="robots" content="noindex"></head><body><p>Цієї сторінки більше немає. ' +
  '<a href="/transport">Транспорт Малина</a> · <a href="/mizhgorodski">Маршрутки та попутки</a></p></body></html>';
