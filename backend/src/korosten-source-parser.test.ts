/**
 * Парсер сторінки розкладу Коростенської ради на закоміченому знімку джерела
 * (data/korosten-transport/source/rada-timetable.html, стан сторінки на 2026-07-13).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  describeRun,
  extractTimetableFragment,
  parseKorostenTimetable,
  splitTermini,
  timetableItems,
  type SourceRoute,
} from './korosten-source-parser';

const SOURCE_DIR = path.resolve(__dirname, '../../data/korosten-transport/source');
const fixture = fs.readFileSync(path.join(SOURCE_DIR, 'rada-timetable.html'), 'utf8');
const timetable = parseKorostenTimetable(fixture);
const route = (number: string): SourceRoute => {
  const found = timetable.routes.find((r) => r.number === number);
  assert.ok(found, `route ${number}`);
  return found;
};
const run = (r: SourceRoute, block: number, departure: string) => {
  const found = r.runs.find((x) => x.block === block && x.departure === departure);
  assert.ok(found, `№${r.number} block ${block} ${departure}`);
  return found;
};

test('splitTermini: тире й дефіси всіх видів, дефіс у назві, проміжні пункти, примітка в дужках', () => {
  assert.deepEqual(splitTermini('Залізничний вокзал- Поліське водосховище').stops, ['Залізничний вокзал', 'Поліське водосховище']);
  assert.deepEqual(splitTermini('Поліське водосховище -Залізничний вокзал').stops, ['Поліське водосховище', 'Залізничний вокзал']);
  assert.deepEqual(splitTermini('Романа Шухевича–Залізничний вокзал').stops, ['Романа Шухевича', 'Залізничний вокзал']);
  assert.deepEqual(splitTermini('Залізничний вокзал-Романа Шухевича').stops, ['Залізничний вокзал', 'Романа Шухевича']);
  assert.deepEqual(splitTermini('Коростень-Грозине – Київська').stops, ['Коростень-Грозине', 'Київська']);
  assert.deepEqual(splitTermini('Сади- Бровар – Романа Шухевича').stops, ['Сади', 'Бровар', 'Романа Шухевича']);
  assert.deepEqual(splitTermini('Цегельний завод – с танція Житомирська').stops, ['Цегельний завод', 'Станція Житомирська']);
  assert.deepEqual(splitTermini('Романа Шухевича –Залізничний вокзал (через вул.Франка крім суботи та неділі)'), {
    stops: ['Романа Шухевича', 'Залізничний вокзал'],
    note: 'через вул.Франка крім суботи та неділі',
  });
});

test('усі дев\'ять маршрутів з номерами, назвами, кількістю графіків і рейсів', () => {
  assert.equal(timetable.modified, '2026-07-13T10:44:39+00:00');
  assert.deepEqual(
    timetable.routes.map((r) => [r.number, r.blocks, r.runs.length]),
    [['1', 2, 44], ['2', 2, 48], ['2-Б', 1, 3], ['3', 2, 36], ['4', 2, 67], ['5', 1, 28], ['6', 2, 46], ['7', 1, 38], ['8', 1, 22]],
  );
  assert.equal(route('1').title, 'Залізничний вокзал – Поліське водосховище');
  for (const r of timetable.routes) {
    for (const x of r.runs) {
      assert.match(x.departure, /^\d\d:\d\d$/);
      assert.ok(x.arrival > x.departure, `№${r.number} ${x.departure}–${x.arrival}`);
      assert.ok(x.from && x.to && x.from !== x.to);
    }
  }
});

test('кінцеві без описок і дублів написання', () => {
  const names = new Set(timetable.routes.flatMap((r) => r.runs.flatMap((x) => [x.from, x.to, ...x.via])));
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b, 'uk')), [
    'Білокоровицьке шосе', 'Бровар', 'Грозине', 'Дачі УТОС', 'Залізничний вокзал', 'Київська', 'Коростень-Грозине',
    'Пашини', 'Поліське водосховище', 'Романа Шухевича', 'Сади', 'Станція Житомирська', 'Цегельний завод', 'Чигирі',
  ]);
});

test('№1: два графіки, перший рейс лише у другого, перерви, зірочка = лише будні', () => {
  const r = route('1');
  assert.equal(r.runs.filter((x) => x.block === 1).length, 24);
  assert.equal(r.runs[0].departure, '06:30');
  const first = run(r, 2, '06:20');
  assert.deepEqual([first.from, first.to, first.arrival, first.days], ['Залізничний вокзал', 'Поліське водосховище', '06:45', 'everyday']);
  assert.deepEqual(r.breaks, [{ block: 2, afterRun: 8 }, { block: 1, afterRun: 12 }]);
  assert.equal(r.starNote, 'Рейси не виконуються в суботу та неділю');
  assert.equal(r.starWeekdaysOnly, true);
  assert.deepEqual(r.runs.filter((x) => x.starred).map((x) => [x.block, x.departure, x.days]), [[2, '16:55', 'weekdays'], [2, '17:25', 'weekdays']]);
});

test('№2: зірочка означає інше («у вихідні скороченим маршрутом») — рейс лишається щоденним', () => {
  const r = route('2');
  assert.equal(r.starWeekdaysOnly, false);
  assert.match(r.starNote ?? '', /скороченим маршрутом/);
  const toShukhevycha = run(r, 2, '16:05');
  assert.deepEqual([toShukhevycha.from, toShukhevycha.to, toShukhevycha.starred, toShukhevycha.days], ['Пашини', 'Романа Шухевича', true, 'everyday']);
});

test('№2-Б і №7: примітка рядком усередині таблиці; №7 — примітка в дужках і перерви без назви рядка', () => {
  assert.equal(route('2-Б').runs.every((x) => x.days === 'weekdays'), true);
  const r = route('7');
  assert.deepEqual(r.runs.filter((x) => x.note).map((x) => x.departure), ['07:35', '08:39']);
  assert.deepEqual(r.breaks, [{ block: 1, afterRun: 14 }, { block: 1, afterRun: 26 }]);
  assert.deepEqual(r.runs.filter((x) => x.starred).map((x) => x.departure), ['20:00', '20:20']);
});

test('№4: рейси з іншими кінцевими й проміжним пунктом; прочерк — рейсу нема', () => {
  const r = route('4');
  const first = run(r, 2, '06:10');
  assert.deepEqual([first.from, first.to], ['Коростень-Грозине', 'Київська']);
  assert.deepEqual(run(r, 2, '11:20').via, ['Грозине']);
  assert.deepEqual([run(r, 2, '18:10').to, run(r, 2, '18:35').from], ['Грозине', 'Грозине']);
  assert.equal(r.runs.filter((x) => x.block === 2 && x.departure > '18:35').length, 0);
});

test('№6: курсив = по вул. Південній, зірочка разом із курсивом', () => {
  const r = route('6');
  assert.equal(r.italicNote, 'виконуються по вул. Південній');
  const italic = r.runs.filter((x) => x.italic);
  assert.equal(italic.length, 11);
  assert.equal(italic.every((x) => x.block === 2 && x.from === 'Станція Житомирська'), true);
  const evening = run(r, 2, '19:00');
  assert.deepEqual([evening.italic, evening.starred, evening.days], [true, true, 'weekdays']);
  assert.equal(run(r, 2, '06:30').from, 'Цегельний завод');
});

test('№8: сезонні гілки як проміжний пункт, рейс до вокзалу перед перервою', () => {
  const r = route('8');
  assert.deepEqual([r.runs[0].from, r.runs[0].via, r.runs[0].to], ['Романа Шухевича', ['Бровар'], 'Сади']);
  assert.equal(run(r, 1, '08:00').to, 'Дачі УТОС');
  assert.equal(run(r, 1, '12:00').to, 'Залізничний вокзал');
  assert.deepEqual(r.breaks, [{ block: 1, afterRun: 11 }]);
});

test('describeRun / timetableItems: рядок рейсу для сповіщення', () => {
  const r = route('6');
  assert.equal(describeRun(run(r, 2, '19:00'), r.blocks), '19:00–19:25 Станція Житомирська → Цегельний завод · графік 2 · курсив *');
  assert.equal(describeRun(route('8').runs[0], 1), '07:00–07:30 Романа Шухевича → Бровар → Сади');
  const items = timetableItems(timetable);
  assert.deepEqual(Object.keys(items), ['№1', '№2', '№2-Б', '№3', '№4', '№5', '№6', '№7', '№8']);
  assert.deepEqual(items['№6'].slice(-2), ['примітка *: Рейси не виконуються в суботу та неділю', 'курсив: виконуються по вул. Південній']);
});

test('timetable.json у репозиторії відповідає знімку сторінки; фрагмент фрагмента — той самий розклад', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'timetable.json'), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(timetable)));
  assert.deepEqual(parseKorostenTimetable(extractTimetableFragment(fixture)), timetable);
});

test('сторінка без таблиць розкладу — помилка', () => {
  assert.throws(() => parseKorostenTimetable('<html><body>Перевірка браузера…</body></html>'), /немає таблиць/);
  assert.throws(() => extractTimetableFragment('<p>нічого</p>'), /немає таблиць/);
});
