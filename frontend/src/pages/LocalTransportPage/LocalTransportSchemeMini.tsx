import React, { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { SCHEME_COLOR_VARS } from './routeColors';
import { MINI_SVG, cropViewBox, unionOf, type Box } from './schemeMini';
import './scheme/scheme-svg.css';
import './LocalTransportSchemeMini.css';

function bboxOf(el: Element | null): Box | null {
  const g = el as SVGGraphicsElement | null;
  if (!g || typeof g.getBBox !== 'function') return null; // jsdom
  try {
    const b = g.getBBox();
    return b.width > 0 || b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  } catch {
    return null;
  }
}

/** Допуск, з яким маркер зупинки вважається таким, що лежить на підсвічених лініях */
const ON_LINE_TOL = 12;

/**
 * Зупинки вздовж підсвічених ліній: SVG не знає, які зупинки обслуговує лінія, тому беремо ті,
 * чий маркер (перше коло/риска групи) лежить у межах bbox цих ліній. Їхні підписи й плашки
 * потрапляють у кадр — без цього назву кінцевої зрізало б краєм.
 */
function stopsAlong(root: ParentNode, lines: Box[]): Box[] {
  if (!lines.length) return [];
  const u = unionOf(lines);
  const out: Box[] = [];
  root.querySelectorAll('.lts-stop').forEach((g) => {
    const m = bboxOf(g.querySelector(':scope > circle, :scope > line'));
    if (!m) return;
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    if (cx < u.x - ON_LINE_TOL || cx > u.x + u.w + ON_LINE_TOL || cy < u.y - ON_LINE_TOL || cy > u.y + u.h + ON_LINE_TOL) return;
    const b = bboxOf(g);
    if (b) out.push(b);
  });
  return out;
}

export type LocalTransportSchemeMiniProps = {
  /** Лінії, що лишаються яскравими; решта тьмяніє */
  routeIds: string[];
  /** Зупинки з маркером «ви тут» (лише ті, що є на схемі, див. isSchemeStop) */
  stopIds?: string[];
  /** Куди веде міні-схема — сторінка схеми з ?route= або ?stop= */
  href: string;
  /** Доступна назва посилання, напр. «Відкрити схему маршрутів: маршрут №3» */
  label: string;
  /** Підпис під схемою (зупинка між вузлами, перелік ліній) */
  note?: React.ReactNode;
  /** Уся схема без притьмарення й кадрування (швидкий старт планувальника) */
  showAll?: boolean;
  /** Заголовок секції (за замовчуванням «На схемі міста») */
  title?: string;
  /** Сторінка-джерело для події `transport_scheme_open` (без неї подія не шлеться) */
  source?: 'planner' | 'route' | 'board';
};

/**
 * Міні-схема для сторінок маршруту й зупинки: та сама SVG-схема, кадрована до підсвічених
 * ліній/зупинок, цілком — посилання на /transport/scheme. Підсвічування і кадрування ставляться
 * після монтування прямо в DOM, бо SVG вставлено рядком, а не React-деревом.
 */
export function LocalTransportSchemeMini({ routeIds, stopIds = [], href, label, note, showAll = false, title = 'На схемі міста', source }: LocalTransportSchemeMiniProps) {
  const headingId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const routeKey = routeIds.join(',');
  const stopKey = stopIds.join(',');

  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const routes = new Set(routeKey ? routeKey.split(',') : []);
    const stops = new Set(stopKey ? stopKey.split(',') : []);
    const lines: Box[] = [];
    root.querySelectorAll('.lts-route').forEach((g) => {
      const own = showAll || routes.has(g.getAttribute('data-route') || '');
      g.classList.toggle('lts-route--dim', !own);
      if (own) {
        const b = bboxOf(g);
        if (b) lines.push(b);
      }
    });
    const boxes: Box[] = showAll ? [] : [...lines, ...stopsAlong(root, lines)];
    root.querySelectorAll('.lts-badge').forEach((g) => {
      g.classList.toggle('lts-badge--dim', !showAll && !routes.has(g.getAttribute('data-route') || ''));
    });
    root.querySelectorAll('.lts-stop').forEach((g) => {
      const here = stops.has(g.getAttribute('data-stop') || '');
      g.classList.toggle('lts-stop--here', here);
      if (here) {
        const b = bboxOf(g);
        if (b) boxes.push(b);
      }
    });
    const svg = root.querySelector('svg');
    if (svg) {
      const v = cropViewBox(boxes);
      svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    }
  }, [routeKey, stopKey, showAll]);

  return (
    <section className="lts-mini" aria-labelledby={headingId} style={SCHEME_COLOR_VARS}>
      <h2 id={headingId} className="lt-section-title lts-mini-title">
        {title}
      </h2>
      <Link
        className="lts-mini-canvas"
        to={href}
        aria-label={label}
        onClick={() => {
          if (source) gaTrackEvent('transport_scheme_open', { source });
        }}
      >
        <div ref={canvasRef} className="lts-mini-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MINI_SVG }} />
        <span className="lts-mini-cta" aria-hidden="true">
          Відкрити схему →
        </span>
      </Link>
      {note && <p className="lts-mini-note">{note}</p>}
    </section>
  );
}
