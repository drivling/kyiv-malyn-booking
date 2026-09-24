import { describe, expect, it, vi } from 'vitest';
import { buildCatalogSnapshot } from './catalog-cache';
import { buildMatchCandidateWhere, findMatchCandidates } from './poputky-match';

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
    stops: [{ pointId: 1, position: 0 }, { pointId: 3, position: 1 }, { pointId: 2, position: 2 }],
  },
];
const catalog = buildCatalogSnapshot(points, routes);
const date = new Date(2026, 11, 1, 12, 0);

describe('buildMatchCandidateWhere', () => {
  it('водій на варіанті через Ірпінь: усі підвідрізки маршруту + legacy route', () => {
    const where = buildMatchCandidateWhere(
      { listingType: 'driver', route: 'Kyiv-Malyn-Irpin', fromPointId: 1, toPointId: 2, tripRouteId: 11, date },
      catalog
    );
    expect(where.listingType).toBe('passenger');
    expect(where.isActive).toBe(true);
    expect(where.date).toEqual({ gte: new Date(2026, 11, 1), lt: new Date(2026, 11, 2) });
    expect(where.OR).toEqual([
      { fromPointId: 1, toPointId: 2 },
      { fromPointId: 1, toPointId: 3 },
      { fromPointId: 3, toPointId: 2 },
      { route: 'Kyiv-Malyn-Irpin', fromPointId: null, toPointId: null },
    ]);
  });

  it('водій без TripRoute: лише його OD-пара; зворотний напрямок не потрапляє', () => {
    const where = buildMatchCandidateWhere(
      { listingType: 'driver', route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, tripRouteId: null, date },
      catalog
    );
    expect(where.OR).toEqual([
      { fromPointId: 1, toPointId: 2 },
      { route: 'Kyiv-Malyn', fromPointId: null, toPointId: null },
    ]);
  });

  it('пасажир Ірпінь→Малин: точна пара + водії на маршрутах, що містять цей відрізок', () => {
    const where = buildMatchCandidateWhere(
      { listingType: 'passenger', route: 'Irpin-Malyn', fromPointId: 3, toPointId: 2, date },
      catalog
    );
    expect(where.listingType).toBe('driver');
    expect(where.OR).toEqual([
      { fromPointId: 3, toPointId: 2 },
      { tripRouteId: { in: [11] } },
      { route: 'Irpin-Malyn', fromPointId: null, toPointId: null },
    ]);
  });

  it('без точок (старий рядок): лише route', () => {
    const where = buildMatchCandidateWhere({ listingType: 'passenger', route: 'Kyiv-Malyn', date }, catalog);
    expect(where.OR).toEqual([{ route: 'Kyiv-Malyn' }]);
  });
});

describe('findMatchCandidates', () => {
  it('передає where у viberListing.findMany, каталог бере з кешу (стаб без tripRoute — ок)', async () => {
    const findMany = vi.fn(async () => [{ id: 1 }]);
    const prisma = { tripPoint: { findMany: async () => points }, viberListing: { findMany } };
    const rows = await findMatchCandidates(prisma, { listingType: 'driver', route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, date });
    expect(rows).toEqual([{ id: 1 }]);
    const arg = (findMany.mock.calls[0] as unknown as [{ where: { listingType: string; OR: unknown[] } }])[0];
    expect(arg.where.listingType).toBe('passenger');
    expect(arg.where.OR[0]).toEqual({ fromPointId: 1, toPointId: 2 });
  });
});
