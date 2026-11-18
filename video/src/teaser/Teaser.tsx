import type React from 'react';
import { AbsoluteFill, Audio, interpolate, staticFile } from 'remotion';
import { MUSIC, type MusicEditName, musicEditFile } from '../audio/music';
import { SafeZones } from '../brand/SafeZones';
import { COLORS } from '../brand/tokens';
import { ShotsPlayer } from './ShotsPlayer';
import { MASTER, place, type Placed, SHORT, SHOTS, totalFrames } from './timeline';

export type TeaserProps = {
  /** Підсвітити безпечні зони Reels (лише для перегляду) */
  showSafe: boolean;
  /** Метроном поверх усього (перевірка біту): `npm run metronome` */
  click: boolean;
  /** Музика (`audio/music.ts`, `npm run music`) і звуки кадрів (`teaser/sounds.ts`) */
  sound?: boolean;
};

export const MASTER_PLACED = place(MASTER);
export const SHORT_PLACED = place(SHORT);

/** На якому біті списку стоїть кадр */
const beatOf = (list: [string, number][], id: string) => {
  let b = 0;
  for (const [m, n] of list) {
    if (m === id) return b;
    b += n;
  }
  throw new Error(`Немає кадру ${id}`);
};

// монтаж треку розрахований на дроп рівно на B2: посунули B2 в таймлайні — поправте dropBeat і `npm run music`
for (const [name, list] of [['master', MASTER], ['short', SHORT]] as const) {
  if (MUSIC.edits[name].dropBeat !== beatOf(list, 'B2')) {
    throw new Error(`music.json: дроп монтажу ${name} на ${MUSIC.edits[name].dropBeat}-му біті, а B2 — на ${beatOf(list, 'B2')}-му`);
  }
}

/**
 * Змонтована музика версії (`npm run music`): секунда 0 файлу — кадр 0 версії, тож кадр `startFrame` версії звучить
 * у кадрі 0 композиції. Монтаж закінчується останнім ударом треку; чернетки, що обриваються посеред треку, гаснуть.
 */
const Music: React.FC<{ edit: MusicEditName; startFrame: number; frames: number; fadeOut: boolean }> = ({ edit, startFrame, frames, fadeOut }) => (
  <Audio
    src={staticFile(musicEditFile(edit))}
    startFrom={startFrame}
    volume={(f) => interpolate(f, [0, 2, frames - 10, frames], [0, 0.85, 0.85, fadeOut ? 0 : 0.85], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
  />
);

const Shell: React.FC<TeaserProps & { shots: Placed[]; edit: MusicEditName; startFrame: number; fadeOut?: boolean; children: React.ReactNode }> = ({
  showSafe,
  click,
  sound = true,
  shots,
  edit,
  startFrame,
  fadeOut = false,
  children,
}) => (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    {children}
    {sound ? <Music edit={edit} startFrame={startFrame} frames={totalFrames(shots)} fadeOut={fadeOut} /> : null}
    {click ? <Audio src={staticFile('audio/metronome-125.wav')} /> : null}
    {showSafe ? <SafeZones /> : null}
  </AbsoluteFill>
);

/** Майстер 9:16, 117 бітів (56,2 с) */
export const Teaser: React.FC<TeaserProps> = (props) => (
  <Shell {...props} shots={MASTER_PLACED} edit="master" startFrame={0}>
    <ShotsPlayer shots={MASTER_PLACED} sound={props.sound ?? true} />
  </Shell>
);

/** Версія 15 с (31 біт, 14,89 с) — зі своїм монтажем треку */
export const Teaser15: React.FC<TeaserProps> = (props) => (
  <Shell {...props} shots={SHORT_PLACED} edit="short" startFrame={0}>
    <ShotsPlayer shots={SHORT_PLACED} sound={props.sound ?? true} />
  </Shell>
);

/** Чернетка окремих кадрів (тривалості — як у майстрі): `--props='{"shots":["B1","B2"]}'` */
export type DraftProps = TeaserProps & { shots: string[] };
export const draftPlaced = (ids: string[]) => place(ids.map((id) => [id, MASTER.find(([m]) => m === id)?.[1] ?? 4]));
export const Draft: React.FC<DraftProps> = ({ shots, ...props }) => {
  const placed = draftPlaced(shots.filter((id) => SHOTS[id]));
  return (
    <Shell {...props} shots={placed} edit="master" startFrame={MASTER_PLACED.find((p) => p.id === placed[0]?.id)?.from ?? 0} fadeOut>
      <ShotsPlayer shots={placed} sound={props.sound ?? true} />
    </Shell>
  );
};
export const draftFrames = (ids: string[]) => totalFrames(draftPlaced(ids.filter((id) => SHOTS[id])));
