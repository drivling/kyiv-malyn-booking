import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { cacheControlFor, isLegacyGonePath, isPrimaryOnlyFile, isRetiredRoutePath, legacyRedirectLocation, LEGACY_LANDING } from '../../scripts/serve-dist-rules.mjs';

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
    for (const p of ['/index.html', '/transport/index.html', '/transport/stop/st_0001/index.html', '/stop-signs/st_0001.html', '/transport-sw.js', '/transport.webmanifest', '/transport/dataset.json', '/transport/routes.json']) {
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

  it('serves the worker and the manifest only on the primary domain', () => {
    expect(isPrimaryOnlyFile('/transport-sw.js')).toBe(true);
    expect(isPrimaryOnlyFile('/transport.webmanifest')).toBe(true);
    expect(isPrimaryOnlyFile('/transport')).toBe(false);
    expect(isPrimaryOnlyFile('/icons/transport-192.png')).toBe(false);
  });
});
