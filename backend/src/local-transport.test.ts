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
