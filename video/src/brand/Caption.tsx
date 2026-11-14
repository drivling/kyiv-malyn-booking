import type React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { GOLOS } from './fonts';
import { COLORS, HEIGHT, SAFE, WIDTH } from './tokens';

/**
 * Титр 2–5 слів у верхній безпечній зоні: «плашка» кольору бренду. Заходить пружиною, виходить за 5 кадрів до `to`.
 * `from` / `to` — кадри всередині поточної Sequence.
 */
export const Caption: React.FC<{ text: string; from?: number; to?: number; top?: number }> = ({ text, from = 0, to, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || (to != null && frame >= to)) return null;
  const enter = spring({ frame: frame - from, fps, config: { damping: 16, mass: 0.6 } });
  const exit = to != null ? interpolate(frame, [to - 5, to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.side * WIDTH,
        right: SAFE.side * WIDTH,
        top: top ?? SAFE.top * HEIGHT + 20,
        textAlign: 'center',
        fontFamily: GOLOS,
        fontWeight: 800,
        fontSize: 68,
        lineHeight: 1.34,
        opacity: Math.min(enter, exit),
        transform: `translateY(${(1 - enter) * 36}px) scale(${0.94 + 0.06 * enter})`,
      }}
    >
      <span
        style={{
          background: COLORS.ink,
          color: COLORS.paper,
          padding: '0.12em 0.5em',
          borderRadius: '0.38em',
          WebkitBoxDecorationBreak: 'clone',
          boxDecorationBreak: 'clone',
        }}
      >
        {text}
      </span>
    </div>
  );
};
