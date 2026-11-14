import type React from 'react';
import { AbsoluteFill, Audio, interpolate, staticFile } from 'remotion';
import { MUSIC } from '../audio/music';
import { BEAT } from '../brand/beat';
import { SafeZones } from '../brand/SafeZones';
import { COLORS, FPS } from '../brand/tokens';
import { ShotsPlayer } from './ShotsPlayer';
import { MASTER, place, type Placed, SHORT, SHOTS, totalFrames } from './timeline';

export type TeaserProps = {
  /** Підсвітити безпечні зони Reels (лише для перегляду) */
  showSafe: boolean;
  /** Метроном 125 BPM поверх усього (перевірка біту): `npm run metronome` */
  click: boolean;
  /** Музика (`audio/music.ts`) і звуки кадрів (`teaser/sounds.ts`) */
  sound?: boolean;
};

export const MASTER_PLACED = place(MASTER);
export const SHORT_PLACED = place(SHORT);

/** На якому біті майстра стоїть кадр — щоб чернетка й версія 15 с звучали тим самим місцем треку */
const masterBeat = (id: string) => {
  let b = 0;
  for (const [m, n] of MASTER) {
    if (m === id) return b;
    b += n;
  }
  return 0;
};

/** Музика: кадр 0 цієї композиції звучить секундою `startSec` треку; на останніх 10 кадрах — згасання */
const Music: React.FC<{ startSec: number; frames: number }> = ({ startSec, frames }) => (
  <Audio
    src={staticFile(MUSIC.file)}
    startFrom={Math.max(0, Math.round(startSec * FPS))}
    volume={(f) => interpolate(f, [0, 2, frames - 10, frames], [0, 0.85, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
  />
);

const Shell: React.FC<TeaserProps & { shots: Placed[]; musicFrom: number; children: React.ReactNode }> = ({ showSafe, click, sound = true, shots, musicFrom, children }) => (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    {children}
    {sound ? <Music startSec={MUSIC.start + musicFrom * BEAT} frames={totalFrames(shots)} /> : null}
    {click ? <Audio src={staticFile('audio/metronome-125.wav')} /> : null}
    {showSafe ? <SafeZones /> : null}
  </AbsoluteFill>
);

/** Майстер 9:16, 28 тактів (53,76 с) */
export const Teaser: React.FC<TeaserProps> = (props) => (
  <Shell {...props} shots={MASTER_PLACED} musicFrom={0}>
    <ShotsPlayer shots={MASTER_PLACED} sound={props.sound ?? true} />
  </Shell>
);

/**
 * Версія 15 с (8 тактів). Музика: B2 версії (2-й біт) звучить там, де в майстрі дроп (B2, 24-й біт).
 */
export const Teaser15: React.FC<TeaserProps> = (props) => (
  <Shell {...props} shots={SHORT_PLACED} musicFrom={masterBeat('B2') - 2}>
    <ShotsPlayer shots={SHORT_PLACED} sound={props.sound ?? true} />
  </Shell>
);

/** Чернетка окремих кадрів (тривалості — як у майстрі): `--props='{"shots":["B1","B2"]}'` */
export type DraftProps = TeaserProps & { shots: string[] };
export const draftPlaced = (ids: string[]) => place(ids.map((id) => [id, MASTER.find(([m]) => m === id)?.[1] ?? 4]));
export const Draft: React.FC<DraftProps> = ({ shots, ...props }) => {
  const placed = draftPlaced(shots.filter((id) => SHOTS[id]));
  return (
    <Shell {...props} shots={placed} musicFrom={masterBeat(placed[0]?.id ?? 'A1')}>
      <ShotsPlayer shots={placed} sound={props.sound ?? true} />
    </Shell>
  );
};
export const draftFrames = (ids: string[]) => totalFrames(draftPlaced(ids.filter((id) => SHOTS[id])));
