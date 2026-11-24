/**
 * «Доведе» · поїздка Києвом однією лінією КПТ без Google (kyiv-own-trip.ts, крок 8б-2).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CityStep } from './city-route';
import type { KptData } from './kyiv-kpt';
import { halvesOf, ownKyivTrip, type TripHalf } from './kyiv-own-trip';

/** Тролейбус 7: Оболонь → Центр → Деміївка (по 10 хв о 8-й), кожні 20 хв з 06:00 до 22:00; трамвай 1 — швидший, лише о 8-й */
const KPT: KptData = {
  version: '20261123',
  validFrom: '20261123',
  validTo: '20271123',
  dirs: [
    { id: '2_7/0/0', mode: 'TROLLEYBUS', no: '7', name: 'Оболонь - Деміївка', points: [['Оболонь', 50.5, 30.5], ['Центр', 50.45, 30.5], ['Деміївка', 50.4, 30.5]], wd: Array.from({ length: 49 }, (_, i) => 360 + i * 20), we: [600], run: { '8': [0, 10, 20], '22': [0, 8, 16] } },
    { id: '2_7/1/0', mode: 'TROLLEYBUS', no: '7', name: 'Деміївка - Оболонь', points: [['Деміївка', 50.4, 30.5], ['Центр', 50.45, 30.5], ['Оболонь', 50.5, 30.5]], wd: [480], we: [], run: { '8': [0, 10, 20] } },
  ],
};
const half = (stop: string, lat: number, walkMin = 4, fetchedAt = '2026-11-20T00:00:00.000Z'): TripHalf => ({ stop, lat, lng: 30.5005, walkMin, walkM: walkMin * 75, fetchedAt });
const A = half('Північна', 50.49);
const B = half('Південна', 50.41, 3, '2026-11-18T00:00:00.000Z');

test('половинки відповіді: посадка першої поїздки й висадка останньої з пішими кроками', () => {
  const steps: CityStep[] = [
    { kind: 'walk', minutes: 4, meters: 300 },
    { kind: 'transit', minutes: 10, mode: 'BUS', line: '1', fromStop: 'А', toStop: 'Б' },
    { kind: 'walk', minutes: 2, meters: 100 },
    { kind: 'transit', minutes: 7, mode: 'TRAM', line: '2', fromStop: 'В', toStop: 'Г' },
    { kind: 'walk', minutes: 5, meters: 400 },
  ];
  assert.deepEqual(halvesOf(steps), { start: { stop: 'А', walkMin: 4, walkM: 300 }, end: { stop: 'Г', walkMin: 5, walkM: 400 } });
  assert.deepEqual(halvesOf([{ kind: 'walk', minutes: 9 }]), { start: null, end: null });
});

test('одна лінія між зупинками біля обох кінців: пішки → тролейбус (свій) → пішки; найстаріша половинка — «перевірено»', () => {
  const t = ownKyivTrip({ starts: [A], ends: [B], date: '2026-11-24', time: '08:00' }, KPT);
  assert.ok(t);
  const ride = t.steps.find((s) => s.kind === 'transit');
  assert.deepEqual([ride?.mode, ride?.line, ride?.own, ride?.fromStop, ride?.toStop, ride?.headsign, ride?.headwayMin], ['TROLLEYBUS', '7', true, 'Північна', 'Південна', 'Деміївка', 20]);
  // 0,01° ≈ 1,1 км уздовж лінії з 5,5 км між точками → 2 хв від Оболоні; Південна — 18 хв; поїздка 16 хв
  assert.equal(ride?.minutes, 16);
  assert.equal(t.minutes, 4 + 10 + 16 + 3 + (t.steps[0].minutes - 4) + (t.steps[2].minutes - 3));
  assert.equal(t.fetchedAt, '2026-11-18T00:00:00.000Z');
  assert.equal(ride?.departs, undefined);
});

test('ні: навпаки за напрямком, далеко від лінії, далеко пішки, поруч, лінія вже не ходить', () => {
  const at = (starts: TripHalf[], ends: TripHalf[], time = '08:00', date = '2026-11-24') => ownKyivTrip({ starts, ends, date, time }, KPT);
  // назад ходить лише один рейс о 08:00 — о 10-й уже ні
  assert.equal(at([B], [A], '10:00'), null);
  assert.equal(at([{ ...A, lng: 30.52 }], [B]), null);
  assert.equal(at([{ ...A, walkMin: 20 }], [B]), null);
  assert.equal(at([A], [{ ...A, stop: 'Поруч', lat: 50.488 }]), null);
  assert.equal(at([A], [B], '23:30'), null);
  // вихідні — свій розклад: рейс о 10:00 від кінцевої, о 9:30 чекати пів години — рахуємо
  assert.ok(at([A], [B], '09:30', '2026-11-22'));
  assert.equal(at([A], [], '08:00'), null);
});

test('із кількох половинок — найшвидша дорога; пізно ввечері — «останній о …»', () => {
  const far = half('Далека', 50.495, 12);
  const t = ownKyivTrip({ starts: [far, A], ends: [B], date: '2026-11-24', time: '08:00' }, KPT);
  assert.equal(t?.steps.find((s) => s.kind === 'transit')?.fromStop, 'Північна');
  const late = ownKyivTrip({ starts: [A], ends: [B], date: '2026-11-24', time: '21:30' }, KPT);
  assert.equal(late?.steps.find((s) => s.kind === 'transit')?.lastDeparts, '22:02');
});
