/**
 * Найпростіший синтез для звуків тизера: шум, осцилятори, біквадратні фільтри (RBJ), огинаючі, запис WAV.
 * Усе генерується кодом — жодних чужих семплів, права на звук наші.
 */
import { writeFile } from 'node:fs/promises';

export const RATE = 48000;
export const TAU = Math.PI * 2;

export const buffer = (sec) => new Float32Array(Math.ceil(sec * RATE));

/** Детермінований шум (той самий звук при кожній генерації) */
let seed = 12345;
export const reseed = (s) => {
  seed = s;
};
export const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed / 2147483647) * 2 - 1;
};

/** Біквадратний фільтр; `set` дозволяє «вести» частоту (свіп) */
export function biquad(type, freq, q = 0.707) {
  let b0, b1, b2, a1, a2;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (f, qq = q) => {
    const w = (TAU * Math.min(f, RATE * 0.45)) / RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * qq);
    const a0 = 1 + alpha;
    if (type === 'lp') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === 'hp') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    a1 = -2 * cos;
    a2 = 1 - alpha;
    b0 /= a0;
    b1 /= a0;
    b2 /= a0;
    a1 /= a0;
    a2 /= a0;
  };
  set(freq, q);
  return {
    set,
    run(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y;
    },
  };
}

/** Додати звук `src` у `dst` з секунди `at` */
export function mix(dst, src, at, gain = 1) {
  const o = Math.round(at * RATE);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
}

/** Пік → `peak` (лінійно) */
export function normalize(data, peak = 0.89) {
  let m = 0;
  for (const v of data) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / m;
  return data;
}

/** Плавні 3 мс на початку й у кінці — без клацань */
export function fadeEdges(data, ms = 3) {
  const n = Math.round((ms / 1000) * RATE);
  for (let i = 0; i < n && i < data.length; i++) {
    data[i] *= i / n;
    data[data.length - 1 - i] *= i / n;
  }
  return data;
}

/** 16 біт, 48 кГц; `channels` = 2 — відліки впереміш (L, R, L, R…) */
export async function writeWav(file, data, channels = 1) {
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767)));
  const body = Buffer.from(pcm.buffer);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + body.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2 * channels, 28);
  h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(body.length, 40);
  await writeFile(file, Buffer.concat([h, body]));
}

/** Частота ноти: 'A3', 'C#4' */
export function note(name) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const base = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (base + (Number(m[3]) - 4) * 12) / 12);
}
