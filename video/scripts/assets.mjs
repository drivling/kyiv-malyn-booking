/**
 * Статичні матеріали сцен у public/assets/ (у git не потрапляють — копії з репозиторію): `npm run assets`.
 *  - схеми Малина й Коростеня (SVG з frontend/public/transport/scheme/ — ті самі, що на сайті й на плакатах);
 *  - фото наклейки «з-д «Прожектор»» з першого поста про наклейки (Docs/facebook-preview-assets), обрізане по
 *    самому фото (без рамки макета). Потрібен ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(VIDEO, '..');
const OUT = path.join(VIDEO, 'public', 'assets');
await mkdir(OUT, { recursive: true });

for (const name of ['malyn-transit-scheme-poster.svg', 'korosten-transit-scheme-poster.svg']) {
  await copyFile(path.join(REPO, 'frontend', 'public', 'transport', 'scheme', name), path.join(OUT, name));
  console.log(`✓ assets/${name}`);
}

const sticker = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-y', '-i', path.join(REPO, 'Docs', 'facebook-preview-assets', 'stickers-1-cover.jpg'), '-vf', 'crop=540:745:480:535', '-q:v', '2', path.join(OUT, 'sticker-prozhektor.jpg')],
  { stdio: 'inherit' },
);
if (sticker.status !== 0) throw new Error('ffmpeg не зміг обрізати фото наклейки (brew install ffmpeg)');
console.log('✓ assets/sticker-prozhektor.jpg');
