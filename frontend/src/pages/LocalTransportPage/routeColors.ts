import type { CSSProperties } from 'react';
import { SCHEME_ROUTES, type SchemeRoute } from './scheme/malyn-scheme-routes';

/**
 * Кольори ліній зі схеми маршрутів (/transport/scheme) для плашок номерів у планувальнику,
 * на табло та в каталозі ліній. Джерело — згенерований scheme/malyn-scheme-routes.ts
 * (Docs/malyn-transit-scheme/build_scheme.py, COLORS і FG); маршрути поза схемою кольору не мають,
 * і CSS бере запасний акцент сайту через var(--lt-route-color, …).
 */
const SCHEME_BY_ID: ReadonlyMap<string, RouteColor> = new Map(SCHEME_ROUTES.map((r: SchemeRoute) => [r.id, { color: r.color, fg: r.fg }]));

type RouteColor = { color: string; fg: string };
const DEFAULT_CITY = 'Malyn';
/** Кольори з датасету (meta.routeColors) — для міст без намальованої схеми; по містах, як і номери маршрутів */
const datasetColorsByCity = new Map<string, ReadonlyMap<string, RouteColor>>();
let currentCity = DEFAULT_CITY;

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Запам'ятати кольори ліній із датасету: meta.routeColors = { "<id маршруту>": { color: "#rrggbb", fg? } }.
 * Викликає apiClient.getTransportDataset() і завантажувач (копія, знімок). Малин бере кольори з легенди схеми,
 * а meta.routeColors — лише для маршрутів, яких на схемі нема.
 */
export function configureRouteColors(meta: unknown, city: string = DEFAULT_CITY): void {
  const raw = (meta as { routeColors?: unknown } | null | undefined)?.routeColors;
  const next = new Map<string, RouteColor>();
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const v = (typeof value === 'string' ? { color: value } : value) as { color?: unknown; fg?: unknown } | null;
      if (!v || typeof v.color !== 'string' || !HEX_RE.test(v.color)) continue;
      const fg = typeof v.fg === 'string' && HEX_RE.test(v.fg) ? v.fg : textColorOn(v.color);
      next.set(id, { color: v.color, fg });
    }
  }
  datasetColorsByCity.set(city, next);
  currentCity = city;
}

/** Місто, чиї кольори віддають routeColor / routeColorStyle (сторінка показує датасет цього міста) */
export function setRouteColorsCity(city: string): void {
  currentCity = city || DEFAULT_CITY;
}

function lookup(routeId: string): RouteColor | undefined {
  const fromScheme = currentCity === DEFAULT_CITY ? SCHEME_BY_ID.get(routeId) : undefined;
  return fromScheme ?? datasetColorsByCity.get(currentCity)?.get(routeId);
}

/** HEX-колір лінії або null для маршруту без кольору (нема ні на схемі, ні в датасеті) */
export function routeColor(routeId: string): string | null {
  return lookup(routeId)?.color ?? null;
}

/**
 * Інлайн-стиль для плашки номера: задає `--lt-route-color` (фон/рамка) і `--lt-route-fg` (колір
 * номера на кольорі лінії, з легенди схеми). Для маршруту без кольору повертає undefined — тоді
 * працюють запасні значення в CSS.
 */
export function routeColorStyle(routeId: string): CSSProperties | undefined {
  const route = lookup(routeId);
  if (!route) return undefined;
  return { '--lt-route-color': route.color, '--lt-route-fg': route.fg } as CSSProperties;
}

/**
 * `--lts-r<id>` (колір лінії) і `--lts-r<id>-fg` (колір номера на плашці) для вставленої SVG-схеми
 * (сторінка «Схема», міні-схема): ті самі кольори, що й у плашках, одним інлайн-стилем на кореневому
 * елементі.
 */
export const SCHEME_COLOR_VARS = Object.fromEntries(
  SCHEME_ROUTES.flatMap((r) => [
    [`--lts-r${r.id}`, r.color],
    [`--lts-r${r.id}-fg`, r.fg],
  ])
) as CSSProperties;

/** Відносна яскравість кольору #rrggbb за WCAG 2.x (0 — чорний, 1 — білий); null — не HEX */
function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двох кольорів #rrggbb за WCAG 2.x: від 1 до 21 (норма AA для звичайного тексту — 4.5) */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 0;
  const lb = relativeLuminance(b) ?? 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Колір тексту на довільному кольорі лінії (наклейки, стіна сканувань): білий або чорний, що
 * контрастніше, — те саме правило, за яким генератор схеми рахує `fg` у легенді. Один із двох на
 * будь-якому кольорі дає щонайменше 4.58:1. Не HEX — білий.
 */
export function textColorOn(bg: string): '#ffffff' | '#000000' {
  if (relativeLuminance(bg) === null) return '#ffffff';
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000';
}
