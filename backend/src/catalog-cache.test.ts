import { describe, expect, it, vi } from 'vitest';
import { buildCatalogSnapshot, getCatalog, getCatalogPoints, invalidateCatalogCache } from './catalog-cache';

const points = [
  { id: 1, code: 'Kyiv', nameUk: 'Київ' },
  { id: 2, code: 'Malyn', nameUk: 'Малин' },
  { id: 3, code: 'Irpin', nameUk: 'Ірпінь' },
];
const routes = [
  { id: 10, slug: 'Kyiv-Malyn', corridorTripRouteId: null, stops: [{ pointId: 1, position: 0 }, { pointId: 2, position: 1 }] },
  {
    id: 11,
    slug: 'Kyiv-Malyn-Irpin',
    corridorTripRouteId: 10,
    stops: [{ pointId: 2, position: 2 }, { pointId: 3, position: 1 }, { pointId: 1, position: 0 }],
  },
];

describe('buildCatalogSnapshot', () => {
  it('впорядковує зупинки, знаходить точки по коду без регістру, along-route у правильному напрямку', () => {
    const snap = buildCatalogSnapshot(points, routes);
    expect(snap.itineraryByRouteId.get(11)).toEqual([1, 3, 2]);
    expect(snap.corridorIdByRouteId.get(11)).toBe(10);
    expect(snap.corridorIdByRouteId.get(10)).toBe(10);
    expect(snap.pointByCode(' kyiv ')?.id).toBe(1);
    expect(snap.routeIdsAlong(3, 2)).toEqual([11]); // Irpin→Malyn лише на варіанті
    expect(snap.routeIdsAlong(1, 2).sort()).toEqual([10, 11]);
    expect(snap.routeIdsAlong(2, 1)).toEqual([]); // зворотний напрямок
    expect(snap.routeIdsAlong(1, 1)).toEqual([]);
  });
});

describe('getCatalog', () => {
  it('ділить один inflight-запит між паралельними викликами і перечитує після invalidate', async () => {
    const tripPoint = { findMany: vi.fn(async () => points) };
    const tripRoute = { findMany: vi.fn(async () => routes) };
    const prisma = { tripPoint, tripRoute };
    const [a, b] = await Promise.all([getCatalog(prisma), getCatalog(prisma)]);
    expect(a).toBe(b);
    expect(tripPoint.findMany).toHaveBeenCalledTimes(1);
    expect(tripRoute.findMany).toHaveBeenCalledTimes(1);
    invalidateCatalogCache(prisma);
    await getCatalogPoints(prisma);
    expect(tripPoint.findMany).toHaveBeenCalledTimes(2);
  });

  it('стаб без tripRoute.findMany → маршрути порожні, точки працюють', async () => {
    const prisma = { tripPoint: { findMany: vi.fn(async () => points) } };
    const snap = await getCatalog(prisma);
    expect(snap.routes).toEqual([]);
    expect(snap.pointByCode('Malyn')?.id).toBe(2);
  });
});
