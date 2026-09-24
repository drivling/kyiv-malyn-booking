/**
 * Кеш каталогів у процесі: TripPoint і TripRoute з упорядкованими зупинками.
 *
 * Це десятки рядків, які змінює лише адмінка, а гарячі шляхи (пошук попуток, мерж,
 * розклад, матчинг) перечитували їх з БД на кожен запит — по ~100 мс за round-trip
 * (Docs/poputky-search-performance-plan.md, D3 і Фаза 2.2).
 *
 * - Кеш прив'язаний до інстансу Prisma (WeakMap), тож тестові стаби не ділять стан.
 * - TTL 60 с + `invalidateCatalogCache()` з адмін-роутів після запису.
 * - У vitest TTL = 0: кожен get() перечитує зі стабу (поведінка тестів не змінюється),
 *   але паралельні виклики все одно ділять один inflight-запит.
 */

export type CatalogPoint = {
  id: number;
  code: string;
  nameUk: string;
  appearInPoputky?: boolean | null;
  appearInFromTo?: boolean | null;
  sortOrder?: number | null;
};

export type CatalogRoute = {
  id: number;
  slug: string;
  corridorTripRouteId: number | null;
  stops: Array<{ pointId: number; position: number }>;
};

/** Стаби в тестах часто мають лише частину моделей — відсутня таблиця = порожній каталог. */
export type CatalogPrisma = {
  tripPoint?: { findMany?: (args?: any) => Promise<any[]> };
  tripRoute?: { findMany?: (args?: any) => Promise<any[]> };
};

export type CatalogSnapshot = {
  points: CatalogPoint[];
  routes: CatalogRoute[];
  pointById: Map<number, CatalogPoint>;
  /** Впорядковані pointId зупинок кожного TripRoute (коридори й варіанти). */
  itineraryByRouteId: Map<number, number[]>;
  /** Коридор маршруту (сам маршрут, якщо він коридор). */
  corridorIdByRouteId: Map<number, number>;
  pointByCode(code: string): CatalogPoint | undefined;
  /** TripRoute, де зупинки містять from→to у цьому порядку. */
  routeIdsAlong(fromPointId: number, toPointId: number): number[];
};

const TTL_MS = process.env.VITEST ? 0 : 60_000;

type Loader<T> = { get(): Promise<T>; invalidate(): void };

function createLoader<T>(load: () => Promise<T>, ttlMs: number): Loader<T> {
  let value: T | null = null;
  let loadedAt = 0;
  let inflight: Promise<T> | null = null;
  return {
    get() {
      if (value !== null && ttlMs > 0 && Date.now() - loadedAt < ttlMs) return Promise.resolve(value);
      if (!inflight) {
        inflight = load()
          .then((v) => {
            value = v;
            loadedAt = Date.now();
            inflight = null;
            return v;
          })
          .catch((e: unknown) => {
            inflight = null;
            throw e;
          });
      }
      return inflight;
    },
    invalidate() {
      value = null;
      loadedAt = 0;
    },
  };
}

type Entry = { points: Loader<CatalogPoint[]>; routes: Loader<CatalogRoute[]> };
const caches = new WeakMap<object, Entry>();
// Усі відомі інстанси — для invalidateCatalogCache() без аргументу (тести, адмінка). Їх одиниці.
const known = new Set<object>();

function entryFor(prisma: CatalogPrisma): Entry {
  let entry = caches.get(prisma);
  if (!entry) {
    entry = {
      points: createLoader<CatalogPoint[]>(async () => {
        const findMany = prisma.tripPoint?.findMany;
        if (!findMany) return [];
        return findMany.call(prisma.tripPoint, { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
      }, TTL_MS),
      routes: createLoader<CatalogRoute[]>(async () => {
        const findMany = prisma.tripRoute?.findMany;
        if (!findMany) return [];
        const rows = await findMany.call(prisma.tripRoute, {
          select: {
            id: true,
            slug: true,
            corridorTripRouteId: true,
            stops: { select: { pointId: true, position: true }, orderBy: { position: 'asc' } },
          },
          orderBy: [{ slug: 'asc' }],
        });
        return rows.map((r: any) => ({
          id: r.id,
          slug: r.slug,
          corridorTripRouteId: r.corridorTripRouteId ?? null,
          stops: Array.isArray(r.stops) ? r.stops : [],
        }));
      }, TTL_MS),
    };
    caches.set(prisma, entry);
    known.add(prisma);
  }
  return entry;
}

/** Усі TripPoint (для пошуку по коду/id). */
export function getCatalogPoints(prisma: CatalogPrisma): Promise<CatalogPoint[]> {
  return entryFor(prisma).points.get();
}

/** Усі TripRoute зі зупинками. */
export function getCatalogRoutes(prisma: CatalogPrisma): Promise<CatalogRoute[]> {
  return entryFor(prisma).routes.get();
}

const snapshots = new WeakMap<CatalogRoute[], WeakMap<CatalogPoint[], CatalogSnapshot>>();

export function buildCatalogSnapshot(points: CatalogPoint[], routes: CatalogRoute[]): CatalogSnapshot {
  const pointById = new Map(points.map((p) => [p.id, p]));
  const byCode = new Map(points.map((p) => [p.code.trim().toLowerCase(), p]));
  const itineraryByRouteId = new Map<number, number[]>();
  const corridorIdByRouteId = new Map<number, number>();
  for (const r of routes) {
    const ordered = [...r.stops]
      .sort((a, b) => a.position - b.position || a.pointId - b.pointId)
      .map((s) => s.pointId);
    itineraryByRouteId.set(r.id, ordered);
    corridorIdByRouteId.set(r.id, r.corridorTripRouteId ?? r.id);
  }
  return {
    points,
    routes,
    pointById,
    itineraryByRouteId,
    corridorIdByRouteId,
    pointByCode: (code) => byCode.get(code.trim().toLowerCase()),
    routeIdsAlong: (fromPointId, toPointId) => {
      if (fromPointId === toPointId) return [];
      const out: number[] = [];
      for (const [id, ids] of itineraryByRouteId) {
        const fi = ids.indexOf(fromPointId);
        const ti = ids.indexOf(toPointId);
        if (fi >= 0 && ti >= 0 && fi < ti) out.push(id);
      }
      return out;
    },
  };
}

/** Точки + маршрути + похідні мапи; знімок мемоізується на ті самі масиви з кешу. */
export async function getCatalog(prisma: CatalogPrisma): Promise<CatalogSnapshot> {
  const [points, routes] = await Promise.all([getCatalogPoints(prisma), getCatalogRoutes(prisma)]);
  let byPoints = snapshots.get(routes);
  if (!byPoints) {
    byPoints = new WeakMap();
    snapshots.set(routes, byPoints);
  }
  let snap = byPoints.get(points);
  if (!snap) {
    snap = buildCatalogSnapshot(points, routes);
    byPoints.set(points, snap);
  }
  return snap;
}

/** Після запису в TripPoint/TripRoute/TripRouteStop: один інстанс або всі відомі. */
export function invalidateCatalogCache(prisma?: object): void {
  if (prisma) {
    const entry = caches.get(prisma);
    entry?.points.invalidate();
    entry?.routes.invalidate();
    return;
  }
  for (const target of known) {
    const entry = caches.get(target);
    entry?.points.invalidate();
    entry?.routes.invalidate();
  }
}
