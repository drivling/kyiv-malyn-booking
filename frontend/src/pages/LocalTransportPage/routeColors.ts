import type { CSSProperties } from 'react';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';

/**
 * Кольори ліній зі схеми маршрутів (/transport/scheme) для плашок номерів у планувальнику,
 * на табло та в каталозі ліній. Джерело — згенерований scheme/malyn-scheme-routes.ts
 * (Docs/malyn-transit-scheme/build_scheme.py, COLORS); маршрути поза схемою кольору не мають,
 * і CSS бере запасний акцент сайту через var(--lt-route-color, …).
 */
const COLOR_BY_ROUTE: ReadonlyMap<string, string> = new Map(SCHEME_ROUTES.map((r) => [r.id, r.color]));

/** HEX-колір лінії або null для маршруту, якого немає на схемі */
export function routeColor(routeId: string): string | null {
  return COLOR_BY_ROUTE.get(routeId) ?? null;
}

/**
 * Інлайн-стиль для плашки номера: задає `--lt-route-color` (фон/рамка) і `--lt-route-fg` (текст на
 * кольорі). Для маршруту без кольору повертає undefined — тоді працюють запасні значення в CSS.
 */
export function routeColorStyle(routeId: string): CSSProperties | undefined {
  const color = routeColor(routeId);
  if (!color) return undefined;
  return { '--lt-route-color': color, '--lt-route-fg': '#ffffff' } as CSSProperties;
}
