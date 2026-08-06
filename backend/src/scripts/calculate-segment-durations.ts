/**
 * Розрахунок часу між зупинками (секунди) через OSRM → PostgreSQL.
 *
 * Після правок у адмінці (технічні точки, порядок, координати) збережіть
 * датасет у базу, потім перерахуйте сегменти:
 *
 *   cd backend && npm run calculate:segments
 *   cd backend && npm run calculate:segments -- --route=11
 *
 * Або з кореня репо (обгортка):
 *   node scripts/calculate_segment_durations.js
 *   node scripts/calculate_segment_durations.js --route=11
 *
 * Логіка як раніше: OSRM-відстань по дорозі, 35/45 км/год, пауза 12 с на
 * пасажирській зупинці, корекція «24 км/год» по всьому напрямку.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { loadTransportDataset, type TransportRouteStopInput } from '../local-transport';

const VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '8', '9', '11', '12'];
const DEFAULT_SEC = 120;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const DELAY_MS = 300;
const STOP_TIME_SEC = 12;
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600;
const CORRELATION_SPEED_KMH = 24;

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

async function main() {
  const args = process.argv.slice(2);
  let routeFilter: string | null = null;
  for (const a of args) {
    if (a.startsWith('--route=')) routeFilter = a.slice(8).trim();
  }

  const prisma = new PrismaClient();
  try {
    const dataset = await loadTransportDataset(prisma);
    if (dataset.stops.length === 0) {
      console.error('Transport dataset is empty. Run: npm run seed:transport');
      process.exit(1);
    }

    const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
    const routeStopsByRoute = new Map<string, TransportRouteStopInput[]>();
    for (const rs of dataset.routeStops) {
      if (!routeStopsByRoute.has(rs.routeId)) routeStopsByRoute.set(rs.routeId, []);
      routeStopsByRoute.get(rs.routeId)!.push(rs);
    }

    const routesInDb = dataset.routes.map((r) => r.id);
    let routesToProcess: string[];
    if (routeFilter) {
      if (!routesInDb.includes(routeFilter)) {
        console.error(`Маршрут ${routeFilter} відсутній у БД. Є: ${routesInDb.join(', ')}`);
        process.exit(1);
      }
      routesToProcess = [routeFilter];
    } else {
      routesToProcess = VERIFIED_ROUTE_IDS.filter((id) => routesInDb.includes(id));
    }

    if (routesToProcess.length === 0) {
      console.error('Немає маршрутів для обробки. Перевірені за замовчуванням:', VERIFIED_ROUTE_IDS.join(', '));
      process.exit(1);
    }

    const newSegments = new Map<string, number>(); // key route|from|to
    const segmentDistancesM: Record<string, number> = {};
    let requested = 0;
    let failed = 0;

    for (const routeId of routesToProcess) {
      const routeStops = routeStopsByRoute.get(routeId) || [];
      for (const dir of ['there', 'back'] as const) {
        const ids = orderedStopIds(routeStops, dir);
        for (let i = 0; i < ids.length - 1; i++) {
          const a = ids[i];
          const b = ids[i + 1];
          const key = `${routeId}|${a}|${b}`;
          const ca = stopById.get(a);
          const cb = stopById.get(b);
          const fromStop = routeStops.find((s) => s.stopId === a);
          const isTechnicalStop = fromStop?.mapOnly === true;

          if (!ca || !cb) {
            newSegments.set(
              key,
              isTechnicalStop ? Math.max(30, DEFAULT_SEC - STOP_TIME_SEC) : DEFAULT_SEC
            );
            continue;
          }

          requested++;
          const { distance: distM } = await fetchOsrmRoute(ca.lng, ca.lat, cb.lng, cb.lat);
          await sleep(DELAY_MS);

          if (distM != null && distM > 0) {
            segmentDistancesM[key] = distM;
            newSegments.set(key, Math.max(30, segmentTimeSecFromDistanceM(distM, !isTechnicalStop)));
          } else {
            newSegments.set(
              key,
              isTechnicalStop ? Math.max(30, DEFAULT_SEC - STOP_TIME_SEC) : DEFAULT_SEC
            );
            failed++;
          }
        }
      }
    }

    for (const routeId of routesToProcess) {
      const routeStops = routeStopsByRoute.get(routeId) || [];
      for (const dir of ['there', 'back'] as const) {
        const ids = orderedStopIds(routeStops, dir);
        const keys: string[] = [];
        for (let i = 0; i < ids.length - 1; i++) keys.push(`${routeId}|${ids[i]}|${ids[i + 1]}`);
        let totalDistM = 0;
        let totalTimeSec = 0;
        for (const k of keys) {
          if (segmentDistancesM[k] != null) totalDistM += segmentDistancesM[k];
          totalTimeSec += newSegments.get(k) || 0;
        }
        if (totalDistM <= 0 || totalTimeSec <= 0) continue;
        const timeAt24Sec = (totalDistM / 1000 / CORRELATION_SPEED_KMH) * 3600;
        if (timeAt24Sec > totalTimeSec) {
          const factor = timeAt24Sec / totalTimeSec;
          for (const k of keys) {
            const v = newSegments.get(k);
            if (v != null) newSegments.set(k, Math.max(30, Math.round(v * factor)));
          }
          console.log(
            `Корекція ${routeId} ${dir}: час при ${CORRELATION_SPEED_KMH} км/год ${Math.round(timeAt24Sec)} с > сума ${totalTimeSec} с → фактор ${factor.toFixed(3)}`
          );
        }
      }
    }

    const kept = dataset.segments.filter((s) => !routesToProcess.includes(s.routeId));
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

    console.log(`Оновлено сегменти в PostgreSQL для маршрутів: ${routesToProcess.join(', ')}`);
    console.log(`Нових сегментів: ${created.length}; збережено з інших маршрутів: ${kept.length}`);
    console.log(`Запитів OSRM: ${requested}, без відповіді (fallback ${DEFAULT_SEC} с): ${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
