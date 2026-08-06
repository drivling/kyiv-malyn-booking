import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Міський транспорт Малина: спільний контракт датасету для API та seed.
 * Датасет редагується в адмінці цілком і зберігається транзакційною заміною.
 */

export interface TransportStopInput {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface TransportRouteInput {
  id: string;
  fromName?: string;
  toName?: string;
  scheme?: string;
  note?: string;
  sourceUrl?: string;
  schedule?: unknown;
}

export interface TransportRouteStopInput {
  routeId: string;
  stopId: string;
  orderThere?: number;
  orderBack?: number;
  mapOnly?: boolean;
}

export interface TransportTripInput {
  id: string;
  routeId: string;
  serviceId?: string;
  headsign?: string;
  directionId?: string;
  departureTime?: string | null;
  blockId?: string | null;
  wheelchairAccessible?: string;
  bikesAllowed?: string;
}

export interface TransportSegmentInput {
  routeId: string;
  fromStopId: string;
  toStopId: string;
  seconds: number;
}

export interface TransportDataset {
  stops: TransportStopInput[];
  routes: TransportRouteInput[];
  routeStops: TransportRouteStopInput[];
  trips: TransportTripInput[];
  segments: TransportSegmentInput[];
  /** center карти, defaultSec, fare, contacts, news, sources, agency, description */
  meta: Record<string, unknown>;
}

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Перевірка цілісності перед записом у БД. Повертає список помилок (порожній — ок). */
export function validateTransportDataset(data: unknown): { errors: string[]; dataset?: TransportDataset } {
  const errors: string[] = [];
  const d = data as Partial<TransportDataset> | null;
  if (!d || typeof d !== 'object') return { errors: ['dataset must be an object'] };

  for (const key of ['stops', 'routes', 'routeStops', 'trips', 'segments'] as const) {
    if (!Array.isArray(d[key])) errors.push(`${key} must be an array`);
  }
  if (!d.meta || typeof d.meta !== 'object') errors.push('meta must be an object');
  if (errors.length) return { errors };

  const dataset = d as TransportDataset;
  const stopIds = new Set<string>();
  for (const s of dataset.stops) {
    if (!s.id || typeof s.id !== 'string') errors.push(`stop without id: ${JSON.stringify(s)}`);
    else if (stopIds.has(s.id)) errors.push(`duplicate stop id ${s.id}`);
    else stopIds.add(s.id);
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') errors.push(`stop ${s.id}: lat/lng must be numbers`);
    if (!s.name || typeof s.name !== 'string') errors.push(`stop ${s.id}: name required`);
  }

  const routeIds = new Set<string>();
  for (const r of dataset.routes) {
    if (!r.id || typeof r.id !== 'string') errors.push(`route without id: ${JSON.stringify(r)}`);
    else if (routeIds.has(r.id)) errors.push(`duplicate route id ${r.id}`);
    else routeIds.add(r.id);
  }

  const rsKeys = new Set<string>();
  for (const rs of dataset.routeStops) {
    if (!routeIds.has(rs.routeId)) errors.push(`routeStop references unknown route ${rs.routeId}`);
    if (!stopIds.has(rs.stopId)) errors.push(`routeStop references unknown stop ${rs.stopId} (route ${rs.routeId})`);
    const key = `${rs.routeId}|${rs.stopId}`;
    if (rsKeys.has(key)) errors.push(`duplicate routeStop ${key}`);
    else rsKeys.add(key);
  }

  const tripIds = new Set<string>();
  for (const t of dataset.trips) {
    if (!t.id || typeof t.id !== 'string') errors.push(`trip without id: ${JSON.stringify(t)}`);
    else if (tripIds.has(t.id)) errors.push(`duplicate trip id ${t.id}`);
    else tripIds.add(t.id);
    if (!routeIds.has(t.routeId)) errors.push(`trip ${t.id} references unknown route ${t.routeId}`);
    if (t.departureTime && !TIME_RE.test(t.departureTime)) {
      errors.push(`trip ${t.id}: bad departureTime "${t.departureTime}"`);
    }
  }

  const segKeys = new Set<string>();
  for (const seg of dataset.segments) {
    if (!routeIds.has(seg.routeId)) errors.push(`segment references unknown route ${seg.routeId}`);
    if (!Number.isFinite(seg.seconds) || seg.seconds < 0) {
      errors.push(`segment ${seg.routeId}|${seg.fromStopId}|${seg.toStopId}: bad seconds`);
    }
    const key = `${seg.routeId}|${seg.fromStopId}|${seg.toStopId}`;
    if (segKeys.has(key)) errors.push(`duplicate segment ${key}`);
    else segKeys.add(key);
  }

  return errors.length ? { errors } : { errors: [], dataset };
}

/** Транзакційна заміна всього датасету. */
export async function replaceTransportDataset(prisma: PrismaClient, dataset: TransportDataset): Promise<void> {
  await prisma.$transaction([
    prisma.transportSegment.deleteMany(),
    prisma.transportTrip.deleteMany(),
    prisma.transportRouteStop.deleteMany(),
    prisma.transportRoute.deleteMany(),
    prisma.transportStop.deleteMany(),
    prisma.transportStop.createMany({
      data: dataset.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    }),
    prisma.transportRoute.createMany({
      data: dataset.routes.map((r) => ({
        id: r.id,
        fromName: r.fromName ?? '',
        toName: r.toName ?? '',
        scheme: r.scheme ?? '',
        note: r.note ?? '',
        sourceUrl: r.sourceUrl ?? '',
        schedule: (r.schedule ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    }),
    prisma.transportRouteStop.createMany({
      data: dataset.routeStops.map((rs) => ({
        routeId: rs.routeId,
        stopId: rs.stopId,
        orderThere: rs.orderThere ?? -1,
        orderBack: rs.orderBack ?? -1,
        mapOnly: rs.mapOnly ?? false,
      })),
    }),
    prisma.transportTrip.createMany({
      data: dataset.trips.map((t) => ({
        id: t.id,
        routeId: t.routeId,
        serviceId: t.serviceId ?? 'everyday',
        headsign: t.headsign ?? '',
        directionId: t.directionId === '0' ? '0' : '1',
        departureTime: t.departureTime ?? null,
        blockId: t.blockId ?? null,
        wheelchairAccessible: t.wheelchairAccessible ?? '',
        bikesAllowed: t.bikesAllowed ?? '',
      })),
    }),
    prisma.transportSegment.createMany({
      data: dataset.segments.map((seg) => ({
        routeId: seg.routeId,
        fromStopId: seg.fromStopId,
        toStopId: seg.toStopId,
        seconds: Math.round(seg.seconds),
      })),
    }),
    prisma.transportMeta.upsert({
      where: { id: 1 },
      create: { id: 1, payload: dataset.meta as Prisma.InputJsonValue },
      update: { payload: dataset.meta as Prisma.InputJsonValue },
    }),
  ]);
}

/** Повний датасет із БД у контрактній формі. */
export async function loadTransportDataset(prisma: PrismaClient): Promise<TransportDataset> {
  const [stops, routes, routeStops, trips, segments, meta] = await Promise.all([
    prisma.transportStop.findMany({ orderBy: { id: 'asc' } }),
    prisma.transportRoute.findMany({ orderBy: { id: 'asc' } }),
    prisma.transportRouteStop.findMany({ orderBy: [{ routeId: 'asc' }, { orderThere: 'asc' }] }),
    prisma.transportTrip.findMany({ orderBy: { id: 'asc' } }),
    prisma.transportSegment.findMany({ orderBy: { id: 'asc' } }),
    prisma.transportMeta.findUnique({ where: { id: 1 } }),
  ]);
  return {
    stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    routes: routes.map((r) => ({
      id: r.id,
      fromName: r.fromName,
      toName: r.toName,
      scheme: r.scheme,
      note: r.note,
      sourceUrl: r.sourceUrl,
      schedule: r.schedule ?? null,
    })),
    routeStops: routeStops.map((rs) => ({
      routeId: rs.routeId,
      stopId: rs.stopId,
      orderThere: rs.orderThere,
      orderBack: rs.orderBack,
      mapOnly: rs.mapOnly,
    })),
    trips: trips.map((t) => ({
      id: t.id,
      routeId: t.routeId,
      serviceId: t.serviceId,
      headsign: t.headsign,
      directionId: t.directionId,
      departureTime: t.departureTime,
      blockId: t.blockId,
      wheelchairAccessible: t.wheelchairAccessible,
      bikesAllowed: t.bikesAllowed,
    })),
    segments: segments.map((seg) => ({
      routeId: seg.routeId,
      fromStopId: seg.fromStopId,
      toStopId: seg.toStopId,
      seconds: seg.seconds,
    })),
    meta: (meta?.payload as Record<string, unknown>) ?? {},
  };
}

const LEGACY_SERVICE_MAP: Record<string, string> = {
  'пн-вт-ср-чт-пт-сб-нд': 'everyday',
  everyday: 'everyday',
  weekdays: 'weekdays',
};

/**
 * Конвертація легасі runtime JSON (malyn_transport / stops_coords / segmentDurations / agency)
 * у нормалізований датасет. Використовується одноразовим seed.
 */
export function convertLegacyRuntime(input: {
  transport: any;
  coords: any;
  segments: any;
  agency?: any;
}): { dataset: TransportDataset; warnings: string[] } {
  const warnings: string[] = [];
  const { transport, coords, segments, agency } = input;

  const coordsMap: Record<string, [number, number]> = coords?.stops || {};
  const catalog: Record<string, { name?: string }> = transport?.supplement?.stops?.stops_catalog || {};
  const stopsByRoute: Record<string, any[]> = transport?.supplement?.stops?.stops_by_route || {};
  const routesMeta: Record<string, any> = transport?.supplement?.routes || {};

  const stops: TransportStopInput[] = [];
  const stopIds = new Set<string>();
  for (const [stopId, meta] of Object.entries(catalog)) {
    const c = coordsMap[stopId];
    if (!c || c.length < 2) {
      warnings.push(`stop ${stopId} (${meta.name}) has no coords — skipped`);
      continue;
    }
    stops.push({ id: stopId, name: meta.name || stopId, lat: Number(c[0]), lng: Number(c[1]) });
    stopIds.add(stopId);
  }

  const routeIds = new Set<string>([...Object.keys(routesMeta), ...Object.keys(stopsByRoute)]);
  for (const rec of transport?.records || []) {
    if (rec.route_id != null) routeIds.add(String(rec.route_id));
  }
  const routes: TransportRouteInput[] = [...routeIds]
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => {
      const m = routesMeta[id] || {};
      return {
        id,
        fromName: m.from || '',
        toName: m.to || '',
        scheme: m.scheme || '',
        note: m.note || '',
        sourceUrl: m.source_url || '',
        schedule: m.schedule ?? null,
      };
    });

  const routeStops: TransportRouteStopInput[] = [];
  for (const [routeId, entries] of Object.entries(stopsByRoute)) {
    for (const e of entries || []) {
      const stopId = e.id && String(e.id).trim();
      if (!stopId || !stopIds.has(stopId)) {
        warnings.push(`route ${routeId}: stop entry ${JSON.stringify(e.name)} without known id — skipped`);
        continue;
      }
      routeStops.push({
        routeId,
        stopId,
        orderThere: e.order_there ?? -1,
        orderBack: e.order_back ?? -1,
        mapOnly: e.map_only === true,
      });
    }
  }

  const trips: TransportTripInput[] = (transport?.records || []).map((rec: any) => ({
    id: String(rec.trip_id),
    routeId: String(rec.route_id),
    serviceId: LEGACY_SERVICE_MAP[rec.service_id] || 'everyday',
    headsign: rec.trip_headsign || '',
    directionId: String(rec.direction_id) === '0' ? '0' : '1',
    departureTime: rec.departure_time || null,
    blockId: rec.block_id || null,
    wheelchairAccessible: rec.wheelchair_accessible || '',
    bikesAllowed: rec.bikes_allowed || '',
  }));

  const segmentRows: TransportSegmentInput[] = [];
  for (const [key, seconds] of Object.entries(segments?.segments || {})) {
    const [routeId, fromStopId, toStopId] = key.split('|');
    if (!routeId || !fromStopId || !toStopId) {
      warnings.push(`bad segment key ${key} — skipped`);
      continue;
    }
    if (!stopIds.has(fromStopId) || !stopIds.has(toStopId)) {
      warnings.push(`segment ${key} references unknown stop — skipped`);
      continue;
    }
    if (!routeIds.has(routeId)) {
      warnings.push(`segment ${key} references unknown route — skipped`);
      continue;
    }
    segmentRows.push({ routeId, fromStopId, toStopId, seconds: Number(seconds) });
  }

  const meta: Record<string, unknown> = {
    center: coords?.center ?? null,
    defaultSec: segments?.defaultSec ?? 120,
    fare: transport?.supplement?.fare ?? null,
    contacts: transport?.supplement?.contacts ?? null,
    news: transport?.supplement?.news ?? null,
    sources: transport?.supplement?.sources ?? null,
    description: transport?.supplement?.description ?? null,
    agency: agency ?? null,
  };

  return { dataset: { stops, routes, routeStops, trips, segments: segmentRows, meta }, warnings };
}
