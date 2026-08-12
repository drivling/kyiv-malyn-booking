/**
 * Poputky OD (origin–destination) helpers.
 * Identity = fromPointId + toPointId; route string is a display/legacy snapshot.
 */
import { buildLegacyRouteKey, parseLegacyRoute } from './schedule-trip';

export type TripPointOd = {
  id: number;
  code: string;
  nameUk: string;
  appearInPoputky?: boolean;
};

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
