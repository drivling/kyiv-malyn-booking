/**
 * Темп і сітка справжнього треку: `npm run analyze -- public/audio/<трек>.mp3 [--drop <секунда дропу>]`.
 * Декодує ffmpeg-ом у моно 22 050 Гц, рахує «силу атак» (прирости енергії), шукає темп автокореляцією в межах
 * 100–150 BPM і фазу біта; підказує `bpm` і `start` для src/audio/music.ts — так, щоб дроп треку ліг на 20-й біт
 * ролика (початок B2, 0:09,6 при 125 BPM). Секунду дропу краще перевірити на слух і передати `--drop`; без неї беремо найсильніший
 * сплеск енергії між 5-ю і 25-ю секундами.
 */
import { spawnSync } from 'node:child_process';

const file = process.argv[2];
const dropArg = process.argv.indexOf('--drop');
if (!file) {
  console.error('Usage: npm run analyze -- <трек> [--drop <секунда>]');
  process.exit(1);
}
const SR = 22050;
const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
if (pcm.status !== 0) throw new Error(pcm.stderr.toString());
const x = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.length / 4);

// енергія вікнами по 512 зі зсувом 128 → сила атаки = додатний приріст. Приріст у вікні i дають нові відліки
// [(i−1)·HOP + WIN, i·HOP + WIN) — тож час атаки ≈ (i·HOP + WIN − HOP/2) / SR
const HOP = 128;
const WIN = 512;
const env = [];
for (let i = 0; i + WIN < x.length; i += HOP) {
  let e = 0;
  for (let j = 0; j < WIN; j++) e += x[i + j] * x[i + j];
  env.push(Math.log(1e-9 + e));
}
const onset = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
const fps = SR / HOP;
const timeOf = (i) => (i * HOP + WIN - HOP / 2) / SR;

// темп: автокореляція сили атак — спершу грубо (0,1), потім точно (0,01)
function tempoScore(bpm) {
  const lag = (60 / bpm) * fps;
  let s = 0;
  for (let i = 0; i + lag * 4 < onset.length; i++) {
    const v = onset[i];
    if (!v) continue;
    for (const k of [1, 2, 4]) {
      const j = i + lag * k;
      const a = Math.floor(j);
      s += v * (onset[a] * (1 - (j - a)) + onset[a + 1] * (j - a));
    }
  }
  return s;
}
let best = { bpm: 0, score: -1 };
for (let b = 100; b <= 150; b += 0.1) {
  const s = tempoScore(b);
  if (s > best.score) best = { bpm: b, score: s };
}
for (let b = best.bpm - 0.15; b <= best.bpm + 0.15; b += 0.01) {
  const s = tempoScore(b);
  if (s > best.score) best = { bpm: b, score: s };
}
const bpm = Math.round(best.bpm * 100) / 100;
const beat = 60 / bpm;

// фаза: кругове середнє часу сильних атак за модулем біта (вага — квадрат сили: бочка важить більше за хет)
const peaks = onset.map((v, i) => ({ v, i })).filter(({ v, i }) => v > 0 && v >= (onset[i - 1] ?? 0) && v >= (onset[i + 1] ?? 0));
const strong = peaks.sort((a, b) => b.v - a.v).slice(0, Math.max(16, Math.round(peaks.length * 0.15)));
let cx = 0;
let cy = 0;
for (const { v, i } of strong) {
  const a = ((timeOf(i) % beat) / beat) * 2 * Math.PI;
  cx += v * v * Math.cos(a);
  cy += v * v * Math.sin(a);
}
const phase = { off: ((((Math.atan2(cy, cx) / (2 * Math.PI)) * beat) % beat) + beat) % beat };

// дроп: передана секунда або найсильніший приріст середньої енергії (вікно в такт) між 5 і 25 с
let drop;
if (dropArg >= 0) drop = Number(process.argv[dropArg + 1]);
else {
  const bar = Math.round(beat * 4 * fps);
  let bestJump = -Infinity;
  for (let i = Math.round(5 * fps); i < Math.min(env.length - bar, 25 * fps); i++) {
    const before = env.slice(i - bar, i).reduce((a, b) => a + b, 0) / bar;
    const after = env.slice(i, i + bar).reduce((a, b) => a + b, 0) / bar;
    if (after - before > bestJump) {
      bestJump = after - before;
      drop = i / fps;
    }
  }
}
// дроп — на найближчий біт сітки
const dropOnGrid = phase.off + Math.round((drop - phase.off) / beat) * beat;
// дроп ролика — початок B2: 16 бітів «старого світу» + 4 біти B1
const DROP_BEAT = 20;
const start = dropOnGrid - DROP_BEAT * beat;

console.log(`темп: ${bpm} BPM (біт ${beat.toFixed(3)} с), перший біт сітки: ${phase.off.toFixed(3)} с`);
console.log(`дроп: ${drop.toFixed(2)} с → на сітці ${dropOnGrid.toFixed(3)} с`);
console.log(`для src/audio/music.ts: bpm: ${bpm}, start: ${start.toFixed(3)}${start < -0.05 ? '  (від\'ємний: дроп зарано — ролик почнеться раніше за трек, вступ буде тихим)' : ''}`);
console.log(`довжина ролика з цим темпом: ${((112 * beat)).toFixed(2)} с`);
