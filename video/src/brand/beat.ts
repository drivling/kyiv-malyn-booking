import { MUSIC } from '../audio/music';
import { FPS } from './tokens';

/** Сітка ролика (Docs/dovede-teaser/script.md): темп музики (`audio/music.ts`), такт — 4 біти */
export const BPM = MUSIC.bpm;
export const BEAT = 60 / BPM;

/** Секунди → номер кадру. При 30 fps біт 125 BPM = 14,4 кадру; округлення дає похибку ≤ 17 мс — на слух непомітно */
export const sec = (s: number) => Math.round(s * FPS);
export const beats = (n: number) => sec(n * BEAT);
export const bars = (n: number) => beats(n * 4);
