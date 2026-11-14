import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { Caption } from '../brand/Caption';
import { Capture } from '../brand/Capture';
import { dotIris } from '../brand/dotIris';
import { Logo, LOGO_DOT, LOGO_SIZE } from '../brand/Logo';
import { PhoneFrame } from '../brand/PhoneFrame';
import { SafeZones } from '../brand/SafeZones';
import { COLORS } from '../brand/tokens';

/**
 * Перевірка студії (план 2): логотип, крапка падає й підстрибує на біт → склейка «через крапку» → дошка попуток зі
 * справжньої зйомки в телефоні, титри, тап «Відірвати номер». 5 с.
 */
const LOGO = 72;
const IRIS = 14;
const BOARD = 92;
export const STUDIO_TEST_FRAMES = LOGO + BOARD - IRIS;
const DOT = LOGO_DOT;
/** Кадр зйомки «rides», з якого починається дошка (Enter — на 30-му) */
const RIDES_FROM = 26;

export const StudioTest: React.FC<{ showSafe: boolean }> = ({ showSafe }) => (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={LOGO}>
        <AbsoluteFill style={{ background: COLORS.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Logo size={LOGO_SIZE} dot="drop" from={12} />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={dotIris(DOT)} timing={linearTiming({ durationInFrames: IRIS })} />
      <TransitionSeries.Sequence durationInFrames={BOARD}>
        <PhoneFrame>
          <Capture name="rides" from={RIDES_FROM} />
        </PhoneFrame>
        <Caption text="Попутки — як на дошці." from={6} to={57} />
        <Caption text="Відірвав — подзвонив." from={58} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    {showSafe ? <SafeZones /> : null}
  </AbsoluteFill>
);
