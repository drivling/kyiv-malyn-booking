import type React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS } from './tokens';

/**
 * Нейтральний телефон без бренду: екран 390 × 844 (як у зйомці), тож кадри зйомки лягають без обрізання.
 * Стоїть трохи нижче центру — верх кадру лишаємо титрам, низ і так закриває інтерфейс Reels.
 * `enterFrom` — кадр, коли телефон в'їжджає знизу; без нього стоїть одразу.
 */
export const PhoneFrame: React.FC<{ children: React.ReactNode; width?: number; top?: number; enterFrom?: number }> = ({
  children,
  width = 760,
  top = 410,
  enterFrom,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = enterFrom == null ? 1 : spring({ frame: frame - enterFrom, fps, config: { damping: 18, mass: 0.9 } });
  const border = 24;
  const height = (width - border * 2) * (844 / 390) + border * 2;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 38%, #f6fbfc 0%, #d5e8ec 100%)' }}>
      <div
        style={{
          position: 'absolute',
          left: (1080 - width) / 2,
          top,
          width,
          height,
          borderRadius: 96,
          border: `${border}px solid ${COLORS.phone}`,
          background: '#000',
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(5, 40, 48, 0.32), 0 6px 18px rgba(5, 40, 48, 0.18)',
          transform: `translateY(${(1 - enter) * 1500}px)`,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, borderRadius: 72, overflow: 'hidden', background: COLORS.bg }}>{children}</div>
      </div>
    </AbsoluteFill>
  );
};
