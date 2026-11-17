/**
 * Табло АС Житомир-1 на живій фікстурі від 17.11.2026 (обрізана сторінка): рейси через Малин, ціни, перевізники,
 * дедуплікація днів, опис змін і звірка з рядками Schedule. Мережі нема.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  boardItems,
  compareBoardWithSchedules,
  describeBoardChanges,
  describeBoardTrip,
  describeBoardVsSchedules,
  formatBoardPrice,
  normalizeCarrier,
  parseBoardPrice,
  parseZhytomyrBoard,
  titleCase,
} from './zhytomyr-board-parser';

const FIXTURE = fs.readFileSync(path.resolve(__dirname, '__fixtures__/zhytomyr-tablo-2026-11-17.html'), 'utf8');

test('titleCase / normalizeCarrier / ціна: капс табло і латинські I/M зводяться до одного написання', () => {
  assert.equal(titleCase('ЖИТОМИР'), 'Житомир');
  assert.equal(titleCase('НОВОГРАД-ВОЛИНСЬКИЙ'), 'Новоград-Волинський');
  assert.equal(normalizeCarrier('ПП &quot;РIМ-Богдан&quot;'), normalizeCarrier('ПП "РІМ-БОГДАН"'));
  assert.equal(normalizeCarrier('ПП &quot;РIM-Богдан&quot;'), 'ПП "РІМ-БОГДАН"');
  assert.equal(parseBoardPrice('\n  334,80\n'), 334.8);
  assert.equal(parseBoardPrice('420,00'), 420);
  assert.equal(parseBoardPrice(''), null);
  assert.equal(formatBoardPrice(334.8), '334,80');
  assert.equal(formatBoardPrice(null), 'без ціни');
});

test('parseZhytomyrBoard: усі рейси через Малин за день — 17, у тому порядку, що на табло; дата з заголовка', () => {
  const board = parseZhytomyrBoard(FIXTURE, 'Малин');
  assert.equal(board.date, '17 листопада 2026 р. (Вівторок)');
  assert.equal(board.trips.length, 17);
  assert.deepEqual(board.trips[0], {
    time: '06:20',
    from: 'Житомир',
    to: 'Малин',
    arrival: '08:30',
    priceUah: 334.8,
    carrier: 'ПП "РІМ-БОГДАН"',
    bus: 'ФОЛЬКСВАГЕН18',
    status: 'В продажі',
    seats: 18,
  });
  const toMalyn = board.trips.filter((t) => t.to === 'Малин');
  assert.equal(toMalyn.length, 15);
  assert.deepEqual(
    toMalyn.filter((t) => t.from !== 'Житомир').map((t) => `${t.time} ${t.from} ${t.priceUah}`),
    ['14:05 Станишівка 329.4', '14:40 Хмільник 299', '16:30 Вінниця 339.3'],
  );
  assert.deepEqual(
    board.trips.filter((t) => t.from === 'Малин').map((t) => `${t.time} → ${t.to} ${t.priceUah}`),
    ['07:40 → Хмільник 357.2', '08:35 → Вінниця 420'],
  );
  // Два написання одного перевізника на табло — одне в нас
  assert.deepEqual([...new Set(board.trips.map((t) => t.carrier))].sort(), ['ПП "РІМ-БОГДАН"', 'ТОВ "БМУ "МАЛИНСПЕЦБУД N3"']);
  // Модель «БАЗ-29 ( )» — без порожніх дужок
  assert.equal(board.trips.find((t) => t.time === '18:30')?.bus, 'БАЗ-29');
  // Без фільтра — ще й чужі рейси (у фікстурі лишено два)
  assert.equal(parseZhytomyrBoard(FIXTURE).trips.length, 19);
});

test('parseZhytomyrBoard: той самий рейс під датою «завтра» рахується один раз; сторінка без табло — помилка', () => {
  const row = FIXTURE.match(/<tr class="even_row">[\s\S]*?06:20[\s\S]*?<\/tr>/)?.[0];
  assert.ok(row);
  const doubled = FIXTURE.replace('</table>', `${row.replace('17 Лис', '18 Лис')}\n</table>`);
  assert.equal(parseZhytomyrBoard(doubled, 'Малин').trips.length, 17);
  assert.throws(() => parseZhytomyrBoard('<html><body>Перевірка браузера…</body></html>'), /немає таблиці табло/);
});

test('boardItems / describeBoardChanges: частина на напрямок; зміна ціни, новий і зниклий рейс — по одному рядку', () => {
  const trips = parseZhytomyrBoard(FIXTURE, 'Малин').trips;
  const items = boardItems(trips);
  assert.deepEqual(Object.keys(items), ['Житомир → Малин', 'Малин → Хмільник', 'Малин → Вінниця', 'Станишівка → Малин', 'Хмільник → Малин', 'Вінниця → Малин']);
  assert.equal(items['Житомир → Малин'].length, 12);
  assert.equal(describeBoardTrip(trips[0]), '06:20 · 334,80 грн · ПП "РІМ-БОГДАН"');

  const next = boardItems(
    trips
      .filter((t) => t.time !== '11:15')
      .map((t) => (t.time === '08:25' ? { ...t, priceUah: 349.5 } : t))
      .concat([{ ...trips[0], time: '05:30', priceUah: 334.8 }]),
  );
  assert.deepEqual(describeBoardChanges(items, next), [
    'новий рейс 05:30 Житомир → Малин: 334,80 грн (ПП "РІМ-БОГДАН")',
    '08:25 Житомир → Малин: 339,30 → 349,50 грн (ПП "РІМ-БОГДАН")',
    'зник рейс 11:15 Житомир → Малин (був 329,40 грн)',
  ]);
  assert.deepEqual(describeBoardChanges(items, items), []);
  assert.deepEqual(describeBoardChanges(undefined, items), []);
  // Змінився лише перевізник
  const carrier = boardItems(trips.map((t) => (t.time === '06:20' ? { ...t, carrier: 'ТОВ "НОВИЙ"' } : t)));
  assert.deepEqual(describeBoardChanges(items, carrier), ['06:20 Житомир → Малин: перевізник ПП "РІМ-БОГДАН" → ТОВ "НОВИЙ"']);
});

test('compareBoardWithSchedules: округлена ціна табло проти Schedule; «нема в базі», «у базі є, на табло нема»; Малин → … не звіряється', () => {
  const trips = parseZhytomyrBoard(FIXTURE, 'Малин').trips;
  const schedules = [
    { id: 78, departureTime: '06:20', priceUah: 335 },
    { id: 79, departureTime: '08:25', priceUah: 299 },
    { id: 86, departureTime: '14:05', priceUah: 329 },
    { id: 87, departureTime: '14:40', priceUah: null },
    { id: 99, departureTime: '23:30', priceUah: 300 },
  ];
  const rows = compareBoardWithSchedules(trips, schedules);
  assert.equal(rows.length, 16); // 15 рейсів до Малина + 1 лише в базі
  const by = (time: string) => rows.find((r) => r.time === time);
  assert.equal(by('06:20')?.verdict, 'same');
  assert.equal(by('08:25')?.verdict, 'differs');
  assert.equal(by('07:00')?.verdict, 'missing');
  assert.equal(by('14:05')?.verdict, 'same');
  assert.equal(by('14:40')?.verdict, 'no-db-price');
  assert.deepEqual(by('23:30'), { time: '23:30', from: null, to: 'Малин', arrival: null, boardPriceUah: null, carrier: null, dbPriceUah: 300, scheduleId: 99, verdict: 'only-db' });
  assert.ok(!rows.some((r) => r.time === '07:40'));
  const lines = describeBoardVsSchedules(rows);
  assert.ok(lines.includes('07:00 Житомир → Малин: нема в базі (табло 334,80 грн)'));
  assert.ok(lines.includes('08:25 Житомир → Малин: табло 339,30, у базі 299 грн'));
  assert.ok(lines.includes('14:40 Хмільник → Малин: у базі ціни нема (табло 299,00 грн)'));
  assert.ok(lines.includes('23:30 → Малин: є в базі (300 грн), на табло нема'));
  assert.ok(!lines.some((l) => l.startsWith('06:20')));
});
