import { describe, expect, test, afterEach, vi } from 'vitest';
import {
  SITES,
  PRIMARY_SITE,
  buildCitySwitchUrl,
  getCurrentSite,
  isPrimaryOnlyPath,
  primaryUrl,
  resolveSite,
  siteForCityCode,
} from './siteConfig';

function stubLocation(href: string) {
  const url = new URL(href);
  vi.stubGlobal('window', {
    location: {
      hostname: url.hostname,
      protocol: url.protocol,
      port: url.port,
      search: url.search,
      pathname: url.pathname,
    },
  } as unknown as Window);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveSite', () => {
  test.each([
    ['malin.kiev.ua', 'malyn'],
    ['www.malin.kiev.ua', 'malyn'],
    ['localhost', 'malyn'],
    ['frontend-production-34cd.up.railway.app', 'malyn'],
    ['korosten.kiev.ua', 'korosten'],
    ['www.korosten.kiev.ua', 'korosten'],
    ['korosten.localhost', 'korosten'],
  ])('%s → %s', (hostname, key) => {
    expect(resolveSite(hostname).key).toBe(key);
  });

  test('невідомий хост вважається головним сайтом', () => {
    expect(resolveSite('').key).toBe(PRIMARY_SITE.key);
    expect(resolveSite('some-preview.example.com').isPrimary).toBe(true);
  });
});

describe('siteForCityCode', () => {
  test('власний домен поки лише в Коростеня', () => {
    expect(siteForCityCode('Korosten').key).toBe('korosten');
    expect(siteForCityCode('Malyn').key).toBe('malyn');
    expect(siteForCityCode('Kyiv').key).toBe('malyn');
    expect(siteForCityCode('').key).toBe('malyn');
  });
});

describe('buildCitySwitchUrl', () => {
  test('null, якщо місто лишається на поточному домені', () => {
    stubLocation('https://malin.kiev.ua/mizhgorodski');
    expect(buildCitySwitchUrl(SITES.malyn, 'Kyiv', '/mizhgorodski', '?from=Kyiv')).toBeNull();
    expect(buildCitySwitchUrl(SITES.korosten, 'Korosten', '/mizhgorodski', '')).toBeNull();
  });

  test('зберігає шлях і query, додає city=', () => {
    stubLocation('https://malin.kiev.ua/mizhgorodski');
    const url = buildCitySwitchUrl(SITES.malyn, 'Korosten', '/mizhgorodski', '?from=Kyiv&to=Malyn');
    expect(url).toBe('https://korosten.kiev.ua/mizhgorodski?from=Kyiv&to=Malyn&city=Korosten');
  });

  test('повернення з коростенського домену веде на головний', () => {
    stubLocation('https://korosten.kiev.ua/transport');
    expect(buildCitySwitchUrl(SITES.korosten, 'Malyn', '/transport', '')).toBe(
      'https://malin.kiev.ua/transport?city=Malyn',
    );
  });

  test('локально ходить між localhost і korosten.localhost з тим самим портом', () => {
    stubLocation('http://localhost:5173/mizhgorodski');
    expect(buildCitySwitchUrl(SITES.malyn, 'Korosten', '/mizhgorodski', '')).toBe(
      'http://korosten.localhost:5173/mizhgorodski?city=Korosten',
    );
  });
});

describe('getCurrentSite', () => {
  test('визначається доменом', () => {
    stubLocation('https://korosten.kiev.ua/mizhgorodski');
    expect(getCurrentSite().key).toBe('korosten');
  });

  test('?site= перекриває домен для локальної розробки', () => {
    stubLocation('http://localhost:5173/mizhgorodski?site=korosten');
    expect(getCurrentSite().key).toBe('korosten');
  });
});

describe('primary-only шляхи', () => {
  test.each(['/admin', '/admin/routes', '/login', '/user'])('%s тільки на головному', (p) => {
    expect(isPrimaryOnlyPath(p)).toBe(true);
  });

  test.each(['/', '/mizhgorodski', '/transport', '/adminx', '/support'])('%s доступний скрізь', (p) => {
    expect(isPrimaryOnlyPath(p)).toBe(false);
  });

  test('primaryUrl зберігає шлях і query', () => {
    stubLocation('https://korosten.kiev.ua/admin/routes');
    expect(primaryUrl('/admin/routes', '?tab=1')).toBe('https://malin.kiev.ua/admin/routes?tab=1');
  });

  test('локально primaryUrl не викидає на прод', () => {
    stubLocation('http://korosten.localhost:5173/admin');
    expect(primaryUrl('/admin', '')).toBe('http://localhost:5173/admin');
  });
});
