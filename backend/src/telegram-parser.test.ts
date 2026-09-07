/**
 * Парсер повідомлень із Telegram-груп попуток. Формат: "Ім'я: текст" / "Ім'я|@user: текст".
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseTelegramMessage, parseTelegramMessages } from './telegram-parser';

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
