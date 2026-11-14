import type React from 'react';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { Caption } from '../brand/Caption';
import { dotIris } from '../brand/dotIris';
import { LOGO_DOT } from '../brand/Logo';
import { SfxCues } from '../audio/Sfx';
import { Placeholder } from './Placeholder';
import { cuesFor } from './sounds';
import { A1, A2, A3, A4, A5, A6 } from './shots/A';
import { B1, B2 } from './shots/B';
import { C1, C2, C3, C4 } from './shots/C';
import { D1, D2, D3, D4 } from './shots/D';
import { E1, E2, E3 } from './shots/E';
import { F1, F2, F3, F4 } from './shots/F';
import { G1, G2, G3 } from './shots/G';
import { H1, H2 } from './shots/H';
import type { Placed } from './timeline';

type ShotComponent = React.FC<{ shot: Placed }>;

/** Готові кадри; решта — заглушки. Нова сцена = компонент у shots/<розділ>.tsx + рядок тут */
const READY: Record<string, ShotComponent> = {
  A1, A2, A3, A4, A5, A6,
  B1, B2,
  C1, C2, C3, C4,
  D1, D2, D3, D4,
  E1, E2, E3,
  F1, F2, F3, F4,
  G1, G2, G3,
  H1, H2,
};

const IRIS_FRAMES = 14;

const ShotView: React.FC<{ shot: Placed; sound: boolean }> = ({ shot, sound }) => {
  const Component = READY[shot.id] ?? Placeholder;
  return (
    <>
      <Component shot={shot} />
      {shot.caption ? <Caption text={shot.caption} from={3} to={Math.round(shot.dur * (shot.captionTo ?? 1))} /> : null}
      {sound ? <SfxCues cues={cuesFor(shot)} /> : null}
    </>
  );
};

/**
 * Кадри один за одним. Склейка на вході кадру (`in: 'iris'`) починається рівно на його біті: попередній кадр
 * подовжується на тривалість склейки, тож початки всіх кадрів лишаються на сітці.
 */
export const ShotsPlayer: React.FC<{ shots: Placed[]; sound?: boolean }> = ({ shots, sound = true }) => (
  <TransitionSeries>
    {shots.flatMap((shot, i) => {
      const next = shots[i + 1];
      const iris = next?.in === 'iris' ? IRIS_FRAMES : 0;
      const items = [
        <TransitionSeries.Sequence key={`${shot.id}-${i}`} durationInFrames={shot.dur + iris}>
          <ShotView shot={shot} sound={sound} />
        </TransitionSeries.Sequence>,
      ];
      if (iris) {
        items.push(<TransitionSeries.Transition key={`t-${i}`} presentation={dotIris(LOGO_DOT)} timing={linearTiming({ durationInFrames: iris })} />);
      }
      return items;
    })}
  </TransitionSeries>
);
