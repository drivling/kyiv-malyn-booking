import type React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { SafeZones } from '../brand/SafeZones';
import { COLORS } from '../brand/tokens';
import { ShotsPlayer } from './ShotsPlayer';
import { MASTER, place, SHORT, SHOTS, totalFrames } from './timeline';

export type TeaserProps = {
  /** Підсвітити безпечні зони Reels (лише для перегляду) */
  showSafe: boolean;
  /** Метроном 125 BPM замість музики (чернетки): `npm run metronome` */
  click: boolean;
};

export const MASTER_PLACED = place(MASTER);
export const SHORT_PLACED = place(SHORT);

const Shell: React.FC<TeaserProps & { children: React.ReactNode }> = ({ showSafe, click, children }) => (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    {children}
    {click ? <Audio src={staticFile('audio/metronome-125.wav')} /> : null}
    {showSafe ? <SafeZones /> : null}
  </AbsoluteFill>
);

/** Майстер 9:16, 28 тактів (53,76 с) */
export const Teaser: React.FC<TeaserProps> = (props) => (
  <Shell {...props}>
    <ShotsPlayer shots={MASTER_PLACED} />
  </Shell>
);

/** Версія 15 с (8 тактів) */
export const Teaser15: React.FC<TeaserProps> = (props) => (
  <Shell {...props}>
    <ShotsPlayer shots={SHORT_PLACED} />
  </Shell>
);

/** Чернетка окремих кадрів (тривалості — як у майстрі): `--props='{"shots":["B1","B2"]}'` */
export type DraftProps = TeaserProps & { shots: string[] };
export const draftPlaced = (ids: string[]) => place(ids.map((id) => [id, MASTER.find(([m]) => m === id)?.[1] ?? 4]));
export const Draft: React.FC<DraftProps> = ({ shots, ...props }) => (
  <Shell {...props}>
    <ShotsPlayer shots={draftPlaced(shots.filter((id) => SHOTS[id]))} />
  </Shell>
);
export const draftFrames = (ids: string[]) => totalFrames(draftPlaced(ids.filter((id) => SHOTS[id])));
