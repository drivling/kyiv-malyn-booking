/**
 * Юніт-тести для експортованої логіки з telegram.ts без живого бота та БД.
 * Запускайте з вимкненим TELEGRAM_BOT_TOKEN (у CI/pre-commit так і є).
 */
import test from 'node:test';
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
  BEHAVIOR_PROMO_SCENARIO_LABELS,
  BEHAVIOR_PROMO_SCENARIO_PROFILES,
  type BehaviorPromoScenarioKey,
} from './telegram';

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
  assert.equal(links.poputkyWeb, 'https://malin.kiev.ua/poputky');
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

test('getAnnounceDraft: прострочена чернетка — null', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  try {
    const token = `draft-ttl-${Date.now()}`;
    setAnnounceDraft(token, { role: 'passenger', route: 'Malyn-Kyiv', date: '2026-06-02' });
    assert.ok(getAnnounceDraft(token));
    t.mock.timers.tick(15 * 60 * 1000 + 1);
    assert.equal(getAnnounceDraft(token), null);
  } finally {
    t.mock.timers.reset();
  }
});
