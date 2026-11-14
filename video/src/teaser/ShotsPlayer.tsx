import type React from 'react';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { Caption } from '../brand/Caption';
import { dotIris } from '../brand/dotIris';
import { LOGO_DOT } from '../brand/Logo';
import { Placeholder } from './Placeholder';
import { B1, B2 } from './shots/B';
import { H1, H2 } from './shots/H';
import type { Placed } from './timeline';

type ShotComponent = React.FC<{ shot: Placed }>;

/** Готові кадри; решта — заглушки. Нова сцена = компонент у shots/<розділ>.tsx + рядок тут */
const READY: Record<string, ShotComponent> = { B1, B2, H1, H2 };

const IRIS_FRAMES = 14;

const ShotView: React.FC<{ shot: Placed }> = ({ shot }) => {
  const Component = READY[shot.id] ?? Placeholder;
  return (
    <>
      <Component shot={shot} />
      {shot.caption ? <Caption text={shot.caption} from={3} to={shot.dur} /> : null}
    </>
  );
};

/**
 * Кадри один за одним. Склейка на вході кадру (`in: 'iris'`) починається рівно на його біті: попередній кадр
 * подовжується на тривалість склейки, тож початки всіх кадрів лишаються на сітці.
 */
export const ShotsPlayer: React.FC<{ shots: Placed[] }> = ({ shots }) => (
  <TransitionSeries>
    {shots.flatMap((shot, i) => {
      const next = shots[i + 1];
      const iris = next?.in === 'iris' ? IRIS_FRAMES : 0;
      const items = [
        <TransitionSeries.Sequence key={`${shot.id}-${i}`} durationInFrames={shot.dur + iris}>
          <ShotView shot={shot} />
        </TransitionSeries.Sequence>,
      ];
      if (iris) {
        items.push(<TransitionSeries.Transition key={`t-${i}`} presentation={dotIris(LOGO_DOT)} timing={linearTiming({ durationInFrames: iris })} />);
      }
      return items;
    })}
  </TransitionSeries>
);
