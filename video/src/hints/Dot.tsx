import type React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BEAT, beats } from '../brand/beat';
import { dropBounce } from '../brand/Logo';
import { COLORS } from '../brand/tokens';

/**
 * Підпис серії сторіс — та сама крапка, що в рекламі (B2, H1–H2): падає за пів біта, тричі підскакує на біт, далі
 * пульсує кільцями «ви тут» і гасне з «дзинь». Усі моменти — у бітах від початку сторіс (сітка треку, `brand/beat.ts`).
 */
export type DotPlan = {
  /** Біт появи (до нього крапки немає) */
  appear: number;
  /** Дихає на кожен біт до цього біту (глухий вступ) — з розміром `small` */
  breatheUntil?: number;
  small?: number;
  /** Підйом [від, до]: «до» — початок падіння (`fall`) */
  rise?: [number, number];
  /** Біт, коли крапка починає падати; удар — на пів біта пізніше, далі три підскоки на біт */
  fall?: number;
  /** Вікна пульсу «ви тут» [від, до) */
  pulse?: [number, number][];
  /** Біт, коли крапка гасне */
  out: number;
};

const easeOut = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

export const Dot: React.FC<{ cx: number; cy: number; size: number; em: number; plan: DotPlan; color?: string }> = ({ cx, cy, size, em, plan, color = COLORS.accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const b = t / BEAT;
  if (b < plan.appear) return null;

  let dy = 0;
  let sx = 1;
  let sy = 1;
  let scale = spring({ frame: frame - beats(plan.appear), fps, config: { damping: 12, stiffness: 190, mass: 0.6 } });
  let ring: number | null = null;
  const small = plan.small ?? 1;

  const inPulse = plan.pulse?.find(([a, z]) => b >= a && b < z);
  if (plan.fall != null && b >= plan.fall && b < plan.fall + 3.5) {
    const d = dropBounce(t - plan.fall * BEAT);
    dy = d.dy * em;
    sx = 2 - d.squash;
    sy = d.squash;
  } else if (plan.rise && b >= plan.rise[0] && b < plan.rise[1]) {
    const k = easeOut((b - plan.rise[0]) / (plan.rise[1] - plan.rise[0]));
    dy = -1.6 * em * k;
    scale *= small + (1 - small) * k;
  } else if (inPulse) {
    const r = (((t - inPulse[0] * BEAT) % (BEAT * 2)) + BEAT * 2) % (BEAT * 2) / (BEAT * 2);
    scale *= 1 + 0.16 * Math.sin(Math.PI * r);
    ring = r;
  } else if (plan.breatheUntil != null && b < plan.breatheUntil) {
    const k = b % 1;
    scale *= small * (1 + 0.2 * (1 - k) ** 3);
  }

  let opacity = 1;
  if (b >= plan.out) {
    const k = Math.min(1, (b - plan.out) / 0.35);
    scale *= 1 + 0.25 * k;
    opacity = 1 - k;
  }

  return (
    <div style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, opacity }}>
      {ring != null ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `${Math.max(2, size * 0.09)}px solid ${color}`,
            transform: `translateY(${dy}px) scale(${1 + ring * 2.6})`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: color,
          transformOrigin: '50% 100%',
          transform: `translateY(${dy}px) scale(${sx * scale}, ${sy * scale})`,
          boxShadow: `0 ${size * 0.12}px ${size * 0.35}px rgba(0, 175, 245, 0.28)`,
        }}
      />
    </div>
  );
};
