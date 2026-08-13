/**
 * Poputky OD (origin–destination) helpers.
 * Identity = fromPointId + toPointId; route string is a display/legacy snapshot.
 * Along-route: passenger OD is an ordered subset of the driver's TripRoute stops.
 */
import { buildLegacyRouteKey, parseLegacyRoute } from './schedule-trip';

export type TripPointOd = {
  id: number;
  code: string;
  nameUk: string;
  appearInPoputky?: boolean;
};

export type PoputkyRouteMatchKind = 'exact' | 'along_route';

type PrismaOdClient = {
  tripPoint: {
    findMany: (args?: any) => Promise<TripPointOd[]>;
    findFirst?: (args?: any) => Promise<TripPointOd | null>;
  };
};

/** Build route snapshot from two point codes (no via). */
export function buildOdRouteSlug(fromCode: string, toCode: string): string {
  return buildLegacyRouteKey(fromCode, toCode, []);
}

/** Parse first two slug segments as OD codes (via ignored for poputky identity). */
export function parseOdCodesFromRoute(route: string): { fromCode: string; toCode: string } | null {
  const { startCode, endCode } = parseLegacyRoute(route);
  if (!startCode || !endCode) return null;
  return { fromCode: startCode, toCode: endCode };
}

export function findPointByCode(points: TripPointOd[], code: string): TripPointOd | undefined {
  const needle = code.trim().toLowerCase();
  return points.find((p) => p.code.toLowerCase() === needle);
}

/** Resolve OD point ids from route slug using TripPoint catalog. */
export async function resolveOdPointIdsFromRoute(
  prisma: PrismaOdClient,
  route: string
): Promise<{ fromPointId: number; toPointId: number } | null> {
  const parsed = parseOdCodesFromRoute(route);
  if (!parsed) return null;
  const points = await prisma.tripPoint.findMany();
  const from = findPointByCode(points, parsed.fromCode);
  const to = findPointByCode(points, parsed.toCode);
  if (!from || !to || from.id === to.id) return null;
  return { fromPointId: from.id, toPointId: to.id };
}

/** Validate two appearInPoputky points and return route + ids. */
export async function resolvePoputkyOdPair(
  prisma: PrismaOdClient,
  fromRaw: string,
  toRaw: string
): Promise<
  | { ok: true; from: TripPointOd; to: TripPointOd; route: string }
  | { ok: false; error: string }
> {
  const points = await prisma.tripPoint.findMany({
    where: { appearInPoputky: true },
  });
  const from = findPointByCode(points, fromRaw);
  const to = findPointByCode(points, toRaw);
  if (!from || !to) {
    return {
      ok: false,
      error: 'Оберіть міста зі списку попуток (звідки та куди).',
    };
  }
  if (from.id === to.id) {
    return { ok: false, error: 'Звідки і куди мають відрізнятися.' };
  }
  return {
    ok: true,
    from,
    to,
    route: buildOdRouteSlug(from.code, to.code),
  };
}

/** Prisma where fragment for exact OD match with dual-read fallback on route string. */
export function buildOdMatchWhere(listing: {
  route: string;
  fromPointId?: number | null;
  toPointId?: number | null;
}): Record<string, unknown> {
  if (listing.fromPointId != null && listing.toPointId != null) {
    return {
      OR: [
        { fromPointId: listing.fromPointId, toPointId: listing.toPointId },
        { fromPointId: null, toPointId: null, route: listing.route },
      ],
    };
  }
  return { route: listing.route };
}

/** Ordered point ids from TripRouteStop rows (by position). */
export function orderedPointIdsFromStops(
  stops: Array<{ pointId: number; position: number }>
): number[] {
  return [...stops]
    .sort((a, b) => a.position - b.position || a.pointId - b.pointId)
    .map((s) => s.pointId);
}

/** Passenger OD lies on driver itinerary in the same direction. */
export function isOdAlongItinerary(
  itineraryPointIds: number[],
  fromPointId: number,
  toPointId: number
): boolean {
  if (!itineraryPointIds.length || fromPointId === toPointId) return false;
  const fromIdx = itineraryPointIds.indexOf(fromPointId);
  const toIdx = itineraryPointIds.indexOf(toPointId);
  if (fromIdx < 0 || toIdx < 0) return false;
  return fromIdx < toIdx;
}

function isExactOdPair(
  a: { route: string; fromPointId?: number | null; toPointId?: number | null },
  b: { route: string; fromPointId?: number | null; toPointId?: number | null }
): boolean {
  if (
    a.fromPointId != null &&
    a.toPointId != null &&
    b.fromPointId != null &&
    b.toPointId != null
  ) {
    return a.fromPointId === b.fromPointId && a.toPointId === b.toPointId;
  }
  return Boolean(a.route) && a.route === b.route;
}

/**
 * Classify route compatibility: exact OD first, else along driver's itinerary.
 * Itinerary is always the driver's TripRoute stops (corridor or variant).
 */
