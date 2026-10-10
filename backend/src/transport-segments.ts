/**
 * OSRM-перерахунок тривалостей перегонів (TransportSegment) для міського транспорту.
 * Використовується CLI і POST /admin/transport/recalculate-segments.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import {
  loadTransportDataset,
  type TransportRouteStopInput,
} from './local-transport';

export const VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '8', '9', '10', '11', '12'];
const DEFAULT_SEC = 120;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const DELAY_MS = 300;
const STOP_TIME_SEC = 12;
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600;
const CORRELATION_SPEED_KMH = 24;
/** Коли OSRM не відповів: довжина дорогою ≈ пряма × цей коефіцієнт */
const ROAD_FACTOR = 1.3;
/** Найкоротший час між сусідніми справжніми зупинками (с) */
const MIN_SPAN_SEC = 30;

export type RecalculateSegmentsOptions = {
  /** Один маршрут; якщо не задано — усі verified, що є в БД */
  routeId?: string | null;
};

export type RecalculateSegmentsResult = {
  routes: string[];
  segmentsWritten: number;
  segmentsKept: number;
  osrmRequested: number;
  osrmFailed: number;
  corrections: string[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function orderedStopIds(routeStops: TransportRouteStopInput[], direction: 'there' | 'back'): string[] {
  const key = direction === 'there' ? 'orderThere' : 'orderBack';
  return routeStops
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1))
    .map((s) => s.stopId);
}

function segmentTimeSecFromDistanceM(distanceM: number, withStopPause: boolean): number {
  const speedKmh = distanceM >= SEGMENT_LONG_M ? SPEED_KMH_FAST : SPEED_KMH_URBAN;
  const driveSec = (distanceM / 1000 / speedKmh) * 3600;
  const stopSec = withStopPause ? STOP_TIME_SEC : 0;
  return Math.round(stopSec + driveSec);
}

function straightLineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Час перегонів одного напрямку (с) за їхньою довжиною дорогою (м).
 * Технічні точки (mapOnly) лише малюють лінію, тож пауза на зупинці, швидкість і мінімум MIN_SPAN_SEC
 * рахуються на відрізок між сусідніми справжніми зупинками, а його час ділиться між перегонами за довжиною
 * (накопичене округлення: сума перегонів = час відрізка). Без технічних точок — як раніше: кожен перегін окремо.
 * @param technical для кожної точки ланцюжка: чи технічна
 * @param distancesM довжина кожного перегону (на 1 менше за точки)
 */
export function chainSegmentSeconds(technical: boolean[], distancesM: number[]): number[] {
  const n = distancesM.length;
  const out = new Array<number>(n).fill(0);
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && technical[i]) continue; // відрізок триває через технічні точки
    const hops = distancesM.slice(start, i);
    const spanM = hops.reduce((sum, d) => sum + Math.max(0, d), 0);
    const spanSec = Math.max(MIN_SPAN_SEC, segmentTimeSecFromDistanceM(spanM, !technical[start]));
    let acc = 0;
    let prev = 0;
    hops.forEach((d, k) => {
      acc += Math.max(0, d);
      const cum = spanM > 0 ? Math.round((spanSec * acc) / spanM) : Math.round((spanSec * (k + 1)) / hops.length);
      out[start + k] = Math.max(1, cum - prev);
      prev = cum;
    });
    start = i;
  }
  return out;
}

