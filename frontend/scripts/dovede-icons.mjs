/**
 * Іконки вкладки й картка посилання «Доведе» (імена й тексти — scripts/dovede-brand.mjs). Логотип — як у ролику-вступі:
 * «Доведе» Golos Text 900 кольору сторінки, блакитна крапка на лінії рядка, на картці — ще й кільце «пульсу» навколо
 * крапки (кадр фіналу ролика). Іконка — «Д» і крапка на білій плитці: так логотип читається і в 16 px.
 * Растеризує Chromium із Playwright (як scripts/gen-pwa-icons.mjs), Golos Text — з Google Fonts (потрібна мережа; без
 * шрифту — помилка, а не картинка запасним шрифтом). Запустити раз і ЗАКОМІТИТИ результат: Railway робить `npm ci`
 * без браузера. Новий малюнок — нові імена в dovede-brand.mjs (`-v2`), бо favicon і прев'ю кешуються за адресою.
 *
 *   npm run dovede:icons      (PW_CHROMIUM=/шлях/до/chrome — якщо Playwright новіший за встановлені браузери)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DOVEDE_DOT, DOVEDE_ICONS, DOVEDE_INK, DOVEDE_OG } from './dovede-brand.mjs';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og-images.mjs';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
/** --dv-accent-ink: блакитний, що тримає контраст на білому, — для адреси на картці */
const URL_INK = '#0079ad';
const WEIGHTS = ['700', '900'];
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@${WEIGHTS.join(';')}&amp;display=block">`;

/**
 * «Д.» у полі 100×100: `tile` — біла плитка з тонкою рамкою і прозорими кутами (вкладка, Android), інакше біле до країв
 * (iOS заокруглює сам)
 */
function iconSvg(size, { tile }) {
  const plate = tile
    ? '<rect x="1" y="1" width="98" height="98" rx="22" fill="#fff" stroke="#d5dde0" stroke-width="2"/>'
    : '<rect width="100" height="100" fill="#fff"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${plate}
<text x="41" y="73" text-anchor="middle" font-family="Golos Text" font-weight="900" font-size="78" fill="${DOVEDE_INK}">Д</text>
<circle cx="80.5" cy="63.5" r="10" fill="${DOVEDE_DOT}"/></svg>`;
}

const iconPage = (svg) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}</head>
<body style="margin:0;background:transparent">${svg}</body></html>`;

/** Картка 1200×630 — останній кадр ролика, покладений набік */
function ogHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0}
.card{width:${OG_IMAGE_WIDTH}px;height:${OG_IMAGE_HEIGHT}px;background:#fff;color:${DOVEDE_INK};font-family:'Golos Text',sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center}
.mark{font-size:200px;font-weight:900;line-height:1;letter-spacing:-0.025em;display:flex;align-items:baseline;margin-top:-10px}
.dot{position:relative;display:inline-block;width:0.22em;height:0.22em;border-radius:50%;background:${DOVEDE_DOT};margin-left:0.05em}
.ring{position:absolute;left:50%;top:50%;width:1.9em;height:1.9em;transform:translate(-50%,-50%);border-radius:50%;
  border:0.2em solid rgba(0,175,245,0.32);box-sizing:border-box;font-size:0.22em}
.tag{margin-top:34px;font-size:50px;font-weight:700;letter-spacing:-0.01em}
.url{margin-top:22px;font-size:40px;font-weight:700;color:${URL_INK}}
</style></head><body><div class="card">
<div class="mark">Доведе<span class="dot"><i class="ring"></i></span></div>
<div class="tag">Спитайте своїми словами.</div>
<div class="url">dovede.online</div>
</div></body></html>`;
}

/** Golos Text справді завантажився (document.fonts.check() каже «так» і тоді, коли шрифту взагалі нема) */
async function assertGolosLoaded(page) {
  const loaded = await page.evaluate(async (weights) => {
    await Promise.all(weights.map((w) => document.fonts.load(`${w} 32px "Golos Text"`, 'Доведе')));
    return [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, '') === 'Golos Text' && f.status === 'loaded')
      .map((f) => String(f.weight));
  }, WEIGHTS);
  const missing = WEIGHTS.filter((w) => !loaded.includes(w));
  if (missing.length) throw new Error(`Golos Text ${missing.join('/')} не завантажився з Google Fonts — потрібна мережа`);
}

async function render(browser, html, width, height, transparent) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await assertGolosLoaded(page);
    return await page.screenshot({ clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  } finally {
    await page.close();
  }
}

function save(publicPath, png) {
  const file = path.join(publicDir, publicPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`[dovede-icons] ${publicPath.slice(1)} (${png.length} bytes)`);
}

async function main() {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const [file, size, tile] of [
      [DOVEDE_ICONS.png32, 32, true],
      [DOVEDE_ICONS.png192, 192, true],
      [DOVEDE_ICONS.apple180, 180, false],
    ]) {
      save(file, await render(browser, iconPage(iconSvg(size, { tile })), size, size, true));
    }
    save(DOVEDE_OG.path, await render(browser, ogHtml(), OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, false));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
