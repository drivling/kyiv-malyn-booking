/** Intercity trip helpers: points, legacy route keys, weekdays, arrival. */

export type VehicleType = 'marshrutka' | 'elektrichka';

export const VEHICLE_TYPES: VehicleType[] = ['marshrutka', 'elektrichka'];

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const; // 1=Mon … 7=Sun

export type TripPointLike = {
  id: number;
  code: string;
  nameUk: string;
  requiredOnTrip?: boolean;
  appearInFromTo?: boolean;
};

/** Parse legacy route string e.g. Kyiv-Malyn-Irpin → terminals + vias. */
export function parseLegacyRoute(route: string): { startCode: string; endCode: string; viaCodes: string[] } {
  const parts = String(route || '')
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return { startCode: parts[0] || '', endCode: '', viaCodes: [] };
  }
  return {
    startCode: parts[0],
    endCode: parts[1],
    viaCodes: parts.slice(2),
  };
}

/** Build stable legacy route key for Booking / unique(route, departureTime). */
export function buildLegacyRouteKey(startCode: string, endCode: string, viaCodes: string[] = []): string {
  const vias = viaCodes.filter(Boolean);
  return vias.length > 0 ? `${startCode}-${endCode}-${vias.join('-')}` : `${startCode}-${endCode}`;
}

export function normalizeViaPointIds(raw: unknown): number[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const item of raw) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

export function normalizeActiveWeekdays(raw: unknown): number[] {
  if (raw == null) return [...ALL_WEEKDAYS];
  if (!Array.isArray(raw)) return [...ALL_WEEKDAYS];
  const days = raw
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...ALL_WEEKDAYS];
}

/** ISO date YYYY-MM-DD or Date → ISO weekday 1=Mon … 7=Sun */
export function isoWeekdayFromDate(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
  const js = d.getDay(); // 0=Sun … 6=Sat
  return js === 0 ? 7 : js;
}

export function isScheduleActiveOnDate(activeWeekdays: unknown, date: string | Date): boolean {
  const days = normalizeActiveWeekdays(activeWeekdays);
  return days.includes(isoWeekdayFromDate(date));
}

