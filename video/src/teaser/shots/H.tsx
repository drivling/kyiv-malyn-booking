import type React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BEAT, beats } from '../../brand/beat';
import { GOLOS } from '../../brand/fonts';
import { dropBounce, LOGO_SIZE } from '../../brand/Logo';
import { COLORS } from '../../brand/tokens';
import type { Placed } from '../timeline';

/**
 * Фінал (script.md, H). H1 — літери «Доведе» встають по черзі, крапка падає й підстрибує, далі пульсує, як «ви тут»
 * на мапі; на третій біт — «Спитайте своїми словами.». H2 — адреса друкується, «Малин · листопад 2026»; на
 * останній біт усе тане, лишається крапка — і зникає разом із ролику.
 */
const URL = 'malin.kiev.ua/dovede';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Крапка-«ви тут»: пульс раз на два біти, кільце розходиться */
function pulse(t: number) {
  const r = (((t % (BEAT * 2)) + BEAT * 2) % (BEAT * 2)) / (BEAT * 2);
  return { scale: 1 + 0.16 * Math.sin(Math.PI * r), ring: r };
}

const Dot: React.FC<{ dy?: number; squash?: number; scale?: number; ring?: number | null; opacity?: number }> = ({
  dy = 0,
  squash = 1,
  scale = 1,
  ring = null,
  opacity = 1,
}) => (
  <span
    style={{
      display: 'inline-block',
      position: 'relative',
      color: COLORS.accent,
      transform: `translateY(${dy}em) scale(${(2 - squash) * scale}, ${squash * scale})`,
      transformOrigin: '50% 85%',
      opacity,
    }}
  >
    .
    {ring != null ? (
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
          transform: `scale(${1 + ring * 2.6})`,
          opacity: 1 - ring,
        }}
      />
    ) : null}
  </span>
);

const logoBox: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  textAlign: 'center',
  fontFamily: GOLOS,
  fontWeight: 800,
  fontSize: LOGO_SIZE,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: COLORS.ink,
  whiteSpace: 'nowrap',
};

const subStyle = (k: number, top: number): React.CSSProperties => ({
  position: 'absolute',
  left: 0,
  right: 0,
  top: `calc(50% + ${top}px)`,
  textAlign: 'center',
  fontFamily: GOLOS,
  color: COLORS.ink,
  opacity: clamp01(k),
  transform: `translateY(${(1 - clamp01(k)) * 30}px)`,
});

/** Коли крапка «вляглася» після падіння з кадру `from`: пів біта падіння + три підскоки */
const settled = (from: number) => from + beats(0.5 + 3);

export const H1: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dropFrom = beats(1);
  let dot: React.ComponentProps<typeof Dot>;
  if (frame < settled(dropFrom)) {
    const { dy, squash } = dropBounce((frame - dropFrom) / fps);
    dot = { dy, squash, opacity: frame < dropFrom ? 0 : 1 };
  } else {
    const p = pulse((frame - settled(dropFrom)) / fps);
    dot = { scale: p.scale, ring: p.ring };
  }
  const sub = spring({ frame: frame - beats(3), fps, config: { damping: 18 } });
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <div style={logoBox}>
        {[...'Доведе'].map((ch, i) => {
          const k = spring({ frame: frame - i * 2, fps, config: { damping: 14, mass: 0.5 } });
          return (
            <span key={i} style={{ display: 'inline-block', opacity: clamp01(k * 1.5), transform: `translateY(${(1 - k) * 0.45}em)` }}>
              {ch}
            </span>
          );
        })}
        <Dot {...dot} />
      </div>
      <div style={{ ...subStyle(sub, 150), fontSize: 64, fontWeight: 600 }}>Спитайте своїми словами.</div>
    </AbsoluteFill>
  );
};

export const H2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const end = shot.dur;
  // адреса друкується за два біти, дата — на третій
  const typed = Math.round(clamp01(frame / beats(2)) * URL.length);
  const date = spring({ frame: frame - beats(3), fps, config: { damping: 18 } });
  // останній біт: текст тане, крапка пульсує востаннє й зникає в останні пів біта
  const fade = interpolate(frame, [end - beats(1), end - beats(0.5)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dotOut = interpolate(frame, [end - beats(0.5), end - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const p = pulse(frame / fps);
  const caretOn = typed < URL.length || Math.floor(frame / beats(0.5)) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <div style={logoBox}>
        <span style={{ opacity: fade }}>Доведе</span>
        <Dot scale={p.scale * dotOut} ring={fade > 0 ? p.ring : null} opacity={dotOut > 0 ? 1 : 0} />
      </div>
      <div style={{ ...subStyle(fade, 150), fontSize: 64, fontWeight: 600 }}>Спитайте своїми словами.</div>
      <div style={{ ...subStyle(fade, 270), fontSize: 66, fontWeight: 800, color: COLORS.accentInk, fontVariantNumeric: 'tabular-nums' }}>
        {URL.slice(0, typed)}
        <span style={{ display: 'inline-block', width: '0.08em', height: '0.9em', marginLeft: '0.04em', verticalAlign: '-0.1em', background: COLORS.accentInk, opacity: caretOn && frame < end - beats(1) ? 1 : 0 }} />
      </div>
      <div style={{ ...subStyle(Math.min(date, fade), 380), fontSize: 40, fontWeight: 600, color: COLORS.muted, letterSpacing: '0.04em' }}>Малин · листопад 2026</div>
    </AbsoluteFill>
  );
};
