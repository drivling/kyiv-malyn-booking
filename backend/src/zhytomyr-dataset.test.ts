/**
 * Датасет міського транспорту Житомира (Docs/zhytomyr-transport-2026-11.md): автобуси з zt.rozklad.in.ua, трамвай і
 * тролейбуси зі знімка EasyWay. Закомічені dataset/zhytomyr-dataset.json і dataset/REPORT.md мусять відповідати
 * джерелам, а датасет — проходити той самий валідатор, що й PUT /transport/dataset.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTransportDataset } from './local-transport';
import { buildZhytomyrDatasetFiles, loadEasyway } from './zhytomyr-dataset-files';
import { displayNumber, routeIdFor } from './zhytomyr-dataset';
import { parseCsvLine, parseEwRawText } from './zhytomyr-easyway';

const ROOT = path.resolve(__dirname, '../../data/zhytomyr-transport');
const { files, result } = buildZhytomyrDatasetFiles(ROOT);
const { dataset } = result;

test('закомічені dataset/zhytomyr-dataset.json і dataset/REPORT.md відповідають джерелам', () => {
  for (const [file, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), content, `${file}: запустіть npm run zhytomyr:dataset`);
  }
});

test('датасет проходить валідацію PUT /transport/dataset', () => {
  const { errors } = validateTransportDataset(JSON.parse(JSON.stringify(dataset)));
  assert.deepEqual(errors, []);
});

test('id зупинок не перетинаються з Малином (st_0…) і Коростенем (st_10NN)', () => {
  for (const s of dataset.stops) {
    assert.match(s.id, /^st_\d{5,8}$/, s.id);
    assert.ok(Number(s.id.slice(3)) >= 20000, s.id);
  }
});

test('усі 19 автобусів zt.rozklad.in.ua і 13 ліній електротранспорту EasyWay', () => {
  const ids = dataset.routes.map((r) => r.id);
  for (const id of ['1', 'a2', 'a3', '18', '18s', '19a', '23a', '115']) assert.ok(ids.includes(id), id);
  for (const id of ['tram', 't1a', 't1b', 't2', 't3', 't4', 't4a', 't5', 't7', 't7a', 't10', 't15', 't15a']) assert.ok(ids.includes(id), id);
  assert.equal(dataset.routes.length, 32);
  // автобус і тролейбус з тим самим номером — різні маршрути
  assert.notEqual(routeIdFor('4', 'bus'), routeIdFor('4', 'trolleybus'));
});

test('номери: id латиницею, на сайті — як у місті', () => {
  assert.equal(routeIdFor('А2', 'bus'), 'a2');
  assert.equal(routeIdFor('18*', 'bus'), '18s');
  assert.equal(routeIdFor('19А', 'bus'), '19a');
  assert.equal(routeIdFor('4A', 'trolleybus'), 't4a');
  assert.equal(routeIdFor('Трамвай', 'tram'), 'tram');
  assert.equal(routeIdFor('4', 'bus', { '4': 'x4' }), 'x4');
  assert.equal(displayNumber('4A', 'trolleybus'), '4А');
  assert.equal(displayNumber('Трамвай', 'tram'), 'Т');
});

test('рейси «у депо» не беремо; кільцеві лінії — один напрямок без повтору першої зупинки', () => {
  const ew = loadEasyway(ROOT);
  assert.ok(ew);
  const t4 = ew.routes.find((r) => r.mode === 'trolleybus' && r.number === '4');
  assert.ok(t4?.directions.forward);
  const depot = t4.directions.forward.workdays.filter((d) => d.depot).length;
  const kept = t4.directions.forward.workdays.length - depot;
  assert.equal(dataset.trips.filter((t) => t.routeId === 't4' && t.directionId === '1' && t.serviceId === 'weekdays').length, kept);
  const loop = dataset.routeStops.filter((r) => r.routeId === 't1a');
  assert.ok(loop.every((r) => (r.orderBack ?? 0) === 0));
  assert.equal(new Set(loop.map((r) => r.stopId)).size, loop.length);
});

test('вечірні рейси EasyWay без рішення власника — лише в звіті', () => {
  const report = files['dataset/REPORT.md'];
  assert.match(report, /Рейси EasyWay, яких нема на zt\.rozklad\.in\.ua/);
  assert.ok(!dataset.trips.some((t) => t.id.includes('-ew')));
});

test('розбір EasyWay: CSV з лапками і сторінка маршруту', () => {
  assert.deepEqual(parseCsvLine('1,T,tram,6.98,"КП ""Житомирське ТТУ""",13 хв'), ['1', 'T', 'tram', '6.98', 'КП "Житомирське ТТУ"', '13 хв']);
  const page = parseEwRawText(fs.readFileSync(path.join(ROOT, 'easyway/raw/electric/route-2.txt'), 'utf8'));
  assert.ok(page);
  assert.deepEqual([page.ri, page.mode, page.number], ['2', 'trolleybus', '1А']);
  assert.ok((page.directions.forward?.stops.length ?? 0) > 10);
  assert.ok(page.directions.forward?.stops.every((x) => x.id));
});
