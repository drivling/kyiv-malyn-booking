import type React from 'react';
import { useEffect, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, Img, staticFile, useCurrentFrame } from 'remotion';
import { COLORS } from './tokens';

export type Manifest = {
  scene: string;
  fps: number;
  width: number;
  height: number;
  frames: number;
  taps: { frame: number; x: number; y: number }[];
  /** Прокрутка сторінки в кожному кадрі, CSS px */
  scroll?: number[];
  /** Знімки всієї сторінки після останнього кадру */
  stills?: Record<string, { width: number; height: number; cssHeight: number }>;
};

/** manifest.json зйомки; рендер чекає, доки він завантажиться */
export function useCaptureManifest(name: string): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [handle] = useState(() => delayRender(`зйомка ${name}`));
  useEffect(() => {
    fetch(staticFile(`captures/${name}/manifest.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`Немає зйомки «${name}»: npm run capture -- ${name}`);
        return r.json();
      })
      .then((m: Manifest) => {
        setManifest(m);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [name, handle]);
  return manifest;
}

/**
 * Кадри зйомки (`npm run capture -- <name>` → public/captures/<name>/). `from` — кадр зйомки, що показується в
 * кадрі 0 цієї Sequence; `rate` — швидкість (2 — удвічі швидше). Після останнього кадру тримаємо останній.
 * Тапи з manifest.json малюємо кружечком у тому місці, де «палець» торкнувся екрана.
 */
export const Capture: React.FC<{ name: string; from?: number; rate?: number; taps?: boolean; style?: React.CSSProperties }> = ({
  name,
  from = 0,
  rate = 1,
  taps = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const manifest = useCaptureManifest(name);
  if (!manifest) return null;
  const idx = Math.min(manifest.frames - 1, Math.max(0, Math.round(from + frame * rate)));
  return (
    <AbsoluteFill style={style}>
      <Img src={staticFile(`captures/${name}/f${String(idx).padStart(4, '0')}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      {taps
        ? manifest.taps.map((tp) => {
            const k = (idx - tp.frame) / 14;
            if (k < 0 || k > 1) return null;
            return (
              <div
                key={tp.frame}
                style={{
                  position: 'absolute',
                  left: `${tp.x * 100}%`,
                  top: `${tp.y * 100}%`,
                  width: '22%',
                  aspectRatio: '1',
                  borderRadius: '50%',
                  border: `10px solid ${COLORS.accent}`,
                  background: 'rgba(0, 175, 245, 0.18)',
                  transform: `translate(-50%, -50%) scale(${0.45 + 0.9 * k})`,
                  opacity: 1 - k,
                }}
              />
            );
          })
        : null}
    </AbsoluteFill>
  );
};
