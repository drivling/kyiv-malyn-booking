/**
 * Час у дорозі авто для попуток «Доведе»: Google Routes із заторами, а без ключа / при збої / понад ліміт — сталий час.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDriveTime, driveTimeDailyCap, DEFAULT_CAR_MINUTES } from './drive-time';

const DEPART = new Date('2026-11-17T05:00:00.000Z');
const NOW = Date.parse('2026-11-16T10:00:00.000Z');

function fakeFetch(reply: { ok?: boolean; status?: number; body?: unknown; throws?: boolean }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (reply.throws) throw new Error('timeout');
    return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.body ?? { routes: [{ duration: '6420s' }] } };
  };
  return { fetchImpl, calls };
}

test('без ключа — сталий час маршруту, Google не чіпаємо', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const drive = createDriveTime({ key: () => null, fetchImpl, now: () => NOW });
  assert.deepEqual(await drive({ fromCode: 'Malyn', toCode: 'Kyiv', departAt: DEPART, fixedMinutes: 100 }), { minutes: 100, source: 'fixed' });
  assert.equal(calls.length, 0);
});

test('сталий час не заданий — 1 год 35 хв', async () => {
  const drive = createDriveTime({ key: () => null, now: () => NOW });
  assert.equal((await drive({ fromCode: 'Malyn', toCode: 'Kyiv', departAt: DEPART, fixedMinutes: 0 })).minutes, DEFAULT_CAR_MINUTES);
  assert.equal(DEFAULT_CAR_MINUTES, 95);
});

test('з ключем: запит із заторами на час виїзду, без координат; відповідь — у хвилинах', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => NOW });
  assert.deepEqual(await drive({ fromCode: 'Malyn', toCode: 'Kyiv', departAt: DEPART, fixedMinutes: 95 }), { minutes: 107, source: 'traffic' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['X-Goog-Api-Key'], 'k');
  assert.equal(calls[0].headers['X-Goog-FieldMask'], 'routes.duration');
  assert.equal(calls[0].body.routingPreference, 'TRAFFIC_AWARE');
  assert.equal(calls[0].body.departureTime, DEPART.toISOString());
  assert.deepEqual(calls[0].body.origin, { address: 'Малин, Житомирська область, Україна' });
});

test('виїзд «уже зараз» — без departureTime (Google не приймає минулого)', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => NOW });
  await drive({ fromCode: 'Kyiv', toCode: 'Malyn', departAt: new Date(NOW - 5 * 60_000), fixedMinutes: 95 });
  assert.equal('departureTime' in calls[0].body, false);
});

test('кеш: та сама пара й година — один запит; інша година — ще один', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => NOW });
  const q = { fromCode: 'Malyn', toCode: 'Kyiv', fixedMinutes: 95 };
  await drive({ ...q, departAt: DEPART });
  await drive({ ...q, departAt: new Date(DEPART.getTime() + 20 * 60_000) });
  assert.equal(calls.length, 1);
  await drive({ ...q, departAt: new Date(DEPART.getTime() + 2 * 3600_000) });
  assert.equal(calls.length, 2);
});

test('помилка сервісу, виняток чи дивна тривалість — сталий час', async () => {
  const q = { fromCode: 'Malyn', toCode: 'Kyiv', departAt: DEPART, fixedMinutes: 95 };
  for (const reply of [{ ok: false, status: 403 }, { throws: true }, { body: { routes: [] } }, { body: { routes: [{ duration: '30s' }] } }]) {
    const { fetchImpl } = fakeFetch(reply);
    const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => NOW });
    assert.deepEqual(await drive(q), { minutes: 95, source: 'fixed' });
  }
});

test('денний ліміт: понад нього — сталий час; наступного дня лічильник з нуля', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  let now = NOW;
  const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => now, dailyCap: () => 2 });
  const at = (h: number) => ({ fromCode: 'Malyn', toCode: 'Kyiv', departAt: new Date(DEPART.getTime() + h * 3600_000), fixedMinutes: 95 });
  assert.equal((await drive(at(0))).source, 'traffic');
  assert.equal((await drive(at(1))).source, 'traffic');
  assert.equal((await drive(at(2))).source, 'fixed');
  assert.equal(calls.length, 2);
  now += 24 * 3600_000;
  assert.equal((await drive(at(26))).source, 'traffic');
});

test('місто, якого сервіс не знає, — сталий час без запиту', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const drive = createDriveTime({ key: () => 'k', fetchImpl, now: () => NOW });
  assert.equal((await drive({ fromCode: 'Malyn', toCode: 'Nowhere', departAt: DEPART, fixedMinutes: 50 })).source, 'fixed');
  assert.equal(calls.length, 0);
});

test('DRIVE_TIME_DAILY_CAP: типово 200, 0 вимикає, сміття — типове', () => {
  assert.equal(driveTimeDailyCap({}), 200);
  assert.equal(driveTimeDailyCap({ DRIVE_TIME_DAILY_CAP: '0' }), 0);
  assert.equal(driveTimeDailyCap({ DRIVE_TIME_DAILY_CAP: 'abc' }), 200);
});
