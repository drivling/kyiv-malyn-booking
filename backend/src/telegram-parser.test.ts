/**
 * Парсер повідомлень із Telegram-груп попуток. Формат: "Ім'я: текст" / "Ім'я|@user: текст".
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  extractMessageBodyTelegram,
  extractSenderNameTelegram,
  extractTelegramUsername,
  parseTelegramMessage,
  parseTelegramMessages,
} from './telegram-parser';
import { formatSenderLine } from './telegram-dzhura-source';

test('parseTelegramMessage: Житомир→Київ з групи poputka_zhytomyr_kyiv', () => {
  const p = parseTelegramMessage('Олег|@oleg_zt: Водій Житомир Київ 02.09 08:00, 1 місце 250 грн 0671112233');
  assert(p);
  assert.equal(p.route, 'Zhytomyr-Kyiv');
  assert.equal(p.listingType, 'driver');
  assert.equal(p.departureTime, '08:00');
  assert.equal(p.phone, '0671112233');
  assert.equal(p.senderName, 'Олег');
});

test('parseTelegramMessage: Київ→Житомир', () => {
  const p = parseTelegramMessage('Ірина: Шукаю водія Київ - Житомир завтра зранку, 2 місця 0509998877');
  assert(p);
  assert.equal(p.route, 'Kyiv-Zhytomyr');
  assert.equal(p.listingType, 'passenger');
});

test('parseTelegramMessages: кілька рядків, розділені ---', () => {
  const raw = [
    'A: Водій Житомир Київ 03.09 07:30 0501111111',
    '---',
    'B: Малин Київ 03.09 09:00 0502222222',
    '---',
  ].join('\n');
  const list = parseTelegramMessages(raw);
  assert.equal(list.length, 2);
  assert.equal(list[0].parsed.route, 'Zhytomyr-Kyiv');
  assert.equal(list[1].parsed.route, 'Malyn-Kyiv');
});

// Оголошення #10430: ім'я "Дима ." (крапка) губило @username, ім'я й Person
test('parseTelegramMessages: ім\'я з крапкою — @username, ім\'я й t.me не губляться', () => {
  const raw = 'Дима .|@dmytrov04: Потрібно місце Житомир-Київ о 19 годині сьогодні\n---\n';
  const [item] = parseTelegramMessages(raw);
  assert(item);
  assert.equal(item.telegramUsername, '@dmytrov04');
  assert.equal(item.parsed.senderName, 'Дима');
  assert.equal(item.parsed.route, 'Zhytomyr-Kyiv');
  assert.equal(item.parsed.departureTime, '19:00');
  assert.equal(item.parsed.phone, '');
  assert.match(item.parsed.notes ?? '', /https:\/\/t\.me\/dmytrov04/);
  assert.doesNotMatch(item.rawMessage, /---/);
});

test('префікс "Ім\'я|@user:" — будь-які символи в імені', () => {
  const cases: Array<[string, string | null]> = [
    ['Олена (Київ)', 'Олена (Київ)'],
    ['Max 🚗', 'Max 🚗'],
    ['Іван 2', 'Іван 2'],
    ['О’Коннор', 'О’Коннор'],
    ['Таня: Малин', 'Таня: Малин'],
    ['🔥🔥', null], // жодної літери — ім'я не показуємо, @username лишається
    ['.', null],
  ];
  for (const [display, expectedName] of cases) {
    const raw = `${display}|@user_name1: Водій Житомир Київ 02.09 08:00 0671112233`;
    assert.equal(extractTelegramUsername(raw), '@user_name1', display);
    assert.equal(extractSenderNameTelegram(raw), expectedName, display);
    assert.equal(extractMessageBodyTelegram(raw), 'Водій Житомир Київ 02.09 08:00 0671112233', display);
  }
});

test('рядок із Джури: formatSenderLine → parseTelegramMessages без втрат', () => {
  const line = formatSenderLine(
    { firstName: 'Дима', lastName: '.', username: 'dmytrov04' },
    'Потрібно місце Житомир-Київ о 19 годині сьогодні',
  );
  const [item] = parseTelegramMessages(`${line}\n---\n`);
  assert.equal(item.telegramUsername, '@dmytrov04');
  assert.equal(item.parsed.route, 'Zhytomyr-Kyiv');
});

test('formatSenderLine: "|" і переноси в імені не ламають протокол, довге ім\'я обрізається', () => {
  const line = formatSenderLine({ firstName: 'A|B\nC', lastName: 'x'.repeat(200), username: 'user_x1' }, 'Київ Малин 15:00');
  assert.equal(line.split('\n').length, 1);
  assert.equal((line.match(/\|/g) ?? []).length, 1);
  assert.equal(extractTelegramUsername(line), '@user_x1');
});

test('без імені й username — "Невідомий"; без username парсер усе ще бере "Ім\'я: текст"', () => {
  assert.equal(formatSenderLine(null, 'тест'), 'Невідомий: тест');
  assert.equal(extractSenderNameTelegram('Олег Іванович: Київ Малин 15:00'), 'Олег Іванович');
  // час у тілі не вважається іменем
  assert.equal(extractSenderNameTelegram('Київ-Малин 15:00 їду'), null);
});

test('останнє повідомлення партії без хвостового ---', () => {
  const [a] = parseTelegramMessages('Олег: Малин Київ 03.09 09:00 0502222222\n---\n');
  assert.doesNotMatch(a.rawMessage, /---/);
});
