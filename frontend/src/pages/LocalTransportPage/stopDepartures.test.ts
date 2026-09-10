/**
 * Unit tests for the stop board: which trips appear at a stop and at what time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRoutesFromData, buildStopDepartures, formatMinsClock } from './stopDepartures';
import { configureSegmentDurations } from './segmentDurations';
import type { RouteStopWithOrder, TransportData, TransportRecord } from './types';

// «2» — перевірений маршрут (сегменти), «1» — неперевірений (2 хв на крок)
const stopsByRoute: Record<string, RouteStopWithOrder[]> = {
  '2': [
    { id: 'st_a', name: 'А', order_there: 1, order_back: 5 },
    { id: 'st_m', name: 'Тех', order_there: 2, order_back: 4, map_only: true },
    { id: 'st_b', name: 'Б', order_there: 3, order_back: 3 },
    { id: 'st_c', name: 'В', order_there: 4, order_back: 2 },
    { id: 'st_d', name: 'Г', order_there: 5, order_back: 1 },
  ],
  '1': [
    { id: 'st_a', name: 'А', order_there: 1, order_back: 3 },
    { id: 'st_b', name: 'Б', order_there: 2, order_back: 2 },
    { id: 'st_d', name: 'Г', order_there: 3, order_back: 1 },
  ],
};
const catalog = { st_a: { name: 'А' }, st_m: { name: 'Тех' }, st_b: { name: 'Б' }, st_c: { name: 'В' }, st_d: { name: 'Г' } };

function data(records: TransportRecord[]): TransportData {
  return {
    source: 'test',
    records,
    supplement: {
      routes: { '2': { from: 'А', to: 'Г' }, '1': { from: 'А', to: 'Г' } },
      stops: { stops_catalog: catalog, stops_by_route: stopsByRoute },
    },
  };
}

const full: TransportRecord = { route_id: '2', trip_id: '2-01', trip_headsign: 'Г', direction_id: '1', departure_time: '06:00:00' };

beforeEach(() => {
  configureSegmentDurations(
    { '2|st_a|st_m': 60, '2|st_m|st_b': 120, '2|st_b|st_c': 300, '2|st_c|st_d': 240 },
    120
  );
});

describe('buildStopDepartures', () => {
  it('full trip: intermediate stop gets departure + segment sum, end stop gets nothing', () => {
    const routes = buildRoutesFromData(data([full]));
    const atB = buildStopDepartures('st_b', routes, stopsByRoute, catalog);
    expect(atB).toHaveLength(1);
    expect(formatMinsClock(atB[0].departureMins)).toBe('06:03');
    expect(atB[0].destination).toBe('Г');
    expect(atB[0].direction).toBe('there');
    // кінцева «Г» — прибуття, не відправлення
    expect(buildStopDepartures('st_d', routes, stopsByRoute, catalog)).toHaveLength(0);
  });

  it('short-turn trip (end_stop_id) is absent after its end and destination falls back to the end stop name', () => {
    const lunch: TransportRecord = { ...full, trip_id: '2-02', trip_headsign: '', departure_time: '13:00:00', end_stop_id: 'st_b' };
    const routes = buildRoutesFromData(data([lunch]));
    expect(buildStopDepartures('st_a', routes, stopsByRoute, catalog).map((r) => r.destination)).toEqual(['Б']);
    expect(buildStopDepartures('st_b', routes, stopsByRoute, catalog)).toHaveLength(0); // кінцева рейсу
    expect(buildStopDepartures('st_c', routes, stopsByRoute, catalog)).toHaveLength(0);
  });

  it('start_stop_id trip is absent before its start and departs from it at departure_time', () => {
    const fromCentre: TransportRecord = { ...full, trip_id: '2-03', departure_time: '06:15:00', start_stop_id: 'st_b' };
    const routes = buildRoutesFromData(data([fromCentre]));
    expect(buildStopDepartures('st_a', routes, stopsByRoute, catalog)).toHaveLength(0);
    const atB = buildStopDepartures('st_b', routes, stopsByRoute, catalog);
    expect(formatMinsClock(atB[0].departureMins)).toBe('06:15');
    expect(formatMinsClock(buildStopDepartures('st_c', routes, stopsByRoute, catalog)[0].departureMins)).toBe('06:20');
  });

  it('arrival_time compresses intermediate times proportionally', () => {
    // 12 хв за сегментами, вікно 6 хв → ×0.5: Б о 06:01.5, В о 06:04
    const squeezed: TransportRecord = { ...full, trip_id: '2-04', arrival_time: '06:06:00' };
    const routes = buildRoutesFromData(data([squeezed]));
    expect(buildStopDepartures('st_b', routes, stopsByRoute, catalog)[0].departureMins).toBeCloseTo(361.5, 5);
    expect(buildStopDepartures('st_c', routes, stopsByRoute, catalog)[0].departureMins).toBeCloseTo(364, 5);
  });

  it('back direction uses order_back and reverse-key segments', () => {
    const back: TransportRecord = { ...full, trip_id: '2-05', trip_headsign: 'А', direction_id: '0', departure_time: '07:00:00' };
    const routes = buildRoutesFromData(data([back]));
    const atC = buildStopDepartures('st_c', routes, stopsByRoute, catalog);
    expect(atC[0].direction).toBe('back');
    expect(formatMinsClock(atC[0].departureMins)).toBe('07:04');
  });

  it('unverified route uses a flat 2 minutes per chain step', () => {
    const r1: TransportRecord = { route_id: '1', trip_id: '1-01', trip_headsign: 'Г', direction_id: '1', departure_time: '09:00:00' };
    const routes = buildRoutesFromData(data([r1]));
    expect(formatMinsClock(buildStopDepartures('st_b', routes, stopsByRoute, catalog)[0].departureMins)).toBe('09:02');
  });

  it('trips without departure time are skipped; rows sorted by time then route', () => {
    const plate: TransportRecord = { ...full, trip_id: '2-06', departure_time: undefined, block_id: 'АМ0033АА' };
    const later: TransportRecord = { ...full, trip_id: '2-07', departure_time: '05:30:00' };
    const r1: TransportRecord = { route_id: '1', trip_id: '1-02', trip_headsign: 'Г', direction_id: '1', departure_time: '06:01:00' };
    const routes = buildRoutesFromData(data([plate, full, later, r1]));
    const rows = buildStopDepartures('st_b', routes, stopsByRoute, catalog);
    expect(rows.map((r) => `${r.routeId}@${formatMinsClock(r.departureMins)}`)).toEqual(['2@05:33', '1@06:03', '2@06:03']); // рівний час → менший номер маршруту першим
  });
});
