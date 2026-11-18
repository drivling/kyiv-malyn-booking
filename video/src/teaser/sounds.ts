import type { SfxCue, SfxName } from '../audio/Sfx';
import { beats } from '../brand/beat';
import { FPS } from '../brand/tokens';
import { FINAL_URL } from './shots/H';
import type { Placed } from './timeline';

/**
 * Звуковий сценарій: які звуки в якому кадрі (кадри — від початку кадру ролика). Тайминги ті самі, що в
 * картинці: набір по літерах (як у зйомці), тапи з manifest, удари крапки на біт, «плінк» на кожну лінію схеми.
 */

const KEYS: SfxName[] = ['key0', 'key1', 'key2'];

/** Клавіші набору в зйомці: набір почався на кадрі зйомки `start` (`cps` знаків за секунду), Sequence показує зйомку з `from` зі швидкістю `rate` */
function typing(chars: number, cps: number, start: number, from: number, rate = 1, volume = 0.2, every = 1): SfxCue[] {
  const out: SfxCue[] = [];
  for (let i = 1; i <= chars; i += every) {
    const captureFrame = start - 1 + (i * FPS) / cps;
    out.push({ name: KEYS[i % 3], at: (captureFrame - from) / rate, volume: volume * (0.8 + 0.2 * ((i * 7) % 3)) / 1.2 });
  }
  return out.filter((c) => c.at >= 0);
}

/** «Плінк» на кожну з n ліній схеми — в ті кадри, коли SchemeSvg її вмикає */
const plinks = (n: number, first: number, span: number, volume = 0.28): SfxCue[] =>
  Array.from({ length: n }, (_, i) => ({ name: `plink${Math.min(9, i)}` as SfxName, at: first + (i * span) / n, volume }));

type CueFn = (shot: Placed) => SfxCue[];

const CUES: Record<string, CueFn> = {
  A1: ({ dur }) => Array.from({ length: 13 }, (_, i) => ({ name: KEYS[i % 3], at: ((i * 2 + 1) * dur * 0.8) / 26, volume: 0.22 })),
  A2: ({ dur }) => [{ name: 'whoosh', at: 3, volume: 0.22 }, ...Array.from({ length: 9 }, (_, k) => ({ name: 'pop' as SfxName, at: ((k + 1) / 12) * dur, volume: 0.18 }))],
  A3: ({ dur }) => Array.from({ length: 8 }, (_, i) => ({ name: 'ding' as SfxName, at: i * beats(0.5), volume: 0.28 })).filter((c) => c.at < dur),
  A4: () => [{ name: 'bonk', at: beats(1), volume: 0.5 }],
  // райзер (2 біти) закінчується на початку B1: стартує за біт до кінця A5 (A6 — один біт)
  A5: ({ dur }) => [...[0, 1, 2].map((b) => ({ name: 'tick' as SfxName, at: beats(b), volume: 0.25 })), { name: 'riser', at: dur - beats(1), volume: 0.45 }],
  A6: ({ dur }) => Array.from({ length: Math.floor(dur / 3) }, (_, i) => ({ name: 'tick' as SfxName, at: i * 3, volume: 0.1 })),
  B1: ({ dur }) => [0, 1, 2, 3].map((i) => ({ name: 'hit' as SfxName, at: (i * dur) / 4, volume: 0.42 })),
  B2: () => [
    { name: 'impact', at: 0, volume: 0.75 },
    { name: 'whoosh', at: 0, volume: 0.3 },
    // крапка: злітає пів біта, падає ще пів — удар на біт 1, далі підскоки на біти 2, 3, 4
    { name: 'tup', at: beats(1), volume: 0.5 },
    { name: 'tup', at: beats(2), volume: 0.4 },
    { name: 'tup', at: beats(3), volume: 0.3 },
    { name: 'tup', at: beats(4) - 1, volume: 0.22 },
  ],
  C1: () => [{ name: 'whoosh', at: 0, volume: 0.32 }],
  // набір «завтра зранку…»: зйомка «hero» — з 10-го кадру, 22 знаки/с; C2 показує її з 8-го
  C2: ({ dur }) => [...typing(46, 22, 10, 8), { name: 'whoosh', at: dur * 0.5, volume: 0.2 }],
  C3: () => [
    { name: 'pop', at: 5, volume: 0.32 },
    { name: 'pop', at: 11, volume: 0.32 },
  ],
  C4: ({ dur }) => [
    { name: 'tap', at: 6, volume: 0.6 },
    { name: 'flap', at: 13, volume: 0.35 },
    { name: 'whoosh', at: dur * 0.45, volume: 0.32 },
  ],
  D2: () => [{ name: 'whoosh', at: 2, volume: 0.15 }],
  D3: ({ dur }) => [{ name: 'whoosh', at: dur * 0.42, volume: 0.18 }],
  D4: () => [{ name: 'whoosh', at: 0, volume: 0.32 }],
  // «попутка з Києва в Малин»: зйомка «rides» — з 0-го кадру, 26 знаків/с
  E1: () => typing(23, 26, 0, 0, 1, 0.2),
  E2: () => [14, 19, 24, 29].map((at) => ({ name: 'pin' as SfxName, at, volume: 0.4 })),
  E3: () => [
    { name: 'tap', at: 4, volume: 0.55 },
    { name: 'rip', at: 6, volume: 0.6 },
    ...Array.from({ length: 13 }, (_, k) => ({ name: 'tick' as SfxName, at: 14 + k * 1.5, volume: 0.14 })),
  ],
  F1: () => [
    { name: 'whoosh', at: 0, volume: 0.22 },
    { name: 'flap', at: 5, volume: 0.32 },
  ],
  F2: ({ dur }) => plinks(9, 4, dur - 18),
  F3: ({ dur }) => [
    { name: 'whoosh', at: 0, volume: 0.18 },
    { name: 'beep', at: dur * 0.6, volume: 0.38 },
  ],
  F4: () => [{ name: 'pop', at: 2, volume: 0.22 }],
  G1: ({ dur }) => [
    { name: 'whoosh', at: 6, volume: 0.28 },
    { name: 'pop', at: dur * 0.5, volume: 0.35 },
  ],
  G2: ({ dur }) => plinks(9, 4, dur - 20),
  G3: ({ dur }) => [
    ...Array.from({ length: 10 }, (_, i) => ({ name: 'tick' as SfxName, at: 6 + i * 2, volume: 0.18 })),
    { name: 'whoosh', at: dur * 0.45, volume: 0.28 },
    { name: 'pop', at: dur * 0.75, volume: 0.4 },
  ],
  // H1: крапка падає з 1-го біта — удари на біти 1,5 / 2,5 / 3,5 / 4,5
  H1: () => [1.5, 2.5, 3.5, 4.5].map((b, i) => ({ name: 'tup' as SfxName, at: beats(b), volume: 0.45 - i * 0.08 })),
  // H2: адреса друкується за два біти (клавіша на кожен знак); остання доля — фінальний удар треку: дзвіночок, адреса
  // гасне, крапка зникає
  H2: ({ dur }) => [
    ...Array.from({ length: FINAL_URL.length }, (_, i) => ({ name: KEYS[i % 3], at: ((i + 1) * beats(2)) / FINAL_URL.length, volume: 0.15 })),
    { name: 'ting', at: dur - beats(1), volume: 0.5 },
  ],
};

export const cuesFor = (shot: Placed): SfxCue[] => (CUES[shot.id]?.(shot) ?? []).filter((c) => c.at < shot.dur);
