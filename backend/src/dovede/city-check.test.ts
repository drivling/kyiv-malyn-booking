/**
 * «Доведе» · звірка свого розкладу з Google (city-check.ts): пари зупинок із датасету й вердикти по відповідях.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CHECK_DATASET } from './city-check.fixture';
import { checkPairs, checkReport, checkVerdict, type CheckMeta } from './city-check';

test('пари: три великі відрізки напрямку, технічні точки й ненадійні маршрути пропущено, година з рейсу біля 10:00', () => {
  const pairs = checkPairs(CHECK_DATASET);
  const byKey = new Map(pairs.map((p) => [`${p.from}|${p.to}`, p]));
  // «туди»: Вокзал → Завод (12 хв), Вокзал → Лікарня (середина з 5 зупинок, 5 хв), Лікарня → Завод (7 хв)
  assert.deepEqual(byKey.get('st_1|st_5'), {
    from: 'st_1',
    to: 'st_5',
    fromName: 'Вокзал',
    toName: 'Завод',
    // ту саму пару їде й №2 — одна пара, дві лінії
    lines: [{ routeNo: '1-А', ownMin: 12 }, { routeNo: '2', ownMin: 10 }],
    dayType: 'weekday',
    hour: 9,
  });
  assert.deepEqual(byKey.get('st_1|st_3')?.lines, [{ routeNo: '1-А', ownMin: 5 }]);
  // від середини: рейс 09:55 + 5 хв = 10:00
  assert.deepEqual([byKey.get('st_3|st_5')?.lines[0].ownMin, byKey.get('st_3|st_5')?.hour], [7, 10]);
  // «назад» ходить лише у вихідні — питаємо суботу
  assert.deepEqual([byKey.get('st_5|st_1')?.dayType, byKey.get('st_5|st_1')?.hour], ['saturday', 15]);
  assert.equal(pairs.length, 6);
  assert.ok(!pairs.some((p) => p.to === 'st_4' || p.from === 't_1' || p.to === 't_1'));
});

test('пари: без сегмента чи без рейсів напрямок пропускаємо; близькі зупинки — теж', () => {
  const noSegments = checkPairs({ ...CHECK_DATASET, segments: [] });
  assert.equal(noSegments.length, 0);
  const noTrips = checkPairs({ ...CHECK_DATASET, trips: [] });
  assert.equal(noTrips.length, 0);
  const near = checkPairs({ ...CHECK_DATASET, stops: CHECK_DATASET.stops.map((s) => (s.id === 'st_5' ? { ...s, lat: 50.9502 } : s)) });
  assert.ok(!near.some((p) => `${p.from}|${p.to}` === 'st_1|st_5'));
});

const META: CheckMeta = { fromName: 'Вокзал', toName: 'Завод', lines: [{ routeNo: '1-А', ownMin: 12 }, { routeNo: '2', ownMin: 10 }] };
const bus = (line: string, min: number) => ({ mode: 'BUS', line, from: 'a', to: 'b', min });

test('вердикти: збігається, Google швидше, наше швидше, інша лінія, пішки, немає', () => {
  // номер Google «1А» = наш «1-А»; різниця 2 хв — у межах
  assert.deepEqual(checkVerdict(META, { status: 'ok', steps: [{ walk: 2 }, bus('1А', 14)] }), { verdict: 'same', routeNo: '1-А', ownMin: 12, googleMin: 14, googleLines: ['1А'] });
  assert.equal(checkVerdict(META, { status: 'ok', steps: [bus('1а', 8)] })?.verdict, 'google_faster');
  assert.equal(checkVerdict(META, { status: 'ok', steps: [bus('2', 15)] })?.verdict, 'ours_faster');
  assert.deepEqual(checkVerdict(META, { status: 'ok', steps: [bus('7', 9)] }), { verdict: 'other_line', googleLines: ['7'] });
  // наш номер, але з пересадкою — не те саме, що наш прямий рейс
  assert.equal(checkVerdict(META, { status: 'ok', steps: [bus('2', 4), bus('7', 5)] })?.verdict, 'other_line');
  assert.deepEqual(checkVerdict(META, { status: 'ok', steps: [{ walk: 25 }] }), { verdict: 'walk' });
  assert.deepEqual(checkVerdict(META, { status: 'no_route' }), { verdict: 'none' });
  assert.equal(checkVerdict(META, { status: 'queued' }), null);
  assert.equal(checkVerdict(META, { status: 'failed' }), null);
});

test('звіт: лічильники, по маршрутах, список розбіжностей — найбільша різниця вгорі', () => {
  const pairs = [
    { key: 'a|b', meta: META },
    { key: 'a|c', meta: { fromName: 'Вокзал', toName: 'Лікарня', lines: [{ routeNo: '1-А', ownMin: 5 }] } },
    { key: 'c|b', meta: { fromName: 'Лікарня', toName: 'Завод', lines: [{ routeNo: '1-А', ownMin: 7 }] } },
    { key: 'b|a', meta: { fromName: 'Завод', toName: 'Вокзал', lines: [{ routeNo: '1-А', ownMin: 12 }] } },
  ];
  const report = checkReport(
    pairs,
    new Map([
      ['a|b', { status: 'ok', steps: [bus('2', 10)] }],
      ['a|c', { status: 'ok', steps: [bus('1-А', 12)] }],
      ['c|b', { status: 'no_route' }],
    ]),
  );
  assert.equal(report.pairs, 4);
  assert.equal(report.answered, 3);
  assert.deepEqual(report.counts, { same: 1, google_faster: 0, ours_faster: 1, other_line: 0, walk: 0, none: 1 });
  assert.deepEqual(report.byRoute, [
    // пара Вокзал → Завод збіглася маршрутом №2, для «1-А» це «інше»
    { routeNo: '1-А', pairs: 3, same: 0, googleFaster: 0, oursFaster: 1, other: 2 },
    { routeNo: '2', pairs: 1, same: 1, googleFaster: 0, oursFaster: 0, other: 0 },
  ]);
  assert.deepEqual(report.rows.map((r) => [r.from, r.to, r.verdict, r.ours, r.googleMin ?? null]), [
    ['Вокзал', 'Лікарня', 'ours_faster', 5, 12],
    ['Лікарня', 'Завод', 'none', 7, null],
  ]);
});
