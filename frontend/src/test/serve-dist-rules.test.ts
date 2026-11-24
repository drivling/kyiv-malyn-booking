import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { apiRedirectPath, apiSearchForCity, goneHtml, GONE_HTML, isCityBoundDistFile, isCityTransportPath, isSiteOwnFile, isSiteTreePath, siteTreeDir, stopRedirectLocation, cacheControlFor, cacheHeadersFor, isLegacyGonePath, isPrimaryOnlyFile, isRetiredRoutePath, legacyRedirectLocation, LEGACY_LANDING, NO_CACHE_HEADERS, parseByteRange, permanentRedirectLocation, robotsHeadersFor, DOVEDE_ROBOTS, splitUrl, withSearch } from '../../scripts/serve-dist-rules.mjs';

describe('serve-dist rules: 301 for retired public URLs', () => {
  it('/poputky lands on the intercity board with the «Попутки» filter chosen', () => {
    expect(permanentRedirectLocation('/poputky')).toBe('/mizhgorodski?type=carpool');
    expect(permanentRedirectLocation('/poputky/')).toBe('/mizhgorodski?type=carpool');
  });

  it('keeps the visitor’s own parameters next to type=carpool, and lets them override it', () => {
    expect(permanentRedirectLocation('/poputky?utm_source=fb&utm_campaign=x')).toBe('/mizhgorodski?type=carpool&utm_source=fb&utm_campaign=x');
    expect(permanentRedirectLocation('/poputky?from=Malyn&to=Kyiv&date=2026-12-01')).toBe('/mizhgorodski?type=carpool&from=Malyn&to=Kyiv&date=2026-12-01');
    expect(permanentRedirectLocation('/poputky?type=bus')).toBe('/mizhgorodski?type=bus');
    // one `?` only: never `?type=carpool?utm=…`
    expect(permanentRedirectLocation('/poputky?utm_source=fb').match(/\?/g)).toHaveLength(1);
  });

  it('does not touch the other exact redirects', () => {
    expect(permanentRedirectLocation('/')).toBe('/mizhgorodski');
    expect(permanentRedirectLocation('/booking')).toBe('/mizhgorodski');
    expect(permanentRedirectLocation('/booking?from=Kyiv')).toBe('/mizhgorodski?from=Kyiv');
    expect(permanentRedirectLocation('/help?x=1')).toBe('/support?x=1');
    expect(permanentRedirectLocation('/privacy')).toBe('/about#privacy-policy');
    expect(permanentRedirectLocation('/privacy?a=1')).toBe('/about?a=1#privacy-policy');
    expect(permanentRedirectLocation('/localtransport/stop/st_0001?d=1')).toBe('/transport/stop/st_0001?d=1');
    expect(permanentRedirectLocation('/index.php')).toBe(LEGACY_LANDING);
  });

  it('never redirects the pages that exist, or the API-looking subpaths', () => {
    for (const p of ['/mizhgorodski', '/mizhgorodski?type=carpool', '/poputky/search', '/poputkyx', '/transport', '/zubastyk']) {
      expect(permanentRedirectLocation(p), p).toBeNull();
    }
  });

  it('splitUrl / withSearch building blocks', () => {
    expect(splitUrl('/poputky/?a=1')).toEqual({ pathname: '/poputky', search: '?a=1' });
    expect(splitUrl('/')).toEqual({ pathname: '/', search: '' });
    expect(withSearch('/a', '')).toBe('/a');
    expect(withSearch('/a', '?x=1')).toBe('/a?x=1');
    expect(withSearch('/a?t=1', '?x=1&x=2')).toBe('/a?t=1&x=1&x=2');
    expect(withSearch('/a?t=1#frag', '?t=2')).toBe('/a?t=2#frag');
  });
});

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