export function parseHhMm(time: string): { h: number; m: number } | null {
  const match = String(time || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

export function formatHhMm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Resolve arrival HH:MM from explicit arrival or departure + durationMinutes. */
/** Add minutes to HH:MM (wraps 24h). */
export function addMinutesToHhMm(departureTime: string, offsetMinutes: number | null | undefined): string {
  if (offsetMinutes == null || !Number.isFinite(offsetMinutes) || offsetMinutes === 0) {
    return departureTime;
  }
  const dep = parseHhMm(departureTime);
  if (!dep) return departureTime;
  const total = dep.h * 60 + dep.m + Math.round(offsetMinutes);
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return formatHhMm(Math.floor(wrapped / 60), wrapped % 60);
}

/** Boarding time at a stop: schedule start + stop offset (0/null for start). */
export function boardingTimeAtStop(
  scheduleDepartureTime: string,
  stops: Array<{ pointId: number; position: number; departureOffsetMinutes?: number | null }>,
  boardPointId: number
): string {
  const ordered = [...stops].sort((a, b) => a.position - b.position || a.pointId - b.pointId);
  const stop = ordered.find((s) => s.pointId === boardPointId);
  if (!stop) return scheduleDepartureTime;
  return addMinutesToHhMm(scheduleDepartureTime, stop.departureOffsetMinutes ?? 0);
}

/** True if schedule tripRoute stops contain from→to in order. */
export function scheduleMatchesOdAlongStops(
  stops: Array<{ pointId: number; position: number }> | undefined | null,
  fromPointId: number,
  toPointId: number
): boolean {
  if (!stops?.length || fromPointId === toPointId) return false;
  const ordered = [...stops]
    .sort((a, b) => a.position - b.position || a.pointId - b.pointId)
    .map((s) => s.pointId);
  const fromIdx = ordered.indexOf(fromPointId);
  const toIdx = ordered.indexOf(toPointId);
  if (fromIdx < 0 || toIdx < 0) return false;
  return fromIdx < toIdx;
}

/** Resolve arrival HH:MM from explicit arrival or departure + durationMinutes. */
export function resolveArrivalTime(
  departureTime: string,
  arrivalTime?: string | null,
  durationMinutes?: number | null
): string | null {
  if (arrivalTime && parseHhMm(arrivalTime)) return arrivalTime.trim();
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes < 0) return null;
  const dep = parseHhMm(departureTime);
  if (!dep) return null;
  const total = dep.h * 60 + dep.m + Math.round(durationMinutes);
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return formatHhMm(Math.floor(wrapped / 60), wrapped % 60);
}


export type ValidateTripPointsResult =
  | { ok: true; viaPointIds: number[] }
  | { ok: false; error: string };

export function validateTripPointSelection(input: {
  startPointId: number;
  endPointId: number;
  viaPointIds: unknown;
  pointsById: Map<number, TripPointLike>;
}): ValidateTripPointsResult {
  const { startPointId, endPointId, pointsById } = input;
  const viaPointIds = normalizeViaPointIds(input.viaPointIds);

  if (!pointsById.has(startPointId)) return { ok: false, error: 'Unknown startPointId' };
  if (!pointsById.has(endPointId)) return { ok: false, error: 'Unknown endPointId' };
  if (startPointId === endPointId) return { ok: false, error: 'startPointId and endPointId must differ' };

  for (const id of viaPointIds) {
    if (!pointsById.has(id)) return { ok: false, error: `Unknown via point id: ${id}` };
    if (id === startPointId || id === endPointId) {
      return { ok: false, error: 'Via points must not duplicate terminals' };
    }
  }

  return { ok: true, viaPointIds };
}

/** Match trip terminals to from/to city codes (order matters). */
export function matchesTerminals(
  startCode: string,
  endCode: string,
  fromCode: string,
  toCode: string
): boolean {
  return startCode === fromCode && endCode === toCode;
}

/** Valid from/to pairs: both appearInFromTo (requiredOnTrip no longer gates pairs). */
export function buildFromToPairs(points: TripPointLike[]): Array<{ from: TripPointLike; to: TripPointLike }> {
  const terminals = points.filter((p) => p.appearInFromTo !== false);
  const pairs: Array<{ from: TripPointLike; to: TripPointLike }> = [];
  for (const from of terminals) {
    for (const to of terminals) {
      if (from.id === to.id) continue;
      pairs.push({ from, to });
    }
  }
  return pairs;
}

export function isVehicleType(value: unknown): value is VehicleType {
  return value === 'marshrutka' || value === 'elektrichka';
}

export const WEEKDAY_PRESETS: Record<string, number[]> = {
  all: [1, 2, 3, 4, 5, 6, 7],
  weekdays: [1, 2, 3, 4, 5],
  exceptSat: [1, 2, 3, 4, 5, 7],
  exceptSun: [1, 2, 3, 4, 5, 6],
  onlySun: [7],
};

/** Corridor slug = first two segments of legacy/variant slug. */
export function corridorSlugFromRouteSlug(slug: string): string {
  const { startCode, endCode } = parseLegacyRoute(slug);
  return buildLegacyRouteKey(startCode, endCode, []);
}

export function defaultLabelUk(startCode: string, endCode: string, viaCodes: string[] = []): string {
  const map: Record<string, string> = {
    Kyiv: 'Київ',
    Malyn: 'Малин',
    Zhytomyr: 'Житомир',
    Korosten: 'Коростень',
    Irpin: 'Ірпінь',
    Bucha: 'Буча',
  };
  const base = `${map[startCode] || startCode} → ${map[endCode] || endCode}`;
  if (viaCodes.includes('Irpin')) return `${base} (через Ірпінь)`;
  if (viaCodes.includes('Bucha')) return `${base} (через Бучу)`;
  if (viaCodes.length) return `${base} (через ${viaCodes.map((c) => map[c] || c).join(', ')})`;
  return base;
}

export type TripRouteRecord = {
  id: number;
  slug: string;
  labelUk: string;
  startPointId: number;
  endPointId: number;
  corridorTripRouteId: number | null;
};

type PrismaTripRouteClient = {
  tripRoute: {
    findUnique: (args: any) => Promise<TripRouteRecord | null>;
    findFirst: (args: any) => Promise<TripRouteRecord | null>;
    create: (args: any) => Promise<TripRouteRecord>;
  };
  tripRouteStop: {
    createMany: (args: any) => Promise<unknown>;
  };
  tripPoint: {
    findMany: (args?: any) => Promise<Array<{ id: number; code: string; nameUk: string }>>;
  };
};

/** Resolve corridor TripRoute by legacy slug (Kyiv-Malyn). */
export async function resolveCorridorTripRouteId(
  prisma: PrismaTripRouteClient,
  routeSlug: string
): Promise<number | null> {
  if (!prisma?.tripRoute?.findUnique) return null;
  const corridorSlug = corridorSlugFromRouteSlug(routeSlug);
  const row = await prisma.tripRoute.findUnique({ where: { slug: corridorSlug } });
  if (!row) return null;
  // Prefer corridor (no parent); if slug itself is corridor, ok
  if (row.corridorTripRouteId == null) return row.id;
  return row.corridorTripRouteId;
}

/** Find or create TripRoute from points; creates RouteStops. */
export async function findOrCreateTripRoute(
  prisma: PrismaTripRouteClient,
  input: { startPointId: number; endPointId: number; viaPointIds?: number[] }
): Promise<TripRouteRecord> {
  const points = await prisma.tripPoint.findMany();
  const byId = new Map(points.map((p) => [p.id, p]));
  const validated = validateTripPointSelection({
    startPointId: input.startPointId,
    endPointId: input.endPointId,
    viaPointIds: input.viaPointIds ?? [],
    pointsById: byId,
  });
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const start = byId.get(input.startPointId)!;
  const end = byId.get(input.endPointId)!;
  const viaCodes = validated.viaPointIds.map((id) => byId.get(id)!.code);
  const slug = buildLegacyRouteKey(start.code, end.code, viaCodes);
  const existing = await prisma.tripRoute.findUnique({ where: { slug } });
  if (existing) return existing;

  const corridorSlug = buildLegacyRouteKey(start.code, end.code, []);
  let corridorTripRouteId: number | null = null;
  if (viaCodes.length > 0) {
    const corridor = await prisma.tripRoute.findUnique({ where: { slug: corridorSlug } });
    if (corridor) corridorTripRouteId = corridor.id;
    else {
      const createdCorridor = await prisma.tripRoute.create({
        data: {
          slug: corridorSlug,
          labelUk: defaultLabelUk(start.code, end.code),
          startPointId: start.id,
          endPointId: end.id,
          corridorTripRouteId: null,
        },
      });
      await prisma.tripRouteStop.createMany({
        data: [
          { tripRouteId: createdCorridor.id, pointId: start.id, position: 0, role: 'start' },
          { tripRouteId: createdCorridor.id, pointId: end.id, position: 1, role: 'end' },
        ],
      });
      corridorTripRouteId = createdCorridor.id;
    }
  }

  const created = await prisma.tripRoute.create({
    data: {
      slug,
      labelUk: defaultLabelUk(start.code, end.code, viaCodes),
      startPointId: start.id,
      endPointId: end.id,
      corridorTripRouteId,
    },
  });
  const stopRows = [
    { tripRouteId: created.id, pointId: start.id, position: 0, role: 'start' },
    ...validated.viaPointIds.map((pid, i) => ({
      tripRouteId: created.id,
      pointId: pid,
      position: i + 1,
      role: 'via',
    })),
    {
      tripRouteId: created.id,
      pointId: end.id,
      position: 1 + validated.viaPointIds.length,
      role: 'end',
    },
  ];
  await prisma.tripRouteStop.createMany({ data: stopRows });
  return created;
}
