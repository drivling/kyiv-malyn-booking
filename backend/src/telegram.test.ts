/**
 * Юніт-тести для експортованої логіки з telegram.ts без живого бота та БД.
 * Запускайте з вимкненим TELEGRAM_BOT_TOKEN (у CI/pre-commit так і є).
 */
import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  hasCyrillic,
  pickBestNameFromCandidates,
  getTelegramScenarioLinks,
  buildBehaviorPromoMessage,
  buildInactivityReminderMessage,
  isTelegramEnabled,
  setAnnounceDraft,
  getAnnounceDraft,
  resetTelegramBotForTests,
  resetSpawnForTests,
  buildAuthorConfirmationSms,
  buildMatchSms,
  buildViberListingConfirmationMessage,
  buildTripReminderSms,
  BEHAVIOR_PROMO_SCENARIO_LABELS,
  BEHAVIOR_PROMO_SCENARIO_PROFILES,
  type BehaviorPromoScenarioKey,
} from './telegram';

afterEach(() => {
  resetTelegramBotForTests();
  resetSpawnForTests();
});

test('buildViberListingConfirmationMessage: сайт і платформа за маршрутом поїздки', () => {
  const korosten = buildViberListingConfirmationMessage(
    {
      route: 'Korosten-Kyiv',
      date: new Date('2026-09-11T12:00:00.000Z'),
      departureTime: '05:00',
      seats: 3,
      listingType: 'driver',
    },
    { addSubscribeInstruction: false },
  );
  assert.match(korosten, /Поїздки Коростень ↔️ Київ, Житомир, Малин/);
  assert.match(korosten, /Сайт: <a href="https:\/\/korosten\.kiev\.ua">korosten\.kiev\.ua<\/a>/);
  assert.equal(korosten.includes('malin.kiev.ua'), false);

  const malyn = buildViberListingConfirmationMessage(
    {
      route: 'Kyiv-Malyn',
      date: new Date('2026-09-11T12:00:00.000Z'),
      departureTime: '05:00',
      seats: null,
      listingType: 'passenger',
    },
    { addSubscribeInstruction: false },
  );
  assert.match(malyn, /Поїздки Київ, Житомир, Коростень ↔️ Малин/);
  assert.match(malyn, /Сайт: <a href="https:\/\/malin\.kiev\.ua">malin\.kiev\.ua<\/a>/);
});

test('buildTripReminderSms: домен за маршрутом бронювання', () => {
  const base = {
    date: new Date('2026-09-11T12:00:00.000Z'),
    departureTime: '05:00',
    name: 'Тест',
  };
  assert.match(
    buildTripReminderSms({ ...base, route: 'Korosten-Malyn' }, 'tomorrow'),
    /korosten\.kiev\.ua$/,
  );
  assert.match(buildTripReminderSms({ ...base, route: 'Kyiv-Malyn' }, 'today'), /malin\.kiev\.ua$/);
});

test('buildTripReminderSms: водій лише за іменем', () => {
  const text = buildTripReminderSms(
    {
      route: 'Kyiv-Malyn',
      date: new Date('2026-09-11T12:00:00.000Z'),
      departureTime: '05:00',
      name: 'Тест',
      driver: { senderName: 'Петро Іваненко', phone: '0679551952' },
    },
    'tomorrow',
  );
  assert.match(text, /Водій Петро, тел \+380679551952\./);
  assert.equal(text.includes('Іваненко'), false);
});

test('buildMatchSms: у SMS про збіг лише ім’я попутника, без прізвища', () => {
  const base = {
    route: 'Kyiv-Malyn',
    date: new Date('2026-09-11T12:00:00.000Z'),
    departureTime: '07:30',
    phone: '067 955 19 52',
  };

  const driver = buildMatchSms({ ...base, senderName: 'Іван Петренко' }, 'driver');
  assert.match(driver, /^Попутка Київ → Малин 11\.09\.2026 07:30: є водій Іван, тел \+380679551952\. /);
  assert.equal(driver.includes('Петренко'), false);
  assert.match(driver, /https:\/\/malin\.kiev\.ua$/);

  const passenger = buildMatchSms({ ...base, senderName: 'Олена Коваль Іванівна' }, 'passenger');
  assert.match(passenger, /є пасажир Олена, тел \+380679551952\./);
  assert.equal(passenger.includes('Коваль'), false);
});

