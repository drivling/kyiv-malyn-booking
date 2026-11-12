/**
 * Схеми маршрутів по містах (Docs/korosten-scheme-2026-11.md). Кожна згенерована тим самим генератором
 * (Docs/malyn-transit-scheme/build_scheme.py; Коростень — з --city Docs/korosten-transit-scheme/korosten_scheme.py):
 * SVG для сайту (лінії з data-route, зупинки з data-stop), легенда й вузли. Місто без схеми — null:
 * тоді на сайті нема вкладки «Схема», міні-схем і порядку ліній за легендою.
 */
import malynSvg from './malyn-scheme.svg?raw';
import korostenSvg from './korosten-scheme.svg?raw';
import { SCHEME_ROUTES as MALYN_ROUTES, type SchemeRoute } from './malyn-scheme-routes';
import { SCHEME_NODES as MALYN_NODES, type SchemeNode } from './malyn-scheme-nodes';
import { SCHEME_ROUTES as KOROSTEN_ROUTES } from './korosten-scheme-routes';
import { SCHEME_NODES as KOROSTEN_NODES } from './korosten-scheme-nodes';

export type { SchemeRoute, SchemeNode };

export type SchemeBox = { x: number; y: number; w: number; h: number };

export type CityScheme = {
  city: string;
  /** SVG карти (variant='site') */
  svg: string;
  routes: SchemeRoute[];
  nodes: SchemeNode[];
  /** viewBox SVG — межі кадрування міні-схеми й прокрутки сторінки схеми */
  viewBox: SchemeBox;
  /** Куди прокрутити полотно на вузькому екрані (частка ширини): центр міста */
  initialScroll: number;
  /** Плакат для друку з QR-кодом (public/transport/scheme/) */
  poster: { pdf: string; svg: string };
};

function viewBoxOf(svg: string): SchemeBox {
  const m = /viewBox="([\d.\s-]+)"/.exec(svg);
  const [x, y, w, h] = (m ? m[1] : '0 0 1400 566').trim().split(/\s+/).map(Number);
  return { x, y, w, h };
}

const SCHEMES: Record<string, CityScheme> = {
  Malyn: {
    city: 'Malyn',
    svg: malynSvg,
    routes: MALYN_ROUTES,
    nodes: MALYN_NODES,
    viewBox: viewBoxOf(malynSvg),
    initialScroll: 0.4,
    poster: { pdf: '/transport/scheme/malyn-transit-scheme-poster.pdf', svg: '/transport/scheme/malyn-transit-scheme-poster.svg' },
  },
  Korosten: {
    city: 'Korosten',
    svg: korostenSvg,
    routes: KOROSTEN_ROUTES,
    nodes: KOROSTEN_NODES,
    viewBox: viewBoxOf(korostenSvg),
    initialScroll: 0.45,
    poster: {
      pdf: '/transport/scheme/korosten-transit-scheme-poster.pdf',
      svg: '/transport/scheme/korosten-transit-scheme-poster.svg',
    },
  },
};

/** Схема міста транспорту або null — місто без схеми */
export function schemeFor(city: string): CityScheme | null {
  return SCHEMES[city] ?? null;
}
