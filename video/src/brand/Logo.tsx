import type React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { BEAT } from './beat';
import { GOLOS } from './fonts';
import { COLORS } from './tokens';

export type DotMode = 'still' | 'drop' | 'pulse' | 'blink';

/**
 * Висота крапки (в em, мінус — вгору) у режимі «drop»: падає за пів біта, далі три підскоки на біт, кожен
 * нижчий. `squash` — сплющення в мить удару об «землю» (рядок).
 */
export function dropBounce(t: number): { dy: number; squash: number } {
  const fall = BEAT / 2;
  const high = 1.6;
  if (t < 0) return { dy: -high, squash: 1 };
  if (t < fall) {
    const k = t / fall;
    return { dy: -high * (1 - k * k), squash: 1 };
  }
  const after = t - fall;
  const n = Math.floor(after / BEAT);
  const f = (after % BEAT) / BEAT;
  const squash = f < 0.12 ? 1 - 0.28 * (1 - f / 0.12) * Math.pow(0.5, n) : 1;
  if (n > 2) return { dy: 0, squash: 1 };
  return { dy: -0.42 * Math.pow(0.45, n) * Math.sin(Math.PI * f), squash };
}

/** «Доведе.» — логотип із живою крапкою. `from` — кадр, з якого рахується анімація крапки */
export const Logo: React.FC<{ size?: number; dot?: DotMode; from?: number; color?: string; style?: React.CSSProperties }> = ({
  size = 220,
  dot = 'still',
  from = 0,
  color = COLORS.ink,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame - from) / fps;

  let transform = 'none';
  let opacity = 1;
  let ring: React.ReactNode = null;
  if (dot === 'drop') {
    const { dy, squash } = dropBounce(t);
    transform = `translateY(${dy}em) scale(${2 - squash}, ${squash})`;
  }
  if (dot === 'pulse') {
    const r = (((t % (BEAT * 2)) + BEAT * 2) % (BEAT * 2)) / (BEAT * 2);
    transform = `scale(${1 + 0.16 * Math.sin(Math.PI * r)})`;
    ring = (
      <span
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '0.06em',
          width: '0.24em',
          height: '0.24em',
          marginLeft: '-0.12em',
          borderRadius: '50%',
          border: `0.035em solid ${COLORS.accent}`,
          transform: `scale(${1 + r * 2.6})`,
          opacity: 1 - r,
        }}
      />
    );
  }
  if (dot === 'blink') opacity = Math.floor(t / (BEAT / 2)) % 2 ? 0.15 : 1;

  return (
    <span
      style={{
        fontFamily: GOLOS,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        color,
        display: 'inline-block',
        position: 'relative',
        ...style,
      }}
    >
      Доведе
      <span style={{ display: 'inline-block', position: 'relative', color: COLORS.accent, transform, transformOrigin: '50% 85%', opacity }}>
        .{ring}
      </span>
    </span>
  );
};