test('buildMatchSms: без імені — узагальнене «Водій»/«Пасажир», без часу — без часу', () => {
  const base = {
    route: 'Kyiv-Malyn',
    date: new Date('2026-09-11T12:00:00.000Z'),
    departureTime: null,
    phone: '0679551952',
  };
  assert.match(buildMatchSms({ ...base, senderName: null }, 'driver'), /11\.09\.2026: є водій Водій, тел/);
  assert.match(buildMatchSms({ ...base, senderName: '  ' }, 'passenger'), /: є пасажир Пасажир, тел/);
});

test('buildAuthorConfirmationSms: компактний текст в одну SMS', () => {
  const text = buildAuthorConfirmationSms({
    route: 'Malyn-Korosten',
    date: new Date('2026-09-01T12:00:00.000Z'),
    departureTime: '14:00-17:00',
  });
  assert.equal(
    text,
    // маршрут через Коростень → сайт Коростеня
    'Ваше оголошення Малин→Коростень 01.09 14:00-17:00 опубліковано на https://korosten.kiev.ua. Інші люди побачать його і зателефонують вам.',
  );
  assert.equal(text.includes('2026'), false); // без року
  assert.equal(text.includes(' → '), false); // стрілка без пробілів
});

test('buildAuthorConfirmationSms: маршрут без власного домену лишається на malin.kiev.ua', () => {
  const text = buildAuthorConfirmationSms({
    route: 'Zhytomyr-Kyiv',
    date: new Date('2026-09-01T12:00:00.000Z'),
    departureTime: '08:00',
  });
  assert.match(text, /опубліковано на https:\/\/malin\.kiev\.ua\./);
});

test('buildAuthorConfirmationSms: без часу', () => {
  const text = buildAuthorConfirmationSms({
    route: 'Kyiv-Malyn',
    date: '2026-09-05T12:00:00.000Z',
    departureTime: null,
  });
  assert.match(text, /^Ваше оголошення Київ→Малин 05\.09 опубліковано на https:\/\/malin\.kiev\.ua\./);
});

test('normalizePhone', () => {
  assert.equal(normalizePhone('067 955 19 52'), '380679551952');
  assert.equal(normalizePhone('+380 67 955 1952'), '380679551952');
  assert.equal(normalizePhone('380679551952'), '380679551952');
  assert.equal(normalizePhone('abc'), '');
});

test('hasCyrillic', () => {
  assert.equal(hasCyrillic('Іван'), true);
  assert.equal(hasCyrillic('Її'), true);
  assert.equal(hasCyrillic('John'), false);
  assert.equal(hasCyrillic(''), false);
});

test('pickBestNameFromCandidates: порожньо', () => {
  assert.deepEqual(pickBestNameFromCandidates(null, null, null, null), {
    newName: null,
    source: null,
  });
});

test('pickBestNameFromCandidates: лише поточне ім’я', () => {
  assert.deepEqual(pickBestNameFromCandidates('Петро', null, null, null), {
    newName: 'Петро',
    source: null,
  });
});

test('pickBestNameFromCandidates: найдовше кириличне має пріоритет', () => {
  const r = pickBestNameFromCandidates('Петро', 'Петро Іванович', null, null);
  assert.equal(r.newName, 'Петро Іванович');
  assert.equal(r.source, 'bot');
});

test('pickBestNameFromCandidates: без кирилиці в поточному — беремо довше латиницею', () => {
  const r = pickBestNameFromCandidates(null, 'Jo', 'Johnny', null);
  assert.equal(r.newName, 'Johnny');
  assert.equal(r.source, 'user_account');
});

test('pickBestNameFromCandidates: кирилиця з opendatabot перемагає латиницю з bot', () => {
  const r = pickBestNameFromCandidates(null, 'Ann', null, 'Анна Марія');
  assert.equal(r.newName, 'Анна Марія');
  assert.equal(r.source, 'opendatabot');
});

test('getTelegramScenarioLinks: структура та deep link', () => {
  const links = getTelegramScenarioLinks();
  assert.match(links.driver, /^https:\/\/t\.me\/[^/]+\?start=driver$/);
  assert.match(links.passenger, /^https:\/\/t\.me\/[^/]+\?start=passenger$/);
  assert.match(links.view, /^https:\/\/t\.me\/[^/]+\?start=view$/);
  assert.equal(links.poputkyWeb, 'https://malin.kiev.ua/mizhgorodski');
});

