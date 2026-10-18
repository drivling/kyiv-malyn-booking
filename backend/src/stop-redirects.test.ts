/**
 * stop-redirects.ts: розбір meta.stopRedirects (лише коректні пари, ланцюжки стискаються, сміття — у problems)
 * і опис зупинки для GET /transport/stops/:id (маршрути без unreliable, з варіантами шляху).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TransportDataset } from './local-transport';
import { lookupStop, parseStopRedirects, stopRedirectsOf } from './stop-redirects';

const LIVE = ['st_0001', 'st_0002', 'st_0003'];

test('parseStopRedirects keeps old → live pairs, squashes chains, reports the rest', () => {
  const { redirects, problems } = parseStopRedirects(
    {
      st_0042: 'st_0001',
      st_0043: 'st_0042', // ланцюжок → st_0001
      st_0044: ' st_0002 ',
      st_0001: 'st_0002', // жива зупинка
      st_0050: 'st_0099', // невідома ціль
      st_0051: 'st_0051', // самопосилання
      st_0052: 'st_0053', // цикл
      st_0053: 'st_0052',
      st_0054: 7,
      bogus: 'st_0001',
    },
    LIVE
  );
  assert.deepEqual(redirects, { st_0042: 'st_0001', st_0043: 'st_0001', st_0044: 'st_0002' });
  assert.deepEqual(problems, [
    'st_0001: is a live stop, cannot redirect it',
    'st_0050: target st_0099 is not a live stop (unknown, self or a cycle)',
    'st_0051: target st_0051 is not a live stop (unknown, self or a cycle)',
    'st_0052: target st_0053 is not a live stop (unknown, self or a cycle)',
    'st_0053: target st_0052 is not a live stop (unknown, self or a cycle)',
    'st_0054: target must be a stop id',
    'bogus: not a stop id (st_NNNN)',
  ]);
});

test('parseStopRedirects tolerates a missing key and rejects a non-object', () => {
  assert.deepEqual(parseStopRedirects(undefined, LIVE), { redirects: {}, problems: [] });
  assert.deepEqual(parseStopRedirects(null, LIVE), { redirects: {}, problems: [] });
  assert.deepEqual(parseStopRedirects(['st_0042'], LIVE).problems, ['stopRedirects must be an object { oldId: newId }']);
  assert.deepEqual(parseStopRedirects('x', LIVE).redirects, {});
});

function dataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_0001', name: 'Барміна', lat: 50.771, lng: 29.241 },
      { id: 'st_0002', name: 'Лікарня', lat: 50.772, lng: 29.242 },
      { id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 },
    ],
    routes: [
      { id: '10', fromName: 'Барміна', toName: 'Лікарня' },
      { id: '2', fromName: 'Барміна', toName: 'Лікарня', variants: [{ id: '2-v1', directionId: '1', name: 'через вокзал', stops: [{ stopId: 'st_0001' }, { stopId: 'st_0003' }, { stopId: 'st_0002' }] }] },
      { id: '5', fromName: 'Барміна', toName: 'Вокзал', unreliable: true },
    ],
    routeStops: [
      { routeId: '10', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
      { routeId: '10', stopId: 'st_0002', orderThere: 2, orderBack: 1 },
      { routeId: '10', stopId: 'st_0003', orderThere: -1, orderBack: -1 },
      { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
      { routeId: '2', stopId: 'st_0002', orderThere: 2, orderBack: 1 },
      { routeId: '5', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
      { routeId: '5', stopId: 'st_0003', orderThere: 2, orderBack: 1 },
    ],
    trips: [],
    segments: [],
    meta: { stopRedirects: { st_0042: 'st_0003', st_0001: 'st_0002' } },
  };
}

test('lookupStop: live stop with its visible routes (variants count, unreliable and disabled entries do not)', () => {
  const ds = dataset();
  assert.deepEqual(lookupStop(ds, 'st_0001'), {
    kind: 'stop',
    stop: { id: 'st_0001', name: 'Барміна', lat: 50.771, lng: 29.241, routeIds: ['2', '10'] },
  });
  // Вокзал: у №10 вимкнена (-1/-1), у №5 прихований маршрут, у №2 — лише варіант шляху
  assert.deepEqual((lookupStop(ds, 'st_0003') as { stop: { routeIds: string[] } }).stop.routeIds, ['2']);
});

test('lookupStop: redirected id → where to, unknown id → unknown; live stop never appears as a redirect', () => {
  const ds = dataset();
  assert.deepEqual(lookupStop(ds, 'st_0042'), { kind: 'redirect', to: 'st_0003' });
  assert.deepEqual(lookupStop(ds, 'st_0099'), { kind: 'unknown' });
  assert.deepEqual(stopRedirectsOf(ds), { st_0042: 'st_0003' });
});
