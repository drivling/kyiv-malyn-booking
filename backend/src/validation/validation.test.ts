/**
 * Юніт-тести модулів validation/*.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFromToToRoute } from '../index-helpers';
import { validatePoputkyAnnounceDraft } from './poputky-announce-draft';
import {
  isValidScheduleDepartureTime,
  SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE,
} from './schedule-departure-time';
import { validateBookingPhoneInput, BOOKING_MISSING_FIELDS_MESSAGE } from './booking-phone';

test('validatePoputkyAnnounceDraft: успіх', () => {
  const r = validatePoputkyAnnounceDraft(
    {
      role: 'driver',
      from: 'kyiv',
      to: 'malyn',
      date: '2026-04-10',
      time: '14:30',
      notes: '  примітка  ',
      priceUah: 199.7,
    },
    mapFromToToRoute
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.route, 'Kyiv-Malyn');
  assert.equal(r.value.dateStr, '2026-04-10');
  assert.equal(r.value.departureTime, '14:30');
  assert.equal(r.value.notes, 'примітка');
  assert.equal(r.value.priceUah, 200);
});

test('validatePoputkyAnnounceDraft: інтервал часу', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'passenger', from: 'malyn', to: 'kyiv', date: '2026-01-02', time: '9:05-16:40' },
    mapFromToToRoute
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.departureTime, '9:05-16:40');
});

test('validatePoputkyAnnounceDraft: порожній час — null', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'driver', from: 'kyiv', to: 'malyn', date: '2026-04-10', time: '   ' },
    mapFromToToRoute
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.departureTime, null);
});

test('validatePoputkyAnnounceDraft: невірна роль', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'pilot', from: 'kyiv', to: 'malyn', date: '2026-04-10' },
    mapFromToToRoute
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /role/);
});

test('validatePoputkyAnnounceDraft: невідомий маршрут', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'driver', from: 'kyiv', to: 'kyiv', date: '2026-04-10' },
    mapFromToToRoute
  );
  assert.equal(r.ok, false);
});

test('validatePoputkyAnnounceDraft: дата не ISO', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'driver', from: 'kyiv', to: 'malyn', date: '10.04.2026' },
    mapFromToToRoute
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /дат/);
});

test('validatePoputkyAnnounceDraft: час невалідний (не HH:MM і не інтервал)', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'driver', from: 'kyiv', to: 'malyn', date: '2026-04-10', time: '14-30' },
    mapFromToToRoute
  );
  assert.equal(r.ok, false);
});

test('validatePoputkyAnnounceDraft: ціна від’ємна', () => {
  const r = validatePoputkyAnnounceDraft(
    { role: 'driver', from: 'kyiv', to: 'malyn', date: '2026-04-10', priceUah: -1 },
    mapFromToToRoute
  );
  assert.equal(r.ok, false);
});

test('isValidScheduleDepartureTime', () => {
  assert.equal(isValidScheduleDepartureTime('08:00'), true);
  assert.equal(isValidScheduleDepartureTime('23:59'), true);
  assert.equal(isValidScheduleDepartureTime('9:30'), false);
  assert.equal(isValidScheduleDepartureTime('24:00'), false);
  assert.equal(isValidScheduleDepartureTime('12:5'), false);
});

test('SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE — стабільний рядок для API', () => {
  assert.equal(typeof SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE, 'string');
});

test('validateBookingPhoneInput: ok для +380', () => {
  const r = validateBookingPhoneInput('+380 67 955 19 52');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.raw.includes('380') || r.raw.includes('67'));
});

test('validateBookingPhoneInput: порожньо', () => {
  const r = validateBookingPhoneInput('  ');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, BOOKING_MISSING_FIELDS_MESSAGE);
});

test('validateBookingPhoneInput: сміття', () => {
  const r = validateBookingPhoneInput('abc');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, 'Invalid phone number');
});
