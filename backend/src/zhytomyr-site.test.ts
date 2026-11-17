/**
 * Житомир зі свого сайту (zt.rozklad.in.ua): розбір сторінок, координати зупинок, звірка з Google.
 * Закомічені routes.json / stops.json / REPORT.md мають дорівнювати тому, що дає генератор зі збережених файлів.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildZhytomyrReport, buildZhytomyrRoutes, buildZhytomyrStops, loadZhytomyrRoutes, type ZhytomyrRoutesFile } from './zhytomyr-routes';
import { extractZtFragment, parseZtDirection, parseZtHome } from './zhytomyr-site-parser';
import { locateZhytomyrStops, sameStopName, stopKey } from './zhytomyr-stops';
import { checkSpans, directionChecks, googleRides, minutesAgree, spanVerdict, type GoogleRide } from './zhytomyr-google-check';

const ROOT = path.resolve(__dirname, '../../data/zhytomyr-transport');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('знімок: routes.json, stops.json і REPORT.md дорівнюють генератору', () => {
  assert.equal(read('routes.json'), buildZhytomyrRoutes(ROOT));
  assert.equal(read('stops.json'), buildZhytomyrStops(ROOT));
  assert.equal(read('REPORT.md'), buildZhytomyrReport(ROOT));
});

test('знімок: кожен маршрут має напрямки, зупинки з хвилинами, що не йдуть назад, і рейси', () => {
  const file = loadZhytomyrRoutes(ROOT);
  assert.ok(file.routes.length >= 15);
  for (const r of file.routes) {
    assert.ok(r.number && r.directions.length >= 1, r.number);
    for (const d of r.directions) {
      assert.ok(d.stops.length >= 5, `${r.number}: зупинок ${d.stops.length}`);
      assert.equal(d.stops[0].minutes, 0);
      assert.ok(d.workdays.length + d.weekend.length > 0, `${r.number} ${d.dirId}: без рейсів`);
      for (const dep of [...d.workdays, ...d.weekend]) assert.match(dep.time, /^([01]\d|2[0-3]):[0-5]\d$/);
    }
  }
});

test('сторінка напрямку: номер, назва, зворотний напрямок, зупинки, рейси будня й вихідного, дата', () => {
  const d = parseZtDirection(read('source/html/131.html'), 131);
  assert.equal(d.number, '1');
  assert.equal(d.reverseId, 132);
  assert.equal(d.stops[0].name, 'Панчішна фабрика 01');
  assert.deepEqual(d.stops[1], { id: 4051, name: 'р-к "Хмільники" 01', minutes: 2 });
  assert.equal(d.workdays[0].time, '06:15');
  assert.ok(d.weekend.length > 10);
  assert.match(d.validFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
  // позначка «у депо» лишається на рейсі
  assert.ok(d.workdays.some((x) => x.note === 'depot'));
});

test('розбирач: головна сторінка, фрагмент без службових атрибутів, сторінка без розкладу — помилка', () => {
  const home = `<div class="route js-route js-bus"><ul><li><a href="/home/schedule/131"><span>1</span>&#x410; - &#x411;</a></li></ul></div>
    <div class="route js-route js-tram"><ul><li><a href="/home/schedule/7"><span>Т1</span>В - Г</a></li></ul></div>`;
  assert.deepEqual(parseZtHome(home), [
    { mode: 'bus', number: '1', name: 'А - Б', dirId: 131 },
    { mode: 'tram', number: 'Т1', name: 'В - Г', dirId: 7 },
  ]);
  const page = `<html><div class="schedule-top"><svg><path d="x"/></svg><div class="number">7</div><h1 class="name-route">А - Б</h1>
    <button class="view-more js-sort-route" onclick="if (!window.__cfRLUnblockHandlers) return false; GetSchedule(8, null)" data-cf-modified-abc-="">x</button>
    <li onclick="GetSchedule(7, 1)" data-cf-modified-abc-=""><span></span><p>Перша</p></li><li onclick="GetSchedule(7, 2)"><span>3&#x2019;</span><p>Друга</p></li>
    <div class="column working-days"><table><tr></tr><tr><td>6</td><td class='default-td '><spam class=''>05</spam></td><td></td></tr><tr><td>23</td><td class='depot '><spam class=''>40</spam></td></tr></table></div>
    <div class="column weekend"><table><tr><td>7</td><td class='default-td '><spam class=''>10</spam></td></tr></table></div>
    <div class="data">&#x420;&#x41E;&#x417;&#x41A;&#x41B;&#x410;&#x414; &#x414;&#x406;&#x404; &#x417; 09.11.2026</div><div class="column weekend"><table></table></div></html>`;
  const fragment = extractZtFragment(page);
  assert.ok(!fragment.includes('svg') && !fragment.includes('data-cf-modified') && !fragment.includes('__cfRLUnblockHandlers'));
  assert.deepEqual(parseZtDirection(fragment, 7), {
    dirId: 7,
    reverseId: 8,
    number: '7',
    name: 'А - Б',
    stops: [
      { id: 1, name: 'Перша', minutes: 0 },
      { id: 2, name: 'Друга', minutes: 3 },
    ],
    workdays: [{ time: '06:05' }, { time: '23:40', note: 'depot' }],
    weekend: [{ time: '07:10' }],
    validFrom: '2026-11-09',
  });
  assert.throws(() => extractZtFragment('<html></html>'), /немає розкладу/);
  assert.throws(() => parseZtDirection('<div class="number">1</div>', 1), /зупинок/);
});

test('назви зупинок: скорочення, лапки, номер боку дороги, порядок слів; різні місця не плутаються', () => {
  assert.equal(stopKey('р-к "Хмільники" 01'), stopKey('Ринок «Хмільники»'));
  assert.equal(stopKey('м-н Польовий 02'), stopKey('майдан Польовий'));
  assert.equal(stopKey('Дмитрівська (на вимогу)'), stopKey('Вул. Дмитрівська'));
  assert.equal(stopKey('Івана Мазепи 010'), stopKey('вул. Івана Мазепи'));
  assert.ok(sameStopName('Романа Шухевича 01', 'Вул. Романа Шухевича'));
  assert.ok(sameStopName('Корабельна 01', 'вулиця Корабельна (кінцева)'));
  assert.ok(!sameStopName('Каракульна', 'вул. Кармелюка'));
  assert.ok(!sameStopName('Миру', 'проспект Миру') || stopKey('Миру') !== stopKey('проспект Миру'));
});

const tiny: ZhytomyrRoutesFile = {
  source: 'x',
  fetchedAt: '2026-11-17',
  routes: [
    {
      number: '5',
      mode: 'bus',
      name: 'А - Д',
      directions: [
        {
          dirId: 1,
          reverseId: null,
          number: '5',
          name: 'А - Д',
          validFrom: null,
          workdays: [{ time: '06:00' }],
          weekend: [],
          stops: [
            { id: 1, name: 'Перша 01', minutes: 0 },
            { id: 2, name: 'Садова', minutes: 4 },
            { id: 3, name: 'Невідома', minutes: 6 },
            { id: 4, name: 'Четверта', minutes: 8 },
            { id: 5, name: 'Далека', minutes: 12 },
          ],
        },
      ],
    },
  ],
};

test('координати: однозначна назва — з OSM; однойменні — ближча до сусідів; немає — між сусідами; Google — лише де OSM мовчить', () => {
  const osm = [
    { name: 'Перша', lat: 50.25, lng: 28.65 },
    { name: 'Вул. Садова', lat: 50.254, lng: 28.65 },
    { name: 'Вул. Садова', lat: 50.3, lng: 28.75 },
    { name: 'Четверта', lat: 50.262, lng: 28.65 },
    { name: 'на вимогу', lat: 50.1, lng: 28.1 },
  ];
  const got = locateZhytomyrStops(tiny, osm, {}, { [stopKey('Далека')]: [{ lat: 50.27, lng: 28.65 }] });
  const by = new Map(got.stops.map((s) => [s.id, s]));
  assert.equal(by.get(1)?.source, 'osm');
  assert.equal(by.get(2)?.lat, 50.254);
  assert.deepEqual([by.get(3)?.source, by.get(3)?.lat], ['interpolated', 50.258]);
  assert.equal(by.get(5)?.source, 'google');
  assert.deepEqual(got.missing, []);
  // без Google кінцева без назви в OSM лишається без координати — чесно «немає»
  assert.deepEqual(locateZhytomyrStops(tiny, osm).missing, [{ id: 5, name: 'Далека' }]);
  // ручна підказка сильніша за все
  assert.equal(locateZhytomyrStops(tiny, osm, { '2': { lat: 50.2551, lng: 28.6511 } }).stops.find((s) => s.id === 2)?.source, 'hint');
});

const ride = (over: Partial<GoogleRide>): GoogleRide => ({ line: '5', minutes: 8, stops: 3, fromStop: 'Перша', toStop: 'Четверта', fromLat: 50.25, fromLng: 28.65, toLat: 50.262, toLng: 28.65, ...over });

test('звірка з Google: відрізки, допуск, вердикт відрізка й напрямку', () => {
  const osm = [
    { name: 'Перша', lat: 50.25, lng: 28.65 },
    { name: 'Садова', lat: 50.254, lng: 28.65 },
    { name: 'Невідома', lat: 50.258, lng: 28.65 },
    { name: 'Четверта', lat: 50.262, lng: 28.65 },
    { name: 'Далека', lat: 50.27, lng: 28.65 },
  ];
  const stops = locateZhytomyrStops(tiny, osm).stops;
  const spans = checkSpans(tiny, stops);
  assert.deepEqual(spans.filter((s) => s.level === 'thirds').map((s) => s.key), ['1:1:2', '1:2:4', '1:4:5']);
  assert.equal(spans.filter((s) => s.level === 'hop').length, 4);
  assert.ok(minutesAgree(10, 12) && minutesAgree(20, 26) && !minutesAgree(10, 14) && !minutesAgree(12, 4));

  const long = spans.find((s) => s.key === '1:2:4')!;
  assert.deepEqual([long.minutes, long.stops], [4, 2]);
  const ok = spanVerdict(long, [[ride({ minutes: 5, stops: 2, fromLat: 50.254, toLat: 50.262 })]], '2026-11-17');
  assert.equal(ok.verdict, 'match');
  assert.equal(spanVerdict(long, [[ride({ minutes: 11, stops: 2, fromLat: 50.254 })]], 'x').verdict, 'differs');
  // Google посадив за 400+ м від нашої зупинки — це вже інший відрізок
  assert.equal(spanVerdict(long, [[ride({ minutes: 4, stops: 2, fromLat: 50.25 })]], 'x').verdict, 'differs');
  const other = spanVerdict(long, [[ride({ line: '12' })], [ride({ line: '3А' })]], 'x');
  assert.deepEqual([other.verdict, other.otherLines], ['unknown', ['12', '3А']]);
  // «18*» на сайті — це «18» у Google
  assert.equal(spanVerdict({ ...long, number: '5*' }, [[ride({ minutes: 4, stops: 2, fromLat: 50.254 })]], 'x').verdict, 'match');

  const all = Object.fromEntries(spans.filter((s) => s.level === 'thirds').map((s) => [s.key, ok]));
  assert.equal(directionChecks(tiny, spans, all)[0].status, 'checked');
  assert.equal(directionChecks(tiny, spans, { ...all, '1:4:5': other })[0].status, 'differs');
  assert.equal(directionChecks(tiny, spans, {})[0].status, 'pending');
  assert.equal(directionChecks(tiny, spans, Object.fromEntries(Object.keys(all).map((k) => [k, other])))[0].status, 'unknown');
});

test('відповідь Google Routes → поїздки: лінія, хвилини, зупинки з координатами; пішки відкидається', () => {
  const body = {
    routes: [
      {
        legs: [
          {
            steps: [
              { staticDuration: '120s' },
              { staticDuration: '540s', transitDetails: { stopCount: 6, transitLine: { nameShort: '58' }, stopDetails: { departureStop: { name: 'А', location: { latLng: { latitude: 50.1, longitude: 28.1 } } }, arrivalStop: { name: 'Б' } } } },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(googleRides(body), [[{ line: '58', minutes: 9, stops: 6, fromStop: 'А', toStop: 'Б', fromLat: 50.1, fromLng: 28.1, toLat: null, toLng: null }]]);
  assert.deepEqual(googleRides({}), []);
});
