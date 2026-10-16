import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { OG_IMAGES, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, ogImageForPath, ogImageUrl } from '../../scripts/og-images.mjs';
import { usePageSeo } from '@/hooks/usePageSeo';

const frontend = path.resolve(__dirname, '../..');
const meta = (property: string) => document.head.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;

/** Розміри PNG із заголовка IHDR (байти 16–23) */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('картки посилань (scripts/og-images.mjs)', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta, link[rel="canonical"]').forEach((el) => el.remove());
  });

  it('/transport і все під ним — транспортна картка, решта сайту — загальна', () => {
    for (const p of ['/transport', '/transport/', '/transport/stop/st_0001', '/transport/route/11', '/transport/scheme']) {
      expect(ogImageForPath(p), p).toBe(OG_IMAGES.transport);
    }
    for (const p of ['/', '/mizhgorodski', '/mizhgorodski/malyn-kyiv', '/support/transport', '/about', '/transportation', null]) {
      expect(ogImageForPath(p), String(p)).toBe(OG_IMAGES.site);
    }
    expect(ogImageUrl(OG_IMAGES.transport)).toBe('https://malin.kiev.ua/og/yak-doikhaty-transport.png');
  });

  it('index.html несе загальну картку, twitter:card і favicon (ICO + SVG)', () => {
    const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
    expect(html).toContain(`<meta property="og:image" content="${ogImageUrl(OG_IMAGES.site)}" />`);
    expect(html).toContain(`<meta property="og:image:alt" content="${OG_IMAGES.site.alt}" />`);
    expect(html).toContain(`<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`);
    expect(html).toContain(`<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/icons/yak-doikhaty.svg" />');
  });

  it('PNG карток і favicon.ico закомічені в public/ потрібного розміру (npm run pwa:icons)', () => {
    for (const image of Object.values(OG_IMAGES)) {
      expect(pngSize(path.join(frontend, 'public', image.path)), image.path).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
    }
    const ico = fs.readFileSync(path.join(frontend, 'public/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1); // тип: іконка
    expect([0, 1, 2].map((i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
  });

  it('usePageSeo ставить картку за canonical і повертає попередню після виходу зі сторінки', () => {
    const transport = renderHook(() => usePageSeo({ title: 'Схема', canonicalUrl: 'https://malin.kiev.ua/transport/scheme' }));
    expect(meta('og:image')).toBe(ogImageUrl(OG_IMAGES.transport));
    expect(meta('og:image:alt')).toBe(OG_IMAGES.transport.alt);
    transport.unmount();
    expect(meta('og:image')).toBeNull();

    renderHook(() => usePageSeo({ title: 'Про нас', canonicalUrl: 'https://malin.kiev.ua/about' }));
    expect(meta('og:image')).toBe(ogImageUrl(OG_IMAGES.site));
  });
});
