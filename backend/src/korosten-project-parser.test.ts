/**
 * Проєкт власника 2025 року для Коростеня (data/korosten-transport/project-2025/html): парсер напрямків,
 * словник назв зупинок і звірка з розкладом ради; закомічені chains.json, stop-aliases.json і REPORT.md
 * мусять відповідати джерелам.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildKorostenProjectFiles, loadKorostenProject } from './korosten-project-files';
import { runsOfDirection } from './korosten-project-report';
import { buildStopAliases, stopNameKeys, type OfficialStop } from './korosten-stop-aliases';

const ROOT = path.resolve(__dirname, '../../data/korosten-transport');
const { directions, timetable, aliases } = loadKorostenProject(ROOT);
const dir = (code: string) => {
  const found = directions.find((d) => d.code === code);
  assert.ok(found, code);
  return found;
};

test('16 напрямків маршрутів №1–8: зупинки, хвилини, відправлення, дата', () => {
  assert.deepEqual(
    directions.map((d) => [d.code, d.stops.length, d.stops[d.stops.length - 1].minute, d.departures.weekdays.length, d.departures.weekends.length]),
    [
      ['11', 15, 30, 22, 21], ['12', 15, 30, 22, 21], ['21', 13, 18, 24, 24], ['22', 14, 17, 24, 24],
      ['31', 23, 32, 17, 15], ['32', 22, 31, 19, 15], ['41', 10, 18, 33, 33], ['42', 8, 16, 34, 34],
      ['51', 13, 24, 14, 13], ['52', 13, 24, 14, 13], ['61', 16, 25, 23, 20], ['62', 16, 25, 23, 20],
      ['71', 8, 16, 19, 18], ['72', 8, 16, 19, 18], ['81', 10, 28, 11, 11], ['82', 10, 27, 10, 10],
    ],
  );
  for (const d of directions) {
    assert.equal(d.asOf, '2025-07-25');
    assert.equal(d.stops[0].minute, 0);
    d.stops.forEach((s, i) => assert.ok(i === 0 || s.minute > d.stops[i - 1].minute, `${d.code} ${s.name}`));
    const times = d.departures.weekdays.map((x) => x.time);
    assert.deepEqual(times, [...times].sort(), d.code);
  }
});

test('№6 від ст. Житомирської: ланцюжок із хвилинами, «на вимогу», рейси «Н» по Південній, вихідні без вечірніх', () => {
  const d = dir('61');
  assert.deepEqual([d.route, d.direction, d.from], ['6', 1, 'Станція Житомирська']);
  assert.deepEqual(d.stops.slice(0, 4), [
    { name: 'Станція Житомирська', onDemand: false, minute: 0 },
    { name: 'Міське кладовище', onDemand: false, minute: 2 },
    { name: 'Завод "ЗБШ"', onDemand: false, minute: 4 },
    { name: 'Вул. Маяковського', onDemand: true, minute: 6 },
  ]);
  assert.deepEqual(d.notes, [{ mark: 'Н', text: 'Маршрут виконується по вул.Південна' }]);
  assert.equal(d.departures.weekdays.filter((x) => x.mark === 'Н').length, 11);
  assert.deepEqual(d.departures.weekdays.slice(0, 3), [{ time: '06:30', mark: null }, { time: '07:00', mark: 'Н' }, { time: '07:30', mark: null }]);
  const weekend = d.departures.weekends.map((x) => x.time);
  assert.equal(weekend.includes('17:00'), false);
  assert.equal(weekend.includes('17:30'), true);
});

test('позначки без літери: сіре тло (№4 через Грозине), підкреслення (№7 через Франка), зірочка', () => {
  assert.deepEqual(dir('41').departures.weekdays.filter((x) => x.mark).map((x) => [x.time, x.mark]), [['06:10', 'depot'], ['11:20', 'depot']]);
  assert.deepEqual(dir('72').departures.weekdays.filter((x) => x.mark).map((x) => [x.time, x.mark]), [['07:35', 'und'], ['08:39', 'und']]);
  assert.deepEqual(dir('72').notes, [{ mark: 'und', text: 'Маршрут виконується через вул.Франка крім суботи та неділі' }]);
  assert.deepEqual(dir('81').departures.weekdays.filter((x) => x.mark).map((x) => [x.time, x.mark]), [['12:00', '*']]);
});

test('stopNameKeys / buildStopAliases: нормалізація, дужки, неоднозначність, підказки', () => {
  assert.deepEqual(stopNameKeys('Магазин 44'), stopNameKeys('44-магазин'));
  assert.ok(stopNameKeys('Зупинка на вимогу «Вул. Бандери Степана (Маяковського)»').includes(stopNameKeys('вул. Маяковського')[0]));
  const official: OfficialStop[] = [
    { uid: 'z-1', label: 'Завод «Хіммаш»', street: '' },
    { uid: 'z-2', label: 'Магазин', street: 'а' },
    { uid: 'z-3', label: 'Магазин', street: 'б' },
  ];
  const names = [
    { name: 'Завод "Хіммаш"', source: 'a' },
    { name: 'Магазин', source: 'a' },
    { name: 'Дачі', source: 'b' },
    { name: 'Невідома', source: 'b' },
  ];
  const plain = buildStopAliases(names, official);
  assert.equal(plain.stops['Завод "Хіммаш"'].uid, 'z-1');
  assert.deepEqual(plain.unresolved.map((u) => [u.name, u.candidates]), [['Дачі', []], ['Магазин', ['z-2', 'z-3']], ['Невідома', []]]);
  const hinted = buildStopAliases(names, official, { Магазин: { uid: 'z-3' }, Дачі: { uid: null } });
  assert.deepEqual([hinted.stops['Магазин'].uid, hinted.stops['Магазин'].how, hinted.stops['Магазин'].confirm], ['z-3', 'hint', true]);
  assert.deepEqual(hinted.newStops, [{ name: 'Дачі', tempId: 'z-101', sources: ['b'] }]);
  assert.deepEqual(hinted.unusedOfficial, ['z-2']);
  assert.throws(() => buildStopAliases(names, official, { Магазин: { uid: 'z-9' } }), /unknown uid/);
});

test('словник на реальних даних: кожна назва з проєкту й розкладу ради розв’язана', () => {
  assert.deepEqual(aliases.unresolved, []);
  assert.deepEqual(aliases.newStops.map((s) => s.name), ['Грозине', 'Дачі УТОС', 'Коростень-Грозине', 'Міськвиконком', 'Сади']);
  assert.equal(aliases.stops['Міське кладовище'].uid, 'z-050');
  assert.equal(aliases.stops['Романа Шухевича'].uid, 'z-069');
  assert.equal(aliases.stops['44-магазин'].uid, aliases.stops['Магазин №44'].uid);
  // Два напрямки одного маршруту — дзеркальні набори зупинок (крім «Міськвиконком», де зупиняються в один бік)
  const uids = (code: string) => new Set(dir(code).stops.map((s) => aliases.stops[s.name]?.uid).filter(Boolean));
  for (const route of ['1', '5', '6', '7']) assert.deepEqual([...uids(`${route}1`)].sort(), [...uids(`${route}2`)].sort(), route);
});

test('звірка з розкладом ради: будні відправлення проєкту збігаються, розбіжності — лише рейси з позначками', () => {
  for (const d of directions) {
    const route = timetable.routes.find((r) => r.number === d.route);
    assert.ok(route);
    const rada = new Set(runsOfDirection(d, route.runs, aliases).map((m) => m.run.departure));
    const project = new Set(d.departures.weekdays.map((x) => x.time));
    // №8 о 13:15 після перерви стартує від вокзалу, а не від початку ланцюжка — у таблиці проєкту його нема
    const known = d.code === '81' ? ['13:15'] : [];
    assert.deepEqual([...rada].filter((t) => !project.has(t)), known, `${d.code}: лише в раді`);
  }
  const only = (code: string) => {
    const d = dir(code);
    const route = timetable.routes.find((r) => r.number === d.route);
    const rada = new Set(runsOfDirection(d, route?.runs ?? [], aliases).map((m) => m.run.departure));
    return d.departures.weekdays.filter((x) => !rada.has(x.time)).map((x) => x.time);
  };
  for (const code of ['11', '12', '31', '32', '51', '52', '61', '62', '71', '72']) assert.deepEqual(only(code), [], code);
  assert.deepEqual(only('21'), ['16:40', '17:25']);
  assert.deepEqual(only('41'), ['06:10', '18:10']);
});

test('chains.json, stop-aliases.json і REPORT.md у репозиторії відповідають джерелам', () => {
  for (const [file, content] of Object.entries(buildKorostenProjectFiles(ROOT))) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), content, `${file}: запустіть npm run korosten:snapshot -- --project`);
  }
});