test('BEHAVIOR_PROMO_SCENARIO_LABELS містить усі ключі', () => {
  const keys: BehaviorPromoScenarioKey[] = [
    'driver_passengers',
    'driver_autocreate',
    'passenger_notify',
    'passenger_quick',
    'mixed_unified',
    'mixed_both',
  ];
  for (const k of keys) {
    assert.ok(BEHAVIOR_PROMO_SCENARIO_LABELS[k]?.length);
    assert.ok(Array.isArray(BEHAVIOR_PROMO_SCENARIO_PROFILES[k]));
    assert.ok(BEHAVIOR_PROMO_SCENARIO_PROFILES[k].length > 0);
  }
});

test('buildBehaviorPromoMessage: усі сценарії містять посилання та HTML', () => {
  const keys: BehaviorPromoScenarioKey[] = [
    'driver_passengers',
    'driver_autocreate',
    'passenger_notify',
    'passenger_quick',
    'mixed_unified',
    'mixed_both',
  ];
  const links = getTelegramScenarioLinks();
  for (const k of keys) {
    const text = buildBehaviorPromoMessage(k);
    assert.match(text, /<b>/);
    assert.ok(text.includes(links.poputkyWeb));
  }
});

test('buildBehaviorPromoMessage: привітання з іменем', () => {
  const text = buildBehaviorPromoMessage('driver_passengers', { fullName: '  Олена  ' });
  assert.ok(text.startsWith('Привіт, Олена!'));
});

test('buildBehaviorPromoMessage: у привітанні лише ім’я, без прізвища', () => {
  const text = buildBehaviorPromoMessage('driver_passengers', { fullName: 'Олена Петренко' });
  assert.ok(text.startsWith('Привіт, Олена!'));
  assert.equal(text.includes('Петренко'), false);
});

test('buildBehaviorPromoMessage: коростенський маршрут веде на korosten.kiev.ua', () => {
  const text = buildBehaviorPromoMessage('driver_passengers', { mainRoute: 'Korosten-Kyiv' });
  assert.match(text, /https:\/\/korosten\.kiev\.ua\/mizhgorodski/);
  assert.equal(text.includes('malin.kiev.ua'), false);
});

test('buildBehaviorPromoMessage: passenger_notify з mainRoute', () => {
  const text = buildBehaviorPromoMessage('passenger_notify', { mainRoute: 'Kyiv-Malyn' });
  assert.ok(text.includes('Kyiv-Malyn'));
});

test('buildInactivityReminderMessage', () => {
  const msg = buildInactivityReminderMessage();
  const links = getTelegramScenarioLinks();
  assert.ok(msg.includes(links.driver));
  assert.ok(msg.includes(links.passenger));
  assert.ok(msg.includes(links.poputkyWeb));
  assert.match(msg, /<b>/);
});

test('isTelegramEnabled: false коли токен знято (test-pretest.cjs)', () => {
  assert.equal(isTelegramEnabled(), false);
});

test('setAnnounceDraft / getAnnounceDraft', () => {
  const token = `draft-unit-${Date.now()}`;
  setAnnounceDraft(token, {
    role: 'driver',
    route: 'Kyiv-Malyn',
    date: '2026-06-01',
    departureTime: '10:00',
    notes: 'тест',
  });
  const d = getAnnounceDraft(token);
  assert(d);
  assert.equal(d.role, 'driver');
  assert.equal(d.route, 'Kyiv-Malyn');
  assert.equal(d.date, '2026-06-01');
  assert.equal(d.departureTime, '10:00');
  assert.equal(d.notes, 'тест');
});

test('getAnnounceDraft: прострочена чернетка — null', () => {
  vi.useFakeTimers();
  try {
    const token = `draft-ttl-${Date.now()}`;
    setAnnounceDraft(token, { role: 'passenger', route: 'Malyn-Kyiv', date: '2026-06-02' });
    assert.ok(getAnnounceDraft(token));
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    assert.equal(getAnnounceDraft(token), null);
  } finally {
    vi.useRealTimers();
  }
});
