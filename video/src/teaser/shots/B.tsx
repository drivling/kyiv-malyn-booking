import type React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { beats } from '../../brand/beat';
import { GOLOS } from '../../brand/fonts';
import { dropBounce, LOGO_SIZE } from '../../brand/Logo';
import { COLORS } from '../../brand/tokens';
import type { Placed } from '../timeline';

/**
 * Слоган (script.md, B). B1 — «Язик до Києва / доведе.» по слову на біт. B2 — дроп: «Язик до Києва» розлітається
 * літерами, «доведе.» їде в центр і стає «Доведе.», а крапка злітає, падає й тричі підстрибує — на кожен біт.
 * Третій удар крапки — останній кадр B2: звідти «через крапку» відкривається телефон (C1).
 */
const LINE1 = ['Язик', 'до', 'Києва'];
const SIZE1 = 118;
const SIZE2 = 150;
const Y1 = -96;
const Y2 = 92;

const lineStyle = (y: number, size: number): React.CSSProperties => ({
  position: 'absolute',
  left: 0,
  right: 0,
  top: `calc(50% + ${y}px)`,
  transform: 'translateY(-50%)',
  textAlign: 'center',
  fontFamily: GOLOS,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: COLORS.ink,
  whiteSpace: 'nowrap',
});

export const B1: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = (i: number) => {
    const f = frame - beats(i);
    return f < 0 ? 0 : spring({ frame: f, fps, config: { damping: 13, mass: 0.45, stiffness: 240 } });
  };
  const word = (k: number): React.CSSProperties => ({
    display: 'inline-block',
    margin: '0 0.12em',
    opacity: Math.min(1, k * 1.6),
    transform: `scale(${1.4 - 0.4 * k}) translateY(${(1 - Math.min(1, k)) * 0.18}em)`,
    filter: `blur(${Math.max(0, 1 - k) * 8}px)`,
  });
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <div style={lineStyle(Y1, SIZE1)}>
        {LINE1.map((w, i) => (
          <span key={w} style={word(pop(i))}>
            {w}
          </span>
        ))}
      </div>
      <div style={lineStyle(Y2, SIZE2)}>
        <span style={word(pop(3))}>
          доведе<span>.</span>
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Детерміновані «випадкові» числа для літер */
const rnd = (i: number, k: number) => {
  const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const B2: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // 1. «Язик до Києва» — літери летять, крутяться й падають під «гравітацією»
  const letters = [...LINE1.join(' ')];
  const scatter = (i: number): React.CSSProperties => {
    const vx = (rnd(i, 1) - 0.5) * 1500;
    const vy = -(420 + rnd(i, 2) * 760);
    const g = 3400;
    return {
      display: 'inline-block',
      transform: `translate(${vx * t}px, ${vy * t + 0.5 * g * t * t}px) rotate(${(rnd(i, 3) - 0.5) * 900 * t}deg)`,
      opacity: interpolate(t, [0.25, 0.6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    };
  };

  // 2. «доведе.» → центр і розмір логотипа
  const move = spring({ frame, fps, config: { damping: 18, mass: 0.7 } });
  const size = interpolate(move, [0, 1], [SIZE2, LOGO_SIZE]);
  const y = interpolate(move, [0, 1], [Y2, 0]);
  // «д» → «Д»: літера згортається й розгортається вже великою
  const flipOut = interpolate(frame, [1, 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flipIn = interpolate(frame, [4, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const capital = frame >= 4;

  // 3. Крапка: злітає (пів біта), далі падає й підстрибує (dropBounce) — удари на біти 1, 2, 3, 4
  const up = beats(0.5);
  let dy = 0;
  let squash = 1;
  if (frame < up) dy = -1.6 * Math.sin((frame / up) * (Math.PI / 2));
  else ({ dy, squash } = dropBounce((frame - up) / fps));

  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <div style={lineStyle(Y1, SIZE1)}>
        {letters.map((ch, i) => (
          <span key={i} style={scatter(i)}>
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </div>
      <div style={{ ...lineStyle(y, size) }}>
        <span style={{ display: 'inline-block', transform: `scaleY(${capital ? flipIn : flipOut})`, transformOrigin: '50% 80%' }}>{capital ? 'Д' : 'д'}</span>
        оведе
        <span
          style={{
            display: 'inline-block',
            color: frame >= 2 ? COLORS.accent : COLORS.ink,
            transform: `translateY(${dy}em) scale(${2 - squash}, ${squash})`,
            transformOrigin: '50% 85%',
          }}
        >
          .
        </span>
      </div>
    </AbsoluteFill>
  );
};
