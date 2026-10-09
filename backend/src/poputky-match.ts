/**
 * Кандидати на «перетин» пасажир↔водій — звуження в SQL замість сканування всіх оголошень дня.
 *
 * Правила ті самі, що в classifyPoputkyRouteMatch (poputky-od.ts):
 * - exact: однакова OD-пара (fromPointId/toPointId) або, без точок, однаковий route;
 * - along_route: OD пасажира лежить на маршруті водія (TripRoute stops) у тому ж напрямку.
 * Тут вони перекладені у `where`: для водія — усі впорядковані пари його зупинок, для
 * пасажира — маршрути, де його пара є підвідрізком (з кешу каталогу). Класифікація часу
 * лишається в JS (telegram.ts resolveMatchType).
 * Docs/poputky-search-performance-plan.md, Фаза 4.1.
 */
import { getCatalog, type CatalogPrisma, type CatalogSnapshot } from './catalog-cache';
import { tripDayWhere } from './trip-day';

export type MatchSource = {
  listingType: 'driver' | 'passenger' | string;
  route: string;
  fromPointId?: number | null;
  toPointId?: number | null;
  tripRouteId?: number | null;
  date: Date;
};

type OdPairWhere = { fromPointId: number; toPointId: number };
type CandidateOr =
  | OdPairWhere
  | { tripRouteId: { in: number[] } }
  | { route: string; fromPointId: null; toPointId: null }
  | { route: string };

export type MatchCandidateWhere = {
  listingType: 'driver' | 'passenger';
  isActive: true;
  date: { gte: Date; lt: Date };
  OR: CandidateOr[];
};

/** Впорядковані зупинки водія: TripRoute з кешу, інакше лише from→to. */
export function driverItinerary(src: MatchSource, catalog: CatalogSnapshot): number[] | null {
  if (src.tripRouteId != null) {
    const ids = catalog.itineraryByRouteId.get(src.tripRouteId);
    if (ids && ids.length >= 2) return ids;
  }
  if (src.fromPointId != null && src.toPointId != null) return [src.fromPointId, src.toPointId];
  return null;
}

export function buildMatchCandidateWhere(src: MatchSource, catalog: CatalogSnapshot): MatchCandidateWhere {
  const opposite = src.listingType === 'driver' ? 'passenger' : 'driver';
  const from = src.fromPointId ?? null;
  const to = src.toPointId ?? null;
  const hasOd = from != null && to != null;
  const or: CandidateOr[] = [];
  const seen = new Set<string>();
  const pushPair = (a: number, b: number) => {
    const key = `${a}>${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    or.push({ fromPointId: a, toPointId: b });
  };

  if (hasOd) pushPair(from, to);

  if (src.listingType === 'driver') {
    // Пасажир підходить, якщо його OD — підвідрізок маршруту водія
    const itinerary = driverItinerary(src, catalog);
    if (itinerary) {
      for (let i = 0; i < itinerary.length; i++) {
        for (let j = i + 1; j < itinerary.length; j++) pushPair(itinerary[i], itinerary[j]);
      }
    }
  } else if (hasOd) {
    // Водій підходить, якщо його TripRoute містить OD пасажира в тому ж напрямку
    const routeIds = catalog.routeIdsAlong(from, to);
    if (routeIds.length) or.push({ tripRouteId: { in: routeIds } });
  }

  // Dual-read: старі рядки без точок порівнюємо по route-рядку
  if (hasOd) or.push({ route: src.route, fromPointId: null, toPointId: null });
  else or.push({ route: src.route });

  return { listingType: opposite, isActive: true, date: tripDayWhere(src.date), OR: or };
}

type MatchPrisma = CatalogPrisma & {
  viberListing: { findMany: (args: any) => Promise<any[]> };
};

/** Активні оголошення протилежного типу на ту саму добу, що можуть перетинатися з `src`. */
export async function findMatchCandidates<T = any>(prisma: MatchPrisma, src: MatchSource): Promise<T[]> {
  const catalog = await getCatalog(prisma);
  const where = buildMatchCandidateWhere(src, catalog);
  return prisma.viberListing.findMany({ where, orderBy: { createdAt: 'desc' } });
}
