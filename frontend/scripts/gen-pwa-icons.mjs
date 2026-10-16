/**
 * Іконки застосунку «Як доїхати» (Docs/transport-pwa-2026-10.md, «Назва й іконка»): фрагмент нашої схеми
 * маршрутів. Шість ліній головної вулиці (Лікарня → Центр; згори вниз №10, №3, №12, №5, №7, №2 — як на схемі)
 * здіймаються під 45° з концентричними поворотами до пересадки-пігулки, нижче — Ірша. Кольори ліній читаються
 * зі згенерованої легенди схеми (scheme/malyn-scheme-routes.ts): змінили палітру схеми — перезапустіть скрипт.
 * SVG растеризує той Chromium, що Playwright і так ставить для e2e, — без бібліотек для зображень. Запустити раз
 * і ЗАКОМІТИТИ результат: Railway робить `npm ci` без браузера.
 *
 *   npm run pwa:icons          (PW_CHROMIUM=/шлях/до/chrome — якщо Playwright новіший за встановлені браузери)
 *
 * Три форми одного малюнка:
 *   - squircle — прозорі кути: Android «any», Windows, Linux, і favicon (yak-doikhaty.svg, /favicon.ico 16/32/48);
 *   - square   — біле до країв: apple-touch-icon (iOS маскує сам);
 *   - maskable — біле до країв, малюнок зменшений до 80 %, щоб пігулка лишилась у безпечному колі (радіус 40 %);
 *     лінії й вода все одно виходять за край.
 * Плюс картки посилань 1200×630 (public/og, тексти й імена — scripts/og-images.mjs) для Telegram, LinkedIn,
 * Facebook: ті самі лінії на всю ширину, заголовок Golos Text з Google Fonts (потрібна мережа; без шрифту — помилка,
 * а не картка запасним шрифтом).
 * Імена файлів — нові для кожного нового малюнка: /icons/* браузери й Cloudflare тримають добу (serve-dist-rules),
 * месенджери кешують прев'ю за адресою картинки; нова адреса — це нова картинка одразу.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { OG_IMAGES, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og-images.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');
const outDir = path.join(publicDir, 'icons');
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

/**
 * Вода, шість ліній і пігулка в будь-якому масштабі: вісь пучка й берег — ламані, що виходять за поле, `bottom` —
 * нижня межа заливки води.
 */
function schemeArt({ axis, shore, bottom, lines, shoreWidth, shoreRadius, pill }) {
  const across = MAIN_STREET.length * lines.width + (MAIN_STREET.length - 1) * lines.gap + pill.margin;
  const [left, right] = [shore[0][0], shore[shore.length - 1][0]];
  return [
    `<path d="${bundleLine(shore, 0, shoreRadius)} L${right},${bottom} L${left},${bottom} Z" fill="${WATER}"/>`,
    bundle(shore, [SHORE], { width: shoreWidth, gap: 0, radius: shoreRadius }),
    bundle(axis, routeColors(MAIN_STREET), lines),
    `<rect x="${fx(pill.x - pill.thick / 2)}" y="${fx(pill.y - across / 2)}" width="${pill.thick}" height="${fx(across)}" ` +
      `rx="${pill.thick / 2}" fill="#fff" stroke="${INK}" stroke-width="${pill.stroke}"/>`,
  ].join('');
}

