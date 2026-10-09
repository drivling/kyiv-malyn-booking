/**
 * Unit tests for the /transport/dataset contract helpers (hidden routes + editor round-trip).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  datasetToEditor,
  editorToDataset,
  hiddenTransportRouteIds,
  publicTransportDataset,
  type TransportDataset,
} from './transportDataset';

function sampleDataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
      { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
    ],
    routes: [
      { id: '2', fromName: 'Базар', toName: 'Вокзал', scheme: '', note: '', sourceUrl: '', schedule: null },
      { id: '10', fromName: '', toName: '', scheme: '', note: '', sourceUrl: '', schedule: null, unreliable: true },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 2, mapOnly: false },
      { routeId: '10', stopId: 'st_a', orderThere: 1, orderBack: 1, mapOnly: false },
    ],
    trips: [
      { id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '08:00:00', blockId: null },
      { id: '10-01', routeId: '10', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: null, blockId: 'АМ0033АА' },
    ],
    segments: [{ routeId: '10', fromStopId: 'st_a', toStopId: 'st_b', seconds: 120 }],
    meta: { defaultSec: 120, center: [50.768, 29.242] },
  };
}

describe('hiddenTransportRouteIds / publicTransportDataset', () => {
  it('collects ids of unreliable routes', () => {
    assert.deepEqual([...hiddenTransportRouteIds(sampleDataset())], ['10']);
  });

  it('returns the same object when nothing is hidden', () => {
    const d = { ...sampleDataset(), routes: [{ id: '2' }] };
    assert.equal(publicTransportDataset(d), d);
  });

  it('strips hidden routes and everything referencing them, keeps stops', () => {
    const pub = publicTransportDataset(sampleDataset());
    assert.deepEqual(pub.routes.map((r) => r.id), ['2']);
    assert.deepEqual(pub.routeStops.map((rs) => rs.routeId), ['2']);
    assert.deepEqual(pub.trips.map((t) => t.id), ['2-01']);
    assert.deepEqual(pub.segments, []);
    assert.equal(pub.stops.length, 2);
  });
});

describe('editor round-trip keeps unreliable', () => {
  it('datasetToEditor exposes the flag in supplement.routes', () => {
    const { transport } = datasetToEditor(sampleDataset());
    assert.equal(transport.supplement?.routes?.['10']?.unreliable, true);
    assert.equal(transport.supplement?.routes?.['2']?.unreliable, false);
  });

  it('editorToDataset takes the editor value, else falls back to base, else false', () => {
    const base = sampleDataset();
    const { transport, coords } = datasetToEditor(base);
    // редактор не знає про прапорець (старий формат) — береться з base
    delete transport.supplement!.routes!['10']!.unreliable;
    // новий маршрут без прапорця
    transport.supplement!.routes!['77'] = { from: 'X', to: 'Y' };
    const out = editorToDataset(transport, coords, base);
    const byId = new Map(out.routes.map((r) => [r.id, r]));
    assert.equal(byId.get('10')?.unreliable, true);
    assert.equal(byId.get('2')?.unreliable, false);
    assert.equal(byId.get('77')?.unreliable, false);
  });
});
