/**
 * Політика Node-хоста (scripts/serve-dist.mjs) — той самий модуль, що й у фронтенді.
 */
import { describe, expect, test } from 'vitest';
import {
  isPrimaryOnlyPath,
  normalizeHost,
  primaryUrl,
  resolveSite,
  resolveSiteKey,
} from '../../scripts/site-hosts.mjs';

describe('normalizeHost', () => {
  test.each([
    ['malin.kiev.ua:443', 'malin.kiev.ua'],
    ['WWW.Malin.Kiev.UA', 'malin.kiev.ua'],
    ['korosten.kiev.ua.', 'korosten.kiev.ua'],
    ['[::1]:4173', '::1'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe('resolveSiteKey за Host-заголовком', () => {
  test.each([
    ['malin.kiev.ua', 'malyn'],
    ['korosten.kiev.ua', 'korosten'],
    ['www.korosten.kiev.ua:443', 'korosten'],
    ['korosten.localhost:4173', 'korosten'],
    ['localhost:4173', 'malyn'],
    [undefined, 'malyn'],
  ])('%s → %s', (host, key) => {
    expect(resolveSiteKey(host)).toBe(key);
  });

  test('вторинний домен не індексується', () => {
    expect(resolveSite('korosten.kiev.ua').isPrimary).toBe(false);
    expect(resolveSite('malin.kiev.ua').isPrimary).toBe(true);
  });
});

describe('шляхи тільки головного домену', () => {
  test.each(['/admin', '/admin/routes', '/login', '/user'])('%s → редирект', (p) => {
    expect(isPrimaryOnlyPath(p)).toBe(true);
  });

  test.each(['/', '/mizhgorodski', '/transport/stop/st_0001', '/support/faq'])(
    '%s лишається на місці',
    (p) => {
      expect(isPrimaryOnlyPath(p)).toBe(false);
    },
  );

  test('primaryUrl веде на malin.kiev.ua', () => {
    expect(primaryUrl('/login', '?next=/user')).toBe('https://malin.kiev.ua/login?next=/user');
  });
});
