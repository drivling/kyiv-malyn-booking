import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { GOLOS } from '../brand/fonts';
import { SECTION_NAMES, type Placed } from './timeline';

/** Заглушка кадру, якого ще не знято: щоб майстер рендерився цілим із першого дня */
export const Placeholder: React.FC<{ shot: Placed }> = ({ shot }) => (
  <AbsoluteFill style={{ background: '#0f2a30', color: '#e6f1f3', justifyContent: 'center', padding: '0 90px', fontFamily: GOLOS }}>
    <div style={{ fontSize: 40, fontWeight: 600, opacity: 0.7, letterSpacing: '0.04em' }}>
      {shot.id} · {SECTION_NAMES[shot.sec]}
    </div>
    <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.15, marginTop: 16 }}>{shot.title}</div>
    <div style={{ fontSize: 34, opacity: 0.55, marginTop: 30 }}>чернетка — сцену ще не знято</div>
  </AbsoluteFill>
);