describe('serve-dist rules: «Доведе» intro video (Range for Safari on iPhone, hashed file names)', () => {
  it('caches the hashed intro video and poster for good, but not other files under /dovede/', () => {
    for (const p of ['/dovede/intro-3f9a1c2b.mp4', '/dovede/intro-3f9a1c2b.jpg', '/ads/hint-711724d9.mp4', '/ads/hint-711724d9.jpg', '/ads/welcome-0a1b2c3d.mp4', '/ads/welcome-0a1b2c3d.jpg', '/ads/welcome-korosten-0a1b2c3d.mp4', '/ads/welcome-korosten-0a1b2c3d.jpg', '/ads/thousand-0ad620ba.mp4', '/ads/thousand-0ad620ba.jpg']) {
      expect(cacheHeadersFor(p), p).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    for (const p of ['/dovede/intro.mp4', '/dovede/intro-3F9A1C2B.mp4', '/dovede/intro-3f9a1c2b.mp4.bak', '/intro-3f9a1c2b.mp4', '/ads/intro-3f9a1c2b.mp4', '/ads/hint.mp4', '/ads/welcome.mp4', '/dovede/welcome-0a1b2c3d.mp4', '/ads/welcome-zhytomyr-0a1b2c3d.mp4', '/ads/welcome-korosten.mp4', '/ads/thousand.mp4', '/ads/thousand-2000-0ad620ba.mp4']) {
      expect(cacheControlFor(p), p).toBe('public, max-age=3600');
    }
  });

  it('reads one byte range: start-end, open end, suffix', () => {
    expect(parseByteRange('bytes=0-1', 1000)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
    expect(parseByteRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange(' bytes=0-0 ', 1)).toEqual({ start: 0, end: 0 });
  });

  it('answers 416 for a range past the end and the whole file for anything else', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-1', 0)).toBe('unsatisfiable');
    for (const h of [undefined, '', 'bytes=', 'bytes=-', 'bytes=5-1', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b']) {
      expect(parseByteRange(h, 1000), String(h)).toBeNull();
    }
  });
});

describe('serve-dist rules: «Доведе» not indexed before launch (X-Robots-Tag)', () => {
  it('marks the page, its intro video and poster noindex for every robot, with or without JS', () => {
    expect(DOVEDE_ROBOTS).toBe('noindex, nofollow, noarchive, nosnippet, noimageindex');
    for (const p of ['/dovede', '/dovede/', '/dovede/intro-55427b80.mp4', '/dovede/intro-55427b80.jpg']) {
      expect(robotsHeadersFor(p), p).toEqual({ 'X-Robots-Tag': DOVEDE_ROBOTS });
    }
    expect(robotsHeadersFor(splitUrl('/dovede?q=%D0%B7%20%D0%9A%D0%B8%D1%94%D0%B2%D0%B0').pathname)).toEqual({ 'X-Robots-Tag': DOVEDE_ROBOTS });
  });

  it('leaves the rest of the site alone', () => {
    for (const p of ['/', '/dovedex', '/transport', '/mizhgorodski', '/about']) {
      expect(robotsHeadersFor(p), p).toEqual({});
    }
  });
});

describe('serve-dist rules: canonical open-data addresses on our domain (Docs/transport-open-protocols-2026-10.md)', () => {
  it('sends the feed, its single files, the OpenAPI document, the RSS and route calendars to the API', () => {
    for (const p of ['/transport/gtfs.zip', '/transport/gtfs/feed_info.txt', '/transport/gtfs/stop_times.txt', '/transport/gtfs/LICENSE.txt', '/openapi.yaml', '/transport/changes.rss', '/transport/route/11/calendar.ics', '/transport/dataset', '/transport/revisions', '/transport/stops/st_0019', '/transport/stop-redirects']) {
      expect(apiRedirectPath(p), p).toBe(p);
    }
  });

  it('leaves pages, snapshots and anything else to the static host', () => {
    for (const p of ['/transport', '/transport/gtfs', '/transport/gtfs/', '/transport/gtfs/../index.js', '/transport/gtfs/stops.csv', '/transport/dataset.json', '/transport/stop-redirects.json', '/transport/routes.json', '/transport/route/11', '/transport/route/11/calendar.ics/x', '/transport/stop/st_0019', '/transport/stops', '/transport/stops/st_0019/x', '/transport/datasets', '/openapi.json', '/']) {
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

describe('serve-dist rules: /transport* на сайті іншого міста (фаза 10б)', () => {
  it('сторінки транспорту залежать від міста, решта сайту — ні', () => {
    expect(isCityTransportPath('/transport')).toBe(true);
    expect(isCityTransportPath('/transport/stop/st_1001')).toBe(true);
    expect(isCityTransportPath('/transport-sw.js')).toBe(false);
    expect(isCityTransportPath('/transportx')).toBe(false);
    expect(isCityTransportPath('/mizhgorodski')).toBe(false);
    expect(siteTreeDir('korosten')).toBe('sites/korosten');
  });

  it('з кореня dist сайт іншого міста не бере HTML і знімки Малина, але бере плакати схем', () => {
    expect(isCityBoundDistFile('/transport/index.html')).toBe(true);
    expect(isCityBoundDistFile('/transport/stop/st_0001/index.html')).toBe(true);
    expect(isCityBoundDistFile('/transport/dataset.json')).toBe(true);
    expect(isCityBoundDistFile('/transport/routes.json')).toBe(true);
    expect(isCityBoundDistFile('/transport/stop-redirects.json')).toBe(true);
    expect(isCityBoundDistFile('/transport/scheme/korosten-transit-scheme-poster.pdf')).toBe(false);
    expect(isCityBoundDistFile('/transport/scheme/korosten-transit-scheme-poster.svg')).toBe(false);
  });

  it('302 на API з сайту іншого міста питає про своє місто', () => {
    expect(apiSearchForCity('', 'Korosten')).toBe('?city=Korosten');
    expect(apiSearchForCity('?limit=5', 'Korosten')).toBe('?limit=5&city=Korosten');
    expect(apiSearchForCity('?city=Malyn', 'Korosten')).toBe('?city=Malyn');
    expect(apiSearchForCity('?limit=5', null)).toBe('?limit=5');
    expect(apiSearchForCity('', '')).toBe('');
  });

  it('сторінка 410 веде на транспорт свого міста; для Малина — та сама, що була', () => {
    expect(goneHtml()).toBe(GONE_HTML);
    expect(GONE_HTML).toContain('Транспорт Малина');
    expect(goneHtml('Коростеня')).toContain('Транспорт Коростеня');
    expect(goneHtml('Коростеня')).not.toContain('Малина');
  });
});

describe('serve-dist rules: свої файли сайту', () => {
  it('llms.txt у кожного сайту свій', () => {
    expect(isSiteOwnFile('/llms.txt')).toBe(true);
    expect(isSiteOwnFile('/robots.txt')).toBe(false);
    expect(isSiteOwnFile('/transport')).toBe(false);
  });

  it('дерево сайту не відкривається напряму як /sites/…', () => {
    expect(isSiteTreePath('/sites/korosten/llms.txt')).toBe(true);
    expect(isSiteTreePath('/sites/korosten/transport/stop/st_1001')).toBe(true);
    expect(isSiteTreePath('/sites')).toBe(true);
    expect(isSiteTreePath('/sitemap.xml')).toBe(false);
    expect(isSiteTreePath('/sitesx')).toBe(false);
  });
});
