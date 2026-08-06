import type {
  TransportDataset,
  TransportRouteStopDto,
  TransportTripDto,
} from '@/api/transportDataset';

export const FALLBACK_MINS = 2;

export function parseClockToMinutes(s: string | null | undefined): number {
  if (!s) return 0;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatMins(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function tripDepartureMinutes(trip: Pick<TransportTripDto, 'departureTime' | 'blockId'>): number {
  const fromDep = parseClockToMinutes(trip.departureTime);
  if (fromDep > 0) return fromDep;
  return parseClockToMinutes(trip.blockId);
}

export function sortTripsByDeparture(a: TransportTripDto, b: TransportTripDto): number {
  return tripDepartureMinutes(a) - tripDepartureMinutes(b);
}

export function orderedPassengerStops(
  routeStops: TransportRouteStopDto[],
  direction: 'there' | 'back'
): TransportRouteStopDto[] {
  const key = direction === 'there' ? 'orderThere' : 'orderBack';
  return routeStops
    .filter((s) => !s.mapOnly && (s[key] ?? -1) > 0)
    .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}

export function orderedAllStops(
  routeStops: TransportRouteStopDto[],
  direction: 'there' | 'back'
): TransportRouteStopDto[] {
  const key = direction === 'there' ? 'orderThere' : 'orderBack';
  return routeStops
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}

function segmentMap(dataset: TransportDataset): Record<string, number> {
  const m: Record<string, number> = {};
  for (const s of dataset.segments) {
    m[`${s.routeId}|${s.fromStopId}|${s.toStopId}`] = s.seconds;
  }
  return m;
}

export function getSegmentSec(
  dataset: TransportDataset,
  routeId: string,
  fromId: string,
  toId: string
): number {
  const segs = segmentMap(dataset);
  const defaultSec = Number(dataset.meta.defaultSec) || 120;
  return segs[`${routeId}|${fromId}|${toId}`] ?? segs[`${routeId}|${toId}|${fromId}`] ?? defaultSec;
}

export function durationFromStartMins(
  dataset: TransportDataset,
  routeId: string,
  chainStopIds: string[],
  toIndex: number
): number {
  let sec = 0;
  for (let i = 0; i < toIndex && i < chainStopIds.length - 1; i++) {
    sec += getSegmentSec(dataset, routeId, chainStopIds[i], chainStopIds[i + 1]);
  }
  if (sec === 0 && toIndex > 0) {
    const hasRouteSeg = dataset.segments.some((s) => s.routeId === routeId);
    if (!hasRouteSeg) return toIndex * FALLBACK_MINS;
  }
  return sec / 60;
}

export function routeStopsFor(dataset: TransportDataset, routeId: string): TransportRouteStopDto[] {
  return dataset.routeStops.filter((rs) => rs.routeId === routeId);
}

export function tripsForRoute(dataset: TransportDataset, routeId: string): TransportTripDto[] {
  return dataset.trips.filter((t) => t.routeId === routeId).sort(sortTripsByDeparture);
}

export function stopName(dataset: TransportDataset, stopId: string): string {
  return dataset.stops.find((s) => s.id === stopId)?.name || stopId;
}

export function coordsMap(dataset: TransportDataset): Record<string, [number, number]> {
  const m: Record<string, [number, number]> = {};
  for (const s of dataset.stops) m[s.id] = [s.lat, s.lng];
  return m;
}

export function mapCenter(dataset: TransportDataset): [number, number] {
  const c = dataset.meta.center as [number, number] | null | undefined;
  return c ?? [50.768, 29.242];
}

/** Чи маршрут з’єднує from→to у заданому напрямку (пасажирські зупинки). */
export function routeConnects(
  dataset: TransportDataset,
  routeId: string,
  fromId: string,
  toId: string,
  direction: 'there' | 'back'
): boolean {
  const passenger = orderedPassengerStops(routeStopsFor(dataset, routeId), direction);
  const fromIdx = passenger.findIndex((s) => s.stopId === fromId);
  const toIdx = passenger.findIndex((s) => s.stopId === toId);
  return fromIdx >= 0 && toIdx > fromIdx;
}

export function findConnectingRoutes(
  dataset: TransportDataset,
  fromId: string,
  toId: string
): Array<{ routeId: string; direction: 'there' | 'back' }> {
  const out: Array<{ routeId: string; direction: 'there' | 'back' }> = [];
  for (const r of dataset.routes) {
    if (routeConnects(dataset, r.id, fromId, toId, 'there')) out.push({ routeId: r.id, direction: 'there' });
    if (routeConnects(dataset, r.id, fromId, toId, 'back')) out.push({ routeId: r.id, direction: 'back' });
  }
  return out.sort((a, b) => Number(a.routeId) - Number(b.routeId));
}

export type StopDeparture = {
  routeId: string;
  tripId: string;
  departureMins: number;
  direction: 'there' | 'back';
  destination: string;
};

export function departuresAtStop(
  dataset: TransportDataset,
  stopId: string,
  afterMins = 0
): StopDeparture[] {
  const rows: StopDeparture[] = [];
  for (const route of dataset.routes) {
    for (const direction of ['there', 'back'] as const) {
      const chain = orderedAllStops(routeStopsFor(dataset, route.id), direction);
      const passenger = orderedPassengerStops(routeStopsFor(dataset, route.id), direction);
      const pIdx = passenger.findIndex((s) => s.stopId === stopId);
      if (pIdx < 0) continue;
      const chainIdx = chain.findIndex((s) => s.stopId === stopId);
      const chainKeys = chain.map((s) => s.stopId);
      const offset = chainIdx >= 0 ? durationFromStartMins(dataset, route.id, chainKeys, chainIdx) : pIdx * FALLBACK_MINS;
      const dirId = direction === 'there' ? '1' : '0';
      const trips = tripsForRoute(dataset, route.id).filter((t) => String(t.directionId) === dirId);
      const destination =
        direction === 'there' ? route.toName || route.fromName || '' : route.fromName || route.toName || '';
      for (const trip of trips) {
        const base = tripDepartureMinutes(trip);
        if (base <= 0) continue;
        const dep = Math.round(base + offset);
        if (dep < afterMins) continue;
        rows.push({
          routeId: route.id,
          tripId: trip.id,
          departureMins: dep,
          direction,
          destination: trip.headsign || destination,
        });
      }
    }
  }
  return rows.sort((a, b) => a.departureMins - b.departureMins);
}

export function formatDateUrl(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export function nowKyivMinutes(): number {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}
