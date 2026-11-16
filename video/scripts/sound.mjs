/**
 * Звук тизера, згенерований кодом (`npm run sound`; файли в public/audio/, у git не потрапляють):
 *  - sfx/*.wav — звуки подій у кадрі (клавіші, тап, «вжух», удар, підскок крапки, шпилька, папір, перекидні
 *    цифри, сповіщення, помилка, сканер, «плінк» лінії, дзвіночок фіналу);
 *  - temp-125.wav — ТИМЧАСОВА музика 125 BPM за брифом зі script.md (глухий вступ → удари слогана → дроп на
 *    0:09,6 → грув → наростання → фінал). Лише щоб оцінити темп і мікс, доки немає справжнього ШІ-треку.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { biquad, buffer, fadeEdges, mix, noise, normalize, note, RATE, reseed, TAU, writeWav } from './dsp.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');
const t = (i) => i / RATE;

/* ---------------- звуки подій ---------------- */

const sfx = {
  key(v = 0) {
    reseed(100 + v);
    const d = buffer(0.045);
    const bp = biquad('bp', 2400 + v * 650, 1.3);
    for (let i = 0; i < d.length; i++) d[i] = bp.run(noise()) * Math.exp(-t(i) / 0.005) * 2.2 + Math.sin(TAU * 170 * t(i)) * Math.exp(-t(i) / 0.008) * 0.25;
    return d;
  },
  tap() {
    reseed(7);
    const d = buffer(0.14);
    const bp = biquad('bp', 3000, 1);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (110 + 110 * Math.exp(-t(i) / 0.02))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.035) * 0.8 + bp.run(noise()) * Math.exp(-t(i) / 0.003) * 0.6;
    }
    return d;
  },
  whoosh() {
    reseed(21);
    const len = 0.55;
    const d = buffer(len);
    const bp = biquad('bp', 300, 0.9);
    for (let i = 0; i < d.length; i++) {
      const k = t(i) / len;
      if (i % 32 === 0) bp.set(300 * Math.pow(9, k), 0.9);
      d[i] = bp.run(noise()) * Math.pow(Math.sin(Math.PI * k), 2) * 1.8;
    }
    return d;
  },
  riser() {
    reseed(33);
    const len = 0.96;
    const d = buffer(len);
    const hp = biquad('hp', 200, 0.8);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const k = t(i) / len;
      if (i % 32 === 0) hp.set(200 * Math.pow(30, k), 0.8);
      ph += (TAU * (180 + 900 * k * k)) / RATE;
      d[i] = (hp.run(noise()) * 0.9 + Math.sin(ph) * 0.25) * k * k;
    }
    return d;
  },
  impact() {
    reseed(44);
    const d = buffer(1.6);
    const lp = biquad('lp', 260, 0.7);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (40 + 60 * Math.exp(-t(i) / 0.08))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.5) + lp.run(noise()) * Math.exp(-t(i) / 0.12) * 2.4;
    }
    return d;
  },
  hit() {
    reseed(55);
    const d = buffer(0.35);
    const bp = biquad('bp', 1500, 0.8);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (50 + 100 * Math.exp(-t(i) / 0.03))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.12) + bp.run(noise()) * Math.exp(-t(i) / 0.05) * 0.9;
    }
    return d;
  },
  tup() {
    const d = buffer(0.13);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (330 + 420 * Math.exp(-t(i) / 0.03))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.045);
    }
    return d;
  },
  ding() {
    const d = buffer(0.6);
    for (let i = 0; i < d.length; i++) d[i] = (Math.sin(TAU * 1318.5 * t(i)) + 0.55 * Math.sin(TAU * 1975.5 * t(i))) * Math.exp(-t(i) / 0.17) * Math.min(1, t(i) / 0.003) * 0.6;
    return d;
  },
  bonk() {
    const d = buffer(0.3);
    const lp = biquad('lp', 1300, 0.8);
    for (let i = 0; i < d.length; i++) d[i] = lp.run(Math.sign(Math.sin(TAU * 155 * t(i))) * 0.5 + Math.sin(TAU * 103 * t(i))) * Math.exp(-t(i) / 0.1);
    return d;
  },
  pin() {
    reseed(66);
    const d = buffer(0.09);
    const bp = biquad('bp', 1800, 3);
    for (let i = 0; i < d.length; i++) d[i] = bp.run(noise()) * Math.exp(-t(i) / 0.01) * 3 + Math.sin(TAU * 940 * t(i)) * Math.exp(-t(i) / 0.016) * 0.45;
    return d;
  },
  rip() {
    reseed(77);
    const len = 0.42;
    const d = buffer(len);
    const bp = biquad('bp', 2600, 0.6);
    let grain = 1;
    for (let i = 0; i < d.length; i++) {
      if (i % 144 === 0) grain = 0.25 + 0.75 * Math.abs(noise());
      const env = Math.min(1, t(i) / 0.02) * Math.exp(-Math.max(0, t(i) - 0.12) / 0.09);
      d[i] = bp.run(noise()) * grain * env * 2.2;
    }
    return d;
  },
  tick() {
    reseed(88);
    const d = buffer(0.025);
    const hp = biquad('hp', 5000, 0.8);
    for (let i = 0; i < d.length; i++) d[i] = hp.run(noise()) * Math.exp(-t(i) / 0.0025) * 2;
    return d;
  },
  flap() {
    reseed(99);
    const d = buffer(0.3);
    const click = sfx.tick();
    let at = 0;
    for (let k = 0; k < 8; k++) {
      mix(d, click, at, 0.6 + 0.4 * Math.abs(noise()));
      at += 0.024 + Math.abs(noise()) * 0.012;
    }
    return d;
  },
  plink(n = 0) {
    const scale = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6'];
    const f = note(scale[n % scale.length]);
    const d = buffer(0.55);
    for (let i = 0; i < d.length; i++) d[i] = (Math.sin(TAU * f * t(i)) + 0.35 * Math.sin(TAU * 2 * f * t(i)) + 0.12 * Math.sin(TAU * 3 * f * t(i))) * Math.exp(-t(i) / 0.16) * Math.min(1, t(i) / 0.002) * 0.6;
    return d;
  },
  beep() {
    const d = buffer(0.22);
    for (let i = 0; i < d.length; i++) {
      const s = t(i);
      const f = s < 0.075 ? 1900 : s > 0.1 && s < 0.175 ? 2500 : 0;
      d[i] = f ? Math.sin(TAU * f * s) * 0.5 : 0;
    }
    return d;
  },
  pop() {
    const d = buffer(0.09);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (380 + 600 * (1 - Math.exp(-t(i) / 0.02)))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.025);
    }
    return d;
  },
  /** Компостер (сторіс «Квиток»): металеве клацання — шум крізь смуговий фільтр — і глухий удар, як на сайті (punchSound.ts) */
  clack() {
    const d = buffer(0.18);
    const bp = biquad('bp', 2600, 1.4);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (55 + 115 * Math.exp(-t(i) / 0.04))) / RATE;
      d[i] = bp.run(noise()) * Math.exp(-t(i) / 0.012) * 1.8 + Math.sin(ph) * Math.exp(-t(i) / 0.05) * 0.7;
    }
    return d;
  },
  /** Штамп «щасливий»: глухий удар гумою об папір */
  thud() {
    const d = buffer(0.22);
    const lp = biquad('lp', 900, 0.8);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (TAU * (48 + 70 * Math.exp(-t(i) / 0.05))) / RATE;
      d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.07) + lp.run(noise()) * Math.exp(-t(i) / 0.01) * 0.6;
    }
    return d;
  },
  ting() {
    const d = buffer(1.8);
    for (let i = 0; i < d.length; i++) d[i] = (Math.sin(TAU * 1760 * t(i)) + 0.5 * Math.sin(TAU * 2640 * t(i)) + 0.22 * Math.sin(TAU * 4185 * t(i))) * Math.exp(-t(i) / 0.5) * Math.min(1, t(i) / 0.002) * 0.5;
    return d;
  },
};

