import type { PrismaClient, Prisma } from '@prisma/client';
import { parseClockMins } from './trip-timing';

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
  /** Ненадійний маршрут — приховати на сайті/SEO (default false) */
  unreliable?: boolean;
  /**
   * Номер для показу («11/1», «5А»), як route_short_name у GTFS; порожньо — id.
   * Без ключа в PUT — лишається попереднє значення (старі клієнти не стирають номер).
   */
  shortName?: string;
  /**
   * Варіанти шляху: інший ланцюжок зупинок для окремих рейсів (TransportTripInput.variantId).
   * Без ключа (або null) у PUT — лишаються попередні (fillOmittedRouteFields); [] — стерти.
   */
  variants?: TransportRouteVariantInput[] | null;
}

/** Найдовший номер маршруту для показу (символів) */
export const ROUTE_SHORT_NAME_MAX = 16;

/** Точка ланцюжка варіанта: зупинка або технічна точка лінії (mapOnly) */
export interface TransportVariantStopInput {
  stopId: string;
  mapOnly?: boolean;
}

/**
 * Варіант шляху маршруту (Docs/route-variants-2026-10.md): рейс з variantId іде цим ланцюжком замість основного
 * ланцюжка свого напрямку. Зупинка в ланцюжку — не більше одного разу (час рейсу ключується за stopId).
 */
export interface TransportRouteVariantInput {
  /** Унікальний у всьому датасеті ключ, напр. «9-v1» */
  id: string;
  /** "0" | "1" — як у рейсів */
  directionId: string;
  /** Шлях для людей, з малої літери: «через вокзал» (сайт пише «іншим шляхом: через вокзал») */
  name: string;
  stops: TransportVariantStopInput[];
}

/** Опорний час рейсу з листка: точний час на зупинці */
export interface TransportTripTimepointInput {
  stopId: string;
  /** HH:MM[:SS] */
  time: string;
}

export const VARIANT_ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;
export const VARIANT_NAME_MAX = 80;
export const VARIANT_STOPS_MAX = 400;
export const TRIP_TIMEPOINTS_MAX = 40;

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
  /** Перша обслуговувана зупинка; null — перша в напрямку */
  startStopId?: string | null;
  /** Остання обслуговувана зупинка (скорочений рейс); null — остання в напрямку */
  endStopId?: string | null;
  /** Фіксований час на останній обслуговуваній зупинці, HH:MM[:SS] */
  arrivalTime?: string | null;
  /** Варіант шляху маршруту (routes[].variants[].id); null — основний ланцюжок напрямку */
  variantId?: string | null;
  /** Опорні часи з листка; з ними arrivalTime порожній. Між опорами час ділиться за сегментами */
  timepoints?: TransportTripTimepointInput[] | null;
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
  /**
   * Лише у відповіді GET: мітка останнього запису (TransportMeta.updatedAt). Клієнт повертає її в PUT як
   * baseRevision — сервер відмовить (409), якщо датасет відтоді змінився.
   */
  revision?: string | null;
}

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Маршрут без ключа variants (або з null) отримує збережені варіанти з БД — до валідації, бо рейси такого клієнта
 * (вкладка карти, старий бандл адмінки) лишаються з variantId. Мутує data. Порожній масив — стерти варіанти.
 */
export async function fillOmittedRouteFields(prisma: PrismaClient, data: unknown): Promise<void> {
  const routes = (data as Partial<TransportDataset> | null)?.routes;
  if (!Array.isArray(routes)) return;
  const omitted = routes.filter(
    (r): r is TransportRouteInput => !!r && typeof r === 'object' && (r.variants === undefined || r.variants === null)
  );
  if (!omitted.length) return;
  const rows = await prisma.transportRoute.findMany({ select: { id: true, variants: true } });
  const previous = new Map(rows.map((r) => [r.id, r.variants]));
  for (const r of omitted) {
    const stored = previous.get(r.id);
    r.variants = Array.isArray(stored) ? (stored as unknown as TransportRouteVariantInput[]) : [];
  }
}

