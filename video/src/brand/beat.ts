import { FPS } from './tokens';

/** Сітка ролика (Docs/dovede-teaser/script.md): 125 BPM, такт — 4 біти. Під справжній трек — підставити його BPM */
export const BPM = 125;
export const BEAT = 60 / BPM;

/** Секунди → номер кадру. При 30 fps біт = 14,4 кадру; округлення дає похибку ≤ 17 мс — на слух непомітно */
export const sec = (s: number) => Math.round(s * FPS);
export const beats = (n: number) => sec(n * BEAT);
export const bars = (n: number) => beats(n * 4);
