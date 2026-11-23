/**
 * «Доведе» · свої лінії Києва (kyiv-own-lines.ts, kyiv-taxi.ts): лінія КПТ у кроці Google бере свій інтервал, хвилини
 * й «останній о …»; маршрутка з переліку — свою частоту; чужі лінії лишаються як дав Google.
 */
import fs from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CityStep } from './city-route';
import type { KptData } from './kyiv-kpt';
import { kptDirsFor, normLineNo, taxiFor, withKyivOwnLines } from './kyiv-own-lines';
import { buildTaxiData, parseTaxiDescription, renderTaxiDataTs, renderTaxiSnapshot, taxiSnapshotFrom, type KyivTaxiData } from './kyiv-taxi';
import { KYIV_TAXI } from './kyiv-taxi-data';
import { KYIV_KPT } from './kyiv-kpt-data';
import { TAXI_DATA_TS, TAXI_JSON, readTaxiSnapshot } from '../scripts/kyiv-kpt';

/** Тролейбус 7 з півночі на південь: три точки на одній довготі, 0 → 10 → 20 хв; назад — дзеркально */
const A = { lat: 50.5, lng: 30.5 };
const B = { lat: 50.45, lng: 30.5 };
const C = { lat: 50.4, lng: 30.5 };
const KPT: KptData = {
  version: '20261123',
  validFrom: '20261123',
  validTo: '20271123',
  dirs: [
    { id: '2_7/0/0', mode: 'TROLLEYBUS', no: '7', name: 'Оболонь - Деміївка', points: [['Оболонь', A.lat, A.lng], ['Центр', B.lat, B.lng], ['Деміївка', C.lat, C.lng]], wd: [360, 380, 400, 420, 1380], we: [420, 480], run: { '6': [0, 10, 20], '7': [0, 12, 24], '23': [0, 8, 16] } },
    { id: '2_7/1/0', mode: 'TROLLEYBUS', no: '7', name: 'Деміївка - Оболонь', points: [['Деміївка', C.lat, C.lng], ['Центр', B.lat, B.lng], ['Оболонь', A.lat, A.lng]], wd: [365, 395, 425], we: [], run: { '6': [0, 10, 20] } },
    { id: '3_7/0/0', mode: 'BUS', no: '7', name: 'Автобус сім', points: [['Х', 50.6, 30.7], ['У', 50.61, 30.71]], wd: [300], we: [], run: { '5': [0, 5] } },
  ],
};
const TAXI: KyivTaxiData = { fetchedAt: '2026-11-23', routes: [parseTaxiDescription('442Д', 'вул. А – вул. Б. Тривалість маршруту 50 хв. Частота відправлення 10-20 хв.')] };
const STOPS: Record<string, { lat: number; lng: number }> = { 'Північна': { lat: 50.475, lng: 30.5005 }, 'Південна': { lat: 50.425, lng: 30.4995 } };
const stopAt = (n: string) => STOPS[n] ?? null;

const ride = (over: Partial<CityStep>): CityStep => ({ kind: 'transit', minutes: 14, mode: 'TROLLEYBUS', line: '7', fromStop: 'Північна', toStop: 'Південна', ...over });

test('номер лінії: латиниця-двійник, регістр, пробіли', () => {
  assert.equal(normLineNo('30ka'), '30КА');
  assert.equal(normLineNo(' 36 тр '), '36ТР');
  assert.equal(normLineNo('200K'), normLineNo('200к'));
});

test('напрямок КПТ: за координатами зупинок у правильному порядку; без них — за написом чи обидва', () => {
  const there = kptDirsFor(ride({}), { from: STOPS['Північна'], to: STOPS['Південна'] }, KPT);
  assert.deepEqual(there.map((m) => m.dir.id), ['2_7/0/0']);
  const back = kptDirsFor(ride({}), { from: STOPS['Південна'], to: STOPS['Північна'] }, KPT);
  assert.deepEqual(back.map((m) => m.dir.id), ['2_7/1/0']);
  assert.deepEqual(kptDirsFor(ride({ headsign: 'Деміївка' }), {}, KPT).map((m) => m.dir.id), ['2_7/0/0']);
  assert.equal(kptDirsFor(ride({}), {}, KPT).length, 2);
  // вид важить: автобус 7 — інша лінія; тролейбус 99 — не наш
  assert.deepEqual(kptDirsFor(ride({ mode: 'BUS' }), {}, KPT).map((m) => m.dir.id), ['3_7/0/0']);
  assert.equal(kptDirsFor(ride({ line: '99' }), {}, KPT).length, 0);
});

test('крок лінією КПТ: свій інтервал і хвилини, загальний час з поправкою', () => {
  // рушаємо 06:00, 2 хв пішки → на зупинці «Північна» (посередині першого відрізка, +5 хв від кінцевої) о 06:02
  const steps: CityStep[] = [{ kind: 'walk', minutes: 2, meters: 150 }, ride({ minutes: 14 }), { kind: 'walk', minutes: 3, meters: 200 }];
  const got = withKyivOwnLines({ steps, minutes: 25, date: '2026-11-23', time: '06:00', stopAt }, { kpt: KPT, taxi: TAXI });
  const r = got.steps[1];
  assert.equal(r.own, true);
  assert.equal(r.headwayMin, 20);
  assert.equal(r.minutes, 10); // 5 → 15 хв за рейсами шостої години
  assert.equal(got.minutes, 21);
  assert.equal(r.lastDeparts, undefined);
  assert.deepEqual(got.steps[0], steps[0]);
});

