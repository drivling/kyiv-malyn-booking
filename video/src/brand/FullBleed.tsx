import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { Capture } from './Capture';
import { COLORS, HEIGHT, WIDTH } from './tokens';

/** Висота екрана зйомки, розтягнутого на всю ширину кадру (390 × 844 → 1080 × ~2337) */
export const BLEED_HEIGHT = (WIDTH * 844) / 390;

/** Наїзд камери в кадрі без рамки: `scale` навколо точки кадру (x, y — частки 1080 × 1920), `shiftY` — зсув у px */
export type FrameZoom = { scale: number; x: number; y: number; shiftY?: number };

/**
 * Кадр зйомки на всю ширину, без телефона. Екран вищий за кадр: `align` 0 — видно верх екрана, 1 — низ.
 */
export const FullBleed: React.FC<{ name: string; from: number; rate?: number; align?: number; zoom?: FrameZoom }> = ({ name, from, rate = 1, align = 0, zoom }) => {
  const z = zoom ?? { scale: 1, x: 0.5, y: 0.5 };
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translateY(${z.shiftY ?? 0}px) scale(${z.scale})`, transformOrigin: `${z.x * 100}% ${z.y * 100}%` }}>
        <div style={{ position: 'absolute', left: 0, top: -(BLEED_HEIGHT - HEIGHT) * align, width: WIDTH, height: BLEED_HEIGHT }}>
          <Capture name={name} from={from} rate={rate} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
