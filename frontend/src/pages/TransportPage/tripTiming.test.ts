import { test } from 'vitest';
import assert from 'node:assert/strict';
import { computeTripTiming, minutesAtStop, parseClockMins, roundMonotonic, tripServesPair } from './tripTiming';

const seg = (table: Record<string, number>, def = 120) => (a: string, b: string) =>
  table[`${a}|${b}`] ?? table[`${b}|${a}`] ?? def;

const chain = ['a', 'm', 'b', 'c', 'd']; // m — технічна точка (map_only) у ланцюжку
const segs = seg({ 'a|m': 60, 'm|b': 120, 'b|c': 300, 'c|d': 240 }); // всього 720 с = 12 хв

test('full trip: cumulative segment sums from the first stop', () => {
  const t = computeTripTiming(chain, segs, { departureMins: 360 })!;
  assert.equal(t.startIndex, 0);
  assert.equal(t.endIndex, 4);
  assert.equal(t.factor, 1);
  assert.equal(t.neededSec, 720);
  assert.equal(t.availableSec, null);
  assert.deepEqual(
    t.stops.map((s) => [s.stopId, s.mins]),
    [['a', 360], ['m', 361], ['b', 363], ['c', 368], ['d', 372]]
  );
  assert.equal(minutesAtStop(t, 'c'), 368);
  assert.equal(minutesAtStop(t, 'zzz'), null);
});

test('arrival with slack: no stretching, last stop earlier than arrival', () => {
  const t = computeTripTiming(chain, segs, { departureMins: 360, arrivalMins: 380 })!;
  assert.equal(t.factor, 1);
  assert.equal(t.availableSec, 1200);
  assert.equal(t.stops[t.stops.length - 1].mins, 372);
});

test('arrival too early: proportional compression, last stop == arrival', () => {
  // 12 хв потрібно, 6 хв є → factor 0.5
  const t = computeTripTiming(chain, segs, { departureMins: 360, arrivalMins: 366 })!;
  assert.equal(t.factor, 0.5);
  assert.equal(t.arrivalIgnored, false);
  assert.deepEqual(
    t.stops.map((s) => s.mins),
    [360, 360.5, 361.5, 364, 366]
  );
});

test('arrival ≤ departure is ignored (factor 1, flag set)', () => {
  const t = computeTripTiming(chain, segs, { departureMins: 360, arrivalMins: 360 })!;
  assert.equal(t.factor, 1);
  assert.equal(t.arrivalIgnored, true);
  assert.equal(t.stops[t.stops.length - 1].mins, 372);
});

test('startStopId mid-chain: departure is at the start stop, earlier stops unserved', () => {
  const t = computeTripTiming(chain, segs, { departureMins: 400, startStopId: 'b' })!;
  assert.equal(t.startIndex, 2);
  assert.deepEqual(t.stops.map((s) => s.stopId), ['b', 'c', 'd']);
  assert.equal(minutesAtStop(t, 'b'), 400);
  assert.equal(minutesAtStop(t, 'd'), 409);
  assert.equal(minutesAtStop(t, 'a'), null);
  assert.equal(t.neededSec, 540);
});

test('endStopId mid-chain: factor uses only the slice sum', () => {
  // a..c = 480 с = 8 хв; вікно 4 хв → factor 0.5
  const t = computeTripTiming(chain, segs, { departureMins: 100, endStopId: 'c', arrivalMins: 104 })!;
  assert.equal(t.endIndex, 3);
  assert.equal(t.neededSec, 480);
  assert.equal(t.factor, 0.5);
  assert.deepEqual(t.stops.map((s) => s.stopId), ['a', 'm', 'b', 'c']);
  assert.equal(minutesAtStop(t, 'c'), 104);
  assert.equal(minutesAtStop(t, 'd'), null);
});

test('invalid slices return null', () => {
  assert.equal(computeTripTiming(['a'], segs, { departureMins: 1 }), null);
  assert.equal(computeTripTiming(chain, segs, { departureMins: 1, startStopId: 'nope' }), null);
  assert.equal(computeTripTiming(chain, segs, { departureMins: 1, endStopId: 'nope' }), null);
  assert.equal(computeTripTiming(chain, segs, { departureMins: 1, startStopId: 'c', endStopId: 'b' }), null);
  assert.equal(computeTripTiming(chain, segs, { departureMins: 1, startStopId: 'c', endStopId: 'c' }), null);
});

test('back direction: reversed chain with reverse-key segment lookup', () => {
  const back = [...chain].reverse();
  const t = computeTripTiming(back, segs, { departureMins: 0 })!;
  assert.deepEqual(t.stops.map((s) => s.mins), [0, 4, 9, 11, 12]);
});

test('non-finite or negative segment seconds count as 0', () => {
  const t = computeTripTiming(['a', 'b', 'c'], () => NaN, { departureMins: 10 })!;
  assert.deepEqual(t.stops.map((s) => s.mins), [10, 10, 10]);
  const t2 = computeTripTiming(['a', 'b'], () => -5, { departureMins: 10 })!;
  assert.equal(t2.stops[1].mins, 10);
});

test('tripServesPair requires both stops in order', () => {
  const t = computeTripTiming(chain, segs, { departureMins: 0, startStopId: 'b' });
  assert.equal(tripServesPair(t, 'b', 'd'), true);
  assert.equal(tripServesPair(t, 'd', 'b'), false);
  assert.equal(tripServesPair(t, 'a', 'd'), false);
  assert.equal(tripServesPair(t, 'b', 'b'), false);
  assert.equal(tripServesPair(null, 'b', 'd'), false);
});

test('roundMonotonic rounds and clamps to non-decreasing', () => {
  assert.deepEqual(roundMonotonic([360, 360.4, 360.6, 361.2]), [360, 360, 361, 361]);
  assert.deepEqual(roundMonotonic([10, 9.2, 12]), [10, 10, 12]);
  assert.deepEqual(roundMonotonic([]), []);
});

test('parseClockMins parses HH:MM[:SS], rejects junk', () => {
  assert.equal(parseClockMins('06:40'), 400);
  assert.equal(parseClockMins('6:40:30'), 400);
  assert.equal(parseClockMins(''), null);
  assert.equal(parseClockMins(null), null);
  assert.equal(parseClockMins('АМ0033АА'), null);
  assert.equal(parseClockMins('07:75'), null);
});

test('mirror: frontend tripTiming.ts is byte-identical to backend trip-timing.ts', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const here = path.resolve(__dirname, 'tripTiming.ts');
  const mirror = path.resolve(__dirname, '../../../../backend/src/trip-timing.ts');
  if (!fs.existsSync(mirror)) return; // поза монорепо (Docker/CI фронтенду) — пропускаємо
  assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(mirror, 'utf8'));
});
