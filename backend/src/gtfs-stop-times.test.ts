/**
 * Unit tests for GTFS stop_times synthesis (slice, compression, technical points).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildTripStopTimes, makeSegSec, toGtfsTime } from './gtfs-stop-times';
import type { TransportRouteStopInput, TransportTripInput } from './local-transport';

const routeStops: TransportRouteStopInput[] = [
  { routeId: '5', stopId: 'st_a', orderThere: 1, orderBack: 5, mapOnly: false },
  { routeId: '5', stopId: 'st_m', orderThere: 2, orderBack: 4, mapOnly: true },
  { routeId: '5', stopId: 'st_b', orderThere: 3, orderBack: 3, mapOnly: false },
  { routeId: '5', stopId: 'st_c', orderThere: 4, orderBack: 2, mapOnly: false },
  { routeId: '5', stopId: 'st_d', orderThere: 5, orderBack: 1, mapOnly: false },
];
const segments: Record<string, number> = {
  '5|st_a|st_m': 60,
  '5|st_m|st_b': 120,
  '5|st_b|st_c': 300,
  '5|st_c|st_d': 240,
};
const known = new Set(['st_a', 'st_m', 'st_b', 'st_c', 'st_d']);
const base: TransportTripInput = { id: '5-01', routeId: '5', directionId: '1', departureTime: '06:00:00' };

test('full trip: passenger rows only, offsets through the technical point', () => {
  const r = buildTripStopTimes(base, routeStops, segments, 120, known)!;
  assert.deepEqual(
    r.rows.map((x) => [x.stop_id, x.departure_time, x.stop_sequence, x.timepoint]),
    [['st_a', '06:00:00', 1, 1], ['st_b', '06:03:00', 2, 0], ['st_c', '06:08:00', 3, 0], ['st_d', '06:12:00', 4, 0]]
  );
  assert.equal(r.factor, 1);
  assert.equal(r.startStopId, 'st_a');
  assert.equal(r.endStopId, 'st_d');
  assert.equal(r.direction, 'there');
});

test('sliced trip: rows start at startStopId with stop_sequence 1 and end at endStopId', () => {
  const r = buildTripStopTimes({ ...base, startStopId: 'st_b', endStopId: 'st_c' }, routeStops, segments, 120, known)!;
  assert.deepEqual(r.rows.map((x) => [x.stop_id, x.departure_time, x.stop_sequence]), [['st_b', '06:00:00', 1], ['st_c', '06:05:00', 2]]);
  assert.equal(r.startIndex, 2);
  assert.equal(r.endIndex, 3);
});

test('arrivalTime compresses proportionally; last row == arrival and is a timepoint', () => {
  const r = buildTripStopTimes({ ...base, arrivalTime: '06:06:00' }, routeStops, segments, 120, known)!;
  assert.equal(r.factor, 0.5);
  const times = r.rows.map((x) => x.departure_time);
  assert.equal(times[times.length - 1], '06:06:00');
  assert.deepEqual(times, ['06:00:00', '06:02:00', '06:04:00', '06:06:00']); // 1.5→2, 4→4, 6
  assert.equal(r.rows[r.rows.length - 1].timepoint, 1);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
});

test('arrival with slack does not stretch', () => {
  const r = buildTripStopTimes({ ...base, arrivalTime: '06:30:00' }, routeStops, segments, 120, known)!;
  assert.equal(r.factor, 1);
  assert.equal(r.rows[r.rows.length - 1].departure_time, '06:12:00');
});

test('back direction uses orderBack and reverse-key segments', () => {
  const r = buildTripStopTimes({ ...base, directionId: '0' }, routeStops, segments, 120, known)!;
  assert.equal(r.direction, 'back');
  assert.deepEqual(r.rows.map((x) => [x.stop_id, x.departure_time]), [['st_d', '06:00:00'], ['st_c', '06:04:00'], ['st_b', '06:09:00'], ['st_a', '06:12:00']]);
});

test('returns null without departureTime or when fewer than 2 passenger stops remain', () => {
  assert.equal(buildTripStopTimes({ ...base, departureTime: null }, routeStops, segments, 120, known), null);
  assert.equal(buildTripStopTimes({ ...base, startStopId: 'st_c', endStopId: 'st_d' }, routeStops, segments, 120, new Set(['st_c'])), null);
  assert.equal(buildTripStopTimes({ ...base, startStopId: 'nope' }, routeStops, segments, 120, known), null);
});

test('route without any segments falls back to 2 minutes per chain step', () => {
  const seg = makeSegSec({ '9|x|y': 10 }, 120, '5');
  assert.equal(seg('st_a', 'st_m'), 120);
  const r = buildTripStopTimes(base, routeStops, {}, 120, known)!;
  assert.deepEqual(r.rows.map((x) => x.departure_time), ['06:00:00', '06:04:00', '06:06:00', '06:08:00']);
});

test('toGtfsTime normalises H:MM and rejects plates', () => {
  assert.equal(toGtfsTime('6:05'), '06:05:00');
  assert.equal(toGtfsTime('АМ0033АА'), null);
});
