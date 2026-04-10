import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  extractPhone,
  extractDate,
  extractTime,
  extractSeats,
  extractPrice,
  extractRoute,
  extractListingType,
  extractSenderName,
  extractMessageDate,
  extractMessageBody,
  parseViberMessage,
  parseViberMessages,
} from './viber-parser';

/** Локальна дата без зсуву UTC */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function silenceWarn(fn: () => void): void {
  const w = console.warn;
  console.warn = () => {};
  try {
    fn();
  } finally {
    console.warn = w;
  }
}

test('normalizePhoneNumber', () => {
  assert.equal(normalizePhoneNumber('+380 (50) 123-45 67'), '+380501234567');
  assert.equal(normalizePhoneNumber('050 111 22 33'), '0501112233');
});

test('extractPhone', () => {
  const cases: { input: string; expected: string | null }[] = [
    { input: '+380 (68) 721 14 77', expected: '+380687211477' },
    { input: '+380-50-123-45-67', expected: '+380501234567' },
    { input: '+380 50-123 45-67', expected: '+380501234567' },
    { input: '050-123-45-67', expected: '0501234567' },
    { input: '050 123 45 67', expected: '0501234567' },
    { input: '0501234567', expected: '0501234567' },
    { input: '+380501234567', expected: '+380501234567' },
    { input: 'тел: 050-111-22-33', expected: '0501112233' },
    { input: '10.04.2026 лише дата', expected: null },
  ];
  for (const { input, expected } of cases) {
    assert.equal(extractPhone(input), expected, input);
  }
});

test('extractDate: DD.MM та рік', () => {
  const ref = new Date(2026, 3, 1);
  assert.equal(ymd(extractDate('їдемо 10.04.2026', ref)), '2026-04-10');
  assert.equal(ymd(extractDate('09.02', ref)), '2026-02-09');
  assert.equal(ymd(extractDate('1.3.26', ref)), '2026-03-01');
});

test('extractDate: DD.MM крапка в кінці має пріоритет над завтра', () => {
  const ref = new Date(2026, 1, 9);
  assert.equal(ymd(extractDate('Завтра 23.02.', ref)), '2026-02-23');
});

test('extractDate: назва місяця', () => {
  const ref = new Date(2026, 0, 1);
  assert.equal(ymd(extractDate('18 лютого', ref)), '2026-02-18');
  assert.equal(ymd(extractDate('5 квітня 2027', ref)), '2027-04-05');
});

test('extractDate: сьогодні та завтра', () => {
  const ref = new Date(2026, 5, 15);
  assert.equal(ymd(extractDate('Київ-Малин сьогодні', ref)), '2026-06-15');
  assert.equal(ymd(extractDate('завтра о 9:00', ref)), '2026-06-16');
});

test('extractDate: за замовчуванням сьогодні (ref)', () => {
  const ref = new Date(2026, 7, 20);
  assert.equal(ymd(extractDate('без дати', ref)), '2026-08-20');
});

test('extractTime: HH:MM та діапазон', () => {
  assert.equal(extractTime('виїзд 18:00'), '18:00');
  assert.equal(extractTime('16:00 зупинка'), '16:00');
  assert.equal(extractTime('8:05 - 9:30'), '08:05-09:30');
});

test('extractTime: крапка після в/о/виїзд', () => {
  assert.equal(extractTime('в 8.40'), '08:40');
  assert.equal(extractTime('о 7.15 кінець'), '07:15');
  assert.equal(extractTime('виїзд 9.00-10.30'), '09:00-10:30');
});

test('extractTime: діапазон з крапкою без префікса', () => {
  assert.equal(extractTime('5.10-5.20'), '05:10-05:20');
});

test('extractTime: дефіс замість двокрапки після в/о/виїзд', () => {
  assert.equal(extractTime('виїзд 20-45'), '20:45');
  assert.equal(extractTime('о 9-15'), '09:15');
});

test('extractTime: невалідний / відсутній', () => {
  assert.equal(extractTime('в 27.02'), null);
  assert.equal(extractTime('лише текст'), null);
});

test('extractSeats', () => {
  assert.equal(extractSeats('2 пасажири'), 2);
  assert.equal(extractSeats('3 особи'), 3);
  assert.equal(extractSeats('4 місця вільні'), 4);
  assert.equal(extractSeats('є місця'), null);
});

test('extractPrice', () => {
  assert.equal(extractPrice('250 грн'), 250);
  assert.equal(extractPrice('150грн.'), 150);
  assert.equal(extractPrice('ціна 200 грн'), 200);
  assert.equal(extractPrice('99 UAH'), 99);
  assert.equal(extractPrice('9 грн'), null);
  assert.equal(extractPrice('без ціни'), null);
});

test('extractRoute', () => {
  assert.equal(extractRoute('Київ Малин'), 'Kyiv-Malyn');
  assert.equal(extractRoute('києва до малину'), 'Kyiv-Malyn');
  assert.equal(extractRoute('академ малин'), 'Kyiv-Malyn');
  assert.equal(extractRoute('киев малин'), 'Kyiv-Malyn');
  assert.equal(extractRoute('Малин Київ'), 'Malyn-Kyiv');
  assert.equal(extractRoute('малин до києва'), 'Malyn-Kyiv');
  assert.equal(extractRoute('Малин Житомир'), 'Malyn-Zhytomyr');
  assert.equal(extractRoute('Житомир Малин'), 'Zhytomyr-Malyn');
  assert.equal(extractRoute('Коростень Малин'), 'Korosten-Malyn');
  assert.equal(extractRoute('коростеня малин'), 'Korosten-Malyn');
  assert.equal(extractRoute('Малин Коростень'), 'Malyn-Korosten');
  assert.equal(extractRoute('Львів Одеса'), 'Unknown');
});

