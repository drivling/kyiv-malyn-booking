import type React from 'react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/** Ділянка SVG, яку показуємо (одиниці viewBox) */
export type SvgBox = { x: number; y: number; w: number; h: number };

function useSvgText(file: string): string | null {
  const [text, setText] = useState<string | null>(null);
  const [handle] = useState(() => delayRender(`svg ${file}`));
  useEffect(() => {
    fetch(staticFile(file))
      .then((r) => {
        if (!r.ok) throw new Error(`Немає ${file}: npm run assets`);
        return r.text();
      })
      .then((t) => {
        setText(t);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [file, handle]);
  return text;
}

/**
 * Схема маршрутів із сайту (public/assets/*-transit-scheme-poster.svg): показуємо ділянку `box` і «вмикаємо»
 * лінії — кожна група `.lts-route[data-route]` світиться від `base` до повної яскравості за `lit(i, n)` (0…1, i —
 * порядок маршрутів у файлі). Кольори, назви й зупинки — ті самі, що на плакаті.
 */
export const SchemeSvg: React.FC<{ file: string; box: SvgBox; lit: (i: number, n: number) => number; base?: number; style?: React.CSSProperties }> = ({
  file,
  box,
  lit,
  base = 0.12,
  style,
}) => {
  const text = useSvgText(file);
  const uid = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const prepared = useMemo(() => {
    if (!text) return null;
    const routes = [...text.matchAll(/class="lts-route" data-route="([^"]+)"/g)].map((m) => m[1]);
    const svg = text
      .replace(/^<\?xml[^>]*>\s*/, '')
      .replace(/<svg([^>]*?)\sviewBox="[^"]*"/, `<svg$1 viewBox="${box.x} ${box.y} ${box.w} ${box.h}"`)
      .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
      .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
      .replace(/<svg/, '<svg preserveAspectRatio="xMidYMid slice"');
    return { routes, svg };
  }, [text, box.x, box.y, box.w, box.h]);
  if (!prepared) return null;
  const n = prepared.routes.length;
  const css = [
    `.${uid} svg{width:100%;height:100%;display:block}`,
    ...prepared.routes.map((r, i) => `.${uid} .lts-route[data-route="${r}"]{opacity:${(base + (1 - base) * Math.min(1, Math.max(0, lit(i, n)))).toFixed(3)}}`),
  ].join('\n');
  return (
    <div className={uid} style={style}>
      <style>{css}</style>
      <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: prepared.svg }} />
    </div>
  );
};
