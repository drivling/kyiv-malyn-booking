/**
 * Фінальний звук для соцмереж: `npm run master -- out/teaser.mp4` → out/teaser-final.mp4.
 * Гучність −14 LUFS (інтегральна), пік ≤ −1 dBTP — два проходи ffmpeg loudnorm і лімітер на −1,9 dBFS (AAC додає міжвідлікові піки); відео не перекодовується,
 * звук — AAC 48 кГц 192 кбіт/с, стерео.
 */
import { spawnSync } from 'node:child_process';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run master -- out/<файл>.mp4');
  process.exit(1);
}
const output = input.replace(/\.mp4$/, '-final.mp4');
const TARGET = 'I=-14:TP=-1:LRA=11';

const measure = spawnSync('ffmpeg', ['-hide_banner', '-i', input, '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
const json = JSON.parse(measure.stderr.slice(measure.stderr.lastIndexOf('{'), measure.stderr.lastIndexOf('}') + 1));
const second = `loudnorm=${TARGET}:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true,alimiter=limit=0.8:level=false`;
const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c:v', 'copy', '-af', second, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);

const check = spawnSync('ffmpeg', ['-hide_banner', '-i', output, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const summary = check.stderr.slice(check.stderr.lastIndexOf('Summary'));
const I = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
console.log(`✓ ${output}: було ${json.input_i} LUFS → стало ${I} LUFS, пік ${peak} dBTP`);
