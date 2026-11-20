/**
 * Ролики «Доведе» для сайту: `npm run dovede:intro -- <ролик.mp4> [--slot intro|hint|welcome] [--width 1080] [--crf 28] [--dry <тека>]`.
 * - `intro` (типово) — ролик-вступ /dovede: `public/dovede/intro-<хеш>.*`, `src/pages/DovedePage/intro/introMedia.ts`;
 * - `hint` — міні-тизер перед табло зупинки після скану наклейки: `public/ads/hint-<хеш>.*`, `src/ads/hintMedia.ts`;
 * - `welcome` — ролик-привітання замість тизера на зупинках зі списку `WELCOME_STOPS` (src/ads/stickerAd.ts):
 *   `public/ads/welcome-<хеш>.*`, `src/ads/welcomeMedia.ts`.
 *
 * Локальний скрипт (потрібен ffmpeg; не для CI й не для Railway). Кодує тизер для вебу — H.264 High, `+faststart`
 * (грає, ще не докачавшись), колір bt709, AAC 128 кбіт/с — і знімає постер з першого кадру. Назва файлів — хеш
 * вмісту ролика (`public/dovede/intro-<8 hex>.mp4` / `.jpg`), тож serve-dist кешує їх назавжди; старі `intro-*`
 * видаляються, а `src/pages/DovedePage/intro/introMedia.ts` переписується новими назвами.
 * Новий ролик НЕ показується вдруге тим, хто бачив старий: для цього змініть ключ у `intro/introState.ts`.
 * `--dry <тека>` — лише закодувати в теку (порівняти розмір і якість), нічого в проєкті не змінюючи.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const src = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!src || !fs.existsSync(src)) {
  console.error('Usage: npm run dovede:intro -- <тизер.mp4> [--width 1080] [--crf 28] [--dry <тека>]');
  process.exit(1);
}
const SLOTS = {
  intro: { dir: 'dovede', prefix: 'intro', media: ['src', 'pages', 'DovedePage', 'intro', 'introMedia.ts'], name: 'INTRO', title: 'Ролик-вступ /dovede' },
  hint: { dir: 'ads', prefix: 'hint', media: ['src', 'ads', 'hintMedia.ts'], name: 'HINT', title: 'Міні-тизер перед табло зупинки' },
  welcome: { dir: 'ads', prefix: 'welcome', media: ['src', 'ads', 'welcomeMedia.ts'], name: 'WELCOME', title: 'Ролик-привітання перед табло зупинки' },
};
const slot = SLOTS[opt('slot', 'intro')];
if (!slot) {
  console.error('--slot: intro | hint | welcome');
  process.exit(1);
}
const width = Number(opt('width', '1080'));
const crf = Number(opt('crf', '28'));
const dry = opt('dry', null);

function ffmpeg(list) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...list], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg ${list.join(' ')} → ${r.status}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dovede-intro-'));
const video = path.join(tmp, 'intro.mp4');
ffmpeg([
  '-i', src,
  // Колір не перераховуємо: рендер Remotion не має позначки матриці, і без setparams ffmpeg 9 вважає його BT.601 й
  // переводить у bt709 — білий тло-кадр стає 251,253,253 замість 255 і на білій сторінці видно рамку ролика
  '-vf', `setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709,scale=${width}:-2:flags=lanczos`,
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
  '-movflags', '+faststart',
  video,
]);
const poster = path.join(tmp, 'intro.jpg');
ffmpeg(['-i', video, '-frames:v', '1', '-q:v', '3', poster]);

const bytes = fs.statSync(video).size;
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' });
const seconds = Math.round(Number(probe.stdout.trim()));
const hash = createHash('sha256').update(fs.readFileSync(video)).digest('hex').slice(0, 8);
const mb = (bytes / 1048576).toFixed(1);

if (dry) {
  fs.mkdirSync(dry, { recursive: true });
  fs.copyFileSync(video, path.join(dry, `intro-${width}-crf${crf}.mp4`));
  fs.copyFileSync(poster, path.join(dry, `intro-${width}-crf${crf}.jpg`));
  console.log(`✓ ${dry}/intro-${width}-crf${crf}.mp4: ${mb} МБ, ${seconds} с`);
  process.exit(0);
}

const { dir, prefix, name } = slot;
const outDir = path.join(root, 'public', dir);
fs.mkdirSync(outDir, { recursive: true });
const own = new RegExp(`^${prefix}-[0-9a-f]{8}\\.(mp4|jpg)$`);
for (const f of fs.readdirSync(outDir)) {
  if (own.test(f) && !f.startsWith(`${prefix}-${hash}.`)) fs.rmSync(path.join(outDir, f));
}
fs.copyFileSync(video, path.join(outDir, `${prefix}-${hash}.mp4`));
fs.copyFileSync(poster, path.join(outDir, `${prefix}-${hash}.jpg`));
fs.rmSync(tmp, { recursive: true, force: true });

const media = `// Згенеровано \`npm run dovede:intro -- … --slot ${opt('slot', 'intro')}\` (scripts/dovede-intro.mjs) — не редагувати руками.
/** ${slot.title}: \`public/${dir}/${prefix}-<хеш>.mp4\`, ${width} px завширшки, CRF ${crf} */
export const ${name}_VIDEO = '/${dir}/${prefix}-${hash}.mp4';
/** Постер — перший кадр ролика */
export const ${name}_POSTER = '/${dir}/${prefix}-${hash}.jpg';
/** Тривалість, с — для підпису на кнопці старту */
export const ${name}_SECONDS = ${seconds};
/** Розмір файлу, байти */
export const ${name}_BYTES = ${bytes};
/** Назва файлу без розширення — для обліку реклами (POST /ads/events) */
export const ${name}_NAME = '${prefix}-${hash}';
`;
fs.writeFileSync(path.join(root, ...slot.media), media);
console.log(`✓ public/${dir}/${prefix}-${hash}.mp4: ${mb} МБ, ${seconds} с; ${slot.media.join('/')} оновлено`);
