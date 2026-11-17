import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { createTransportTestStore } from './transport-test-store';
import { kyivLocalToUtc, listGpsPositions, parseGpsFeed, parseGpsRange, recordGpsPositions } from './transport-gps';

const row = (over: Record<string, unknown> = {}) => ({
  imei: '863071012345678',
  gov_number: 'АМ 2298  ЕК',
  route_short_name: '2Б',
  route_long_name: '.№02-Б "Пашини - Залізничний Вокзал - Гастелло"',
  time: '2026-11-17 09:59:45',
  latitude: '50.962655',
  longitude: '28.657818',
  speed: '0',
  satellites: '9',
  ...over,
});

test('kyivLocalToUtc: зимовий (+2) і літній (+3) час Києва; не той формат — null', () => {
  assert.equal(kyivLocalToUtc('2026-11-17 09:59:45')?.toISOString(), '2026-11-17T07:59:45.000Z');
  assert.equal(kyivLocalToUtc('2026-07-01 12:00:00')?.toISOString(), '2026-07-01T09:00:00.000Z');
  assert.equal(kyivLocalToUtc('17.11.2026 09:59'), null);
  assert.equal(kyivLocalToUtc(''), null);
});

test('parseGpsFeed: BOM, JSON-рядок усередині JSON, порожні й нульові точки пропускає', () => {
  const inner = JSON.stringify([row(), row({ imei: '' }), row({ imei: '2', latitude: '0', longitude: '0' }), row({ imei: '3', time: 'вчора' })]);
  const body = '﻿' + JSON.stringify(inner);
  const out = parseGpsFeed(body);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    vehicleId: '863071012345678',
    plate: 'АМ 2298 ЕК',
    routeNo: '2Б',
    at: new Date('2026-11-17T07:59:45.000Z'),
    lat: 50.962655,
    lng: 28.657818,
    speed: 0,
    satellites: 9,
  });
  // звичайний масив теж
  assert.equal(parseGpsFeed(JSON.stringify([row()])).length, 1);
  assert.throws(() => parseGpsFeed('{"a":1}'), /expected an array/);
});

test('recordGpsPositions: нові точки з містом фіду; повтор, стара (депо) і з майбутнього — не пишуться; старі рядки видаляються', async () => {
  const store = createTransportTestStore({
    transportVehiclePosition: [
      { cityCode: 'Korosten', id: 1, vehicleId: 'old', plate: 'x', routeNo: '1', at: new Date('2026-10-01T08:00:00Z'), lat: 1, lng: 1, speed: 0, satellites: null },
    ],
  });
  const prisma = store.prisma as unknown as PrismaClient;
  const now = new Date('2026-11-17T08:01:00Z');
  const body = JSON.stringify([
    row(),
    row({ imei: 'depot', time: '2026-11-15 18:45:22' }),
    row({ imei: 'future', time: '2026-11-17 10:30:00' }),
  ]);
  const deps = { fetchText: async () => body, now: () => now, feeds: [{ cityCode: 'Korosten', url: 'x' }] };
  const first = await recordGpsPositions(prisma, deps);
  assert.deepEqual(first, [{ cityCode: 'Korosten', received: 1, inserted: 1, deleted: 1 }]);
  const second = await recordGpsPositions(prisma, deps);
  assert.deepEqual(second, [{ cityCode: 'Korosten', received: 1, inserted: 0, deleted: 0 }]);
  const rows = store.tables.transportVehiclePosition;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cityCode, 'Korosten');
  assert.equal(rows[0].routeNo, '2Б');

  const failed = await recordGpsPositions(prisma, { ...deps, fetchText: async () => { throw new Error('HTTP 503'); } });
  assert.deepEqual(failed, [{ cityCode: 'Korosten', received: 0, inserted: 0, deleted: 0, error: 'HTTP 503' }]);
});

test('parseGpsRange: за замовчуванням останні 24 год; більше 7 діб або from ≥ to — null', () => {
  const now = new Date('2026-11-17T08:00:00Z');
  assert.deepEqual(parseGpsRange(undefined, undefined, now), { from: new Date('2026-11-16T08:00:00Z'), to: now });
  assert.equal(parseGpsRange('2026-11-01T00:00:00Z', '2026-11-17T00:00:00Z', now), null);
  assert.equal(parseGpsRange('2026-11-17T00:00:00Z', '2026-11-16T00:00:00Z', now), null);
  assert.equal(parseGpsRange('сьогодні', undefined, now), null);
});

test('listGpsPositions + GET /admin/transport/gps: лише місто запиту, за маршрутом, зведена по автобусах, лише адмін', async () => {
  const at = (iso: string) => new Date(iso);
  const pos = (id: number, cityCode: string, vehicleId: string, routeNo: string, iso: string) => ({
    cityCode, id, vehicleId, plate: `P-${vehicleId}`, routeNo, at: at(iso), lat: 50.9, lng: 28.6, speed: 10, satellites: 8, createdAt: at(iso),
  });
  const store = createTransportTestStore({
    tripPoint: [
      { id: 1, code: 'Malyn', hasLocalTransport: true },
      { id: 2, code: 'Korosten', hasLocalTransport: false },
    ],
    transportVehiclePosition: [
      pos(1, 'Korosten', 'a', '2Б', '2026-11-17T07:00:00Z'),
      pos(2, 'Korosten', 'a', '2Б', '2026-11-17T07:01:00Z'),
      pos(3, 'Korosten', 'b', '1', '2026-11-17T07:00:30Z'),
      pos(4, 'Malyn', 'm', '1', '2026-11-17T07:00:30Z'),
    ],
  });
  const prisma = store.prisma as unknown as PrismaClient;
  const range = { from: at('2026-11-17T00:00:00Z'), to: at('2026-11-17T08:00:00Z') };
  const all = await listGpsPositions(prisma, { cityCode: 'Korosten', ...range });
  assert.deepEqual(all.positions.map((p) => p.vehicleId), ['a', 'a', 'b']);
  assert.deepEqual(all.vehicles.find((v) => v.vehicleId === 'a'), {
    vehicleId: 'a', plate: 'P-a', routes: ['2Б'], points: 2, first: '2026-11-17T07:00:00.000Z', last: '2026-11-17T07:01:00.000Z',
  });
  const one = await listGpsPositions(prisma, { cityCode: 'Korosten', ...range, routeNo: '1' });
  assert.deepEqual(one.positions.map((p) => p.vehicleId), ['b']);
  assert.equal(all.truncated, false);

  const app = createApp({ prisma, adminPassword: 'gps-test' });
  await request(app).get('/admin/transport/gps?city=Korosten').expect(401);
  const res = await request(app)
    .get('/admin/transport/gps?city=Korosten&from=2026-11-17T00:00:00Z&to=2026-11-17T08:00:00Z&route=2%D0%91')
    .set({ Authorization: adminAuthToken('gps-test') })
    .expect(200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.deepEqual(res.body.positions.map((p: { vehicleId: string }) => p.vehicleId), ['a', 'a']);
  await request(app).get('/admin/transport/gps?city=Korosten&from=x').set({ Authorization: adminAuthToken('gps-test') }).expect(400);
});
