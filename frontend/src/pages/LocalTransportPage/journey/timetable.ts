/**
 * Збірка Timetable з готових патернів: індекси «зупинка → патерни» і піші переходи між близькими зупинками.
 * Спільна для сайту (buildTimetable.ts, з датасету) і для звірки з Transitous (з GTFS stop_times).
 */
import { haversineDistance } from '../nearbyAlternatives';
import { DEFAULT_JOURNEY_OPTIONS, type JourneyOptions } from './options';
import type { Footpath, Pattern, Timetable, TimetableStop } from './types';

/** Хвилини пішки (округлено вгору) для відстані по прямій, з урахуванням «вулиця довша за пряму» */
export function walkMinutesForDistance(straightMeters: number, opts: JourneyOptions): number {
  return Math.ceil((straightMeters * opts.detourFactor) / (opts.walkSpeedMps * 60));
}

/** Довжина пішки, м, для відстані по прямій */
export function walkMetersForDistance(straightMeters: number, opts: JourneyOptions): number {
  return Math.round(straightMeters * opts.detourFactor);
}

function hasPos(s: TimetableStop): s is TimetableStop & { lat: number; lng: number } {
  return typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

function buildFootpaths(stops: TimetableStop[], opts: JourneyOptions): Footpath[][] {
  const out: Footpath[][] = stops.map(() => []);
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    if (!hasPos(a)) continue;
    for (let j = i + 1; j < stops.length; j++) {
      const b = stops[j];
      if (!hasPos(b)) continue;
      const d = haversineDistance(a.lat, a.lng, b.lat, b.lng);
      if (d > opts.maxTransferWalkM) continue;
      const minutes = Math.max(opts.minTransferMin, walkMinutesForDistance(d, opts));
      const meters = walkMetersForDistance(d, opts);
      out[i].push({ to: j, minutes, meters });
      out[j].push({ to: i, minutes, meters });
    }
  }
  return out;
}

export function assembleTimetable(input: {
  stops: TimetableStop[];
  patterns: Pattern[];
  options?: Partial<JourneyOptions>;
}): Timetable {
  const options: JourneyOptions = { ...DEFAULT_JOURNEY_OPTIONS, ...input.options };
  const stopIndex = new Map<string, number>();
  input.stops.forEach((s, i) => stopIndex.set(s.id, i));

  const patterns = input.patterns.map((p) => ({
    ...p,
    trips: [...p.trips].sort((a, b) => a.times[0] - b.times[0]),
  }));
  const patternsAtStop: Timetable['patternsAtStop'] = input.stops.map(() => []);
  patterns.forEach((p, pattern) => {
    p.stops.forEach((stop, pos) => patternsAtStop[stop].push({ pattern, pos }));
  });

  return {
    stops: input.stops,
    stopIndex,
    patterns,
    patternsAtStop,
    footpaths: buildFootpaths(input.stops, options),
    options,
  };
}
