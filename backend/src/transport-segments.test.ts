/**
 * Unit tests for chainSegmentSeconds: segment durations of one direction from road distances.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chainSegmentSeconds, mergeChainSeconds, segmentChains } from './transport-segments';

test('chainSegmentSeconds: without technical points every hop is timed on its own, as before', () => {
  // 200 м: 12 с паузи + 200 м на 35 км/год ≈ 32.6 → 33; 1000 м: 12 + 1000 м на 45 км/год = 92
  assert.deepEqual(chainSegmentSeconds([false, false, false], [200, 1000]), [33, 92]);
  // дуже короткий перегін — не менше 30 с
  assert.deepEqual(chainSegmentSeconds([false, false], [20]), [30]);
});

test('chainSegmentSeconds: technical points split the span time by length instead of adding 30 s each', () => {
  // справжня → 2 технічні → справжня, 3 × 100 м: один відрізок 300 м = 12 + 30.9 ≈ 43 с, а не 3 × 30
  const secs = chainSegmentSeconds([false, true, true, false], [100, 100, 100]);
  assert.equal(secs.reduce((a, b) => a + b, 0), 43);
  assert.deepEqual(secs, [14, 15, 14]);
  // короткий відрізок з технічною точкою: мінімум 30 с — на весь відрізок
  assert.deepEqual(chainSegmentSeconds([false, true, false], [5, 5]), [15, 15]);
});

test('chainSegmentSeconds: spans end at every real stop', () => {
  // [справжня, технічна, справжня, справжня]: 200 м (33 с, ділиться 17 + 16) і 500 м (63 с)
  assert.deepEqual(chainSegmentSeconds([false, true, false, false], [100, 100, 500]), [17, 16, 63]);
});

test('chainSegmentSeconds: hops without a known length share the span time evenly', () => {
  assert.deepEqual(chainSegmentSeconds([false, true, false], [0, 0]), [15, 15]);
});

test('segmentChains: main there/back first, then variants with their own technical points', () => {
  const chains = segmentChains(
    [
      { routeId: '9', stopId: 'a', orderThere: 1, orderBack: 3 },
      { routeId: '9', stopId: 't', orderThere: 2, orderBack: 2, mapOnly: true },
      { routeId: '9', stopId: 'b', orderThere: 3, orderBack: 1 },
      { routeId: '9', stopId: 'x', orderThere: -1, orderBack: -1 },
    ],
    [
      { id: '9-v1', directionId: '1', name: 'V', stops: [{ stopId: 'a' }, { stopId: 'w', mapOnly: true }, { stopId: 'v' }] },
      { id: '9-v2', directionId: '0', name: 'короткий', stops: [{ stopId: 'v' }] },
    ]
  );
  assert.deepEqual(
    chains.map((c) => [c.label, c.ids.join(','), c.technical.map(Number).join(''), c.variant]),
    [
      ['there', 'a,t,b', '010', false],
      ['back', 'b,t,a', '010', false],
      ['variant 9-v1', 'a,w,v', '010', true],
    ]
  );
});

test('mergeChainSeconds: main chains overwrite as before; a variant only fills hops not yet set', () => {
  const m = new Map<string, number>();
  mergeChainSeconds(m, '9', ['a', 'b', 'c'], [10, 20]);
  mergeChainSeconds(m, '9', ['a', 'b'], [11]); // основний «назад» зі спільним перегоном — як раніше, пізніше значення
  mergeChainSeconds(m, '9', ['a', 'b', 'v'], [99, 30], true);
  assert.deepEqual(Object.fromEntries(m), { '9|a|b': 11, '9|b|c': 20, '9|b|v': 30 });
});
