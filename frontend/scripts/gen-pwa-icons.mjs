/**
 * Іконки застосунку «Транспорт Малина» (Docs/transport-pwa-2026-10.md, фаза 3): проста маршрутка на
 * фірмовому #00aff5, намальована тут же (SVG у 100-одиничному полі) і растеризована тим Chromium, що
 * Playwright і так ставить для e2e — без бібліотек для зображень. Запустити раз і ЗАКОМІТИТИ результат:
 * Railway робить `npm ci` без браузера.
 *
 *   npm run pwa:icons          (PW_CHROMIUM=/шлях/до/chrome — якщо Playwright новіший за встановлені браузери)
 *
 * Три форми одного малюнка:
 *   - squircle — прозорі кути: Android «any», Windows, Linux, і favicon (transport.svg);
 *   - square   — синій до країв: apple-touch-icon (iOS маскує сам);
 *   - maskable — синій до країв, маршрутка зменшена в безпечне коло 80 %.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/icons');

const BRAND = '#00aff5';
const GLASS = '#0b7fc2';

/** Маршрутка спереду: білий кузов, скло, маршрутна табличка, фари, колеса */
const ART = [
  `<rect x="19" y="19" width="62" height="55" rx="12" fill="#fff"/>`,
  `<rect x="24" y="72" width="13" height="9" rx="4" fill="#fff"/>`,
  `<rect x="63" y="72" width="13" height="9" rx="4" fill="#fff"/>`,
  `<rect x="26" y="27" width="48" height="24" rx="5" fill="${GLASS}"/>`,
  `<rect x="41" y="30" width="18" height="6" rx="2" fill="#fff" opacity="0.92"/>`,
  `<circle cx="31.5" cy="62.5" r="4.5" fill="${GLASS}"/>`,
  `<circle cx="68.5" cy="62.5" r="4.5" fill="${GLASS}"/>`,
  `<rect x="41" y="59.5" width="18" height="6" rx="3" fill="${GLASS}" opacity="0.45"/>`,
].join('');

/** Малюнок у 100-одиничному полі: squircle або квадрат, за потреби зменшений навколо центру */
export function iconSvg({ square = false, scale = 1 } = {}) {
  const bg = `<rect width="100" height="100"${square ? '' : ' rx="22.5"'} fill="${BRAND}"/>`;
  const shift = (100 - 100 * scale) / 2;
  const art = scale === 1 ? ART : `<g transform="translate(${shift} ${shift}) scale(${scale})">${ART}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg}${art}</svg>`;
}

const ICONS = [
  // [файл, px, малюнок]
  ['transport-192.png', 192, iconSvg()],
  ['transport-512.png', 512, iconSvg()],
  ['apple-touch-icon-180.png', 180, iconSvg({ square: true })],
  ['transport-maskable-512.png', 512, iconSvg({ square: true, scale: 0.8 })],
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'transport.svg'), `${iconSvg()}\n`, 'utf8');
  console.log('[gen-pwa-icons] transport.svg');

  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const [name, size, drawing] of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${drawing.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
      );
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
      await page.close();
      writeFileSync(path.join(outDir, name), png);
      console.log(`[gen-pwa-icons] ${name} (${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
