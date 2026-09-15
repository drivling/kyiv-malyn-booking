import { beforeEach, describe, expect, it } from 'vitest';
import { findNearestTrip } from './nearestTrip';
import { configureSegmentDurations } from './segmentDurations';
import type { TransportRecord } from './types';

// Ланцюжок А → Б → В; сегменти 4 хв і 5 хв (маршрут «2» перевірений).
const chain = ['st_a', 'st_b', 'st_c'];
const at = {
  routeId: '2',
  chainKeys: { there: chain, back: [...chain].reverse() },
  fromStop: 'st_a',
  toStop: 'st_c',
};

function trip(id: string, departure: string, direction: '0' | '1' = '1', extra: Partial<TransportRecord> = {}): TransportRecord {
  return { route_id: '2', trip_id: id, trip_headsign: direction === '1' ? 'В' : 'А', direction_id: direction, departure_time: departure, ...extra };
}

beforeEach(() => {
  configureSegmentDurations({ '2|st_a|st_b': 240, '2|st_b|st_c': 300, '2|st_c|st_b': 300, '2|st_b|st_a': 240 }, 120);
});

describe('findNearestTrip', () => {
  it('з контекстом З→До повертає час на «З», час на «До» і рейс', () => {
    const trips = [trip('t1', '08:30:00'), trip('t2', '09:20:00')];
    const n = findNearestTrip(trips, 8 * 60, 'there', at);
    expect(n).not.toBeNull();
    expect(n!.timeAtFrom).toBe(8 * 60 + 30);
    expect(n!.timeAtTo).toBe(8 * 60 + 39); // 4 + 5 хв
    expect(n!.wrapped).toBe(false);
    expect(n!.record.trip_id).toBe('t1');
    expect(n!.direction).toBe('there');
  });

  it('бере перший рейс після nowMins, а не найранішій', () => {
    const trips = [trip('t1', '08:30:00'), trip('t2', '09:20:00')];
    expect(findNearestTrip(trips, 8 * 60 + 31, 'there', at)!.record.trip_id).toBe('t2');
  });

  it('після останнього рейсу — перший зранку з позначкою wrapped', () => {
    const trips = [trip('t1', '08:30:00'), trip('t2', '09:20:00')];
    const n = findNearestTrip(trips, 23 * 60 + 50, 'there', at);
    expect(n!.record.trip_id).toBe('t1');
    expect(n!.wrapped).toBe(true);
    expect(n!.timeAtFrom).toBe(8 * 60 + 30);
  });

  it('рейс, що не обслуговує пару (кінцева до «До»), не кандидат', () => {
    const short = trip('t-short', '08:00:00', '1', { end_stop_id: 'st_b' });
    const full = trip('t-full', '08:30:00');
    const n = findNearestTrip([short, full], 7 * 60, 'there', at);
    expect(n!.record.trip_id).toBe('t-full');
  });

  it('directionFilter обмежує напрямок; без фільтра обирає ближчий за часом', () => {
    const there = trip('t-there', '10:00:00', '1');
    const back = trip('t-back', '08:10:00', '0');
    const noPair = { ...at, fromStop: 'st_b', toStop: undefined };
    expect(findNearestTrip([there, back], 8 * 60, 'there', noPair)!.record.trip_id).toBe('t-there');
    expect(findNearestTrip([there, back], 8 * 60, undefined, noPair)!.record.trip_id).toBe('t-back');
  });

  it('без контексту — за відправленням з кінцевої, timeAtTo = null', () => {
    const n = findNearestTrip([trip('t1', '08:30:00')], 8 * 60);
    expect(n!.time).toBe(8 * 60 + 30);
    expect(n!.timeAtFrom).toBe(8 * 60 + 30);
    expect(n!.timeAtTo).toBeNull();
  });

  it('рейси без часу (номер машини в block_id) ігноруються; порожній список → null', () => {
    const plate = trip('t-plate', '', '1', { departure_time: undefined, block_id: 'АМ0033АА' });
    expect(findNearestTrip([plate], 8 * 60, 'there', at)).toBeNull();
    expect(findNearestTrip([], 8 * 60)).toBeNull();
  });
});
