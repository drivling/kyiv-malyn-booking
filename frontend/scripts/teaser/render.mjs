/**
 * Міні-тизери з крапкою (`npm run dovede:teaser -- <welcome|credit> […]`), 1080×1920, 30 кадрів/с, 7,7 с:
 * - `welcome` — крапка з ролика «Крапка» так само з'являється й стрибає, але «друкує» два рядки тексту й стає крапкою
 *   в кінці: `--l1 Вітаємо --l2 "в Малині"` (типово саме так). Звук — із ролика «Крапка» (`--audio`), рух у такт;
 * - `credit` — на готовий ролик «Крапка» (`--base`, обов'язковий) накладається підпис компанії внизу. База має бути
 *   БЕЗ підпису: рендер Remotion або `git show 94195ac:frontend/public/ads/hint-711724d9.mp4 > крапка.mp4`.
 * Підпис в обох однаковий: знак і «ТОВ «Технології»» з `technologies-logo-uk-line.svg`, з'являється з 5-ї секунди.
 *
 * Локальний скрипт (ffmpeg і мережа до Google Fonts; не для CI й не для Railway). Сцена — `scene.html`: усе в ній
 * залежить лише від номера кадру, Chromium із Playwright знімає кадри, ffmpeg складає H.264 (bt709) зі звуком.
 * Результат — у `out/` (у .gitignore); на сайт ролик кладе `npm run dovede:intro -- <ролик> --slot hint` («Крапка»)
 * чи `--slot welcome` (привітання на зупинках із `WELCOME_STOPS`, src/ads/stickerAd.ts).
 * `PW_CHROMIUM=/шлях/до/chrome` — якщо Playwright новіший за встановлені браузери.
 *
 * Логотип українською (`technologies-logo-uk.svg` — знак + «Технології» + «ТОВ», `…-uk-line.svg` — рядок для
 * дрібного розміру) малює `lockup.py`: слово — Montserrat кривими (у «Technologies» на сайті компанії Poppins,
 * кирилиці в ньому нема).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (mode !== 'welcome' && mode !== 'credit') {
  console.error('Usage: npm run dovede:teaser -- welcome [--l1 Вітаємо] [--l2 "в Малині"] [--audio <крапка.mp4>] [--out <файл.mp4>]\n'
    + '       npm run dovede:teaser -- credit  --base <крапка без підпису.mp4> [--out <файл.mp4>]');
  process.exit(1);
}

/** Ролик «Крапка», що зараз на сайті (src/ads/hintMedia.ts) */
function currentHint() {
  const media = fs.readFileSync(path.join(root, 'src', 'ads', 'hintMedia.ts'), 'utf8');
  const m = media.match(/HINT_VIDEO = '([^']+)'/);
  if (!m) throw new Error('src/ads/hintMedia.ts: HINT_VIDEO не знайдено');
  return path.join(root, 'public', m[1]);
}
// база для `credit` — лише явно: ролик на сайті вже з підписом, удруге накладати його не можна
const given = mode === 'welcome' ? opt('audio', currentHint()) : opt('base');
if (!given || !fs.existsSync(given)) {
  console.error(given ? `Немає файлу ${given}` : '--base <ролик «Крапка» без підпису.mp4> обов\'язковий');
  process.exit(1);
}
const source = path.resolve(given);
const out = path.resolve(opt('out', path.join(root, 'out', mode === 'welcome' ? 'teaser-welcome.mp4' : 'hint-credit.mp4')));
const crf = String(Number(opt('crf', '14')));
fs.mkdirSync(path.dirname(out), { recursive: true });

const WIDTH = 1080;
const HEIGHT = 1920;
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const X264 = ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', ...BT709];
/** Кадри Chromium — повний RGB; у відео — bt709 і телевізійний діапазон, інакше біле тло стає сіруватим */
const TO_709 = 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709';

const url = pathToFileURL(path.join(here, 'scene.html'));
url.searchParams.set('mode', mode);
for (const key of ['l1', 'l2']) if (opt(key) != null) url.searchParams.set(key, opt(key));

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let ffmpeg;
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.goto(url.href);
  if (mode === 'welcome') {
    await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@800&display=block' });
  }
  const creditSvg = fs.readFileSync(path.join(here, 'technologies-logo-uk-line.svg'), 'utf8');
  const info = await page.evaluate((svg) => window.teaser.init(svg), creditSvg);

  const frames = ['-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'png', '-i', 'pipe:0'];
  const list = mode === 'welcome'
    ? [...frames, '-i', source, '-map', '0:v', '-map', '1:a', '-vf', `${TO_709},format=yuv420p`]
    : ['-i', source, ...frames,
      '-filter_complex', `[1:v]${TO_709},format=yuva420p[c];[0:v][c]overlay=eof_action=repeat[v]`, '-map', '[v]', '-map', '0:a'];
  ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', ...list, ...X264, '-c:a', 'copy', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg → ${code}`))));
  });
  for (let f = 0; f < info.frames; f++) {
    await page.evaluate((n) => window.teaser.setFrame(n), f);
    const png = await page.screenshot({ type: 'png', omitBackground: mode === 'credit' });
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  ffmpeg.stdin.end();
  await done;
  const kb = Math.round(fs.statSync(out).size / 1024);
  const text = info.layout ? `, кегль ${info.layout.size}, крапка ${info.layout.dot} px` : '';
  console.log(`✓ ${path.relative(process.cwd(), out)}: ${info.frames} кадрів, ${kb} КБ${text}`);
} finally {
  ffmpeg?.stdin.destroy();
  await browser.close();
}
