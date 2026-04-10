/**
 * Юніт-тести для логіки, винесеної з index.ts (без HTTP / Prisma).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapFromToToRoute,
  hasNonEmptyText,
  mergeTextField,
  mergeSenderName,
  mergeRawMessage,
  serializeViberListing,
  getViberListingEndDateTime,
  getTelegramReminderWhere,
  hasTelegramReminderBaseCondition,
  getChannelPromoWhere,
  noTelegramCondition,
  PROMO_NOT_FOUND_SENTINEL,
  getScenarioKeysForProfile,
} from './index-helpers';

test('mapFromToToRoute: відомі пари', () => {
  assert.equal(mapFromToToRoute('kyiv', 'malyn'), 'Kyiv-Malyn');
  assert.equal(mapFromToToRoute('Malyn', 'Kyiv'), 'Malyn-Kyiv');
  assert.equal(mapFromToToRoute('zhytomyr', 'malyn'), 'Zhytomyr-Malyn');
  assert.equal(mapFromToToRoute('korosten', 'malyn'), 'Korosten-Malyn');
});

test('mapFromToToRoute: невідома пара — null', () => {
  assert.equal(mapFromToToRoute('kyiv', 'kyiv'), null);
  assert.equal(mapFromToToRoute('', 'malyn'), null);
});

test('hasNonEmptyText', () => {
  assert.equal(hasNonEmptyText(null), false);
  assert.equal(hasNonEmptyText('  '), false);
  assert.equal(hasNonEmptyText('a'), true);
});

test('mergeTextField', () => {
  assert.equal(mergeTextField('a', null), 'a');
  assert.equal(mergeTextField(null, 'b'), 'b');
  assert.equal(mergeTextField('same', 'same'), 'same');
  assert.equal(mergeTextField('short', 'longer value'), 'short | longer value');
  assert.equal(mergeTextField('already has longer inside', 'longer'), 'already has longer inside');
});

test('mergeSenderName: лише якщо старого немає', () => {
  assert.equal(mergeSenderName(null, 'New'), 'New');
  assert.equal(mergeSenderName('Old', 'New'), 'Old');
});

test('mergeRawMessage', () => {
  assert.equal(mergeRawMessage('a', ''), 'a');
  assert.equal(mergeRawMessage('', 'b'), 'b');
  assert.equal(mergeRawMessage('hello', 'hello'), 'hello');
  assert.equal(mergeRawMessage('a\nb', 'a'), 'a\nb');
  assert.equal(mergeRawMessage('short', 'longer text'), 'short\n---\nlonger text');
  assert.equal(mergeRawMessage('first', 'second'), 'first\n---\nsecond');
});

test('serializeViberListing: ISO для Date', () => {
  const d = new Date('2026-03-15T12:00:00.000Z');
  const row = {
    id: 1,
    route: 'X',
    date: d,
    createdAt: d,
    updatedAt: d,
  };
  const s = serializeViberListing(row);
  assert.equal(s.date, d.toISOString());
  assert.equal(s.route, 'X');
});

test('getViberListingEndDateTime: без часу — 23:59', () => {
  const end = getViberListingEndDateTime(new Date('2026-06-10T00:00:00.000Z'), null);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('getViberListingEndDateTime: один час', () => {
  const end = getViberListingEndDateTime(new Date('2026-06-10T00:00:00.000Z'), '14:30');
  assert.equal(end.getHours(), 14);
  assert.equal(end.getMinutes(), 30);
});

test('getViberListingEndDateTime: діапазон — кінець', () => {
  const end = getViberListingEndDateTime(new Date('2026-06-10T00:00:00.000Z'), '9:05-16:40');
  assert.equal(end.getHours(), 16);
  assert.equal(end.getMinutes(), 40);
});

test('getTelegramReminderWhere: all / default', () => {
  const w = getTelegramReminderWhere('all');
  assert.deepEqual(w, hasTelegramReminderBaseCondition);
});

test('getTelegramReminderWhere: no_active_viber', () => {
  const w = getTelegramReminderWhere('no_active_viber') as {
    viberListings: { none: { isActive: boolean } };
  };
  assert.equal(w.viberListings.none.isActive, true);
});

test('getTelegramReminderWhere: no_reminder_7_days має OR з lt', () => {
  const w = getTelegramReminderWhere('no_reminder_7_days') as {
    OR: Array<{ telegramReminderSentAt: null | { lt: Date } }>;
  };
  assert.equal(w.OR.length, 2);
  assert.equal(w.OR[0].telegramReminderSentAt, null);
  assert.ok(w.OR[1].telegramReminderSentAt && 'lt' in w.OR[1].telegramReminderSentAt);
  assert.ok(w.OR[1].telegramReminderSentAt.lt instanceof Date);
});

test('getChannelPromoWhere', () => {
  assert.deepEqual(getChannelPromoWhere('no_telegram'), noTelegramCondition);
  const nc = getChannelPromoWhere('no_communication') as {
    telegramPromoSentAt: null;
  };
  assert.equal(nc.telegramPromoSentAt, null);
  const pf = getChannelPromoWhere('promo_not_found') as {
    telegramPromoSentAt: Date;
  };
  assert.equal(pf.telegramPromoSentAt.getTime(), PROMO_NOT_FOUND_SENTINEL.getTime());
});

test('getScenarioKeysForProfile узгоджено з BEHAVIOR_PROMO_SCENARIO_PROFILES', () => {
  assert.deepEqual(getScenarioKeysForProfile('driver'), ['driver_passengers', 'driver_autocreate']);
  assert.deepEqual(getScenarioKeysForProfile('passenger'), ['passenger_notify', 'passenger_quick']);
  assert.deepEqual(getScenarioKeysForProfile('mixed'), [
    'driver_passengers',
    'driver_autocreate',
    'passenger_notify',
    'passenger_quick',
    'mixed_unified',
    'mixed_both',
  ]);
});
