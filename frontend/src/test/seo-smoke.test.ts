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

  it('fails when the page is the SPA shell in disguise (shell title, foreign canonical)', () => {
    const html = page({ title: SHELL_TITLE, canonical: 'https://malin.kiev.ua/mizhgorodski' });
    const { errors } = analyzeHtml(html, { url: 'https://malin.kiev.ua/transport', shellTitle: SHELL_TITLE });
    expect(errors.join('\n')).toMatch(/title equals SPA shell/);
    expect(errors.join('\n')).toMatch(/canonical .* ≠ "https:\/\/malin\.kiev\.ua\/transport"/);
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
  const corridor = { slug: 'malyn-kyiv', routes: ['Malyn-Kyiv-Irpin', 'Malyn-Kyiv-Bucha'] };
  const row = (route: string, departureTime: string) => ({ route, departureTime });

  it('uses live rows when every route answered, sorted by time', () => {
    const live = { 'Malyn-Kyiv-Irpin': [row('Malyn-Kyiv-Irpin', '09:00')], 'Malyn-Kyiv-Bucha': [row('Malyn-Kyiv-Bucha', '05:00')] };
    const r = resolveCorridorSchedules(corridor, live, { fetchedAt: '2026-01-01', routes: {} }, { today: '2026-09-10' });
    expect(r.source).toBe('api');
    expect(r.asOf).toBe('2026-09-10');
    expect(r.rows.map((x: { departureTime: string }) => x.departureTime)).toEqual(['05:00', '09:00']);
  });

  it('falls back to the committed snapshot (with its date) when a route is missing live', () => {
    const live = { 'Malyn-Kyiv-Irpin': [row('Malyn-Kyiv-Irpin', '09:00')] };
    const snapshot = { fetchedAt: '2026-09-01', routes: { 'Malyn-Kyiv-Irpin': [row('Malyn-Kyiv-Irpin', '09:00')], 'Malyn-Kyiv-Bucha': [row('Malyn-Kyiv-Bucha', '05:00')] } };
    const r = resolveCorridorSchedules(corridor, live, snapshot, { today: '2026-09-10' });
    expect(r.source).toBe('snapshot');
    expect(r.asOf).toBe('2026-09-01');
    expect(r.rows).toHaveLength(2);
  });

  it('throws instead of shipping an empty timetable', () => {
    expect(() => resolveCorridorSchedules(corridor, {}, { fetchedAt: null, routes: {} }, { today: '2026-09-10' })).toThrow(/Rule D10/);
  });

  it('PRERENDER_ALLOW_EMPTY-style override yields an explicit empty result', () => {
    const r = resolveCorridorSchedules(corridor, {}, { fetchedAt: null, routes: {} }, { allowEmpty: true, today: '2026-09-10' });
    expect(r).toMatchObject({ rows: [], source: 'empty' });
  });
});
