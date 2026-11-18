import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  DOVEDE_DESCRIPTION,
  DOVEDE_ICON_LINKS,
  DOVEDE_ICONS,
  DOVEDE_OG,
  DOVEDE_TITLE,
  dovedeHtml,
} from '../../scripts/dovede-brand.mjs';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '../../scripts/og-images.mjs';
import { usePageSeo } from '@/hooks/usePageSeo';
import { SITE_ICON_LINKS, useDovedeIcons } from '@/pages/DovedePage/brandIcons';

const frontend = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');

/** Розміри PNG із заголовка IHDR (байти 16–23) */
function pngSize(publicPath: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(frontend, 'public', publicPath));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const iconLinks = () =>
  [...document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((el) => ({
    rel: el.getAttribute('rel'),
    href: el.getAttribute('href'),
  }));

describe('«Доведе» у вкладці й у прев\'ю посилання (scripts/dovede-brand.mjs)', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta, link').forEach((el) => el.remove());
  });

  it('dist/dovede/index.html: назва, опис, іконки й картка «Доведе», noindex — замість шапки «Як доїхати»', () => {
    const html = dovedeHtml(indexHtml, 'https://malin.kiev.ua');
    expect(html).toContain(`<title>${DOVEDE_TITLE}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${DOVEDE_TITLE}" />`);
    expect(html).toContain(`<meta property="og:description" content="${DOVEDE_DESCRIPTION}" />`);
    expect(html).toContain(`<meta name="description" content="${DOVEDE_DESCRIPTION}" />`);
    expect(html).toContain('<meta property="og:site_name" content="dovede.online" />');
    expect(html).toContain(`<meta property="og:image" content="https://malin.kiev.ua${DOVEDE_OG.path}" />`);
    expect(html).toContain(`<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain(`<link rel="icon" type="image/png" sizes="32x32" href="${DOVEDE_ICONS.png32}" />`);
    expect(html).toContain(`<link rel="apple-touch-icon" href="${DOVEDE_ICONS.apple180}" />`);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Доведе" />');
    for (const gone of ['/favicon.ico', 'yak-doikhaty.svg', 'yak-doikhaty-apple-180', 'yak-doikhaty-site.png', 'transport.webmanifest', 'noindex,follow']) {
      expect(html, gone).not.toContain(gone);
    }
    // тіло (корінь SPA і скрипти) — те саме, що в оболонці
    expect(html.slice(html.indexOf('</head>'))).toBe(indexHtml.slice(indexHtml.indexOf('</head>')));
  });

  it('змінили index.html так, що тег не знайшовся, — збірка падає, а не віддає чужу картку', () => {
    expect(() => dovedeHtml(indexHtml.replace(/<meta property="og:title"[^>]*\/>/, ''))).toThrow(/og:title/);
    expect(() => dovedeHtml(indexHtml.replace('</title>', '</title><title>x</title>'))).toThrow(/title/);
  });

  it('збірка пише dist/dovede/index.html одразу після SRI', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('node scripts/sri.mjs && node scripts/dovede-html.mjs &&');
  });

  it('PNG закомічені в public/dovede потрібного розміру (npm run dovede:icons)', () => {
    expect(pngSize(DOVEDE_ICONS.png32)).toEqual({ width: 32, height: 32 });
    expect(pngSize(DOVEDE_ICONS.png192)).toEqual({ width: 192, height: 192 });
    expect(pngSize(DOVEDE_ICONS.apple180)).toEqual({ width: 180, height: 180 });
    expect(pngSize(DOVEDE_OG.path)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });

  it('usePageSeo із власною карткою ставить картку «Доведе», а не картку сайту', () => {
    renderHook(() =>
      usePageSeo({ title: DOVEDE_TITLE, canonicalUrl: 'https://malin.kiev.ua/dovede', description: DOVEDE_DESCRIPTION, ogImage: DOVEDE_OG }),
    );
    const meta = (p: string) => document.head.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
    expect(meta('og:image')).toBe(`https://malin.kiev.ua${DOVEDE_OG.path}`);
    expect(meta('og:image:alt')).toBe(DOVEDE_OG.alt);
  });

  it('сторінка ставить іконку «Доведе» у вкладку, а вихід зі сторінки повертає іконки сайту з index.html', () => {
    for (const link of SITE_ICON_LINKS) expect(indexHtml, link.href).toContain(`href="${link.href}"`);
    const { unmount } = renderHook(() => useDovedeIcons());
    expect(iconLinks()).toEqual(DOVEDE_ICON_LINKS.map(({ rel, href }) => ({ rel, href })));
    unmount();
    expect(iconLinks()).toEqual(SITE_ICON_LINKS.map(({ rel, href }) => ({ rel, href })));
  });
});