test('extractListingType', () => {
  assert.equal(extractListingType('Водій завтра'), 'driver');
  assert.equal(extractListingType('пасажир шукає'), 'passenger');
  assert.equal(extractListingType('Київ-Малин'), 'driver');
  assert.equal(extractListingType('водій і пасажир'), 'driver');
});

test('extractSenderName', () => {
  const header = '[ 9 лютого 2026 р. 12:55 ] ⁨Іван⁩: текст';
  assert.equal(extractSenderName(header), 'Іван');
  assert.equal(extractSenderName('без заголовка'), null);
});

test('extractMessageDate', () => {
  const header = '[ 10 квітня 2026 р. 08:00 ] ⁨X⁩:';
  const d = extractMessageDate(header);
  assert(d);
  assert.equal(ymd(d), '2026-04-10');
  assert.equal(extractMessageDate('немає шапки'), null);
  assert.equal(extractMessageDate('[ 1 февраля 2026 р. 10:00 ] ⁨X⁩:'), null);
});

test('extractMessageBody: багаторядковий текст', () => {
  const raw = `[ 1 січня 2026 р. 10:00 ] ⁨A⁩: рядок1
рядок2
тел 0501234567`;
  assert.equal(
    extractMessageBody(raw),
    `рядок1
рядок2
тел 0501234567`
  );
});

test('extractMessageBody: без Viber-шапки', () => {
  assert.equal(extractMessageBody('  просто текст  '), 'просто текст');
});

test('parseViberMessage: повний успішний розбір', () => {
  const raw = `[ 10 квітня 2026 р. 12:00 ] ⁨Tatiana⁩: Водій 10.04.2026.
Київ(Академ)-Малин 250 грн.
16:00
Двоє позаду
+380 (68) 721 14 77`;
  const p = parseViberMessage(raw);
  assert(p);
  assert.equal(p.senderName, 'Tatiana');
  assert.equal(p.listingType, 'driver');
  assert.equal(p.route, 'Kyiv-Malyn');
  assert.equal(ymd(p.date), '2026-04-10');
  assert.equal(p.departureTime, '16:00');
  assert.equal(p.price, 250);
  assert.equal(p.seats, null);
  assert.equal(p.phone, '+380687211477');
});

test('parseViberMessage: місця та примітки', () => {
  // notesPatterns використовують \\w+ — латиниця; кирилицю після «біля» не ловить (регресія, якщо зміните regex)
  const raw = `[ 1 лютого 2026 р. 10:00 ] ⁨X⁩: Пасажир Малин-Київ 05.02 о 18:00 3 пасажири 200 грн біля Akadem є місця 0501112233`;
  const p = parseViberMessage(raw);
  assert(p);
  assert.equal(p.listingType, 'passenger');
  assert.equal(p.route, 'Malyn-Kyiv');
  assert.equal(p.seats, 3);
  assert(p.notes?.includes('біля Akadem'));
  assert(p.notes?.includes('є місця'));
});

test('parseViberMessage: без телефону — phone порожній рядок', () => {
  silenceWarn(() => {
    const raw = `[ 1 лютого 2026 р. 10:00 ] ⁨X⁩: Водій Київ-Малин 10.02 18:00`;
    const p = parseViberMessage(raw);
    assert(p);
    assert.equal(p.phone, '');
  });
});

test('parseViberMessage: невідомий маршрут — null', () => {
  silenceWarn(() => {
    const raw = `[ 1 лютого 2026 р. 10:00 ] ⁨X⁩: Водій 10.02 Львів 0501234567`;
    assert.equal(parseViberMessage(raw), null);
  });
});

test('parseViberMessages: кілька повідомлень та skip коротких', () => {
  const block = `
[ 1 лютого 2026 р. 10:00 ] ⁨A⁩: Київ-Малин 02.02 0501111111
[ 2 лютого 2026 р. 10:00 ] ⁨B⁩: Малин-Київ 03.02 0502222222
`.trim();
  const out = parseViberMessages(block);
  assert.equal(out.length, 2);
  assert.equal(out[0].parsed.phone, '0501111111');
  assert.equal(out[1].parsed.route, 'Malyn-Kyiv');
  assert.equal(parseViberMessages('[short]').length, 0);
});

test('parseViberMessages: невалідне оголошення пропускається', () => {
  silenceWarn(() => {
    const block = `
[ 1 лютого 2026 р. 10:00 ] ⁨A⁩: Київ-Малин 02.02 0501111111
[ 2 лютого 2026 р. 10:00 ] ⁨B⁩: Водій Львів 0502222222
`.trim();
    const out = parseViberMessages(block);
    assert.equal(out.length, 1);
    assert.equal(out[0].parsed.phone, '0501111111');
  });
});

test('parseViberMessage: примітка «від м …» (латиниця після м)', () => {
  const raw = `[ 1 лютого 2026 р. 10:00 ] ⁨X⁩: Водій Київ-Малин 02.02 18:00 від м Akadem 0501234567`;
  const p = parseViberMessage(raw);
  assert(p);
  assert(p.notes?.includes('від м Akadem'));
});

test('extractPhone: шаблон +380 перевіряється першим — береться перший +380 у рядку, не 0XX раніше', () => {
  assert.equal(extractPhone('старий 0501111111 новий +380 50 222 33 44'), '+380502223344');
});

test('extractPhone: зайвий 0 і пробіл перед повним номером — береться повний 0XXXXXXXXX', () => {
  assert.equal(extractPhone('тел 0 0938901865'), '0938901865');
  assert.equal(extractPhone('0 0734440513'), '0734440513');
});