/** Перевірка варіантів маршруту; заповнює variantById для перевірки рейсів. */
function validateRouteVariants(
  r: TransportRouteInput,
  stopIds: Set<string>,
  variantById: Map<string, { routeId: string; variant: TransportRouteVariantInput }>,
  errors: string[]
): void {
  if (r.variants === undefined || r.variants === null) return;
  if (!Array.isArray(r.variants)) {
    errors.push(`route ${r.id}: variants must be an array`);
    return;
  }
  for (const v of r.variants) {
    if (!v || typeof v !== 'object') {
      errors.push(`route ${r.id}: variant must be an object`);
      continue;
    }
    const where = `route ${r.id} variant ${typeof v.id === 'string' ? v.id : JSON.stringify(v.id)}`;
    if (typeof v.id !== 'string' || !VARIANT_ID_RE.test(v.id)) errors.push(`${where}: bad id (A-Z a-z 0-9 _ . -, ≤40)`);
    else if (variantById.has(v.id)) errors.push(`${where}: duplicate variant id`);
    else variantById.set(v.id, { routeId: r.id, variant: v });
    if (v.directionId !== '0' && v.directionId !== '1') errors.push(`${where}: directionId must be "0" or "1"`);
    if (typeof v.name !== 'string' || !v.name.trim()) errors.push(`${where}: name required`);
    else if (/[\r\n\t]/.test(v.name)) errors.push(`${where}: name must be one line`);
    else if (v.name.trim().length > VARIANT_NAME_MAX) errors.push(`${where}: name longer than ${VARIANT_NAME_MAX} characters`);
    if (!Array.isArray(v.stops)) {
      errors.push(`${where}: stops must be an array`);
      continue;
    }
    if (v.stops.length > VARIANT_STOPS_MAX) errors.push(`${where}: more than ${VARIANT_STOPS_MAX} stops`);
    const seen = new Set<string>();
    let passengers = 0;
    v.stops.forEach((p, i) => {
      if (!p || typeof p !== 'object' || typeof p.stopId !== 'string') {
        errors.push(`${where}: stop #${i + 1} must be { stopId }`);
        return;
      }
      if (!stopIds.has(p.stopId)) errors.push(`${where}: unknown stop ${p.stopId}`);
      if (seen.has(p.stopId)) errors.push(`${where}: stop ${p.stopId} repeats (a chain visits a stop once)`);
      seen.add(p.stopId);
      if (p.mapOnly !== undefined && typeof p.mapOnly !== 'boolean') errors.push(`${where}: mapOnly must be boolean`);
      if (!p.mapOnly) passengers++;
    });
    if (passengers < 2) errors.push(`${where}: needs at least 2 passenger stops`);
    const first = v.stops[0];
    const last = v.stops[v.stops.length - 1];
    if ((first && first.mapOnly) || (last && last.mapOnly)) {
      errors.push(`${where}: first and last points must be passenger stops`);
    }
  }
}

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
  const variantById = new Map<string, { routeId: string; variant: TransportRouteVariantInput }>();
  for (const r of dataset.routes) {
    if (!r.id || typeof r.id !== 'string') errors.push(`route without id: ${JSON.stringify(r)}`);
    else if (routeIds.has(r.id)) errors.push(`duplicate route id ${r.id}`);
    else routeIds.add(r.id);
    if (r.unreliable !== undefined && r.unreliable !== null && typeof r.unreliable !== 'boolean') {
      errors.push(`route ${r.id}: unreliable must be boolean`);
    }
    if (r.shortName !== undefined && r.shortName !== null) {
      if (typeof r.shortName !== 'string') errors.push(`route ${r.id}: shortName must be a string`);
      else if (/[\r\n\t]/.test(r.shortName)) errors.push(`route ${r.id}: shortName must be one line`);
      else if (r.shortName.trim().length > ROUTE_SHORT_NAME_MAX) {
        errors.push(`route ${r.id}: shortName longer than ${ROUTE_SHORT_NAME_MAX} characters`);
      }
    }
    validateRouteVariants(r, stopIds, variantById, errors);
  }

  const rsKeys = new Set<string>();
  const routeStopByKey = new Map<string, TransportRouteStopInput>();
  for (const rs of dataset.routeStops) {
    if (!routeIds.has(rs.routeId)) errors.push(`routeStop references unknown route ${rs.routeId}`);
    if (!stopIds.has(rs.stopId)) errors.push(`routeStop references unknown stop ${rs.stopId} (route ${rs.routeId})`);
    const key = `${rs.routeId}|${rs.stopId}`;
    if (rsKeys.has(key)) errors.push(`duplicate routeStop ${key}`);
    else {
      rsKeys.add(key);
      routeStopByKey.set(key, rs);
    }
  }

  /** Ланцюжок зупинок маршруту в напрямку (з технічними точками), як на сайті/у GTFS. */
  const chainCache = new Map<string, string[]>();
  const chainFor = (routeId: string, dir: 'there' | 'back'): string[] => {
    const cacheKey = `${routeId}|${dir}`;
    const cached = chainCache.get(cacheKey);
    if (cached) return cached;
    const orderKey = dir === 'there' ? 'orderThere' : 'orderBack';
    const chain = dataset.routeStops
      .filter((rs) => rs.routeId === routeId && (rs[orderKey] ?? -1) > 0)
      .sort((a, b) => (a[orderKey] ?? -1) - (b[orderKey] ?? -1))
      .map((rs) => rs.stopId);
    chainCache.set(cacheKey, chain);
    return chain;
  };

  const tripIds = new Set<string>();
  for (const t of dataset.trips) {
    if (!t.id || typeof t.id !== 'string') errors.push(`trip without id: ${JSON.stringify(t)}`);
    else if (tripIds.has(t.id)) errors.push(`duplicate trip id ${t.id}`);
    else tripIds.add(t.id);
    if (!routeIds.has(t.routeId)) errors.push(`trip ${t.id} references unknown route ${t.routeId}`);
    if (t.departureTime && !TIME_RE.test(t.departureTime)) {
      errors.push(`trip ${t.id}: bad departureTime "${t.departureTime}"`);
    }

    const dir: 'there' | 'back' = t.directionId === '0' ? 'back' : 'there';
    const orderKey = dir === 'there' ? 'orderThere' : 'orderBack';

    // Ланцюжок рейсу: варіант шляху або основний ланцюжок напрямку
    let variant: TransportRouteVariantInput | null = null;
    if (t.variantId != null && t.variantId !== '') {
      const ref = typeof t.variantId === 'string' ? variantById.get(t.variantId) : undefined;
      if (typeof t.variantId !== 'string') errors.push(`trip ${t.id}: variantId must be a string`);
      else if (!ref) errors.push(`trip ${t.id}: unknown variant ${t.variantId}`);
      else if (ref.routeId !== t.routeId) errors.push(`trip ${t.id}: variant ${t.variantId} belongs to route ${ref.routeId}`);
      else if (ref.variant.directionId !== (dir === 'back' ? '0' : '1')) {
        errors.push(`trip ${t.id}: variant ${t.variantId} is for the other direction`);
      } else variant = ref.variant;
    }
    const chain = variant ? variant.stops.map((p) => p.stopId) : chainFor(t.routeId, dir);
    const isPassenger = (stopId: string): boolean => {
      if (variant) return variant.stops.some((p) => p.stopId === stopId && !p.mapOnly);
      const rs = routeStopByKey.get(`${t.routeId}|${stopId}`);
      return !!rs && (rs[orderKey] ?? -1) > 0 && !rs.mapOnly;
    };
    const chainName = variant ? `variant ${variant.id}` : `route ${t.routeId} (${dir})`;

    for (const field of ['startStopId', 'endStopId'] as const) {
      const stopId = t[field];
      if (stopId == null || stopId === '') continue;
      if (typeof stopId !== 'string') {
        errors.push(`trip ${t.id}: ${field} must be a string`);
        continue;
      }
      if (!isPassenger(stopId)) errors.push(`trip ${t.id}: ${field} ${stopId} is not a passenger stop of ${chainName}`);
    }
    const startIdx = typeof t.startStopId === 'string' && t.startStopId ? chain.indexOf(t.startStopId) : 0;
    const endIdx = typeof t.endStopId === 'string' && t.endStopId ? chain.indexOf(t.endStopId) : chain.length - 1;
    if (chain.length >= 2 && startIdx >= 0 && endIdx >= 0 && startIdx >= endIdx) {
      errors.push(`trip ${t.id}: startStopId must precede endStopId`);
    }

    const hasTimepoints = Array.isArray(t.timepoints) && t.timepoints.length > 0;
    if (t.timepoints != null && !Array.isArray(t.timepoints)) errors.push(`trip ${t.id}: timepoints must be an array`);
    else if (hasTimepoints) {
      const tps = t.timepoints as TransportTripTimepointInput[];
      const dep = typeof t.departureTime === 'string' ? parseClockMins(t.departureTime) : null;
      if (tps.length > TRIP_TIMEPOINTS_MAX) errors.push(`trip ${t.id}: more than ${TRIP_TIMEPOINTS_MAX} timepoints`);
      if (dep == null) errors.push(`trip ${t.id}: timepoints require departureTime`);
      if (t.arrivalTime != null && t.arrivalTime !== '') errors.push(`trip ${t.id}: use timepoints or arrivalTime, not both`);
      let prevIdx = startIdx;
      let prevMins = dep;
      for (const tp of tps) {
        if (!tp || typeof tp !== 'object' || typeof tp.stopId !== 'string' || typeof tp.time !== 'string') {
          errors.push(`trip ${t.id}: timepoint must be { stopId, time }`);
          continue;
        }
        const mins = TIME_RE.test(tp.time) ? parseClockMins(tp.time) : null;
        const idx = chain.indexOf(tp.stopId);
        if (mins == null) errors.push(`trip ${t.id}: timepoint ${tp.stopId} bad time "${tp.time}"`);
        if (!isPassenger(tp.stopId)) errors.push(`trip ${t.id}: timepoint ${tp.stopId} is not a passenger stop of ${chainName}`);
        else if (idx <= prevIdx || idx > endIdx) {
          errors.push(`trip ${t.id}: timepoint ${tp.stopId} must follow the previous one within the served stops`);
        }
        if (mins != null && prevMins != null && mins <= prevMins) {
          errors.push(`trip ${t.id}: timepoint ${tp.stopId} must be later than the previous time`);
        }
        if (idx > prevIdx) prevIdx = idx;
        if (mins != null) prevMins = mins;
      }
    }

    if (t.arrivalTime != null && t.arrivalTime !== '') {
      if (typeof t.arrivalTime !== 'string' || !TIME_RE.test(t.arrivalTime)) {
        errors.push(`trip ${t.id}: bad arrivalTime "${t.arrivalTime}"`);
      } else if (!t.departureTime) {
        errors.push(`trip ${t.id}: arrivalTime requires departureTime`);
      } else if (TIME_RE.test(t.departureTime)) {
        const dep = parseClockMins(t.departureTime);
        const arr = parseClockMins(t.arrivalTime);
        if (dep != null && arr != null && arr <= dep) {
          errors.push(`trip ${t.id}: arrivalTime must be after departureTime`);
        }
      }
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

/** Номер для показу: з датасету (обрізаний), а коли ключа немає — попередній з БД. */
function shortNameFor(r: TransportRouteInput, previous: Map<string, string>): string {
  return typeof r.shortName === 'string' ? r.shortName.trim() : previous.get(r.id) ?? '';
}

/** Варіанти маршруту у формі для БД: лише відомі поля; порожньо — NULL. */
function storedVariants(variants: TransportRouteVariantInput[] | null | undefined): Prisma.InputJsonValue | undefined {
  if (!Array.isArray(variants) || !variants.length) return undefined;
  return variants.map((v) => ({
    id: v.id,
    directionId: v.directionId,
    name: v.name.trim(),
    stops: v.stops.map((p) => (p.mapOnly ? { stopId: p.stopId, mapOnly: true } : { stopId: p.stopId })),
  }));
}

/** Опорні часи рейсу у формі для БД; порожньо — NULL. */
function storedTimepoints(tps: TransportTripTimepointInput[] | null | undefined): Prisma.InputJsonValue | undefined {
  if (!Array.isArray(tps) || !tps.length) return undefined;
  return tps.map((tp) => ({ stopId: tp.stopId, time: tp.time }));
}

/** Транзакційна заміна всього датасету. */
export async function replaceTransportDataset(prisma: PrismaClient, dataset: TransportDataset): Promise<void> {
  const previousShortNames = dataset.routes.some((r) => typeof r.shortName !== 'string')
    ? new Map(
        (await prisma.transportRoute.findMany({ select: { id: true, shortName: true } })).map((r) => [r.id, r.shortName ?? ''])
      )
    : new Map<string, string>();
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
        unreliable: r.unreliable ?? false,
        shortName: shortNameFor(r, previousShortNames),
        variants: storedVariants(r.variants),
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
        startStopId: t.startStopId || null,
        endStopId: t.endStopId || null,
        arrivalTime: t.arrivalTime || null,
        variantId: t.variantId || null,
        timepoints: storedTimepoints(t.timepoints),
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
      unreliable: r.unreliable,
      shortName: r.shortName ?? '',
      variants: Array.isArray(r.variants) ? (r.variants as unknown as TransportRouteVariantInput[]) : [],
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
      startStopId: t.startStopId,
      endStopId: t.endStopId,
      arrivalTime: t.arrivalTime,
      variantId: t.variantId ?? null,
      timepoints: Array.isArray(t.timepoints) ? (t.timepoints as unknown as TransportTripTimepointInput[]) : null,
    })),
    segments: segments.map((seg) => ({
      routeId: seg.routeId,
      fromStopId: seg.fromStopId,
      toStopId: seg.toStopId,
      seconds: seg.seconds,
    })),
    meta: (meta?.payload as Record<string, unknown>) ?? {},
    revision: meta?.updatedAt ? new Date(meta.updatedAt).toISOString() : null,
  };
}

/** Мітка останнього запису датасету (див. TransportDataset.revision); null — датасету ще немає. */
export async function currentTransportRevision(prisma: PrismaClient): Promise<string | null> {
  const meta = await prisma.transportMeta.findUnique({ where: { id: 1 } });
  return meta?.updatedAt ? new Date(meta.updatedAt).toISOString() : null;
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
        unreliable: m.unreliable === true,
        ...(typeof m.short_name === 'string' ? { shortName: m.short_name } : {}),
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
    startStopId: rec.start_stop_id || null,
    endStopId: rec.end_stop_id || null,
    arrivalTime: rec.arrival_time || null,
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
