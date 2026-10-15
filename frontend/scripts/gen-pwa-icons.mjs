/**
 * Іконки застосунку «Як доїхати» (Docs/transport-pwa-2026-10.md, «Назва й іконка»): фрагмент нашої схеми
 * маршрутів. Шість ліній головної вулиці (Лікарня → Центр; згори вниз №10, №3, №12, №5, №7, №2 — як на схемі)
 * здіймаються під 45° з концентричними поворотами до пересадки-пігулки, нижче — Ірша. Кольори ліній читаються
 * зі згенерованої легенди схеми (scheme/malyn-scheme-routes.ts): змінили палітру схеми — перезапустіть скрипт.
 * SVG у 100-одиничному полі растеризує той Chromium, що Playwright і так ставить для e2e, — без бібліотек для
 * зображень. Запустити раз і ЗАКОМІТИТИ результат: Railway робить `npm ci` без браузера.
 *
 *   npm run pwa:icons          (PW_CHROMIUM=/шлях/до/chrome — якщо Playwright новіший за встановлені браузери)
 *
 * Три форми одного малюнка:
 *   - squircle — прозорі кути: Android «any», Windows, Linux, і favicon (yak-doikhaty.svg);
 *   - square   — біле до країв: apple-touch-icon (iOS маскує сам);
 *   - maskable — біле до країв, малюнок зменшений до 80 %, щоб пігулка лишилась у безпечному колі (радіус 40 %);
 *     лінії й вода все одно виходять за край.
 * Імена файлів — нові для кожного нового малюнка: /icons/* браузери й Cloudflare тримають добу (serve-dist-rules),
 * а нова адреса — це нова картинка одразу, і в precache воркера теж.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/icons');
const legendFile = path.resolve(here, '../src/pages/LocalTransportPage/scheme/malyn-scheme-routes.ts');

/** Головна вулиця схеми між Лікарнею і Центром, згори вниз */
const MAIN_STREET = ['10', '3', '12', '5', '7', '2'];
/** Кольори сторінки «Схема» (LocalTransportSchemePage.css): контур пересадки, берег і вода */
const INK = '#054752';
const SHORE = '#9ccfe8';
const WATER = '#d9ecf7';

/** Легенда — згенерований JSON-масив у TS-файлі (build_scheme.py) */
function routeColors(ids) {
  const src = readFileSync(legendFile, 'utf8');
  const routes = JSON.parse(src.slice(src.indexOf('= [') + 2, src.lastIndexOf(']') + 1));
  return ids.map((id) => {
    const route = routes.find((r) => r.id === id);
    if (!route) throw new Error(`маршруту №${id} немає в ${legendFile}`);
    return route.color;
  });
}

const fx = (n) => Number(n.toFixed(2));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1]));
const normal = (u) => [-u[1], u[0]];

/**
 * Лінія пучка: вісь, зсунута на `off` уздовж нормалі (miter у вершинах), з кутами-дугами. Радіус дуги — радіус
 * осі мінус зсув у бік повороту, тож дуги сусідніх ліній концентричні, як на схемах метро.
 */
function bundleLine(axis, off, radius) {
  const pts = axis.map((p, i) => {
    if (i === 0 || i === axis.length - 1) {
      const u = unit(i === 0 ? sub(axis[1], axis[0]) : sub(axis[i], axis[i - 1]));
      return add(p, mul(normal(u), off));
    }
    const na = normal(unit(sub(p, axis[i - 1])));
    const nb = normal(unit(sub(axis[i + 1], p)));
    return add(p, mul(add(na, nb), off / (1 + dot(na, nb))));
  });
  let d = `M${fx(pts[0][0])},${fx(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const ua = unit(sub(axis[i], axis[i - 1]));
    const ub = unit(sub(axis[i + 1], axis[i]));
    const r = radius - off * Math.sign(dot(normal(ua), ub));
    const t = r * Math.tan(Math.acos(Math.min(1, dot(ua, ub))) / 2);
    const a = sub(pts[i], mul(ua, t));
    const b = add(pts[i], mul(ub, t));
    const sweep = ua[0] * ub[1] - ua[1] * ub[0] > 0 ? 1 : 0;
    d += ` L${fx(a[0])},${fx(a[1])} A${fx(r)},${fx(r)} 0 0 ${sweep} ${fx(b[0])},${fx(b[1])}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${fx(last[0])},${fx(last[1])}`;
}

function bundle(axis, colors, { width, gap, radius }) {
  const step = width + gap;
  return colors
    .map((color, j) => {
      const off = (j - (colors.length - 1) / 2) * step;
      return `<path d="${bundleLine(axis, off, radius)}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
    })
    .join('');
}

/** Схема: вода, шість ліній, пігулка. Вісь і берег виходять далеко за поле — для зменшеного maskable */
function scheme() {
  const lines = { width: 4.4, gap: 1.25, radius: 21 };
  const shore = [[-40, 86], [44, 86], [62, 68], [140, 68]];
  const across = MAIN_STREET.length * lines.width + (MAIN_STREET.length - 1) * lines.gap + 7.5;
  return [
    `<path d="${bundleLine(shore, 0, 10)} L140,140 L-40,140 Z" fill="${WATER}"/>`,
    bundle(shore, [SHORE], { width: 2.2, gap: 0, radius: 10 }),
    bundle([[-40, 62], [28, 62], [58, 32], [140, 32]], routeColors(MAIN_STREET), lines),
    `<rect x="72.1" y="${fx(32 - across / 2)}" width="7.8" height="${fx(across)}" rx="3.9" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`,
  ].join('');
}

/** Малюнок у 100-одиничному полі: squircle або квадрат, за потреби зменшений навколо центру */
export function iconSvg({ square = false, scale = 1 } = {}) {
  const shape = `<rect width="100" height="100"${square ? '' : ' rx="22.5"'}`;
  const shift = (100 - 100 * scale) / 2;
  const art = scale === 1 ? scheme() : `<g transform="translate(${shift} ${shift}) scale(${scale})">${scheme()}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><clipPath id="icon">${shape}/></clipPath></defs>${shape} fill="#fff"/>` +
    `<g clip-path="url(#icon)">${art}</g></svg>`
  );
}

const ICONS = [
  // [файл, px, малюнок]
  ['yak-doikhaty-192.png', 192, iconSvg()],
  ['yak-doikhaty-512.png', 512, iconSvg()],
  ['yak-doikhaty-apple-180.png', 180, iconSvg({ square: true })],
  ['yak-doikhaty-maskable-512.png', 512, iconSvg({ square: true, scale: 0.8 })],
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'yak-doikhaty.svg'), `${iconSvg()}\n`, 'utf8');
  console.log('[gen-pwa-icons] yak-doikhaty.svg');

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
