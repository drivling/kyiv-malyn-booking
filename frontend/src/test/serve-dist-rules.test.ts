import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { isLegacyGonePath, isRetiredRoutePath, legacyRedirectLocation, LEGACY_LANDING } from '../../scripts/serve-dist-rules.mjs';

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
