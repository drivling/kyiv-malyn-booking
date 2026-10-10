/**
 * Unit tests for chainSegmentSeconds: segment durations of one direction from road distances.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chainSegmentSeconds } from './transport-segments';

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