test('пізно ввечері: «останній о …», а коли пішов — сьогодні вже не ходить', () => {
  const late = withKyivOwnLines({ steps: [ride({})], minutes: 14, date: '2026-11-23', time: '23:00', stopAt }, { kpt: KPT, taxi: TAXI }).steps[0];
  assert.equal(late.lastDeparts, '23:04');
  assert.equal(late.gone, undefined);
  const gone = withKyivOwnLines({ steps: [ride({})], minutes: 14, date: '2026-11-23', time: '23:30', stopAt }, { kpt: KPT, taxi: TAXI }).steps[0];
  assert.equal(gone.gone, true);
  assert.equal(gone.lastDeparts, '23:04');
  assert.equal(gone.headwayMin, undefined);
  // рано вранці — коли перший; у вихідні — свій розклад
  assert.equal(withKyivOwnLines({ steps: [ride({})], minutes: 14, date: '2026-11-23', time: '05:00', stopAt }, { kpt: KPT, taxi: TAXI }).steps[0].firstDeparts, '06:05');
  assert.equal(withKyivOwnLines({ steps: [ride({})], minutes: 14, date: '2026-11-22', time: '07:00', stopAt }, { kpt: KPT, taxi: TAXI }).steps[0].headwayMin, 60);
});

test('без координат зупинок — лише інтервал, рідший з двох напрямків', () => {
  const r = withKyivOwnLines({ steps: [ride({ headwayMin: 5 })], minutes: 14, date: '2026-11-23', time: '06:10' }, { kpt: KPT, taxi: TAXI }).steps[0];
  assert.equal(r.own, true);
  assert.equal(r.headwayMin, 30);
  assert.equal(r.minutes, 14);
  assert.equal(r.lastDeparts, undefined);
  // пізно ввечері без координат свій розклад нічого певного не скаже — крок як дав Google
  const night = ride({ headwayMin: 15 });
  assert.deepEqual(withKyivOwnLines({ steps: [night], minutes: 14, date: '2026-11-23', time: '23:50' }, { kpt: KPT, taxi: TAXI }).steps[0], night);
});

test('маршрутка з переліку — своя частота «від–до»; приміський автобус лишається як дав Google', () => {
  const steps: CityStep[] = [ride({ mode: 'SHARE_TAXI', line: '442д', headwayMin: 7 }), ride({ mode: 'BUS', line: '820', headwayMin: 30 })];
  const got = withKyivOwnLines({ steps, minutes: 28, date: '2026-11-23', time: '09:00' }, { kpt: KPT, taxi: TAXI });
  assert.deepEqual([got.steps[0].own, got.steps[0].headwayMin, got.steps[0].headwayMax], [true, 10, 20]);
  assert.deepEqual(got.steps[1], steps[1]);
  assert.equal(got.minutes, 28);
  // автобус із номером, що є серед ліній КПТ, — не маршрутка
  assert.equal(taxiFor(ride({ mode: 'BUS', line: '7' }), KPT, { fetchedAt: '', routes: [parseTaxiDescription('7', 'А – Б. Частота відправлення 15 хв.')] }), null);
});

test('опис маршрутки: «10-20 хв», «60хв», одне число', () => {
  assert.deepEqual(parseTaxiDescription('150', 'вул. Милославська – Севастопольська площа. Тривалість маршруту 60 хв. Частота відправлення 10-20 хв.'), { no: '150', name: 'вул. Милославська – Севастопольська площа', minutes: 60, every: [10, 20] });
  assert.deepEqual(parseTaxiDescription('529к', 'ст. м. «Харківська» – вул. Шевченка. Тривалість маршруту 60хв. Частота відправлення 60хв.').every, [60, 60]);
  assert.equal(parseTaxiDescription('1', 'Без частоти').every, null);
  assert.throws(() => taxiSnapshotFrom({ result: { records: [] } }, '2026-11-23'));
  assert.deepEqual(taxiSnapshotFrom({ result: { records: [{ shortName: '2', description: 'б', sortOrder: 2 }, { shortName: '1', description: 'а', sortOrder: 1 }] } }, '2026-11-23').routes.map((r) => r.no), ['1', '2']);
});

test('знімок маршруток і згенерований файл дорівнюють генератору; номери не перетинаються з КПТ', () => {
  const snap = readTaxiSnapshot();
  assert.equal(fs.readFileSync(TAXI_JSON, 'utf8'), renderTaxiSnapshot(snap));
  assert.equal(fs.readFileSync(TAXI_DATA_TS, 'utf8'), renderTaxiDataTs(buildTaxiData(snap)));
  assert.ok(KYIV_TAXI.routes.length >= 90);
  assert.ok(KYIV_TAXI.routes.every((r) => r.every && r.every[0] > 0));
  const kpt = new Set(KYIV_KPT.dirs.filter((d) => d.mode === 'BUS').map((d) => normLineNo(d.no)));
  assert.deepEqual(KYIV_TAXI.routes.filter((r) => kpt.has(normLineNo(r.no))).map((r) => r.no), []);
});