async function fetchOsrmRoute(lon1: number, lat1: number, lon2: number, lat2: number) {
  const coords = `${lon1},${lat1};${lon2},${lat2}`;
  const url = `${OSRM_BASE}/${coords}?overview=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { distance: null as number | null };
    const data = (await res.json()) as { code?: string; routes?: Array<{ distance: number }> };
    if (data.code !== 'Ok' || !data.routes?.[0]) return { distance: null };
    return { distance: data.routes[0].distance };
  } catch {
    clearTimeout(timeout);
    return { distance: null };
  }
}

export async function recalculateSegmentDurations(
  prisma: PrismaClient,
  options: RecalculateSegmentsOptions = {}
): Promise<RecalculateSegmentsResult> {
  const dataset = await loadTransportDataset(prisma);
  if (dataset.stops.length === 0) {
    throw new Error('Transport dataset is empty');
  }

  const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
  const routeStopsByRoute = new Map<string, TransportRouteStopInput[]>();
  for (const rs of dataset.routeStops) {
    if (!routeStopsByRoute.has(rs.routeId)) routeStopsByRoute.set(rs.routeId, []);
    routeStopsByRoute.get(rs.routeId)!.push(rs);
  }

  const routesInDb = dataset.routes.map((r) => r.id);
  const routeFilter = options.routeId?.trim() || null;
  let routesToProcess: string[];
  if (routeFilter) {
    if (!routesInDb.includes(routeFilter)) {
      throw new Error(`Маршрут ${routeFilter} відсутній у БД. Є: ${routesInDb.join(', ')}`);
    }
    routesToProcess = [routeFilter];
  } else {
    routesToProcess = VERIFIED_ROUTE_IDS.filter((id) => routesInDb.includes(id));
  }

  if (routesToProcess.length === 0) {
    throw new Error(`Немає маршрутів для обробки. Перевірені: ${VERIFIED_ROUTE_IDS.join(', ')}`);
  }

  const newSegments = new Map<string, number>();
  const corrections: string[] = [];
  let osrmRequested = 0;
  let osrmFailed = 0;

  for (const routeId of routesToProcess) {
    const routeStops = routeStopsByRoute.get(routeId) || [];
    const technicalIds = new Set(routeStops.filter((s) => s.mapOnly === true).map((s) => s.stopId));
    for (const dir of ['there', 'back'] as const) {
      const ids = orderedStopIds(routeStops, dir);
      if (ids.length < 2) continue;
      const distances: number[] = [];
      const fromOsrm: boolean[] = [];
      for (let i = 0; i < ids.length - 1; i++) {
        const ca = stopById.get(ids[i]);
        const cb = stopById.get(ids[i + 1]);
        let distM: number | null = null;
        if (ca && cb) {
          osrmRequested++;
          const res = await fetchOsrmRoute(ca.lng, ca.lat, cb.lng, cb.lat);
          await sleep(DELAY_MS);
          if (res.distance != null && res.distance > 0) distM = res.distance;
          else osrmFailed++;
        }
        fromOsrm.push(distM != null);
        distances.push(distM ?? (ca && cb ? straightLineM(ca, cb) * ROAD_FACTOR : 0));
      }
      let seconds = chainSegmentSeconds(
        ids.map((id) => technicalIds.has(id)),
        distances
      );
      // Поправка: не швидше за CORRELATION_SPEED_KMH у середньому (за довжиною, відомою з OSRM)
      const knownM = distances.reduce((sum, d, i) => sum + (fromOsrm[i] ? d : 0), 0);
      const totalSec = seconds.reduce((sum, v) => sum + v, 0);
      const timeAt24Sec = (knownM / 1000 / CORRELATION_SPEED_KMH) * 3600;
      if (knownM > 0 && totalSec > 0 && timeAt24Sec > totalSec) {
        const factor = timeAt24Sec / totalSec;
        seconds = seconds.map((v) => Math.max(1, Math.round(v * factor)));
        corrections.push(
          `${routeId} ${dir}: ${CORRELATION_SPEED_KMH} км/год ${Math.round(timeAt24Sec)} с > ${totalSec} с → ×${factor.toFixed(3)}`
        );
      }
      for (let i = 0; i < ids.length - 1; i++) newSegments.set(`${routeId}|${ids[i]}|${ids[i + 1]}`, seconds[i]);
    }
  }

  const segmentsKept = dataset.segments.filter((s) => !routesToProcess.includes(s.routeId)).length;
  const created = [...newSegments.entries()].map(([key, seconds]) => {
    const [routeId, fromStopId, toStopId] = key.split('|');
    return { routeId, fromStopId, toStopId, seconds };
  });

  const defaultSec = Number(dataset.meta.defaultSec) || DEFAULT_SEC;
  const metaPayload = { ...dataset.meta, defaultSec } as Prisma.InputJsonValue;

  await prisma.$transaction([
    prisma.transportSegment.deleteMany({ where: { routeId: { in: routesToProcess } } }),
    prisma.transportSegment.createMany({ data: created }),
    prisma.transportMeta.upsert({
      where: { id: 1 },
      create: { id: 1, payload: metaPayload },
      update: { payload: metaPayload },
    }),
  ]);

  return {
    routes: routesToProcess,
    segmentsWritten: created.length,
    segmentsKept,
    osrmRequested,
    osrmFailed,
    corrections,
  };
}
