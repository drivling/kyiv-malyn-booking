/**
 * Unit tests for the stop board: which trips appear at a stop and at what time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRoutesFromData, buildStopDepartures, formatMinsClock, tripDestination } from './stopDepartures';
import { configureSegmentDurations } from './segmentDurations';
import type { RouteStopWithOrder, RouteVariantVm, TransportData, TransportRecord } from './types';

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

describe('buildStopDepartures with route variants', () => {
  // Варіант «туди» А → Б → Вокзал (лише у варіанті); варіант «назад» Вокзал → Б → А → Лікарня з опорним часом на Б
  const variantsByRoute: Record<string, RouteVariantVm[]> = {
    '2': [
      {
        id: '2-v1',
        direction: 'there',
        name: 'Перший рейс до вокзалу',
        stops: [
          { id: 'st_a', name: 'А' },
          { id: 'st_b', name: 'Б' },
          { id: 'st_x', name: 'Вокзал' },
        ],
      },
      {
        id: '2-v2',
        direction: 'back',
        name: 'Від вокзалу до лікарні',
        stops: [
          { id: 'st_x', name: 'Вокзал' },
          { id: 'st_xm', name: 'Тех 2', map_only: true },
          { id: 'st_b', name: 'Б' },
          { id: 'st_a', name: 'А' },
          { id: 'st_y', name: 'Лікарня' },
        ],
      },
    ],
  };
  const vCatalog = { ...catalog, st_x: { name: 'Вокзал' }, st_y: { name: 'Лікарня' } };
  const toStation: TransportRecord = { ...full, trip_id: '2-v1', trip_headsign: '', departure_time: '06:40:00', variant_id: '2-v1' };
  const fromStation: TransportRecord = {
    route_id: '2',
    trip_id: '2-v2',
    trip_headsign: '',
    direction_id: '0',
    departure_time: '07:05:00',
    variant_id: '2-v2',
    timepoints: [{ stopId: 'st_b', time: '07:15' }],
  };
  const routes = () => buildRoutesFromData(data([full, toStation, fromStation]));
  const rowsAt = (stop: string) =>
    buildStopDepartures(stop, routes(), stopsByRoute, vCatalog, variantsByRoute).map(
      (r) => `${formatMinsClock(r.departureMins)} ${r.direction} → ${r.destination}${r.variantId ? ` [${r.variantId}]` : ''}`
    );

  it('each trip runs its own chain; a variant trip without a headsign goes to the end of its variant', () => {
    // 2-v1: А→Б за замовчуванням 2 хв; 2-v2: Вокзал 07:05 → Б 07:15 (опорний час розтягує 4 хв до 10)
    expect(rowsAt('st_b')).toEqual(['06:03 there → Г', '06:42 there → Вокзал [2-v1]', '07:15 back → Лікарня [2-v2]']);
    expect(rowsAt('st_c')).toEqual(['06:08 there → Г']);
  });

  it('a stop that only a variant serves gets its departures; the variant end gets none', () => {
    expect(rowsAt('st_x')).toEqual(['07:05 back → Лікарня [2-v2]']);
    expect(rowsAt('st_y')).toEqual([]);
    // без варіантів (старий бандл) зупинки вокзалу в маршруті №2 немає
    expect(buildStopDepartures('st_x', routes(), stopsByRoute, vCatalog)).toEqual([]);
  });

  it('variant trip headsigns do not rename the route termini', () => {
    const d: TransportData = {
      source: 'test',
      records: [full, { ...toStation, trip_headsign: 'Вокзал' }],
      supplement: { stops: { stops_catalog: vCatalog, stops_by_route: stopsByRoute, variants_by_route: variantsByRoute } },
    };
    expect(buildRoutesFromData(d).find((r) => r.id === '2')?.to).toBe('Г');
  });
});

describe('tripDestination', () => {
  const route = { from: 'А', to: 'Г' };

  it('headsign має пріоритет', () => {
    expect(tripDestination({ trip_headsign: 'Лікарня', end_stop_id: 'st_b' }, 'there', route, catalog)).toBe('Лікарня');
  });

  it('без headsign — назва кінцевої зупинки рейсу (скорочений рейс)', () => {
    expect(tripDestination({ trip_headsign: '', end_stop_id: 'st_b' }, 'there', route, catalog)).toBe('Б');
  });

  it('далі — кінець маршруту за напрямком', () => {
    expect(tripDestination({ trip_headsign: '', end_stop_id: null }, 'there', route, catalog)).toBe('Г');
    expect(tripDestination({ trip_headsign: '  ', end_stop_id: null }, 'back', route, catalog)).toBe('А');
  });

  it('рейс варіанта без таблички — кінець варіанта (end_stop_id важливіший)', () => {
    const variant: RouteVariantVm = {
      id: 'v',
      direction: 'there',
      name: 'До Б',
      stops: [
        { id: 'st_a', name: 'А' },
        { id: 'st_m', name: 'Тех', map_only: true },
        { id: 'st_b', name: 'Б' },
      ],
    };
    expect(tripDestination({ trip_headsign: '', end_stop_id: null }, 'there', route, catalog, variant)).toBe('Б');
    expect(tripDestination({ trip_headsign: '', end_stop_id: 'st_a' }, 'there', route, catalog, variant)).toBe('А');
    expect(tripDestination({ trip_headsign: 'Вокзал', end_stop_id: null }, 'there', route, catalog, variant)).toBe('Вокзал');
  });

  it('нічого не відомо — «—»', () => {
    expect(tripDestination({ trip_headsign: '', end_stop_id: 'st_unknown' }, 'there', { from: null, to: null }, catalog)).toBe('—');
  });
});
