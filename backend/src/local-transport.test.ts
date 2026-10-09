/**
 * Unit tests for local-transport dataset validation and legacy conversion.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  convertLegacyRuntime,
  validateTransportDataset,
  type TransportDataset,
} from './local-transport';

function minimalDataset(overrides: Partial<TransportDataset> = {}): TransportDataset {
  return {
    stops: [{ id: 'st_0001', name: 'Барміна', lat: 50.77, lng: 29.24 }],
    routes: [{ id: '2', fromName: 'А', toName: 'Б' }],
    routeStops: [{ routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 1, mapOnly: false }],
    trips: [
      {
        id: '2-01',
        routeId: '2',
        serviceId: 'everyday',
        headsign: 'Б',
        directionId: '1',
        departureTime: '07:00:00',
      },
    ],
    segments: [],
    meta: { defaultSec: 120, center: [50.77, 29.24] },
    ...overrides,
  };
}

test('validateTransportDataset: ok for minimal valid dataset', () => {
  const { errors, dataset } = validateTransportDataset(minimalDataset());
  assert.equal(errors.length, 0);
  assert.ok(dataset);
  assert.equal(dataset!.stops.length, 1);
});

test('validateTransportDataset: rejects missing arrays', () => {
  const { errors } = validateTransportDataset({ meta: {} });
  assert.ok(errors.some((e) => e.includes('stops')));
});

test('validateTransportDataset: rejects unknown stop in routeStop', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      routeStops: [{ routeId: '2', stopId: 'st_missing', orderThere: 1, orderBack: 1 }],
    })
  );
  assert.ok(errors.some((e) => e.includes('unknown stop')));
});

test('validateTransportDataset: rejects bad departureTime', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      trips: [{ id: '2-01', routeId: '2', departureTime: '7am' }],
    })
  );
  assert.ok(errors.some((e) => e.includes('departureTime')));
});

test('validateTransportDataset: rejects non-boolean unreliable', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      routes: [{ id: '2', unreliable: 'yes' as unknown as boolean }],
    })
  );
  assert.ok(errors.some((e) => e.includes('unreliable must be boolean')));
});

test('validateTransportDataset: accepts boolean / omitted unreliable', () => {
  const ok = validateTransportDataset(minimalDataset({ routes: [{ id: '2', unreliable: true }] }));
  assert.equal(ok.errors.length, 0);
  const omitted = validateTransportDataset(minimalDataset({ routes: [{ id: '2' }] }));
  assert.equal(omitted.errors.length, 0);
});

test('convertLegacyRuntime: maps timed trip and coords', () => {
  const { dataset, warnings } = convertLegacyRuntime({
    transport: {
      records: [
        {
          route_id: '2',
          trip_id: '2-01',
          service_id: 'пн-вт-ср-чт-пт-сб-нд',
          trip_headsign: 'Лікарня',
          direction_id: '1',
          departure_time: '07:00:00',
        },
      ],
      supplement: {
        routes: { '2': { from: 'Фабрика', to: 'Лікарня' } },
        stops: {
          stops_catalog: { st_0001: { name: 'Барміна' } },
          stops_by_route: {
            '2': [{ id: 'st_0001', name: 'Барміна', order_there: 1, order_back: 5 }],
          },
        },
      },
    },
    coords: { center: [50.77, 29.24], stops: { st_0001: [50.77, 29.24] } },
    segments: { defaultSec: 120, segments: { '2|st_0001|st_0001': 60 } },
    agency: { agency_id: 'malyn' },
  });
  assert.equal(warnings.length, 0);
  assert.equal(dataset.stops.length, 1);
  assert.equal(dataset.trips[0].serviceId, 'everyday');
  assert.equal(dataset.trips[0].departureTime, '07:00:00');
  assert.equal((dataset.meta.agency as { agency_id: string }).agency_id, 'malyn');
});

test('convertLegacyRuntime: reads unreliable flag from supplement.routes', () => {
  const { dataset } = convertLegacyRuntime({
    transport: {
      records: [
        { route_id: '10', trip_id: '10-01', direction_id: '1' },
        { route_id: '2', trip_id: '2-01', direction_id: '1', departure_time: '07:00:00' },
      ],
      supplement: {
        routes: { '10': { unreliable: true }, '2': { from: 'А', to: 'Б' } },
        stops: { stops_catalog: {}, stops_by_route: {} },
      },
    },
    coords: { center: [50.77, 29.24], stops: {} },
    segments: { defaultSec: 120, segments: {} },
  });
  const byId = new Map(dataset.routes.map((r) => [r.id, r]));
  assert.equal(byId.get('10')?.unreliable, true);
  assert.equal(byId.get('2')?.unreliable, false);
});

function shortTurnDataset(overrides: Partial<TransportDataset> = {}): TransportDataset {
  return minimalDataset({
    stops: [
      { id: 'st_a', name: 'А', lat: 50.77, lng: 29.24 },
      { id: 'st_m', name: 'Тех', lat: 50.771, lng: 29.241 },
      { id: 'st_b', name: 'Б', lat: 50.772, lng: 29.242 },
      { id: 'st_c', name: 'В', lat: 50.773, lng: 29.243 },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 4, mapOnly: false },
      { routeId: '2', stopId: 'st_m', orderThere: 2, orderBack: 3, mapOnly: true },
      { routeId: '2', stopId: 'st_b', orderThere: 3, orderBack: 2, mapOnly: false },
      { routeId: '2', stopId: 'st_c', orderThere: 4, orderBack: -1, mapOnly: false },
    ],
    ...overrides,
  });
}

function tripWith(extra: Partial<TransportDataset['trips'][number]>) {
  return [{ id: '2-01', routeId: '2', directionId: '1', departureTime: '07:00:00', ...extra }];
}

test('validate: short-turn trip with start/end/arrival is accepted', () => {
  const { errors } = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ startStopId: 'st_a', endStopId: 'st_b', arrivalTime: '07:10:00' }) })
  );
  assert.deepEqual(errors, []);
});

test('validate: start/end must be passenger stops of the route in that direction', () => {
  const cases: Array<[Partial<TransportDataset['trips'][number]>, string]> = [
    [{ startStopId: 'st_zzz' }, 'startStopId st_zzz is not a passenger stop'],
    [{ endStopId: 'st_m' }, 'endStopId st_m is not a passenger stop'], // технічна точка
    [{ directionId: '0', startStopId: 'st_c' }, 'startStopId st_c is not a passenger stop'], // orderBack -1
    [{ startStopId: 'st_b', endStopId: 'st_a' }, 'startStopId must precede endStopId'],
    [{ startStopId: 'st_b', endStopId: 'st_b' }, 'startStopId must precede endStopId'],
    [{ endStopId: 'st_a' }, 'startStopId must precede endStopId'], // кінцева = перша зупинка
    [{ startStopId: 5 as unknown as string }, 'startStopId must be a string'],
  ];
  for (const [extra, expected] of cases) {
    const { errors } = validateTransportDataset(shortTurnDataset({ trips: tripWith(extra) }));
    assert.ok(errors.some((e) => e.includes(expected)), `${JSON.stringify(extra)} → ${errors.join('; ')}`);
  }
});

test('validate: arrivalTime format, order and dependency on departureTime', () => {
  const bad = validateTransportDataset(shortTurnDataset({ trips: tripWith({ arrivalTime: '7am' }) }));
  assert.ok(bad.errors.some((e) => e.includes('bad arrivalTime')));
  const early = validateTransportDataset(shortTurnDataset({ trips: tripWith({ arrivalTime: '07:00' }) }));
  assert.ok(early.errors.some((e) => e.includes('arrivalTime must be after departureTime')));
  const noDep = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ departureTime: null, arrivalTime: '07:30' }) })
  );
  assert.ok(noDep.errors.some((e) => e.includes('arrivalTime requires departureTime')));
  const empty = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ startStopId: '', endStopId: '', arrivalTime: '' }) })
  );
  assert.deepEqual(empty.errors, []);
});

test('convertLegacyRuntime: maps snake_case start/end/arrival, empty → null', () => {
  const { dataset } = convertLegacyRuntime({
    transport: {
      records: [
        { route_id: '2', trip_id: '2-01', direction_id: '1', departure_time: '07:00:00',
          start_stop_id: 'st_a', end_stop_id: 'st_b', arrival_time: '07:10:00' },
        { route_id: '2', trip_id: '2-02', direction_id: '1', departure_time: '08:00:00', start_stop_id: '' },
      ],
      supplement: { routes: {}, stops: { stops_catalog: {}, stops_by_route: {} } },
    },
    coords: { center: [50.77, 29.24], stops: {} },
    segments: { defaultSec: 120, segments: {} },
  });
  assert.equal(dataset.trips[0].startStopId, 'st_a');
  assert.equal(dataset.trips[0].endStopId, 'st_b');
  assert.equal(dataset.trips[0].arrivalTime, '07:10:00');
  assert.equal(dataset.trips[1].startStopId, null);
  assert.equal(dataset.trips[1].arrivalTime, null);
});
