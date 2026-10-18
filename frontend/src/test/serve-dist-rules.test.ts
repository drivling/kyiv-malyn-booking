import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { apiRedirectPath, stopRedirectLocation, cacheControlFor, cacheHeadersFor, isLegacyGonePath, isPrimaryOnlyFile, isRetiredRoutePath, legacyRedirectLocation, LEGACY_LANDING, NO_CACHE_HEADERS } from '../../scripts/serve-dist-rules.mjs';

describe('serve-dist rules: old Zubustik-site URLs (plan 1.10)', () => {
  it('301s booking-intent pages of the old site to the Kyiv corridor', () => {
    expect(legacyRedirectLocation('/index.php')).toBe(LEGACY_LANDING);
    expect(legacyRedirectLocation('/pages/login.php')).toBe(LEGACY_LANDING);
    expect(legacyRedirectLocation('/pages')).toBe(LEGACY_LANDING);
    expect(legacyRedirectLocation('/mizhgorodski')).toBeNull();
    expect(legacyRedirectLocation('/transport/route/5')).toBeNull();
  });

  it('410s old assets, WordPress leftovers and stray .php', () => {
    for (const p of ['/script/app/web/img/x.png', '/css/main.css', '/js/main.js', '/img/zubus_logo_horizont.svg', '/feed', '/comments/feed', '/wp-login.php', '/xmlrpc.php', '/wp-content/uploads/a.jpg', '/whatever.php']) {
      expect(isLegacyGonePath(p), p).toBe(true);
    }
    for (const p of ['/index.php', '/pages/login.php', '/assets/index-abc.js', '/transport', '/data/x.json', '/stop-signs/st_0001.html']) {
      expect(isLegacyGonePath(p), p).toBe(false);
    }
  });
});

describe('serve-dist rules: retired city routes (plan 1.5, rule D3)', () => {
  const known = new Set(['1', '2', '5', '10', '10-old']);

  it('410s a route id that is not in the dataset', () => {
    expect(isRetiredRoutePath('/transport/route/6', known)).toBe(true);
    expect(isRetiredRoutePath('/transport/route/99', known)).toBe(true);
  });

  it('keeps existing routes, even unnamed or unreliable ones (they open in the app)', () => {
    expect(isRetiredRoutePath('/transport/route/1', known)).toBe(false);
    expect(isRetiredRoutePath('/transport/route/10-old', known)).toBe(false);
    expect(isRetiredRoutePath('/transport/route/5', known)).toBe(false);
  });

  it('ignores other paths and never 410s when the list is unknown', () => {
    expect(isRetiredRoutePath('/transport/stop/st_0001', known)).toBe(false);
    expect(isRetiredRoutePath('/transport/route/6/extra', known)).toBe(false);
    expect(isRetiredRoutePath('/transport/route/6', null)).toBe(false);
  });
});

describe('serve-dist rules: transport PWA files (Docs/transport-pwa-2026-10.md, phase 1)', () => {
  it('revalidates HTML, the worker, the manifest and the per-deploy snapshots on every request', () => {
    for (const p of ['/index.html', '/transport/index.html', '/transport/stop/st_0001/index.html', '/stop-signs/st_0001.html', '/transport-sw.js', '/transport.webmanifest', '/transport/dataset.json', '/transport/routes.json', '/transport/stop-redirects.json']) {
      expect(cacheControlFor(p), p).toBe('no-cache');
    }
  });

  it('keeps hashed assets immutable and gives icons a day, the rest an hour', () => {
    expect(cacheControlFor('/assets/index-PzoziBg2.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/assets/index-BLT33i2y.css')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/icons/transport-192.png')).toBe('public, max-age=86400');
    for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/transport/scheme/malyn-transit-scheme-poster.pdf']) {
      expect(cacheControlFor(p), p).toBe('public, max-age=3600');
    }
  });

  it('tells the CDN to keep no copy of what the browser must revalidate (Cloudflare caches .js by extension)', () => {
    expect(NO_CACHE_HEADERS).toEqual({ 'Cache-Control': 'no-cache', 'CDN-Cache-Control': 'no-store' });
    for (const p of ['/transport-sw.js', '/transport.webmanifest', '/transport/dataset.json', '/transport/routes.json', '/index.html', '/transport/index.html']) {
      expect(cacheHeadersFor(p), p).toEqual({ 'Cache-Control': 'no-cache', 'CDN-Cache-Control': 'no-store' });
    }
  });

  it('leaves cacheable files to Cache-Control alone', () => {
    expect(cacheHeadersFor('/assets/index-PzoziBg2.js')).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' });
    expect(cacheHeadersFor('/icons/transport-192.png')).toEqual({ 'Cache-Control': 'public, max-age=86400' });
    expect(cacheHeadersFor('/robots.txt')).toEqual({ 'Cache-Control': 'public, max-age=3600' });
  });

  it('serves the worker and the manifest only on the primary domain', () => {
    expect(isPrimaryOnlyFile('/transport-sw.js')).toBe(true);
    expect(isPrimaryOnlyFile('/transport.webmanifest')).toBe(true);
    expect(isPrimaryOnlyFile('/transport')).toBe(false);
    expect(isPrimaryOnlyFile('/icons/transport-192.png')).toBe(false);
  });
});

describe('serve-dist rules: canonical open-data addresses on our domain (Docs/transport-open-protocols-2026-10.md)', () => {
  it('sends the feed, its single files, the OpenAPI document, the RSS and route calendars to the API', () => {
    for (const p of ['/transport/gtfs.zip', '/transport/gtfs/feed_info.txt', '/transport/gtfs/stop_times.txt', '/transport/gtfs/LICENSE.txt', '/openapi.yaml', '/transport/changes.rss', '/transport/route/11/calendar.ics']) {
      expect(apiRedirectPath(p), p).toBe(p);
    }
  });

  it('leaves pages, snapshots and anything else to the static host', () => {
    for (const p of ['/transport', '/transport/gtfs', '/transport/gtfs/', '/transport/gtfs/../index.js', '/transport/gtfs/stops.csv', '/transport/dataset.json', '/transport/routes.json', '/transport/route/11', '/transport/route/11/calendar.ics/x', '/openapi.json', '/']) {
      expect(apiRedirectPath(p), p).toBeNull();
    }
  });
});

describe('serve-dist rules: merged stops (meta.stopRedirects → dist/transport/stop-redirects.json)', () => {
  const map = { st_0042: 'st_0019', 'st_0043': 'st_0043' };

  it('301s an old stop id to the live one and keeps everything else', () => {
    expect(stopRedirectLocation('/transport/stop/st_0042', map)).toBe('/transport/stop/st_0019');
    expect(stopRedirectLocation('/transport/stop/st_0019', map)).toBeNull();
    expect(stopRedirectLocation('/transport/stop/st_0043', map)).toBeNull();
    expect(stopRedirectLocation('/transport/stop', map)).toBeNull();
    expect(stopRedirectLocation('/transport/stop/st_0042/x', map)).toBeNull();
    expect(stopRedirectLocation('/transport/route/st_0042', map)).toBeNull();
    expect(stopRedirectLocation('/transport/stop/st_0042', null)).toBeNull();
    expect(stopRedirectLocation('/transport/stop/constructor', map)).toBeNull();
  });
});
