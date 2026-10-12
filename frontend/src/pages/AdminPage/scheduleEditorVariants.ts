/**
 * Варіанти шляху й опорні часи в редакторі розкладу (Docs/route-variants-2026-10.md): ланцюжок шляху,
 * рейси шляху, перенесення рейсу на інший шлях, опорні часи на зупинках, текст JSON-редактора варіантів.
 * Повна перевірка — на сервері (PUT /transport/dataset); тут — лише те, що потрібно формі.
 */
import type {
  TransportRouteDto,
  TransportRouteStopDto,
  TransportRouteVariantDto,
  TransportTripDto,
  TransportTripTimepointDto,
} from '@/api/transportDataset';
import type { TripTiming } from '../LocalTransportPage/dataset/tripTiming';

/** Шлях у перемикачі редактора: основний ланцюжок напрямку або id варіанта */
export const MAIN_PATH = '';

/** Варіанти маршруту в напрямку рейсів ('1' — туди, '0' — назад) */
export function variantsForDirection(
  route: Pick<TransportRouteDto, 'variants'> | null | undefined,
  directionId: string
): TransportRouteVariantDto[] {
  return (route?.variants ?? []).filter((v) => v.directionId === directionId);
}

/** Ланцюжок шляху: варіант або основний ланцюжок напрямку — з технічними точками (час) і лише пасажирські (рядки) */
export function pathChain(
  routeStops: TransportRouteStopDto[],
  routeId: string,
  directionId: string,
  variant: TransportRouteVariantDto | null
): { chain: string[]; passengers: string[] } {
  if (variant) {
    return {
      chain: variant.stops.map((p) => p.stopId),
      passengers: variant.stops.filter((p) => !p.mapOnly).map((p) => p.stopId),
    };
  }
  const orderKey = directionId === '0' ? 'orderBack' : 'orderThere';
  const rows = routeStops
    .filter((rs) => rs.routeId === routeId && (rs[orderKey] ?? -1) > 0)
    .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
  return { chain: rows.map((rs) => rs.stopId), passengers: rows.filter((rs) => !rs.mapOnly).map((rs) => rs.stopId) };
}

/** Шлях рейсу в перемикачі: id його варіанта, якщо такий є серед варіантів напрямку, інакше основний */
export function tripPath(trip: Pick<TransportTripDto, 'variantId'>, variants: TransportRouteVariantDto[]): string {
  return trip.variantId && variants.some((v) => v.id === trip.variantId) ? trip.variantId : MAIN_PATH;
}

/**
 * Зміни рейсу при перенесенні на інший шлях: «З» / «Кінцева» стосувалися старого ланцюжка — скидаються;
 * опорні часи лишаються лише на пасажирських зупинках нового шляху.
 */
export function moveTripToPath(
  trip: Pick<TransportTripDto, 'timepoints'>,
  pathId: string,
  passengers: string[]
): Pick<TransportTripDto, 'variantId' | 'startStopId' | 'endStopId' | 'timepoints'> {
  const kept = (trip.timepoints ?? []).filter((tp) => passengers.includes(tp.stopId));
  return { variantId: pathId || null, startStopId: null, endStopId: null, timepoints: kept.length ? kept : null };
}

/** Опорний час рейсу на зупинці (HH:MM) або '' */
export function timepointAt(trip: Pick<TransportTripDto, 'timepoints'>, stopId: string): string {
  return (trip.timepoints ?? []).find((tp) => tp.stopId === stopId)?.time.slice(0, 5) ?? '';
}

/**
 * Опорні часи рейсу після правки клітинки: time '' прибирає опору на зупинці. Порядок — як у ланцюжку
 * шляху (так їх перевіряє сервер); порожній список — null.
 */
export function setTimepoint(
  trip: Pick<TransportTripDto, 'timepoints'>,
  stopId: string,
  time: string,
  passengers: string[]
): TransportTripTimepointDto[] | null {
  const rest = (trip.timepoints ?? []).filter((tp) => tp.stopId !== stopId);
  const next = time ? [...rest, { stopId, time }] : rest;
  const order = (id: string) => {
    const i = passengers.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  next.sort((a, b) => order(a.stopId) - order(b.stopId));
  return next.length ? next : null;
}

/** Текст JSON-редактора варіантів маршруту; без варіантів — порожньо */
export function variantsToText(variants: TransportRouteVariantDto[] | null | undefined): string {
  return variants?.length ? JSON.stringify(variants, null, 2) : '';
}

/**
 * Розбір JSON-редактора варіантів: порожньо — без варіантів; інакше масив
 * `{ id, directionId: "1" | "0", name, stops: [{ stopId, mapOnly? }] }`. Перевіряється лише форма —
 * решту (зупинки існують, без повторів, крайні пасажирські) перевірить сервер при збереженні.
 */
export function parseVariantsText(
  text: string
): { variants: TransportRouteVariantDto[]; error: '' } | { variants: null; error: string } {
  if (!text.trim()) return { variants: [], error: '' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { variants: null, error: `Некоректний JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(raw)) return { variants: null, error: 'Потрібен масив варіантів: [{ id, directionId, name, stops }]' };
  for (const [i, v] of raw.entries()) {
    const at = `Варіант ${i + 1}`;
    if (!v || typeof v !== 'object') return { variants: null, error: `${at}: потрібен об'єкт` };
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id.trim()) return { variants: null, error: `${at}: потрібен id` };
    if (o.directionId !== '0' && o.directionId !== '1') {
      return { variants: null, error: `${at} (${o.id}): directionId — "1" (туди) або "0" (назад)` };
    }
    if (typeof o.name !== 'string' || !o.name.trim()) return { variants: null, error: `${at} (${o.id}): потрібна назва (name)` };
    if (!Array.isArray(o.stops) || o.stops.some((p) => !p || typeof (p as { stopId?: unknown }).stopId !== 'string')) {
      return { variants: null, error: `${at} (${o.id}): stops — масив [{ stopId, mapOnly? }]` };
    }
  }
  return { variants: raw as TransportRouteVariantDto[], error: '' };
}

/**
 * Чи можна поставити опорний час у клітинці: рейс має час і тут зупиняється, це не його перша зупинка
 * (там опора — відправлення) і в рейсу немає «Прибуття» (опори й прибуття не разом).
 */
export function canSetTimepoint(
  trip: Pick<TransportTripDto, 'arrivalTime'>,
  timing: TripTiming | null | undefined,
  stopId: string
): boolean {
  if (!timing || trip.arrivalTime) return false;
  return timing.stops.findIndex((s) => s.stopId === stopId) > 0;
}
