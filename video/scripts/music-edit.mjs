/**
 * Монтаж музики під ролик: `npm run music` → public/audio/music/<версія>.wav для кожного монтажу з src/audio/music.json.
 *
 * Трек декодується ffmpeg-ом (48 кГц, стерео), шматки `[від, до)` у тактах від дропу склеюються впритул
 * (рівносильний перехід 10 мс по центру шва — без клацань). Файл починається з тиші так, що його секунда 0 — це
 * кадр 0 ролика, а дроп лягає рівно на біт `dropBeat`; отже ролик просто грає файл з початку, без округлень до кадру.
 * Гучність — як у тимчасового треку (−21,2 LUFS інтегральна), під яку зведено звуки кадрів; пік не вище −0,3 dBFS.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { RATE, writeWav } from './dsp.mjs';

const TARGET_LUFS = -21.2;
const PEAK = 0.966;
const SEAM = Math.round(0.01 * RATE);

const cfg = JSON.parse(await readFile(new URL('../src/audio/music.json', import.meta.url), 'utf8'));
const source = new URL(`../public/${cfg.file}`, import.meta.url).pathname;
const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
if (pcm.status !== 0) throw new Error(`ffmpeg не прочитав ${source}: ${pcm.stderr}`);
const src = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.length / 4);
const srcFrames = src.length / 2;

const BEAT = 60 / cfg.bpm;
const BAR = BEAT * 4;

/** Відлік каналу `ch` у дробовій позиції `pos` (кадри треку) — лінійна інтерполяція; за межами треку — тиша */
function at(pos, ch) {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= srcFrames) return 0;
  const f = pos - i;
  return src[i * 2 + ch] * (1 - f) + src[(i + 1) * 2 + ch] * f;
}

function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=sample', '-f', 'null', '-'], { encoding: 'utf8' });
  const summary = r.stderr.slice(r.stderr.lastIndexOf('Summary'));
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
}

await mkdir(new URL('../public/audio/music/', import.meta.url), { recursive: true });

for (const [name, edit] of Object.entries(cfg.edits)) {
  const H = SEAM / 2;
  // секунда ролика, з якої звучить перший шматок
  let t = edit.dropBeat * BEAT + edit.bars[0][0] * BAR;
  const length = t + edit.bars.reduce((s, [a, b]) => s + (b - a) * BAR, 0);
  const out = new Float32Array(Math.ceil(length * RATE) * 2);
  const frames = out.length / 2;
  edit.bars.forEach(([from, to], k) => {
    const a = t * RATE;
    const b = (t + (to - from) * BAR) * RATE;
    const srcStart = (cfg.drop + from * BAR) * RATE;
    const first = k === 0;
    const last = k === edit.bars.length - 1;
    for (let n = Math.max(0, Math.floor(first ? a : a - H)); n < Math.min(frames, Math.ceil(last ? b : b + H)); n++) {
      let g = 1;
      if (!first && n < a + H) g *= Math.sin((((n - (a - H)) / SEAM) * Math.PI) / 2);
      if (!last && n > b - H) g *= Math.cos((((n - (b - H)) / SEAM) * Math.PI) / 2);
      // кінець останнього шматка — 5 мс згасання, щоб не клацнуло
      if (last && n > b - 240) g *= Math.max(0, (b - n) / 240);
      const pos = srcStart + (n - a);
      out[n * 2] += g * at(pos, 0);
      out[n * 2 + 1] += g * at(pos, 1);
    }
    console.log(`  ${name}: такти ${from}…${to} (${(cfg.drop + from * BAR).toFixed(2)}–${(cfg.drop + to * BAR).toFixed(2)} с треку) → ${t.toFixed(2)} с ролика`);
    t += (to - from) * BAR;
  });

  const file = new URL(`../public/audio/music/${name}.wav`, import.meta.url).pathname;
  await writeWav(file, out, 2);
  const I = loudness(file);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  let gain = 10 ** ((TARGET_LUFS - I) / 20);
  if (peak * gain > PEAK) {
    console.log(`  ${name}: пік обмежив підсилення (${(20 * Math.log10(PEAK / peak)).toFixed(1)} дБ замість ${(20 * Math.log10(gain)).toFixed(1)})`);
    gain = PEAK / peak;
  }
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  await writeWav(file, out, 2);
  console.log(`✓ public/audio/music/${name}.wav: ${length.toFixed(2)} с, ${I.toFixed(1)} → ${loudness(file).toFixed(1)} LUFS, дроп на ${(edit.dropBeat * BEAT).toFixed(2)} с`);
}
