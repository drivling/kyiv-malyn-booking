/**
 * Чисті хелпери міні-схеми (LocalTransportSchemeMini.tsx): кадрування, посилання на схему,
 * перелік зупинок схеми. Окремий модуль, щоб компонентний файл експортував лише компонент.
 */
import schemeSvg from './scheme/malyn-scheme.svg?raw';
import { schemeNodeForStop } from './schemeStops';

/** viewBox згенерованої схеми (build_scheme.py, variant='site') — межі кадрування */
const BASE = { x: 0, y: 176, w: 1400, h: 566 };
/** Поле навколо підсвічених ліній/зупинок, у координатах схеми */
const CROP_PAD = 70;
/** Найвужчий кадр: коротка лінія не має перетворюватись на крупний план без контексту */
const CROP_MIN_W = 640;

/**
 * Той самий SVG, що й на /transport/scheme, але без інтерактивних ролей на групах:
 * міні-схема цілком лежить усередині <Link>, а вкладені role=button/link і tabindex там недоречні.
 */
export const MINI_SVG = schemeSvg.replace(/ (?:role="(?:button|link)"|tabindex="0")/g, '');

/** Чи є зупинка на схемі — головною або однією зі зупинок вузла (malyn-scheme-nodes.ts) */
export function isSchemeStop(stopId: string): boolean {
  return schemeNodeForStop(stopId) !== null;
}

/** Посилання на сторінку схеми з контекстом (маршрут/зупинка) і датою-часом пошуку */
export function buildSchemeUrl(p: { route?: string; stop?: string; date?: string; time?: string }): string {
  const qs = new URLSearchParams();
  if (p.route) qs.set('route', p.route);
  if (p.stop) qs.set('stop', p.stop);
  if (p.date) qs.set('d', p.date);
  if (p.time) qs.set('h', p.time);
  const s = qs.toString();
  return `/transport/scheme${s ? `?${s}` : ''}`;
}

export type Box = { x: number; y: number; w: number; h: number };

/**
 * Кадр для viewBox: обʼєднання bbox підсвічених елементів з полем, пропорції як у всієї схеми
 * (щоб міні-схема завжди була однакової форми), не вужче CROP_MIN_W і в межах BASE.
 */
export function unionOf(boxes: Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function cropViewBox(boxes: Box[]): Box {
  if (!boxes.length) return BASE;
  const u = unionOf(boxes);
  const x0 = u.x - CROP_PAD;
  const y0 = u.y - CROP_PAD;
  const x1 = u.x + u.w + CROP_PAD;
  const y1 = u.y + u.h + CROP_PAD;
  const ratio = BASE.h / BASE.w;
  let w = Math.max(x1 - x0, CROP_MIN_W);
  let h = w * ratio;
  if (y1 - y0 > h) {
    h = y1 - y0;
    w = h / ratio;
  }
  if (w > BASE.w) {
    w = BASE.w;
    h = BASE.h;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(cx - w / 2, BASE.x), BASE.x + BASE.w - w);
  const y = Math.min(Math.max(cy - h / 2, BASE.y), BASE.y + BASE.h - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
