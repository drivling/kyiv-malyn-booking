import { beforeEach, describe, expect, it } from 'vitest';
import { configureSegmentDurations } from '../segmentDurations';
import type { RouteStopWithOrder, RouteVariantVm, TransportRecord } from '../types';
import type { RouteBundle } from '../stopDepartures';
import { buildTimetable, serviceDayForDate, tripRunsOn } from './buildTimetable';
import { planDay } from './plan';

// Маршрут «2» (перевірений): A → B → [технічна точка X] → C, і назад. Сегменти: A–B 4, B–X 1, X–C 4 хв.
const stopsByRoute: Record<string, RouteStopWithOrder[]> = {
  '2': [
    { name: 'A', id: 'st_a', order_there: 1, order_back: 4 },
    { name: 'B', id: 'st_b', order_there: 2, order_back: 3 },
    { name: 'X', id: 'st_x', order_there: 3, order_back: 2, map_only: true },
    { name: 'C', id: 'st_c', order_there: 4, order_back: 1 },
  ],
};
const coords: Record<string, [number, number]> = {
  st_a: [50.0, 29.0],
  st_b: [50.01, 29.0],
  st_x: [50.015, 29.0],
  st_c: [50.02, 29.0],
};

function trip(id: string, departure: string, extra: Partial<TransportRecord> = {}): TransportRecord {
  return { route_id: '2', trip_id: id, trip_headsign: 'C', direction_id: '1', departure_time: departure, service_id: 'everyday', ...extra };
}

function bundle(trips: TransportRecord[]): RouteBundle[] {
  return [{ id: '2', from: 'A', to: 'C', trips }];
}

function build(trips: TransportRecord[], serviceDay: 'weekday' | 'weekend' = 'weekday', variants?: Record<string, RouteVariantVm[]>) {
  return buildTimetable({ routes: bundle(trips), stopsByRoute, variantsByRoute: variants, coords, serviceDay });
}

beforeEach(() => {
  configureSegmentDurations(
    { '2|st_a|st_b': 240, '2|st_b|st_x': 60, '2|st_x|st_c': 240, '2|st_c|st_x': 240, '2|st_x|st_b': 60, '2|st_b|st_a': 240 },
    120
  );
});

describe('serviceDayForDate / tripRunsOn', () => {
  it('субота й неділя — weekend, решта — weekday', () => {
    expect(serviceDayForDate(new Date(2026, 9, 19))).toBe('weekday'); // пн
    expect(serviceDayForDate(new Date(2026, 9, 23))).toBe('weekday'); // пт
    expect(serviceDayForDate(new Date(2026, 9, 24))).toBe('weekend'); // сб
    expect(serviceDayForDate(new Date(2026, 9, 25))).toBe('weekend'); // нд
  });

  it('weekdays їздить лише по буднях; everyday, порожнє й застаріле — щодня', () => {
    expect(tripRunsOn('weekdays', 'weekday')).toBe(true);
    expect(tripRunsOn('weekdays', 'weekend')).toBe(false);
    for (const id of ['everyday', '', undefined, 'пн-вт-ср-чт-пт-сб-нд']) {
      expect(tripRunsOn(id, 'weekend')).toBe(true);
    }
  });
});

describe('buildTimetable', () => {
  it('час на зупинках з recordTiming, технічні map_only-точки не стають зупинками', () => {
    const tt = build([trip('t1', '08:00')]);
    expect(tt.stops.map((s) => s.id)).toEqual(['st_a', 'st_b', 'st_c']);
    expect(tt.patterns).toHaveLength(1);
    // 8:00, +4 хв, +1 +4 хв
    expect(tt.patterns[0]).toMatchObject({ routeId: '2', direction: 'there', variantId: null });
    expect(tt.patterns[0].trips[0].times).toEqual([480, 484, 489]);
  });

  it('фільтр дня: рейс weekdays є в будень і немає у вихідний', () => {
    const trips = [trip('t1', '08:00'), trip('t2', '09:00', { service_id: 'weekdays' })];
    expect(build(trips, 'weekday').patterns[0].trips.map((t) => t.tripId)).toEqual(['t1', 't2']);
    expect(build(trips, 'weekend').patterns[0].trips.map((t) => t.tripId)).toEqual(['t1']);
  });

  it('скорочений рейс (start_stop_id) — окремий патерн зі своїми зупинками', () => {
    const tt = build([trip('t1', '08:00'), trip('t3', '10:00', { start_stop_id: 'st_b' })]);
    const short = tt.patterns.find((p) => p.stops.length === 2)!;
    expect(short.stops.map((i) => tt.stops[i].id)).toEqual(['st_b', 'st_c']);
    expect(short.trips[0].times).toEqual([600, 605]);
  });

  it('рейс, що обганяє попередній (стиснення arrival_time), потрапляє в окремий патерн', () => {
    const tt = build([trip('slow', '08:00'), trip('fast', '08:01', { arrival_time: '08:05' })]);
    expect(tt.patterns).toHaveLength(2);
    for (const p of tt.patterns) expect(p.trips).toHaveLength(1);
  });

  it('рейс без часу відправлення пропускається', () => {
    expect(build([trip('t0', '')]).patterns).toEqual([]);
  });

  it('варіант шляху — окремий патерн зі своїм variantId', () => {
    const variants: Record<string, RouteVariantVm[]> = {
      '2': [{ id: 'direct', direction: 'there', name: 'навпростець', stops: [{ id: 'st_a', name: 'A' }, { id: 'st_c', name: 'C' }] }],
    };
    const tt = build([trip('t1', '08:00'), trip('t4', '09:00', { variant_id: 'direct' })], 'weekday', variants);
    expect(tt.patterns.map((p) => p.variantId ?? '').sort()).toEqual(['', 'direct']);
    const direct = tt.patterns.find((p) => p.variantId === 'direct')!;
    expect(direct.stops.map((i) => tt.stops[i].id)).toEqual(['st_a', 'st_c']);
  });

  it('пошук працює поверх побудованого розкладу', () => {
    const tt = build([trip('t1', '08:00'), trip('t2', '09:00')]);
    const { journeys } = planDay(tt, { kind: 'stop', stopId: 'st_a' }, { kind: 'stop', stopId: 'st_c' });
    expect(journeys.map((j) => [j.departMins, j.arriveMins, j.transfers])).toEqual([
      [480, 489, 0],
      [540, 549, 0],
    ]);
  });
});
