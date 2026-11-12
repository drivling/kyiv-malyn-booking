/**
 * Чернетка датасету Коростеня (Docs/korosten-transport-data-2026-11.md): генератор з джерел у data/korosten-transport,
 * зіставлення OSM і правила рейсів. Закомічені dataset/korosten-dataset.json і dataset/REPORT.md мусять
 * відповідати джерелам, а чернетка — проходити той самий валідатор, що й PUT /transport/dataset.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTransportDataset } from './local-transport';
import { buildKorostenDatasetFiles, loadKorostenDatasetInput } from './korosten-dataset-files';
import { buildKorostenDataset, cleanStopName, korostenStopId, type KTrip } from './korosten-dataset';
import { matchOsmStops, osmRouteFromFull, osmStopsFromOverpass, type OsmStop } from './korosten-osm';

const ROOT = path.resolve(__dirname, '../../data/korosten-transport');
const { files, result } = buildKorostenDatasetFiles(ROOT);
const { dataset, report } = result;
const trip = (pred: (t: KTrip) => boolean): KTrip[] => dataset.trips.filter(pred);

test('закомічені dataset/korosten-dataset.json і dataset/REPORT.md відповідають джерелам', () => {
  for (const [file, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), content, `${file}: запустіть npm run korosten:dataset`);
  }
});

test('чернетка проходить валідацію PUT /transport/dataset', () => {
  const { errors } = validateTransportDataset(JSON.parse(JSON.stringify(dataset)));
  assert.deepEqual(errors, []);
});

test('id і назви зупинок', () => {
  assert.equal(korostenStopId('z-001'), 'st_1001');
  assert.equal(korostenStopId('z-105'), 'st_1105');
  assert.throws(() => korostenStopId('st_0001'));
  assert.equal(cleanStopName('Зупинка на вимогу “Ощадбанк”'), 'Ощадбанк (на вимогу)');
  assert.equal(cleanStopName('Зупинка на вимогу «Аптека» (Золота Бочка)'), 'Аптека (Золота Бочка) (на вимогу)');
  assert.equal(cleanStopName('Зупинка на вимогу'), 'Зупинка на вимогу');
  assert.equal(cleanStopName('Коростень- Подільський'), 'Коростень-Подільський');
  assert.equal(cleanStopName('Вул. Шатрищанська '), 'Вул. Шатрищанська');
  assert.equal(cleanStopName('Завод "Хіммаш"'), 'Завод «Хіммаш»');
  // усі назви в чернетці — уже почищені
  for (const s of dataset.stops) assert.equal(cleanStopName(s.name), s.name, s.id);
});

test('маршрути: 1–8 і 2-Б, кінцеві = назви зупинок ланцюжка, кольори зі схеми 2019', () => {
  assert.deepEqual(dataset.routes.map((r) => r.id), ['1', '2', '2b', '3', '4', '5', '6', '7', '8']);
  assert.equal(dataset.routes.find((r) => r.id === '2b')?.shortName, '2-Б');
  const names = new Set(dataset.stops.map((s) => s.name));
  for (const r of dataset.routes) {
    assert.ok(names.has(r.fromName) && names.has(r.toName), r.id);
    assert.match(dataset.meta.routeColors[r.id], /^#[0-9A-F]{6}$/, r.id);
  }
});

test('координати: у межах міста, жодних двох зупинок в одній точці', () => {
  const seen = new Map<string, string>();
  for (const s of dataset.stops) {
    assert.ok(s.lat > 50.88 && s.lat < 51.02 && s.lng > 28.5 && s.lng < 28.75, s.id);
    const k = `${s.lat},${s.lng}`;
    assert.ok(!seen.has(k), `${s.id} і ${seen.get(k)} в одній точці`);
    seen.set(k, s.id);
  }
  // вокзал — з OSM
  assert.equal(result.coordSource['z-001'], 'osm');
});

test('рейси: час ради, «*» → будні, «Графік» → blockId', () => {
  const r1 = trip((t) => t.routeId === '1');
  assert.equal(r1.length, 44);
  assert.equal(r1.filter((t) => t.serviceId === 'weekdays').length, 2);
  assert.ok(r1.every((t) => /^1-g[12]$/.test(t.blockId)));
  assert.ok(r1.every((t) => /^1-[12]\d\d$/.test(t.id)));
  const first = r1.find((t) => t.directionId === '1');
  assert.equal(first?.id, '1-101');
  assert.equal(first?.headsign, 'Поліське водосховище');
});

test('«головна пара» кінцевих: №3 «вокзал – Чигирі» їде весь ланцюжок до Проліскової', () => {
  const r3 = trip((t) => t.routeId === '3');
  assert.ok(r3.length > 30);
  assert.ok(r3.every((t) => t.startStopId === null && t.endStopId === null));
});

test('скорочений рейс №8: Романа Шухевича → вокзал закінчується на вокзалі', () => {
  const short = trip((t) => t.routeId === '8' && t.endStopId === 'st_1001');
  assert.equal(short.length, 1);
  assert.equal(short[0].headsign, 'Залізничний вокзал');
  assert.equal(short[0].variantId, null);
});

test('рейси іншим шляхом: курсив №6 → по Південній, №8 до Садів / Дач УТОС, №2 до Романа Шухевича', () => {
  assert.equal(trip((t) => t.variantId === '6-pivdenna').length, 11);
  assert.ok(trip((t) => t.variantId === '8-sady-1').some((t) => t.startStopId === 'st_1001'), 'рейс від вокзалу до Садів');
  assert.equal(trip((t) => t.variantId === '8-utos-1').length + trip((t) => t.variantId === '8-utos-0').length, 4);
  assert.equal(trip((t) => t.variantId?.startsWith('2-shukhevycha')).length, 4);
  // рейс до Садів закінчується на Садах
  for (const t of trip((x) => x.variantId === '8-sady-1')) assert.equal(t.headsign, 'Сади');
});

test('відкладені рейси: Грозине (№4) і через Франка (№7) — не в чернетці, а в звіті', () => {
  assert.equal(trip((t) => t.routeId === '4').length, 63);
  assert.equal(trip((t) => t.routeId === '7').length, 36);
  assert.match(report, /\| №4 \| 2 \| 06:10 \| Коростень-Грозине – Київська \|/);
  assert.match(report, /\| №7 \| 1 \| 07:35 \|.*Франка/);
});

test('arrivalTime лише там, де рада дає інший час у дорозі', () => {
  const t = trip((x) => x.routeId === '3' && x.departureTime === '06:40:00' && x.directionId === '1')[0];
  assert.equal(t.arrivalTime, '07:20:00');
  const plain = trip((x) => x.routeId === '6' && !x.variantId);
  assert.ok(plain.every((x) => x.arrivalTime === null), 'у №6 рада й проєкт дають ті самі 25 хв');
});

test('сегменти: хвилини проєкту × 60, не менше 30 с; невідомі перегони варіантів — з часу ради', () => {
  const seg = (routeId: string, a: string, b: string) => dataset.segments.find((s) => s.routeId === routeId && s.fromStopId === a && s.toStopId === b)?.seconds;
  assert.equal(seg('1', 'st_1001', 'st_1002'), 120);
  assert.ok(dataset.segments.every((s) => s.seconds >= 30));
  assert.ok((seg('8', 'st_1076', 'st_1105') ?? 0) >= 60, 'Бровар → Сади');
});

test('без жодної відомої точки генератор зупиняється, а не вигадує координати', () => {
  const input = loadKorostenDatasetInput(ROOT);
  assert.throws(() => buildKorostenDataset({ ...input, osm: null, streets: null, google: null }), /no coordinates for z-001/);
  // з самими вулицями — уже є з чого рахувати
  const streetsOnly = buildKorostenDataset({ ...input, osm: null, google: null });
  assert.equal(streetsOnly.dataset.stops.length, dataset.stops.length);
  assert.match(streetsOnly.report, /Знімок OSM: нема/);
});

const stop = (id: string, name: string, lat: number, lng: number): OsmStop => ({ id, name, lat, lng });

test('OSM: дві платформи однієї зупинки → середня точка; далека однойменна — осторонь; підказка перемагає', () => {
  const names = new Map([
    ['z-001', ['Залізничний вокзал']],
    ['z-005', ['В. Стуса (Сакко і Ванцетті)']],
    ['z-075', ['Магазин']],
    ['z-090', ['Магазин']],
  ]);
  const osm = [
    stop('node/1', 'Залізничний вокзал', 50.9566, 28.6342),
    stop('node/2', 'Залізничний вокзал', 50.9568, 28.6344),
    stop('node/3', 'Залізничний вокзал', 50.97, 28.6),
    stop('node/4', 'Вул. Василя Стуса', 50.9437, 28.6297),
    stop('node/5', 'Магазин', 50.9389, 28.6363),
  ];
  const plain = matchOsmStops(osm, names);
  assert.deepEqual(plain.matches.get('z-001'), { lat: 50.9567, lng: 28.6343, osmIds: ['node/1', 'node/2'], outliers: ['node/3'] });
  assert.equal(plain.matches.has('z-005'), false, 'назви різні — без підказки не беремо');
  assert.deepEqual(plain.ambiguous, [{ osmId: 'node/5', name: 'Магазин', uids: ['z-075', 'z-090'] }]);
  const hinted = matchOsmStops(osm, names, { 'node/4': 'z-005', 'node/5': 'z-075', 'node/3': null });
  assert.equal(hinted.matches.get('z-005')?.lat, 50.9437);
  assert.equal(hinted.matches.get('z-075')?.lng, 28.6363);
  assert.deepEqual(hinted.matches.get('z-001')?.outliers, []);
});

test('OSM: розбір відповіді Overpass і маршруту з API', () => {
  const stops = osmStopsFromOverpass([
    { type: 'node', id: 2, lat: 50.1, lon: 28.1, tags: { name: ' Б ' } },
    { type: 'way', id: 1, center: { lat: 50.2, lon: 28.2 }, tags: { name: 'А' } },
    { type: 'node', id: 3, lat: 50.3, lon: 28.3, tags: {} },
    { type: 'relation', id: 9, tags: { name: 'маршрут' } },
  ]);
  assert.deepEqual(stops, [stop('node/2', 'Б', 50.1, 28.1), stop('way/1', 'А', 50.2, 28.2)]);
  const route = osmRouteFromFull(
    [
      { type: 'relation', id: 7, tags: { ref: '1', from: 'А', to: 'Б' }, members: [
        { type: 'node', ref: 1, role: 'platform' },
        { type: 'way', ref: 5, role: 'route' },
        { type: 'node', ref: 2, role: 'stop' },
        { type: 'node', ref: 3, role: 'platform_exit_only' },
      ] },
      { type: 'node', id: 1, lat: 50.1, lon: 28.1, tags: { name: 'А' } },
      { type: 'node', id: 2, lat: 50.15, lon: 28.15 },
      { type: 'node', id: 3, lat: 50.2, lon: 28.2, tags: { name: 'Б' } },
    ],
    7,
  );
  assert.deepEqual(route, { id: 'relation/7', ref: '1', from: 'А', to: 'Б', platforms: [stop('node/1', 'А', 50.1, 28.1), stop('node/3', 'Б', 50.2, 28.2)] });
});
