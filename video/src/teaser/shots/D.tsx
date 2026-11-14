import type React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { ease } from '../../brand/camera';
import { useCaptureManifest } from '../../brand/Capture';
import { FullBleed } from '../../brand/FullBleed';
import { WIDTH } from '../../brand/tokens';
import type { Placed } from '../timeline';

/**
 * Історія (script.md, D) — продовження дубля «hero» вже без рамки телефона: історія склалася під час наїзду в C4,
 * прокрутки рейкою — на 232–268 (до «Вийдіть біля ПТЛ» і №8) та 292–322 (до вокзалу). D1 — маршрутка (кадри до
 * прокрутки, повільно), D2 — пересадка на №8, D3 — наїзд на перекидні «09:45», D4 — камера відходить: уся історія
 * однією смугою (знімок сторінки `full.jpg`).
 */
const HERO = 'hero';

export const D1: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  return <FullBleed name={HERO} from={200} rate={0.5} zoom={{ scale: ease(frame, 0, shot.dur, 1, 1.12), x: 0.3, y: 0.42 }} />;
};

export const D2: React.FC<{ shot: Placed }> = () => <FullBleed name={HERO} from={232} />;

export const D3: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, shot.dur * 0.42, shot.dur * 0.92, 0, 1);
  // «09:45 · Малин · вокзал» підіймаємо з нижньої третини кадру в середину
  return <FullBleed name={HERO} from={290} zoom={{ scale: 1 + 0.85 * k, x: 0.13, y: 0.72, shiftY: -320 * k }} />;
};

export const D4: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const manifest = useCaptureManifest(HERO);
  if (!manifest) return null;
  // прокрутка в кінці дубля і висота сторінки — з manifest.json зйомки
  const LAST_SCROLL = manifest.scroll?.[manifest.scroll.length - 1] ?? 0;
  const PAGE_HEIGHT = manifest.stills?.full?.cssHeight ?? 844;
  const k = ease(frame, 0, shot.dur * 0.55, 0, 1);
  // старт: сторінка на всю ширину, видно той самий шматок, що в кінці дубля; фініш — уся смуга під титром
  const fullH = (PAGE_HEIGHT * WIDTH) / 390;
  const endScale = 1380 / fullH;
  const endX = (WIDTH - WIDTH * endScale) / 2;
  const endY = 450;
  const startY = -(LAST_SCROLL * WIDTH) / 390;
  const s = 1 + (endScale - 1) * k;
  const x = endX * k;
  const y = startY + (endY - startY) * k;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 38%, #f6fbfc 0%, #d5e8ec 100%)', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: WIDTH,
          height: fullH,
          transformOrigin: '0 0',
          transform: `translate(${x}px, ${y}px) scale(${s})`,
          borderRadius: (36 / Math.max(s, 0.2)) * k,
          overflow: 'hidden',
          boxShadow: k > 0.05 ? `0 ${30 / s}px ${80 / s}px rgba(5, 40, 48, ${0.3 * k})` : 'none',
        }}
      >
        <Img src={staticFile(`captures/${HERO}/full.jpg`)} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </AbsoluteFill>
  );
};
