import type React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, WIDTH } from './tokens';

/** Геометрія телефона в кадрі 1080 × 1920: екран 390 × 844 (як у зйомці) — кадри зйомки лягають без обрізання */
export const PHONE = {
  width: 760,
  top: 410,
  border: 24,
} as const;
export const SCREEN = {
  left: (WIDTH - PHONE.width) / 2 + PHONE.border,
  top: PHONE.top + PHONE.border,
  width: PHONE.width - PHONE.border * 2,
  height: (PHONE.width - PHONE.border * 2) * (844 / 390),
} as const;

/**
 * Камера: `scale` навколо точки екрана (x, y — частки ширини й висоти екрана) і `shiftY` — зсув телефона вгору
 * (мінус) у px кадру, щоб важливе не потрапляло в нижні 35 % (там інтерфейс Reels).
 */
export type PhoneZoom = { scale: number; x: number; y: number; shiftY?: number };

/**
 * Масштаб, за якого екран телефона стає рівно на всю ширину кадру, а його верх — на верх кадру: з цього стану
 * склейка в кадр без рамки (`FullBleed`, align 0) непомітна.
 */
export const FILL_ZOOM: PhoneZoom = (() => {
  const s = WIDTH / SCREEN.width;
  const originY = (SCREEN.top * s) / (s - 1);
  return { scale: s, x: 0.5, y: (originY - SCREEN.top) / SCREEN.height };
})();

/**
 * Нейтральний телефон без бренду. Стоїть нижче центру: верх кадру — титрам, низ і так закриває інтерфейс Reels.
 * `enterFrom` — кадр, коли телефон в'їжджає знизу; `zoom` — наїзд камери на точку екрана.
 */
export const PhoneFrame: React.FC<{ children: React.ReactNode; enterFrom?: number; zoom?: PhoneZoom }> = ({ children, enterFrom, zoom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = enterFrom == null ? 1 : spring({ frame: frame - enterFrom, fps, config: { damping: 18, mass: 0.9 } });
  const z = zoom ?? { scale: 1, x: 0.5, y: 0.5 };
  const height = SCREEN.height + PHONE.border * 2;
  const originX = PHONE.border + z.x * SCREEN.width;
  const originY = PHONE.border + z.y * SCREEN.height;
  // що ближче до «екран на весь кадр», то прямокутніші кути — склейка в FullBleed без стрибка
  const round = Math.min(1, Math.max(0, (FILL_ZOOM.scale - z.scale) / (FILL_ZOOM.scale - 1)));
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 38%, #f6fbfc 0%, #d5e8ec 100%)' }}>
      <div
        style={{
          position: 'absolute',
          boxSizing: 'border-box',
          left: (WIDTH - PHONE.width) / 2,
          top: PHONE.top,
          width: PHONE.width,
          height,
          borderRadius: 96 * round,
          border: `${PHONE.border}px solid ${COLORS.phone}`,
          background: '#000',
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(5, 40, 48, 0.32), 0 6px 18px rgba(5, 40, 48, 0.18)',
          transform: `translateY(${(1 - enter) * 1500 + (z.shiftY ?? 0)}px) scale(${z.scale})`,
          transformOrigin: `${originX}px ${originY}px`,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, borderRadius: 72 * round, overflow: 'hidden', background: COLORS.bg }}>{children}</div>
      </div>
    </AbsoluteFill>
  );
};
