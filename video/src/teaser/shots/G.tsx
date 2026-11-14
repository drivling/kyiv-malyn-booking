import type React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ease } from '../../brand/camera';
import { GOLOS } from '../../brand/fonts';
import { KYIV, MALYN_POINT, project, TOWNS } from '../../brand/oblastMap';
import { SchemeSvg } from '../../brand/SchemeSvg';
import { COLORS, HEIGHT, WIDTH } from '../../brand/tokens';
import type { Placed } from '../timeline';

/**
 * Далі буде (script.md, G). G1 — уся схема Малина стискається в точку «Малин» на мапі. G2 — схема Коростеня з
 * плаката: лінії вмикаються одна за одною («скоро»). G3 — Житомирщина: Малин і Коростень світяться, решта міст
 * загоряється, пунктир тягнеться до Києва. Числа й дати не обіцяємо — лише «далі».
 */
const MAP_BG = 'radial-gradient(120% 80% at 50% 45%, #f6fbfc 0%, #e1eef1 100%)';
const MALYN_MAP = { x: 0, y: 150, w: 1400, h: 600 };
const KOROSTEN_MAP = { x: 0, y: 130, w: 1400, h: 1070 };

const Dot: React.FC<{ x: number; y: number; r: number; color: string; opacity?: number; ring?: number }> = ({ x, y, r, color, opacity = 1, ring }) => (
  <>
    {ring != null ? (
      <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `6px solid ${color}`, opacity: (1 - ring) * opacity, transform: `scale(${1 + ring * 2.2})` }} />
    ) : null}
    <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', background: color, opacity }} />
  </>
);

const Label: React.FC<{ x: number; y: number; text: string; size: number; weight: number; opacity?: number; align?: 'left' | 'right' }> = ({ x, y, text, size, weight, opacity = 1, align = 'left' }) => (
  <div
    style={{
      position: 'absolute',
      left: align === 'left' ? x : undefined,
      right: align === 'right' ? WIDTH - x : undefined,
      top: y,
      transform: 'translateY(-50%)',
      fontFamily: GOLOS,
      fontSize: size,
      fontWeight: weight,
      color: COLORS.ink,
      opacity,
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);

export const G1: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, 6, shot.dur * 0.6, 0, 1);
  // схема на всю ширину → стискається в точку Малина
  const w0 = WIDTH;
  const h0 = (w0 * MALYN_MAP.h) / MALYN_MAP.w;
  const cx = WIDTH / 2 + (MALYN_POINT.x - WIDTH / 2) * k;
  const cy = HEIGHT * 0.47 + (MALYN_POINT.y - HEIGHT * 0.47) * k;
  const s = 1 - 0.97 * k;
  const label = ease(frame, shot.dur * 0.5, shot.dur * 0.75, 0, 1);
  return (
    <AbsoluteFill style={{ background: MAP_BG }}>
      <SchemeSvg
        file="assets/malyn-transit-scheme-poster.svg"
        box={MALYN_MAP}
        lit={() => 1}
        style={{ position: 'absolute', left: cx - (w0 * s) / 2, top: cy - (h0 * s) / 2, width: w0 * s, height: h0 * s, opacity: 1 - ease(frame, shot.dur * 0.45, shot.dur * 0.6, 0, 1), borderRadius: 30 * k }}
      />
      <Dot x={MALYN_POINT.x} y={MALYN_POINT.y} r={18} color={COLORS.accent} opacity={label} />
      <Label x={MALYN_POINT.x + 34} y={MALYN_POINT.y} text="Малин" size={56} weight={800} opacity={label} />
    </AbsoluteFill>
  );
};

export const G2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const w = WIDTH * ease(frame, 0, shot.dur, 1, 1.12);
  const h = (w * KOROSTEN_MAP.h) / KOROSTEN_MAP.w;
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <SchemeSvg
        file="assets/korosten-transit-scheme-poster.svg"
        box={KOROSTEN_MAP}
        lit={(i, n) => (frame - 4 - (i * (shot.dur - 20)) / n) / 8}
        style={{ position: 'absolute', left: (WIDTH - w) / 2, top: HEIGHT * 0.52 - h / 2, width: w, height: h }}
      />
    </AbsoluteFill>
  );
};

export const G3: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const later = TOWNS.filter((t) => t.tier === 'later');
  const kyiv = project(KYIV.lat, KYIV.lon);
  const arrow = ease(frame, shot.dur * 0.45, shot.dur * 0.85, 0, 1);
  const kyivOn = ease(frame, shot.dur * 0.75, shot.dur * 0.9, 0, 1);
  const pulse = ((frame / fps) % 0.96) / 0.96;
  // пунктир Малин → Київ: дуга, що «малюється»
  const mx = MALYN_POINT.x + 20;
  const my = MALYN_POINT.y;
  const qx = (mx + kyiv.x) / 2;
  const qy = Math.min(my, kyiv.y) - 120;
  return (
    <AbsoluteFill style={{ background: MAP_BG }}>
      <svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M ${mx} ${my} Q ${qx} ${qy} ${kyiv.x - 22} ${kyiv.y}`} fill="none" stroke={COLORS.accent} strokeWidth={8} strokeLinecap="round" strokeDasharray="1" pathLength={1} strokeDashoffset={1 - arrow} />
      </svg>
      {later.map((t, i) => {
        const p = project(t.lat, t.lon);
        const k = spring({ frame: frame - 6 - i * 2, fps, config: { damping: 14, mass: 0.5 } });
        return (
          <div key={t.name}>
            <Dot x={p.x} y={p.y} r={12} color={COLORS.ink} opacity={Math.min(1, k)} />
            <Label x={p.x + 22} y={p.y} text={t.name} size={34} weight={600} opacity={Math.min(1, k) * 0.85} />
          </div>
        );
      })}
      {TOWNS.filter((t) => t.tier !== 'later').map((t) => {
        const p = project(t.lat, t.lon);
        return (
          <div key={t.name}>
            <Dot x={p.x} y={p.y} r={18} color={COLORS.accent} ring={pulse} />
            <Label x={p.x + 34} y={p.y} text={t.name} size={52} weight={800} />
          </div>
        );
      })}
      <Dot x={kyiv.x} y={kyiv.y} r={26} color={COLORS.ink} opacity={kyivOn} />
      <Label x={kyiv.x - 10} y={kyiv.y + 70} text="Київ" size={64} weight={800} opacity={kyivOn} align="right" />
    </AbsoluteFill>
  );
};
