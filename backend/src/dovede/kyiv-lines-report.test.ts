/**
 * «Доведе» · Київ: лінії Google у збережених відповідях проти наших даних і «чи ходить лінія КПТ о цій годині»
 * (kyiv-lines-report.ts, крок 8в-1), плюс ознака `kpt_not_running` у звіті якості.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CityStep } from './city-route';
import type { KptData } from './kyiv-kpt';
import type { KyivTaxiData } from './kyiv-taxi';
import { parseTaxiDescription } from './kyiv-taxi';
import { kptLineRunsAt, kyivLinesReport, lineKind } from './kyiv-lines-report';
import { findSuspicious } from './city-quality';

const KPT: KptData = {
  version: '20261123',
  validFrom: '20261123',
  validTo: '20271123',
  dirs: [
    { id: '2_7/0/0', mode: 'TROLLEYBUS', no: '7', name: 'Оболонь - Деміївка', points: [['Оболонь', 50.5, 30.5], ['Деміївка', 50.4, 30.5]], wd: [360, 480, 1450], we: [600], run: { '6': [0, 20] } },
    { id: '3_7/0/0', mode: 'BUS', no: '7', name: 'Автобус сім', points: [['Х', 50.6, 30.7], ['У', 50.61, 30.71]], wd: [300], we: [], run: { '5': [0, 5] } },
  ],
};
const TAXI: KyivTaxiData = { fetchedAt: '2026-11-23', routes: [parseTaxiDescription('442Д', 'вул. А – вул. Б. Тривалість маршруту 50 хв. Частота відправлення 10-20 хв.')] };
const ride = (mode: string, line: string, headsign?: string): CityStep => ({ kind: 'transit', minutes: 10, mode, line, ...(headsign ? { headsign } : {}) });

test('вид лінії: КПТ за видом і номером, маршрутка з переліку, метро, кільцева, приміська залізниця, чуже', () => {
  assert.deepEqual(lineKind(ride('TROLLEYBUS', '7'), KPT, TAXI), { kind: 'kpt', name: 'Оболонь - Деміївка' });
  assert.equal(lineKind(ride('TRAM', '7'), KPT, TAXI).kind, 'none');
  assert.deepEqual(lineKind(ride('SHARE_TAXI', '442d'), KPT, TAXI), { kind: 'taxi', name: 'вул. А – вул. Б' });
  assert.equal(lineKind(ride('SUBWAY', '1'), KPT, TAXI).kind, 'metro');
  assert.equal(lineKind(ride('HEAVY_RAIL', 'Kyiv City Express'), KPT, TAXI).kind, 'ring');
  assert.equal(lineKind(ride('HEAVY_RAIL', '6910'), KPT, TAXI).kind, 'rail');
  assert.equal(lineKind(ride('FUNICULAR', 'Фунікулер'), KPT, TAXI).kind, 'funicular');
  assert.equal(lineKind(ride('BUS', '820'), KPT, TAXI).kind, 'none');
});

test('звіт ліній: скільки разів і в скількох парах, найчастіші першими, підсумки за видами', () => {
  const rows = [
    { fromKey: 'a', toKey: 'x', steps: [{ kind: 'walk', minutes: 3 }, ride('BUS', '820'), ride('TROLLEYBUS', '7')] },
    { fromKey: 'a', toKey: 'x', steps: [ride('BUS', '820')] },
    { fromKey: 'b', toKey: 'y', steps: [ride('BUS', '820'), ride('SHARE_TAXI', '442Д')] },
    { fromKey: 'c', toKey: 'z', steps: 'зіпсовано' },
  ];
  const r = kyivLinesReport(rows, KPT, TAXI);
  assert.equal(r.roads, 3);
  assert.deepEqual(r.lines.map((l) => [l.mode, l.line, l.kind, l.rides, l.roads]), [
    ['BUS', '820', 'none', 3, 2],
    ['TROLLEYBUS', '7', 'kpt', 1, 1],
    ['SHARE_TAXI', '442Д', 'taxi', 1, 1],
  ]);
  assert.deepEqual([r.byKind.none, r.byKind.kpt, r.byKind.metro], [{ lines: 1, rides: 3 }, { lines: 1, rides: 1 }, { lines: 0, rides: 0 }]);
});

test('чи ходить лінія КПТ близько до години: за 90 хв до початку і до кінця години; після півночі; вихідні; чужа — null', () => {
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'weekday', 8, KPT), true);
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'weekday', 9, KPT), true); // рейс 08:00 ще в дорозі
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'weekday', 12, KPT), false);
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'weekday', 0, KPT), true); // 24:10
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'sunday', 10, KPT), true);
  assert.equal(kptLineRunsAt('TROLLEYBUS', '7', 'saturday', 8, KPT), false);
  assert.equal(kptLineRunsAt('TRAM', '7', 'weekday', 8, KPT), null);
});

test('звіт якості Києва: Google везе лінією КПТ о годині без рейсів — kpt_not_running; чужа лінія й метро — ні', () => {
  const row = (hour: number, steps: CityStep[]) => ({ cityCode: 'Kyiv', fromKey: 'kyiv.pas', toKey: 'вулиця тест 1', fromLabel: 'вокзал', toLabel: 'вулиця Тест 1', dayType: 'weekday', hour, minutes: 30, steps });
  // справжній KYIV_KPT: автобус 114 ходить удень, о 3-й ночі — ні
  const night = findSuspicious([row(3, [ride('BUS', '114'), ride('BUS', '820'), ride('SUBWAY', '1')])]);
  assert.equal(night.length, 1);
  assert.deepEqual(night[0].reasons.map((x) => x.code), ['kpt_not_running']);
  assert.match(night[0].reasons[0].text, /03:00: №114/);
  assert.deepEqual(findSuspicious([row(12, [ride('BUS', '114')])]), []);
});
