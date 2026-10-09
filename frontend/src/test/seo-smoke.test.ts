import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { analyzeHtml, parseSitemap, urlToPath, visibleText } from '../../scripts/seo-smoke-lib.mjs';
// @ts-expect-error — same
import { resolveCorridorSchedules } from '../../scripts/prerender-corridors.mjs';

const SHELL_TITLE = 'Попутки та маршрутки Малин ↔ Київ, Житомир, Коростень | malin.kiev.ua';

function page({
  title = 'Попутка та маршрутка Малин — Київ | malin.kiev.ua',
  canonical = 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv',
  h1 = 'Попутка та маршрутка Малин — Київ',
  body = '',
  jsonLd = true,
} = {}) {
  const filler = 'Розклад маршруток Малин — Київ з бази бронювання malin.kiev.ua. '.repeat(8);
  return `<!doctype html><html><head><title>${title}</title>
<link rel="canonical" href="${canonical}" />
${jsonLd ? '<script type="application/ld+json">{"@context":"https://schema.org"}</script>' : ''}
</head><body><div id="root"><main><h1>${h1}</h1><p>${filler}</p>${body}
<a href="/mizhgorodski?from=Kyiv&amp;to=Malyn&amp;type=bus">Шукати</a></main></div></body></html>`;
}

describe('seo-smoke-lib', () => {
  it('parses sitemap locs and normalizes paths', () => {
    const xml = '<urlset><url><loc>https://malin.kiev.ua/transport</loc></url><url><loc> https://malin.kiev.ua/about/ </loc></url></urlset>';
    expect(parseSitemap(xml)).toEqual(['https://malin.kiev.ua/transport', 'https://malin.kiev.ua/about/']);
    expect(urlToPath('https://malin.kiev.ua/about/')).toBe('/about');
    expect(urlToPath('https://malin.kiev.ua/')).toBe('/');
  });

  it('passes a healthy prerendered corridor page', () => {
    const { errors } = analyzeHtml(page(), { url: 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv', shellTitle: SHELL_TITLE });
    expect(errors).toEqual([]);
  });

  it('fails on a foreign canonical (shell canonical leaking into a page)', () => {
    const html = page({ canonical: 'https://malin.kiev.ua/mizhgorodski' });
    const { errors } = analyzeHtml(html, { url: 'https://malin.kiev.ua/transport', shellTitle: SHELL_TITLE });
    expect(errors.join('\n')).toMatch(/canonical .* ≠ "https:\/\/malin\.kiev\.ua\/transport"/);
  });

  it('fails on a bare shell (shell title + no visible content) but allows the home page to share the title', () => {
    const bare = '<html><head><title>' + SHELL_TITLE + '</title><link rel="canonical" href="https://malin.kiev.ua/transport" /></head><body><div id="root"></div></body></html>';
    expect(analyzeHtml(bare, { url: 'https://malin.kiev.ua/transport', shellTitle: SHELL_TITLE }).errors.join('\n')).toMatch(/title equals SPA shell title .* no visible content/);
    const home = page({ title: SHELL_TITLE, canonical: 'https://malin.kiev.ua/mizhgorodski' });
    expect(analyzeHtml(home, { url: 'https://malin.kiev.ua/mizhgorodski', shellTitle: SHELL_TITLE }).errors).toEqual([]);
  });

  it('flags "? — ?" placeholders in title and text (D1)', () => {
    const html = page({ title: 'Маршрут №6 ? — ? | Транспорт Малина', h1: 'Маршрут №6', body: '<p>лінія ? — ?</p>' });
    const { errors } = analyzeHtml(html, { url: 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv', shellTitle: SHELL_TITLE });
    expect(errors.some((e: string) => e.includes('placeholder "?" in title'))).toBe(true);
    expect(errors.some((e: string) => e.includes('placeholder "? — ?" in text'))).toBe(true);
  });

  it('flags raw route slugs in visible text but ignores them inside hrefs and JSON-LD (D8)', () => {
    const ok = analyzeHtml(page(), { url: 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv', shellTitle: SHELL_TITLE });
    expect(ok.errors).toEqual([]);
    const bad = analyzeHtml(page({ body: '<tr><td>11:47</td><td>Malyn-Kyiv</td><td>60 грн</td></tr>' }), {
      url: 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv',
      shellTitle: SHELL_TITLE,
    });
    expect(bad.errors.join('\n')).toMatch(/raw route slug "Malyn-Kyiv"/);
  });

  it('flags "will load in the app" fallback copy (D10)', () => {
    const html = page({ body: '<tr><td colspan="3">Розклад підвантажиться в додатку; відкрийте сторінку.</td></tr>' });
    const { errors } = analyzeHtml(html, { url: 'https://malin.kiev.ua/mizhgorodski/malyn-kyiv', shellTitle: SHELL_TITLE });
    expect(errors.join('\n')).toMatch(/fallback copy "підвантаж"/);
  });

  it('visibleText drops head, scripts and tags', () => {
    expect(visibleText('<head><title>x</title></head><body><script>1</script><p>a &amp; b</p></body>')).toBe('a & b');
  });
});

describe('prerender-corridors resolveCorridorSchedules (D10)', () => {
  const row = (route: string, departureTime: string) => ({ route, departureTime });
  const empty = { fetchedAt: null, corridors: {} };

  it('uses live rows when the API answered — an empty list is an honest answer', () => {
    const live = { 'malyn-kyiv': [row('Malyn-Kyiv-Bucha', '05:00')], 'kyiv-korosten': [] };
    expect(resolveCorridorSchedules('malyn-kyiv', live, empty, { today: '2026-09-10' })).toMatchObject({ source: 'api', asOf: '2026-09-10' });
    expect(resolveCorridorSchedules('kyiv-korosten', live, empty, { today: '2026-09-10' })).toMatchObject({ source: 'api', rows: [] });
  });

  it('falls back to the committed snapshot (with its date) when the API did not answer', () => {
    const snapshot = { fetchedAt: '2026-09-01', corridors: { 'malyn-kyiv': [row('Malyn-Kyiv-Irpin', '09:00')] } };
    const r = resolveCorridorSchedules('malyn-kyiv', {}, snapshot, { today: '2026-09-10' });
    expect(r).toMatchObject({ source: 'snapshot', asOf: '2026-09-01' });
    expect(r.rows).toHaveLength(1);
  });

  it('throws instead of shipping a placeholder timetable', () => {
    expect(() => resolveCorridorSchedules('malyn-kyiv', {}, empty, { today: '2026-09-10' })).toThrow(/Rule D10/);
  });

  it('PRERENDER_ALLOW_EMPTY-style override yields an explicit empty result', () => {
    expect(resolveCorridorSchedules('malyn-kyiv', {}, empty, { allowEmpty: true, today: '2026-09-10' })).toMatchObject({ rows: [], source: 'empty' });
  });
});