/* ---------------- тимчасова музика 125 BPM ---------------- */

const BEAT = 60 / 125;
const BAR = BEAT * 4;
const S16 = BEAT / 4;

function kick() {
  const d = buffer(0.42);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    ph += (TAU * (46 + 110 * Math.exp(-t(i) / 0.03))) / RATE;
    d[i] = Math.sin(ph) * Math.exp(-t(i) / 0.2);
  }
  return d;
}
function clap() {
  reseed(5);
  const d = buffer(0.25);
  const bp = biquad('bp', 1150, 1);
  for (let i = 0; i < d.length; i++) {
    const s = t(i);
    const burst = [0, 0.011, 0.022].some((b) => s >= b && s < b + 0.008) ? 1 : 0;
    d[i] = bp.run(noise()) * (burst * 0.9 + Math.exp(-Math.max(0, s - 0.022) / 0.09) * (s >= 0.022 ? 0.8 : 0)) * 2;
  }
  return d;
}
function hat(open = false, muffled = false) {
  reseed(open ? 6 : 8);
  const d = buffer(open ? 0.25 : 0.06);
  const f = muffled ? biquad('bp', 3200, 0.8) : biquad('hp', 7500, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = f.run(noise()) * Math.exp(-t(i) / (open ? 0.12 : 0.022)) * 1.4;
  return d;
}
function saw(f, len, cutoff, decay, attack = 0.004) {
  const d = buffer(len);
  const lp = biquad('lp', cutoff, 0.8);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    ph = (ph + f / RATE) % 1;
    d[i] = lp.run(ph * 2 - 1) * Math.min(1, t(i) / attack) * (decay ? Math.exp(-t(i) / decay) : 1);
  }
  return fadeEdges(d, 4);
}
function pad(freqs, len, cutoff = 900) {
  const d = buffer(len);
  for (const f of freqs) for (const det of [0.997, 1.003]) mix(d, saw(f * det, len, cutoff, 0, 0.35), 0, 0.12);
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, (len - t(i)) / 0.3);
  return d;
}
function pluck(freqs, cutoff = 2600) {
  const d = buffer(0.4);
  for (const f of freqs) mix(d, saw(f, 0.4, cutoff, 0.11), 0, 0.22);
  return d;
}

