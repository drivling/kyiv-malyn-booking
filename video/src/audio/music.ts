import music from './music.json';

/**
 * Музика ролика — `music.json` (його читає й `scripts/music-edit.mjs`, тому JSON):
 * - `file` — трек у public/ (не в git: права на ШІ-трек — лише для ролика, а репозиторій публічний);
 * - `bpm` — темп треку. Сітка кадрів рахується від нього (`brand/beat.ts`): поміняли трек — склейки самі стали на
 *   його біти;
 * - `drop` — секунда дропу у файлі (сильна доля): від неї рахуються такти монтажу. `npm run analyze` підкаже, але
 *   краще почути самому;
 * - `edits` — монтаж треку під кожну версію ролика: шматки `[від, до)` у тактах від дропу (0 — дроп, −3 — за три
 *   такти до нього, 28,25 — перша доля 28-го такту й ще одна доля), склеєні впритул зі швом 10 мс. `dropBeat` — біт
 *   ролика, на який лягає дроп (початок B2); `Teaser.tsx` звіряє його з таймлайном.
 *
 * `npm run music` складає з треку `public/audio/music/<версія>.wav` — уже з тишею на початку, рівно під кадри ролика,
 * і з гучністю тимчасового треку (−21,2 LUFS), під яку зведено звуки кадрів.
 */
export type MusicEditName = 'master' | 'short';
export type MusicEdit = { dropBeat: number; bars: [number, number][] };

export const MUSIC = music as { file: string; bpm: number; drop: number; edits: Record<MusicEditName, MusicEdit> };

/** Змонтована музика версії: файл у public/ */
export const musicEditFile = (name: MusicEditName) => `audio/music/${name}.wav`;
