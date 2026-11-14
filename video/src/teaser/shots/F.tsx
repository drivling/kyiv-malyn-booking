import type React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { beats } from '../../brand/beat';
import { ease } from '../../brand/camera';
import { Capture } from '../../brand/Capture';
import { FullBleed } from '../../brand/FullBleed';
import { PhoneFrame } from '../../brand/PhoneFrame';
import { SchemeSvg } from '../../brand/SchemeSvg';
import { COLORS, HEIGHT, WIDTH } from '../../brand/tokens';
import type { Placed } from '../timeline';

/**
 * Місто з пересадками (script.md, F). F1 — зйомка «city»: Царське село → №9 → пішки → №12 → вокзал (прискорено ×1,5).
 * F2 — схема Малина з плаката: камера пролітає зліва направо, лінії «вмикаються» одна за одною. F3 — фото наклейки
 * «з-д «Прожектор»» з першого поста: наїзд на QR, рамка сканування. F4 — зйомка «board»: табло «м-н "Промінь"».
 */

export const F1: React.FC<{ shot: Placed }> = () => <FullBleed name="city" from={22} rate={1.5} />;

/** Ділянка плаката Малина з самою мапою (одиниці viewBox 1400 × 1012) */
const MALYN_MAP = { x: 0, y: 150, w: 1400, h: 600 };

export const F2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const h = 980;
  const w = (h * MALYN_MAP.w) / MALYN_MAP.h;
  const x = ease(frame, 0, shot.dur, 0, -(w - WIDTH));
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      <SchemeSvg
        file="assets/malyn-transit-scheme-poster.svg"
        box={MALYN_MAP}
        lit={(i, n) => (frame - 4 - (i * (shot.dur - 18)) / n) / 8}
        style={{ position: 'absolute', left: x, top: (HEIGHT - h) / 2 - 80, width: w, height: h }}
      />
    </AbsoluteFill>
  );
};

/** Фото 540 × 745 і де на ньому QR (частки) */
const STICKER = { w: 540, h: 745, qr: { x: 0.34, y: 0.7, size: 0.25 } };

export const F3: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  // фото на всю висоту кадру, наїзд на QR і підйом QR у середину кадру (нижні 35 % закриває Reels)
  const base = HEIGHT / STICKER.h;
  const w0 = STICKER.w * base;
  // де QR на старті (фото на всю висоту, по центру) і куди його веде камера
  const start = { x: (WIDTH - w0) / 2 + STICKER.qr.x * w0, y: STICKER.qr.y * HEIGHT };
  const k = ease(frame, 0, shot.dur * 0.8, 0, 1);
  const scale = base * (1 + 0.9 * k);
  const imgW = STICKER.w * scale;
  const imgH = STICKER.h * scale;
  const qrX = STICKER.qr.x * imgW;
  const qrY = STICKER.qr.y * imgH;
  const left = interpolate(k, [0, 1], [start.x, WIDTH / 2]) - qrX;
  const top = interpolate(k, [0, 1], [start.y, HEIGHT * 0.5]) - qrY;
  // рамка сканування: заходить на 40 % кадру, пульсує на біт
  const scan = ease(frame, shot.dur * 0.35, shot.dur * 0.6, 0, 1);
  const pulse = 1 + 0.05 * Math.sin((frame / beats(1)) * Math.PI * 2);
  const box = STICKER.qr.size * imgW * 1.35;
  return (
    <AbsoluteFill style={{ background: '#2b3134', overflow: 'hidden' }}>
      <Img src={staticFile('assets/sticker-prozhektor.jpg')} style={{ position: 'absolute', left, top, width: imgW, height: imgH }} />
      <div
        style={{
          position: 'absolute',
          left: left + qrX - box / 2,
          top: top + qrY - box / 2,
          width: box,
          height: box,
          opacity: scan,
          transform: `scale(${(1.4 - 0.4 * scan) * pulse})`,
        }}
      >
        {[
          { left: 0, top: 0, borderRight: 0, borderBottom: 0 },
          { right: 0, top: 0, borderLeft: 0, borderBottom: 0 },
          { left: 0, bottom: 0, borderRight: 0, borderTop: 0 },
          { right: 0, bottom: 0, borderLeft: 0, borderTop: 0 },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', width: '24%', height: '24%', border: `14px solid ${COLORS.accent}`, borderRadius: 10, ...s }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const F4: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  return (
    <PhoneFrame zoom={{ scale: ease(frame, 0, shot.dur, 1, 1.08), x: 0.5, y: 0.4, shiftY: -230 }}>
      <Capture name="board" from={14} />
    </PhoneFrame>
  );
};