export function classifyPoputkyRouteMatch(input: {
  driver: {
    route: string;
    fromPointId?: number | null;
    toPointId?: number | null;
    itineraryPointIds?: number[] | null;
  };
  passenger: {
    route: string;
    fromPointId?: number | null;
    toPointId?: number | null;
  };
}): PoputkyRouteMatchKind | null {
  if (isExactOdPair(input.driver, input.passenger)) return 'exact';

  const itinerary = input.driver.itineraryPointIds;
  const fromId = input.passenger.fromPointId;
  const toId = input.passenger.toPointId;
  if (
    itinerary &&
    itinerary.length >= 2 &&
    fromId != null &&
    toId != null &&
    isOdAlongItinerary(itinerary, fromId, toId)
  ) {
    return 'along_route';
  }
  return null;
}

/** Human label from route slug using optional code→nameUk map. */
export function formatOdRouteLabel(
  route: string,
  labelByCode?: Map<string, string> | Record<string, string>
): string {
  const parsed = parseOdCodesFromRoute(route);
  if (!parsed) return route;
  const lookup = (code: string): string => {
    if (!labelByCode) return code;
    if (labelByCode instanceof Map) return labelByCode.get(code) ?? code;
    return labelByCode[code] ?? code;
  };
  const { viaCodes } = parseLegacyRoute(route);
  const from = lookup(parsed.fromCode);
  const to = lookup(parsed.toCode);
  if (viaCodes.length > 0) {
    return `${from} → ${to} (через ${viaCodes.map(lookup).join(', ')})`;
  }
  return `${from} → ${to}`;
}

export const DEFAULT_POINT_LABELS_UK: Record<string, string> = {
  Kyiv: 'Київ',
  Malyn: 'Малин',
  Zhytomyr: 'Житомир',
  Korosten: 'Коростень',
  Irpin: 'Ірпінь',
  Bucha: 'Буча',
};

/** One unique origin→destination pair derived from TripRoute stops (corridors + along-variant). */
export type OdPair = {
  fromCode: string;
  toCode: string;
  fromNameUk: string;
  toNameUk: string;
  labelUk: string;
  /** Corridor TripRoute id when known (variant → its corridor; pure corridor → itself). */
  corridorTripRouteId: number | null;
  /** TripRoute that contributed this pair (first wins on dedupe). */
  sourceTripRouteId: number;
};

export type TripRouteForOdPairs = {
  id: number;
  slug: string;
  labelUk?: string | null;
  corridorTripRouteId?: number | null;
  startPoint?: { id: number; code: string; nameUk: string } | null;
  endPoint?: { id: number; code: string; nameUk: string } | null;
  stops?: Array<{
    position: number;
    point?: { id: number; code: string; nameUk: string } | null;
    pointId?: number;
  }>;
};

/**
 * Build unique OD pairs from TripRoutes:
 * - corridor terminals (start→end)
 * - all ordered along-stop pairs for variants (and corridors with via stops)
 */
export function buildOdPairsFromTripRoutes(routes: TripRouteForOdPairs[]): OdPair[] {
  const byKey = new Map<string, OdPair>();

  for (const tr of routes) {
    const orderedStops: Array<{ code: string; nameUk: string }> = [];
    if (tr.stops?.length) {
      const sorted = [...tr.stops].sort((a, b) => a.position - b.position);
      for (const s of sorted) {
        const p = s.point;
        if (p?.code) orderedStops.push({ code: p.code, nameUk: p.nameUk });
      }
    }
    if (orderedStops.length < 2 && tr.startPoint && tr.endPoint) {
      orderedStops.length = 0;
      orderedStops.push(
        { code: tr.startPoint.code, nameUk: tr.startPoint.nameUk },
        { code: tr.endPoint.code, nameUk: tr.endPoint.nameUk }
      );
    }
    if (orderedStops.length < 2) continue;

    const corridorTripRouteId =
      tr.corridorTripRouteId != null ? tr.corridorTripRouteId : tr.id;

    for (let i = 0; i < orderedStops.length; i++) {
      for (let j = i + 1; j < orderedStops.length; j++) {
        const from = orderedStops[i];
        const to = orderedStops[j];
        const key = `${from.code}\0${to.code}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          fromCode: from.code,
          toCode: to.code,
          fromNameUk: from.nameUk,
          toNameUk: to.nameUk,
          labelUk: `${from.nameUk} → ${to.nameUk}`,
          corridorTripRouteId,
          sourceTripRouteId: tr.id,
        });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const c = a.fromCode.localeCompare(b.fromCode);
    return c !== 0 ? c : a.toCode.localeCompare(b.toCode);
  });
}

type PrismaOdPairsClient = {
  tripRoute: {
    findMany: (args?: any) => Promise<TripRouteForOdPairs[]>;
  };
};

/** Load TripRoutes with stops and return unique OD pairs. */
export async function listOdPairs(prisma: PrismaOdPairsClient): Promise<OdPair[]> {
  const routes = await prisma.tripRoute.findMany({
    include: {
      startPoint: { select: { id: true, code: true, nameUk: true } },
      endPoint: { select: { id: true, code: true, nameUk: true } },
      stops: {
        include: { point: { select: { id: true, code: true, nameUk: true } } },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: [{ slug: 'asc' }],
  });
  return buildOdPairsFromTripRoutes(routes);
}
