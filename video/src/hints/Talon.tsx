import type React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { GOLOS } from '../brand/fonts';
import { COLORS } from '../brand/tokens';

/**
 * Талон із сайту (frontend/.../DovedePage/intro/DovedeIntro.css, `.dv-talon`): тепла бумага, блакитна сітка-гільйош,
 * перфорація по краях, сітка компостера 3 × 3, червоний номер і штамп «щасливий». Розміри — як на сайті (340 px
 * завширшки), у кадрі його збільшує батько. Моменти — номери кадрів від початку сторіс. До запуску на талоні немає
 * назви сервісу: заголовок — «Куди скажете.» (крапка — та сама блакитна), маршрут — «Малин → …».
 */
const RED = '#c62828';
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type TalonTimes = {
  /** Кадр удару компостера (щелепа внизу, дірки) */
  punch: number;
  /** Кадр штампа «щасливий» */
  stamp: number;
  /** Кадр, з якого друкується рядок дійсності, і скільки кадрів на друк */
  valid: number;
  validFrames: number;
  /** Кадр одного біта — щелепа падає за третину біта */
  beat: number;
};

export const Talon: React.FC<{
  no: string;
  validText: string;
  holes: number[];
  times: TalonTimes;
  /** Що з'являється в першій дірці (крапка серії) */
  inHole?: React.ReactNode;
}> = ({ no, validText, holes, times, inHole }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { punch, stamp, valid, validFrames, beat } = times;

  // щелепа: падає за третину біта до удару, коротко тисне, піднімається й зникає
  const jawY = interpolate(frame, [punch - beat / 3, punch, punch + beat * 0.15, punch + beat * 0.7], [-130, 0, 2, -150], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const jawOpacity = interpolate(frame, [punch - beat / 3, punch - beat / 5, punch + beat * 0.45, punch + beat * 0.7], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hit = frame >= punch && frame < punch + 4 ? 3 : 0;
  const stampK = frame < stamp ? 0 : spring({ frame: frame - stamp, fps, config: { damping: 11, stiffness: 260, mass: 0.5 } });
  const typed = Math.floor(clamp01((frame - valid) / validFrames) * validText.length);

  return (
    <div style={{ position: 'relative', width: 340, filter: 'drop-shadow(0 14px 20px rgba(5, 71, 82, 0.16)) drop-shadow(0 2px 2px rgba(5, 71, 82, 0.12))' }}>
      <div
        style={{
          position: 'absolute',
          zIndex: 2,
          right: 14,
          top: '50%',
          width: 92,
          height: 92,
          marginTop: -46,
          borderRadius: 10,
          background: 'linear-gradient(#d8402f 0 22px, #9b231b 22px 25px, transparent 25px), linear-gradient(160deg, #e6ecee 0%, #aab6ba 40%, #6b797e 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 -2px 0 rgba(0, 0, 0, 0.25)',
          opacity: jawOpacity,
          transform: `translateY(${jawY}px) rotate(-1.5deg)`,
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 18,
          padding: '18px 22px 20px 26px',
          borderRadius: 3,
          color: COLORS.ink,
          fontFamily: GOLOS,
          transform: `rotate(-1.5deg) translateY(${hit}px)`,
          background:
            'radial-gradient(120% 90% at 15% 20%, rgba(255, 255, 255, 0.7), transparent 60%), repeating-linear-gradient(115deg, rgba(0, 175, 245, 0.08) 0 1px, transparent 1px 6px), repeating-linear-gradient(65deg, rgba(0, 175, 245, 0.06) 0 1px, transparent 1px 6px), #fffaf0',
          WebkitMask:
            'radial-gradient(circle at 0 7px, transparent 3.5px, #000 4px) left / 51% 14px repeat-y, radial-gradient(circle at 100% 7px, transparent 3.5px, #000 4px) right / 51% 14px repeat-y',
          mask: 'radial-gradient(circle at 0 7px, transparent 3.5px, #000 4px) left / 51% 14px repeat-y, radial-gradient(circle at 100% 7px, transparent 3.5px, #000 4px) right / 51% 14px repeat-y',
        }}
      >
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
            Куди скажете<span style={{ color: COLORS.accent }}>.</span>
          </span>
          <span style={{ marginTop: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.muted }}>Квиток на проїзд</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Малин → …</span>
          <span style={{ marginTop: 10, fontFamily: MONO, fontSize: 13, letterSpacing: '0.06em', color: '#a3301f' }}>Серія ДВ № {no}</span>
          <span style={{ marginTop: 4, minHeight: 16, fontFamily: MONO, fontSize: 12, letterSpacing: '0.04em', color: '#a3301f' }}>{validText.slice(0, typed)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 24px)', gridAutoRows: 24, border: '1.5px solid rgba(5, 71, 82, 0.35)', borderRadius: 3 }}>
          {Array.from({ length: 9 }, (_, i) => {
            const order = holes.indexOf(i);
            const holeK = order < 0 ? 0 : clamp01((frame - punch - order) / 3);
            return (
              <span
                key={i}
                style={{
                  position: 'relative',
                  display: 'grid',
                  placeItems: 'center',
                  borderRight: i % 3 === 2 ? 0 : '1px solid rgba(5, 71, 82, 0.18)',
                  borderBottom: i >= 6 ? 0 : '1px solid rgba(5, 71, 82, 0.18)',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(5, 71, 82, 0.4)' }}>{i + 1}</span>
                {order >= 0 ? (
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 14,
                      height: 14,
                      margin: '-7px 0 0 -7px',
                      borderRadius: '50%',
                      background: '#ffffff',
                      boxShadow: 'inset 0 1.5px 2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(5, 71, 82, 0.12)',
                      transform: `scale(${holeK})`,
                    }}
                  />
                ) : null}
                {order === 0 ? inHole : null}
              </span>
            );
          })}
        </div>
        <span
          style={{
            position: 'absolute',
            left: 150,
            bottom: 30,
            padding: '1px 8px',
            border: `2px solid ${RED}`,
            borderRadius: 4,
            color: RED,
            fontFamily: GOLOS,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            mixBlendMode: 'multiply',
            opacity: 0.85 * stampK,
            transform: `rotate(-9deg) scale(${1.9 - 0.9 * stampK})`,
          }}
        >
          щасливий
        </span>
      </div>
    </div>
  );
};
