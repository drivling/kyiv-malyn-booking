import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PHONE_ONLY_NOTICE_HTML,
  PHONE_ONLY_NOTICE_TEXT,
  PHONE_ONLY_SMS,
  PHONE_ONLY_TOAST,
  ZUBASTYK_PHONES,
  isPhoneOnlyBooking,
} from './phone-booking';

test('isPhoneOnlyBooking: лише маршрутки Київ ↔ Малин («Зубастик»)', () => {
  for (const route of ['Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha']) {
    assert.equal(isPhoneOnlyBooking({ route, vehicleType: 'marshrutka' }), true, route);
    assert.equal(isPhoneOnlyBooking({ route, source: 'schedule' }), true, route);
  }
  // електрички мають ті самі slug-и коридору
  assert.equal(isPhoneOnlyBooking({ route: 'Kyiv-Malyn', vehicleType: 'elektrichka' }), false);
  // попутка на тому ж напрямку — не «Зубастик»
  assert.equal(isPhoneOnlyBooking({ route: 'Kyiv-Malyn', source: 'viber_match' }), false);
  for (const route of ['Malyn-Zhytomyr-Potiivka', 'Korosten-Malyn', 'Kyiv-Korosten', 'Kyiv-Malynivka', '', null]) {
    assert.equal(isPhoneOnlyBooking({ route, vehicleType: 'marshrutka' }), false, String(route));
  }
});

test('тексти «лише за телефоном» несуть номери «Зубастика»', () => {
  assert.equal(ZUBASTYK_PHONES.length, 4);
  for (const p of ZUBASTYK_PHONES) {
    assert.match(p.digits, /^380\d{9}$/);
    assert.ok(PHONE_ONLY_NOTICE_TEXT.includes(p.label), p.label);
    assert.ok(PHONE_ONLY_NOTICE_HTML.includes(`href="tel:+${p.digits}"`), p.digits);
  }
  assert.match(PHONE_ONLY_NOTICE_TEXT, /поки не працює/);
  assert.match(PHONE_ONLY_NOTICE_TEXT, /лише за телефоном/);
  assert.match(PHONE_ONLY_NOTICE_HTML, /093 170 18 35<\/a> \(резервний\)/);
  assert.match(PHONE_ONLY_SMS, /0931920008/);
  // answerCallbackQuery приймає до 200 символів
  assert.ok(PHONE_ONLY_TOAST.length <= 200);
});