const CHORDS = [
  { bass: 'A2', notes: ['A3', 'C4', 'E4'] },
  { bass: 'F2', notes: ['F3', 'A3', 'C4'] },
  { bass: 'C3', notes: ['C4', 'E4', 'G4'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4'] },
].map((c) => ({ bass: note(c.bass), notes: c.notes.map(note) }));

function tempMusic() {
  const total = 28 * BAR + 3;
  const m = buffer(total);
  const K = kick();
  const C = clap();
  const H = hat();
  const HO = hat(true);
  const HM = hat(false, true);
  const TICK = sfx.tick();

  // A — глухий вступ (такти 0–3): тікання, приглушені хети, низький пед
  mix(m, pad(CHORDS[0].notes, 4 * BAR, 520), 0, 0.9);
  for (let b = 0; b < 16; b++) {
    mix(m, TICK, b * BEAT, 0.35);
    mix(m, HM, b * BEAT + BEAT / 2, 0.25);
  }
  mix(m, sfx.riser(), 4 * BAR - 0.96, 0.7);

  // B — удар і чотири удари слогана (такт 4)
  mix(m, sfx.impact(), 4 * BAR, 0.9);
  for (let b = 0; b < 4; b++) {
    mix(m, K, 4 * BAR + b * BEAT, 1);
    mix(m, pluck(CHORDS[0].notes, 3200), 4 * BAR + b * BEAT, 1.1);
  }

  // C–F — грув (такти 5–20)
  const groove = (bar, opts = {}) => {
    const c = CHORDS[(bar - 5 + 400) % 4];
    const at = bar * BAR;
    for (let b = 0; b < 4; b++) {
      if (!opts.noKick) mix(m, K, at + b * BEAT, 1);
      if (b % 2 === 1) mix(m, C, at + b * BEAT, 0.7);
      mix(m, H, at + b * BEAT + BEAT / 2, 0.35);
      if (b % 2 === 0) mix(m, H, at + b * BEAT, 0.18);
      if (bar % 2 === 1 && b === 3) mix(m, HO, at + b * BEAT + BEAT / 2, 0.3);
    }
    for (let e = 0; e < 8; e++) mix(m, saw(c.bass * (e % 4 === 3 ? 2 : 1), BEAT / 2, 520, 0.12), at + e * (BEAT / 2), 0.5);
    const up = opts.high ? 2 : 1;
    [0, 3, 6, 8, 11, 14].forEach((s, j) => mix(m, pluck([c.notes[j % 3] * up], opts.cutoff ?? 2600), at + s * S16, 0.9));
    if ((bar - 5) % 4 === 3) for (let s = 12; s < 16; s++) mix(m, C, at + s * S16, 0.3 + 0.1 * (s - 12));
  };
  for (let bar = 5; bar <= 20; bar++) groove(bar, { high: bar >= 13 && bar <= 16 });

  // G — наростання (такти 21–23): без бочки, фільтр відкривається, дріб пришвидшується
  for (let bar = 21; bar <= 23; bar++) {
    const k = (bar - 21) / 3;
    groove(bar, { noKick: true, cutoff: 700 + 3000 * k });
    const div = bar === 23 ? 16 : 8;
    for (let s = 0; s < div; s++) mix(m, C, bar * BAR + (s * BAR) / div, 0.15 + 0.25 * (s / div) * (bar === 23 ? 1 : 0.6));
  }
  mix(m, sfx.riser(), 24 * BAR - 0.96, 0.6);

  // H — фінал (такти 24–27): грув ще такт, далі пед і удари; останній акорд на 26-му з довгим хвостом
  mix(m, sfx.impact(), 24 * BAR, 0.6);
  groove(24);
  groove(25, { cutoff: 1800 });
  mix(m, pad(CHORDS[2].notes, 2 * BAR + 3, 1200), 26 * BAR, 1.1);
  mix(m, K, 26 * BAR, 1);
  mix(m, pluck(CHORDS[2].notes, 3500), 26 * BAR, 1.2);
  mix(m, sfx.ting(), 28 * BAR - BEAT / 2, 0.35);

  return fadeEdges(normalize(m, 0.8), 20);
}

await mkdir(path.join(OUT, 'sfx'), { recursive: true });
const files = {
  key0: sfx.key(0),
  key1: sfx.key(1),
  key2: sfx.key(2),
  tap: sfx.tap(),
  whoosh: sfx.whoosh(),
  riser: sfx.riser(),
  impact: sfx.impact(),
  hit: sfx.hit(),
  tup: sfx.tup(),
  ding: sfx.ding(),
  bonk: sfx.bonk(),
  pin: sfx.pin(),
  rip: sfx.rip(),
  tick: sfx.tick(),
  flap: sfx.flap(),
  beep: sfx.beep(),
  pop: sfx.pop(),
  ting: sfx.ting(),
  clack: sfx.clack(),
  thud: sfx.thud(),
};
for (let n = 0; n < 10; n++) files[`plink${n}`] = sfx.plink(n);
for (const [name, data] of Object.entries(files)) await writeWav(path.join(OUT, 'sfx', `${name}.wav`), fadeEdges(normalize(data, 0.9), 2));
console.log(`✓ audio/sfx: ${Object.keys(files).length} звуків`);
await writeWav(path.join(OUT, 'temp-125.wav'), tempMusic());
console.log('✓ audio/temp-125.wav — тимчасова музика 125 BPM');
