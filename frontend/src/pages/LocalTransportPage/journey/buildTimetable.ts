/**
 * Розклад для пошуку пересадок з датасету сайту. Нічого не рахує заново: ланцюжок рейсу — chainForRecord
 * (варіанти шляху), час на зупинках — recordTiming (start/end, arrival_time, опорні часи), зупинки — лише
 * пасажирські (технічні map_only-точки є в timing.stops, але пересадкою бути не можуть).
 *
 * Викликати ПІСЛЯ configureSegmentDurations(): recordTiming читає його модульний стан.
 */
import { roundMonotonic } from '../dataset/tripTiming';
import { recordTiming } from '../routeTiming';
import { chainForRecord, recordDirection, recordVariant, type VariantsByRoute } from '../routeVariants';
import type { StopsByRoute } from '../routeGeometry';
import type { RouteBundle } from '../stopDepartures';
import type { JourneyOptions } from './options';
import { assembleTimetable } from './timetable';
import type { Pattern, PatternTrip, Timetable, TimetableStop } from './types';

/** Тип дня руху: calendar.txt сайту знає лише `everyday` і `weekdays` */
export type ServiceDay = 'weekday' | 'weekend';

/** Субота й неділя — вихідний тип дня; свят у даних немає */
export function serviceDayForDate(date: Date): ServiceDay {
  const dow = date.getDay();
  return dow === 0 || dow === 6 ? 'weekend' : 'weekday';
}

/** `weekdays` їздить лише по буднях; `everyday`, порожній і застарілі рядки — щодня (так само, як GTFS-експорт) */
export function tripRunsOn(serviceId: string | undefined, day: ServiceDay): boolean {
  return (serviceId ?? '').trim().toLowerCase() === 'weekdays' ? day === 'weekday' : true;
}

export interface BuildTimetableInput {
  routes: RouteBundle[];
  stopsByRoute: StopsByRoute | undefined;
  variantsByRoute: VariantsByRoute | undefined;
  /** Координати зупинок [lat, lng]; зупинка без координат не бере участі в пішках */
  coords: Record<string, [number, number]> | null | undefined;
  serviceDay: ServiceDay;
  options?: Partial<JourneyOptions>;
}

/**
 * Рейси, що не обганяють один одного, лишаються в одному патерні; ті, що обганяють на якійсь зупинці,
 * переходять у наступний (RAPTOR вимагає, щоб ранішій рейс патерна не прибував пізніше за пізніший).
 */
function splitOvertaking(trips: PatternTrip[]): PatternTrip[][] {
  const sorted = [...trips].sort((a, b) => a.times[0] - b.times[0]);
  const groups: PatternTrip[][] = [];
  for (const trip of sorted) {
    const group = groups.find((g) => {
      const last = g[g.length - 1];
      return trip.times.every((t, i) => last.times[i] <= t);
    });
    if (group) group.push(trip);
    else groups.push([trip]);
  }
  return groups;
}

export function buildTimetable(input: BuildTimetableInput): Timetable {
  const { routes, stopsByRoute, variantsByRoute, coords, serviceDay } = input;

  const stops: TimetableStop[] = [];
  const stopIndex = new Map<string, number>();
  const indexOf = (id: string): number => {
    let i = stopIndex.get(id);
    if (i === undefined) {
      i = stops.length;
      stopIndex.set(id, i);
      const c = coords?.[id];
      stops.push(c ? { id, lat: c[0], lng: c[1] } : { id });
    }
    return i;
  };

  const groups = new Map<string, { base: Omit<Pattern, 'trips'>; trips: PatternTrip[] }>();

  for (const route of routes) {
    for (const trip of route.trips) {
      if (!tripRunsOn(trip.service_id, serviceDay)) continue;
      const chain = chainForRecord(stopsByRoute, variantsByRoute, trip);
      const passenger = new Set(chainForRecord(stopsByRoute, variantsByRoute, trip, { markersOnly: true }));
      const timing = recordTiming(route.id, chain, trip);
      if (!timing) continue;
      const served = timing.stops.filter((s) => passenger.has(s.stopId));
      if (served.length < 2) continue;

      const direction = recordDirection(trip);
      const variantId = recordVariant(variantsByRoute, trip)?.id ?? null;
      const stopIds = served.map((s) => s.stopId);
      const key = `${route.id}|${direction}|${variantId ?? ''}|${stopIds.join(',')}`;
      let group = groups.get(key);
      if (!group) {
        group = { base: { routeId: route.id, direction, variantId, stops: stopIds.map(indexOf) }, trips: [] };
        groups.set(key, group);
      }
      group.trips.push({ tripId: trip.trip_id, times: roundMonotonic(served.map((s) => s.mins)) });
    }
  }

  const patterns: Pattern[] = [];
  for (const { base, trips } of groups.values()) {
    for (const part of splitOvertaking(trips)) patterns.push({ ...base, trips: part });
  }
  return assembleTimetable({ stops, patterns, options: input.options });
}
