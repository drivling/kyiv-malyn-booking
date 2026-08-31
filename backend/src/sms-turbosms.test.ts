/**
 * Юніт-тести TurboSMS-клієнта: побудова запиту, розбір відповіді, оцінка сегментів.
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  estimateSmsSegments,
  parseTurboSmsResponse,
  sendSms,
  setSmsFetchForTests,
  toTurboSmsRecipient,
} from './sms-turbosms';

afterEach(() => setSmsFetchForTests(null));

test('toTurboSmsRecipient: нормалізація до 380XXXXXXXXX', () => {
  assert.equal(toTurboSmsRecipient('+380 (63) 077-43-56'), '380630774356');
  assert.equal(toTurboSmsRecipient('0630774356'), '380630774356');
  assert.equal(toTurboSmsRecipient('80630774356'), '380630774356');
  assert.equal(toTurboSmsRecipient('380630774356'), '380630774356');
});

test('estimateSmsSegments: кирилиця 70/67, латиниця 160/153', () => {
  assert.equal(estimateSmsSegments('Привіт'), 1);
  assert.equal(estimateSmsSegments('я'.repeat(70)), 1);
  assert.equal(estimateSmsSegments('я'.repeat(71)), 2);
  assert.equal(estimateSmsSegments('a'.repeat(160)), 1);
  assert.equal(estimateSmsSegments('a'.repeat(161)), 2);
});

test('parseTurboSmsResponse: успіх (per-recipient code 0)', () => {
  const r = parseTurboSmsResponse({
    response_code: 0,
    response_result: [{ phone: '380630774356', response_code: 0, message_id: 'abc-1' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.messageId, 'abc-1');
});

test('parseTurboSmsResponse: помилка провайдера (per-recipient code != 0)', () => {
  const r = parseTurboSmsResponse({
    response_code: 0,
    response_result: [{ phone: '380630774356', response_code: 800, response_status: 'Too many requests' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Too many requests/);
});

test('parseTurboSmsResponse: невідома форма → ok:false', () => {
  assert.equal(parseTurboSmsResponse(null).ok, false);
  assert.equal(parseTurboSmsResponse('oops').ok, false);
  assert.equal(parseTurboSmsResponse({ weird: true }).ok, false);
});

test('sendSms: без токена/відправника → no_credentials, без мережі', async () => {
  let called = false;
  setSmsFetchForTests(async () => {
    called = true;
    return new Response('{}');
  });
  const r = await sendSms('0630774356', 'test', { token: null, sender: null });
  assert.equal(r.sent, false);
  assert.equal(r.error, 'no_credentials');
  assert.equal(called, false);
});

test('sendSms: формує POST на TurboSMS з Bearer та recipients/sms', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  setSmsFetchForTests(async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(
      JSON.stringify({ response_code: 0, response_result: [{ response_code: 0, message_id: 'm-9' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const r = await sendSms('0630774356', 'Привіт', { token: 'TKN', sender: 'Malyn' });
  assert.equal(seenUrl, 'https://api.turbosms.ua/message/send.json');
  assert.equal(seenInit?.method, 'POST');
  const headers = new Headers(seenInit?.headers);
  assert.equal(headers.get('authorization'), 'Bearer TKN');
  const body = JSON.parse(String(seenInit?.body));
  assert.deepEqual(body.recipients, ['380630774356']);
  assert.equal(body.sms.sender, 'Malyn');
  assert.equal(body.sms.text, 'Привіт');
  assert.equal(r.sent, true);
  assert.equal(r.providerMessageId, 'm-9');
});

test('sendSms: мережевий виняток → sent:false, error network:*', async () => {
  setSmsFetchForTests(async () => {
    throw new Error('ECONNRESET');
  });
  const r = await sendSms('0630774356', 'x', { token: 'T', sender: 'S' });
  assert.equal(r.sent, false);
  assert.match(r.error ?? '', /network: ECONNRESET/);
});
