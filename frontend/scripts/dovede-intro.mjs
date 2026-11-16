/**
 * Ролик-вступ «Доведе» для сайту: `npm run dovede:intro -- <тизер.mp4> [--width 1080] [--crf 28] [--dry <тека>]`.
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

const outDir = path.join(root, 'public', 'dovede');
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (/^intro-[0-9a-f]{8}\.(mp4|jpg)$/.test(f) && !f.startsWith(`intro-${hash}.`)) fs.rmSync(path.join(outDir, f));
}
fs.copyFileSync(video, path.join(outDir, `intro-${hash}.mp4`));
fs.copyFileSync(poster, path.join(outDir, `intro-${hash}.jpg`));
fs.rmSync(tmp, { recursive: true, force: true });

const media = `// Згенеровано \`npm run dovede:intro\` (scripts/dovede-intro.mjs) — не редагувати руками.
/** Ролик-вступ: \`public/dovede/intro-<хеш>.mp4\`, ${width} px завширшки, CRF ${crf} */
export const INTRO_VIDEO = '/dovede/intro-${hash}.mp4';
/** Постер — перший кадр ролика */
export const INTRO_POSTER = '/dovede/intro-${hash}.jpg';
/** Тривалість, с — для підпису на кнопці старту */
export const INTRO_SECONDS = ${seconds};
/** Розмір файлу, байти */
export const INTRO_BYTES = ${bytes};
`;
fs.writeFileSync(path.join(root, 'src', 'pages', 'DovedePage', 'intro', 'introMedia.ts'), media);
console.log(`✓ public/dovede/intro-${hash}.mp4: ${mb} МБ, ${seconds} с; intro/introMedia.ts оновлено`);
