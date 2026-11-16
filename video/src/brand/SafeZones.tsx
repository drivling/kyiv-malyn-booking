import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { HEIGHT, SAFE, WIDTH } from './tokens';

type Zones = { top: number; bottom: number; side: number };

/** Лише для перегляду в Studio (`showSafe`): де інтерфейс Reels (типово) чи сторіс (`SAFE_STORY`) перекриває кадр */
export const SafeZones: React.FC<{ zones?: Zones }> = ({ zones = SAFE }) => {
  const hatch = 'repeating-linear-gradient(135deg, rgba(227, 54, 140, 0.32) 0 14px, rgba(227, 54, 140, 0.12) 14px 28px)';
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: zones.top * HEIGHT, background: hatch }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: zones.bottom * HEIGHT, background: hatch }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: zones.side * WIDTH, background: hatch }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: zones.side * WIDTH, background: hatch }} />
    </AbsoluteFill>
  );
};
