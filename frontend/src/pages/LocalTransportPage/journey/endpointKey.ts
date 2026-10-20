/**
 * Кінець маршруту, що не є зупинкою (геолокація, клік на карті), живе в тому самому рядковому стані «Звідки/Куди»,
 * що й id зупинки, тож проходить через URL-пару `/transport/:from/:to` без окремих параметрів:
 *   me:50.77283,29.25807 — «Моє місцезнаходження» (геолокація)
 *   pt:50.77283,29.25807 — «Точка на карті»
 * 5 знаків після коми ≈ 1 м. Координати в аналітику не йдуть (див. endpointGaValue).
 */
import type { Endpoint } from './types';

export type PointKind = 'me' | 'pt';

export interface ParsedPoint {
  kind: PointKind;
  lat: number;
  lng: number;
}

const POINT_RE = /^(me|pt):(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;

export function pointKey(kind: PointKind, lat: number, lng: number): string {
  return `${kind}:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function parsePointKey(key: string | null | undefined): ParsedPoint | null {
  const m = POINT_RE.exec((key ?? '').trim());
  if (!m) return null;
  const lat = Number(m[2]);
  const lng = Number(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { kind: m[1] as PointKind, lat, lng };
}

export function isPointKey(key: string | null | undefined): boolean {
  return parsePointKey(key) !== null;
}

/** Id зупинки або координати → кінець для пошуку поїздок */
export function endpointFromKey(key: string): Endpoint {
  const p = parsePointKey(key);
  return p ? { kind: 'point', lat: p.lat, lng: p.lng } : { kind: 'stop', stopId: key };
}

/** Підпис кінця, що не є зупинкою; для зупинки — null (її назву дає каталог) */
export function pointLabel(key: string): string | null {
  const p = parsePointKey(key);
  if (!p) return null;
  return p.kind === 'me' ? 'Моє місцезнаходження' : 'Точка на карті';
}

/** Те, що можна віддати в GA4: id зупинки або категорія, але не координати людини */
export function endpointGaValue(key: string): string {
  const p = parsePointKey(key);
  return p ? (p.kind === 'me' ? 'geo' : 'point') : key;
}