/** Іконка в 100-одиничному полі. Вісь і берег виходять далеко за поле — для зменшеного maskable */
function scheme() {
  return schemeArt({
    axis: [[-40, 62], [28, 62], [58, 32], [140, 32]],
    shore: [[-40, 86], [44, 86], [62, 68], [140, 68]],
    bottom: 140,
    lines: { width: 4.4, gap: 1.25, radius: 21 },
    shoreWidth: 2.2,
    shoreRadius: 10,
    pill: { x: 76, y: 32, thick: 7.8, stroke: 2.4, margin: 7.5 },
  });
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
const FAVICON_SIZES = [16, 32, 48];

/** Лінії на картці 1200×630: під текстом зліва, підйом праворуч до пігулки, вода в правому нижньому куті */
function ogArt() {
  const art = schemeArt({
    axis: [[-100, 515], [680, 515], [970, 225], [1300, 225]],
    shore: [[-100, 660], [740, 660], [920, 480], [1300, 480]],
    bottom: 800,
    lines: { width: 20, gap: 6, radius: 100 },
    shoreWidth: 6,
    shoreRadius: 40,
    pill: { x: 1100, y: 225, thick: 38, stroke: 10, margin: 40 },
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="art" viewBox="0 0 ${OG_IMAGE_WIDTH} ${OG_IMAGE_HEIGHT}">${art}</svg>`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Картка посилання: іконка з адресою, «Як доїхати», два рядки підзаголовка — ліворуч над лініями */
function ogCardHtml(image) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@500;700;800&amp;display=block">
<style>
html,body{margin:0}
.card{position:relative;width:${OG_IMAGE_WIDTH}px;height:${OG_IMAGE_HEIGHT}px;overflow:hidden;background:#fff;color:${INK};font-family:'Golos Text',sans-serif}
.art{position:absolute;inset:0;width:100%;height:100%}
.brand{position:absolute;left:72px;top:58px;display:flex;align-items:center;gap:18px;font-size:30px;font-weight:700;letter-spacing:-0.2px}
.brand svg{width:60px;height:60px;filter:drop-shadow(0 1px 2px rgba(5,71,82,0.25))}
h1{position:absolute;left:66px;top:148px;margin:0;font-size:116px;line-height:1;font-weight:800;letter-spacing:-3px}
p{position:absolute;left:72px;top:300px;margin:0;font-size:32px;line-height:1.28;font-weight:500;color:#3f6268;white-space:nowrap}
</style></head><body><div class="card">${ogArt()}
<div class="brand">${iconSvg()}<span>${esc(image.label)}</span></div>
<h1>${esc(image.title)}</h1>
<p>${image.lead.map(esc).join('<br>')}</p>
</div></body></html>`;
}

/** Golos Text справді завантажився (document.fonts.check() каже «так» і тоді, коли шрифту взагалі нема) */
async function assertGolosLoaded(page) {
  const weights = await page.evaluate(async () => {
    await Promise.all(['500', '700', '800'].map((w) => document.fonts.load(`${w} 32px "Golos Text"`, 'Як доїхати')));
    return [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, '') === 'Golos Text' && f.status === 'loaded')
      .map((f) => String(f.weight));
  });
  const missing = ['500', '700', '800'].filter((w) => !weights.includes(w));
  if (missing.length) throw new Error(`Golos Text ${missing.join('/')} не завантажився з Google Fonts — потрібна мережа`);
}

/** ICO з PNG-кадрами (так уміють усі браузери від Vista/IE9): заголовок, каталог, PNG підряд */
function icoFile(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.png)]);
}

async function render(browser, html, width, height, { transparent = true, fonts = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    if (fonts) await assertGolosLoaded(page);
    return await page.screenshot({ clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  } finally {
    await page.close();
  }
}

const iconPage = (drawing, size) =>
  `<!doctype html><html><body style="margin:0;background:transparent">${drawing.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'yak-doikhaty.svg'), `${iconSvg()}\n`, 'utf8');
  console.log('[gen-pwa-icons] yak-doikhaty.svg');

  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const [name, size, drawing] of ICONS) {
      const png = await render(browser, iconPage(drawing, size), size, size);
      writeFileSync(path.join(outDir, name), png);
      console.log(`[gen-pwa-icons] ${name} (${png.length} bytes)`);
    }

    const frames = [];
    for (const size of FAVICON_SIZES) frames.push({ size, png: await render(browser, iconPage(iconSvg(), size), size, size) });
    const ico = icoFile(frames);
    writeFileSync(path.join(publicDir, 'favicon.ico'), ico);
    console.log(`[gen-pwa-icons] favicon.ico ${FAVICON_SIZES.join('/')} (${ico.length} bytes)`);

    for (const image of Object.values(OG_IMAGES)) {
      const png = await render(browser, ogCardHtml(image), OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, { transparent: false, fonts: true });
      const file = path.join(publicDir, image.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);
      console.log(`[gen-pwa-icons] ${image.path.slice(1)} (${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
