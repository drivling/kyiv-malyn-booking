import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Спільне для вкладок «Реклама» й «Люди» на стіні: плитка «сьогодні» (одне велике число, смужка, підпис) і стрічка
 * цілих рядків — рядків рівно стільки, скільки вміщається (вимір висоти), решта не стискається до нечитабельності.
 * Стилі — `.wall-ads-*` у StickerWall.css.
 */
export type WallBarSegment = { width: string; tone: 'solid' | 'soft' | 'muted' };

export function WallTile({
  title,
  color,
  value,
  prefix,
  unit,
  bar,
  sub,
}: {
  title: string;
  color: string;
  value: number;
  /** Перед числом, напр. «№ » */
  prefix?: string;
  unit: string;
  bar: WallBarSegment[];
  /** [головне, подробиця] — подробицю вертикальний телефон ховає */
  sub: [string, string?];
}) {
  return (
    <div className="wall-ads-tile" style={{ '--c': color } as CSSProperties}>
      <span className="wall-ads-tile-title">{title}</span>
      <span className="wall-ads-tile-value">
        <b>
          {prefix}
          {value}
        </b>{' '}
        {unit}
      </span>
      <span className="wall-ads-bar" aria-hidden="true">
        {bar.map((s, i) => (
          <span key={i} className={`wall-ads-bar-${s.tone}`} style={{ width: s.width }} />
        ))}
      </span>
      <span className="wall-ads-tile-sub">
        {sub[0]}
        {sub[1] ? <span className="wall-ads-extra"> · {sub[1]}</span> : null}
      </span>
    </div>
  );
}

/** Висота рядка й проміжок — ті самі, що в `.wall-ads-item` / `.wall-ads-feed` */
const ROW_EM = 2.2;
const GAP_EM = 0.3;

/** Скільки цілих рядків вміщає стрічка; поки не виміряно (або jsdom) — усі */
function useRowsThatFit(total: number) {
  const ref = useRef<HTMLOListElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      if (h <= 0) return setFit(null);
      const em = parseFloat(getComputedStyle(el).fontSize) || 16;
      setFit(Math.max(1, Math.floor((h + GAP_EM * em) / ((ROW_EM + GAP_EM) * em))));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, Math.min(total, fit ?? total)] as const;
}

export function WallFeed<T>({ items, label, keyOf, children }: { items: T[]; label: string; keyOf: (item: T) => string; children: (item: T) => ReactNode }) {
  const [ref, fit] = useRowsThatFit(items.length);
  return (
    <ol ref={ref} className="wall-ads-feed" aria-label={label}>
      {items.slice(0, fit).map((item) => (
        <Fragment key={keyOf(item)}>{children(item)}</Fragment>
      ))}
    </ol>
  );
}
