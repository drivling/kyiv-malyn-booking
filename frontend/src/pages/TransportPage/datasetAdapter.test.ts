/**
 * Unit tests for TransportDataset → Local view-model adapter.
 * Run: npx tsx --test src/pages/TransportPage/datasetAdapter.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TransportDataset } from '../../api/transportDataset.ts';
import {
  datasetToLocalViewModel,
  getDurationFromStartSec,
  getSegmentDurationSec,
} from './datasetAdapter.ts';

function sampleDataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
      { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
      { id: 'st_map', name: 'Точка карти', lat: 50.775, lng: 29.245 },
    ],
    routes: [
      {
        id: '2',
        fromName: 'Базар',
        toName: 'Вокзал',
        scheme: 'city',
        note: '',
        sourceUrl: '',
        schedule: null,
      },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 3, mapOnly: false },
      { routeId: '2', stopId: 'st_map', orderThere: 2, orderBack: 2, mapOnly: true },
      { routeId: '2', stopId: 'st_b', orderThere: 3, orderBack: 1, mapOnly: false },
    ],
    trips: [
      {
        id: 't1',
        routeId: '2',
        serviceId: 'everyday',
        headsign: 'Вокзал',
        directionId: '1',
        departureTime: '08:30:00',
        blockId: null,
      },
    ],
    segments: [
      { routeId: '2', fromStopId: 'st_a', toStopId: 'st_map', seconds: 90 },
      { routeId: '2', fromStopId: 'st_map', toStopId: 'st_b', seconds: 150 },
    ],
    meta: { defaultSec: 120, center: [50.768, 29.242] },
  };
}

describe('datasetToLocalViewModel', () => {
  it('maps stops into catalog and coords', () => {
    const vm = datasetToLocalViewModel(sampleDataset());
    assert.equal(vm.data.supplement?.stops?.stops_catalog?.st_a?.name, 'Базар');
    assert.deepEqual(vm.coords.stops.st_b, [50.78, 29.25]);
    assert.deepEqual(vm.coords.center, [50.768, 29.242]);
  });

  it('maps trips to TransportRecord fields', () => {
    const vm = datasetToLocalViewModel(sampleDataset());
    assert.equal(vm.data.records.length, 1);
    assert.equal(vm.data.records[0].route_id, '2');
    assert.equal(vm.data.records[0].trip_id, 't1');
    assert.equal(vm.data.records[0].departure_time, '08:30:00');
    assert.equal(vm.data.records[0].direction_id, '1');
  });

  it('preserves map_only on route stops', () => {
    const vm = datasetToLocalViewModel(sampleDataset());
    const stops = vm.data.supplement?.stops?.stops_by_route?.['2'] || [];
    const mapOnly = stops.find((s) => s.id === 'st_map');
    assert.equal(mapOnly?.map_only, true);
    assert.equal(stops.find((s) => s.id === 'st_a')?.map_only, undefined);
  });

  it('builds segment lookup and duration from start', () => {
    const vm = datasetToLocalViewModel(sampleDataset());
    assert.equal(vm.defaultSec, 120);
    assert.equal(vm.segmentDurations['2|st_a|st_map'], 90);
    assert.equal(
      getSegmentDurationSec(vm.segmentDurations, vm.defaultSec, '2', 'st_a', 'st_map'),
      90
    );
    assert.equal(
      getDurationFromStartSec(vm.segmentDurations, vm.defaultSec, '2', ['st_a', 'st_map', 'st_b'], 2),
      240
    );
    assert.equal(
      getSegmentDurationSec(vm.segmentDurations, vm.defaultSec, '2', 'missing', 'x'),
      120
    );
  });

  it('maps route supplement from / to', () => {
    const vm = datasetToLocalViewModel(sampleDataset());
    assert.equal(vm.data.supplement?.routes?.['2']?.from, 'Базар');
    assert.equal(vm.data.supplement?.routes?.['2']?.to, 'Вокзал');
  });
});
