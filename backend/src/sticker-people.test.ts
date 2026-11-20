/**
 * Люди з наклейок (sticker-people.ts): перший скан — нова людина з номером, далі історія (зупинки за порядком, доби),
 * гонка двох перших сканів, повернення без скану, тизер, номер у межах міста; зведення для стіни й адмінки; HTTP —
 * відповідь скану з `person`, вкладка «Люди» на стіні (ключ стіни) і адмінка.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { stickerWallKey } from './sticker-wall';
import {
  MAX_PERSON_STOPS,
  buildPeopleWall,
  buildStickerPeople,
  nextScanState,
  passengerNumber,
  personSummary,
  recordPersonReturn,
  recordPersonScan,
  recordPersonTeaser,
  type StickerPersonRow,
} from './sticker-people';
import { createTransportTestStore } from './transport-test-store';

const A = 'aaaa-1111-aaaa-1111';
const B = 'bbbb-2222-bbbb-2222';
const C = 'cccc-3333-cccc-3333';
const at = (iso: string) => new Date(iso);

test('перший скан — нова людина №1; далі історія: зупинки за порядком, доби за Києвом, номер не змінюється', async () => {
  const { prisma, tables } = createTransportTestStore();
  const first = await recordPersonScan(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0015', side: 'a', at: at('2026-11-16T09:00:00Z') });
  assert.deepEqual(first, { number: 1, scans: 1, stops: 1, firstStopId: 'st_0015', firstAt: '2026-11-16T09:00:00.000Z', isNew: true });
  const other = await recordPersonScan(prisma, { cityCode: 'Malyn', clientId: B, stopId: 'st_0019', side: 'b', at: at('2026-11-16T10:00:00Z') });
  assert.equal(other.number, 2);
  // той самий день, інша зупинка; 23:30 за Києвом 16-го — ще той самий день
  await recordPersonScan(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0019', side: 's', at: at('2026-11-16T21:30:00Z') });
  // 00:30 за Києвом 17-го — нова доба; знову перша зупинка — у списку не повторюється
  const again = await recordPersonScan(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0015', side: 'a', at: at('2026-11-16T22:30:00Z') });
  assert.deepEqual(again, { number: 1, scans: 3, stops: 2, firstStopId: 'st_0015', firstAt: '2026-11-16T09:00:00.000Z', isNew: false });
  const row = tables.stickerPerson.find((p) => p.clientId === A)!;
  assert.deepEqual(row.stopIds, ['st_0015', 'st_0019']);
  assert.equal(row.scanDays, 2);
  assert.equal(row.lastScanDay, '2026-11-17');
  assert.equal(row.lastSide, 'a');
  assert.equal(await personSummary(prisma, 'Malyn', C), null, 'незнайомий браузер — без людини');
});

test('номер пасажира — у межах міста: люди Коростеня не зсувають номери Малина', async () => {
  const { prisma } = createTransportTestStore();
  await recordPersonScan(prisma, { cityCode: 'Korosten', clientId: C, stopId: 'z-001', side: 'a' });
  const malyn = await recordPersonScan(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0015', side: 'a' });
  const korosten = await recordPersonScan(prisma, { cityCode: 'Korosten', clientId: A, stopId: 'z-002', side: 'a' });
  assert.equal(malyn.number, 1);
  assert.equal(korosten.number, 2, 'той самий браузер у Коростені — окрема людина, другий там');
  assert.equal(await passengerNumber(prisma, 'Malyn', 99), 1);
});

test('гонка двох перших сканів одного браузера: друге створення падає на унікальному ключі — і стає оновленням', async () => {
  const store = createTransportTestStore();
  await recordPersonScan(store.prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0015', side: 'a' });
  let raced = false;
  const people = store.prisma.stickerPerson as unknown as { findUnique: (a: unknown) => Promise<unknown> };
  const real = people.findUnique;
  // перший пошук «не бачить» рядок, який щойно записав паралельний запит
  const racy = {
    ...store.prisma,
    stickerPerson: {
      ...store.prisma.stickerPerson,
      findUnique: (a: unknown) => {
        if (!raced) {
          raced = true;
          return Promise.resolve(null);
        }
        return real(a);
      },
    },
  } as unknown as PrismaClient;
  const second = await recordPersonScan(racy, { cityCode: 'Malyn', clientId: A, stopId: 'st_0019', side: 'b' });
  assert.equal(raced, true);
  assert.deepEqual({ number: second.number, scans: second.scans, stops: second.stops, isNew: second.isNew }, { number: 1, scans: 2, stops: 2, isNew: false });
  assert.equal(store.tables.stickerPerson.length, 1);
});

test('повернення без скану — людина з наклейки повернення; далі лише лічильник; тизер — один раз', async () => {
  const { prisma, tables } = createTransportTestStore();
  await recordPersonReturn(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0070', side: 's', at: at('2026-11-10T08:00:00Z') });
  await recordPersonReturn(prisma, { cityCode: 'Malyn', clientId: A, stopId: 'st_0070', side: 's', at: at('2026-11-12T08:00:00Z') });
  const p = tables.stickerPerson[0];
  assert.deepEqual(
    { first: p.firstStopId, scans: p.scans, stops: p.stopIds, returns: p.returns, last: (p.lastReturnAt as Date).toISOString() },
    { first: 'st_0070', scans: 0, stops: ['st_0070'], returns: 2, last: '2026-11-12T08:00:00.000Z' }
  );
  await recordPersonTeaser(prisma, { cityCode: 'Malyn', clientId: A, at: at('2026-11-13T08:00:00Z') });
  await recordPersonTeaser(prisma, { cityCode: 'Malyn', clientId: A, at: at('2026-11-14T08:00:00Z') });
  assert.equal((p.teaserAt as Date).toISOString(), '2026-11-13T08:00:00.000Z', 'перший досмотрений тизер лишається');
  await recordPersonTeaser(prisma, { cityCode: 'Malyn', clientId: B });
  assert.equal(tables.stickerPerson.length, 1, 'тизер без людини людину не створює');
});

const person = (id: number, over: Partial<StickerPersonRow>): StickerPersonRow => ({
  id,
  cityCode: 'Malyn',
  clientId: `client-${String(id).padStart(4, '0')}`,
  firstStopId: 'st_0015',
  firstSide: 'a',
  firstAt: at('2026-11-17T08:00:00Z'),
  lastStopId: 'st_0015',
  lastSide: 'a',
  lastAt: at('2026-11-17T08:00:00Z'),
  scans: 1,
  stopIds: ['st_0015'],
  scanDays: 1,
  lastScanDay: '2026-11-17',
  returns: 0,
  lastReturnAt: null,
  teaserAt: null,
  ...over,
});

test('список зупинок людини має межу: перша лишається, найстаріші після неї випадають', () => {
  const stops = Array.from({ length: MAX_PERSON_STOPS }, (_, i) => `st_${i}`);
  const next = nextScanState(person(1, { stopIds: stops }), { stopId: 'st_new', side: 'a', at: at('2026-11-17T09:00:00Z') });
  assert.equal(next.stopIds.length, MAX_PERSON_STOPS);
  assert.equal(next.stopIds[0], 'st_0');
  assert.equal(next.stopIds[1], 'st_2');
  assert.equal(next.stopIds.at(-1), 'st_new');
});

test('стіна «Люди»: нові сьогодні й учора, повернулись сьогодні й за тиждень, 90 днів, останні — за дією', () => {
  const now = at('2026-11-17T12:00:00Z'); // 14:00 за Києвом
  const snap = buildPeopleWall(
    [
      person(1, { firstAt: at('2026-10-01T08:00:00Z'), firstStopId: 'st_0070', stopIds: ['st_0070', 'st_0015'], scanDays: 5, lastAt: at('2026-11-17T07:00:00Z'), teaserAt: at('2026-11-17T07:01:00Z') }),
      person(2, { firstAt: at('2026-11-16T09:00:00Z'), lastAt: at('2026-11-16T09:00:00Z'), lastScanDay: '2026-11-16', returns: 1, lastReturnAt: at('2026-11-17T11:00:00Z') }),
      person(3, { firstAt: at('2026-11-17T10:00:00Z'), lastAt: at('2026-11-17T10:00:00Z') }),
      person(4, { firstAt: at('2026-11-16T15:00:00Z'), lastAt: at('2026-11-16T15:00:00Z'), lastScanDay: '2026-11-16' }),
      person(5, { cityCode: 'Malyn', firstAt: at('2026-06-01T08:00:00Z'), lastAt: at('2026-06-01T08:00:00Z'), lastScanDay: '2026-06-01' }),
    ],
    now
  );
  assert.equal(snap.day, '2026-11-17');
  assert.equal(snap.total, 5);
  assert.deepEqual(snap.today, { new: 1, returned: 2 });
  assert.deepEqual(snap.yesterday, { new: 2 });
  assert.equal(snap.returned7d, 2);
  assert.deepEqual(snap.d90, { new: 4, returned: 2, multiStop: 1, teaser: 1 });
  assert.deepEqual(
    snap.people.map((p) => [p.number, p.kind, p.isNew]),
    [
      [2, 'return', false],
      [3, 'scan', true],
      [1, 'scan', false],
      [4, 'scan', false],
      [5, 'scan', false],
    ]
  );
  assert.equal(snap.people[0].who, '0002');
  assert.equal(snap.people[2].stops, 2);
  assert.equal(snap.people[2].teaser, true);
});

test('адмінка «Люди»: нові за вікно, по добах і перших зупинках; постійні — більше зупинок, далі діб', () => {
  const now = at('2026-11-17T12:00:00Z');
  const persons = [
    person(1, { firstAt: at('2026-10-01T08:00:00Z'), stopIds: ['st_0070', 'st_0015', 'st_0019'], scanDays: 3, returns: 1 }),
    person(2, { firstAt: at('2026-11-15T08:00:00Z'), firstStopId: 'st_0019', stopIds: ['st_0019'], scanDays: 4 }),
    person(3, { firstAt: at('2026-11-17T08:00:00Z'), firstStopId: 'st_0019', teaserAt: now }),
    person(4, { firstAt: at('2026-11-16T22:30:00Z') }), // 00:30 17-го за Києвом — сьогодні
  ];
  const week = buildStickerPeople(persons, now, 7);
  assert.equal(week.total, 4);
  assert.equal(week.newInPeriod, 3);
  assert.equal(week.returning, 2);
  assert.equal(week.multiStop, 1);
  assert.equal(week.teaser, 1);
  assert.deepEqual(week.daily, [
    { day: '2026-11-15', count: 1 },
    { day: '2026-11-17', count: 2 },
  ]);
  assert.deepEqual(week.firstStops, [
    { stopId: 'st_0019', count: 2 },
    { stopId: 'st_0015', count: 1 },
  ]);
  assert.deepEqual(
    week.people.map((p) => p.number),
    [1, 2, 3, 4]
  );
  assert.deepEqual(week.people[0].stopIds, ['st_0070', 'st_0015', 'st_0019']);
  assert.equal(buildStickerPeople(persons, now, 1).newInPeriod, 2, '«сьогодні» — київська доба');
});

const ADMIN = 'people-test-admin';
async function app() {
  const store = createTransportTestStore({
    transportStop: [{ cityCode: 'Malyn', id: 'st_0015', name: 'з-д «Прожектор»', lat: 50.77, lng: 29.24 }],
  });
  return { store, app: await listenLocal(createApp({ prisma: store.prisma, adminPassword: ADMIN })) };
}

test('POST /transport/sticker-scans з id браузера — `person` з номером; повтор за 2 хв — та сама людина, не нова', async () => {
  const { app: a, store } = await app();
  const first = await request(a).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'a', clientId: A }).expect(201);
  assert.deepEqual({ ...first.body.person, firstAt: undefined }, { number: 1, scans: 1, stops: 1, firstStopId: 'st_0015', firstAt: undefined, isNew: true });
  const repeat = await request(a).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'a', clientId: A }).expect(200);
  assert.equal(repeat.body.counted, false);
  assert.equal(repeat.body.person.number, 1);
  assert.equal(repeat.body.person.isNew, false);
  assert.equal(store.tables.stickerPerson[0].scans, 1, 'повтор скан не рахує');
  // інша людина за тим самим IP (CGNAT) і тією ж наклейкою за 2 хв: скан — повтор, але людина своя, з цією першою зупинкою
  const neighbour = await request(a).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'a', clientId: B }).expect(200);
  assert.equal(neighbour.body.counted, false);
  assert.deepEqual({ number: neighbour.body.person.number, isNew: neighbour.body.person.isNew, first: neighbour.body.person.firstStopId }, { number: 2, isNew: true, first: 'st_0015' });
  assert.equal(store.tables.stickerScan.length, 1, 'лічильник сканів — як і був, за IP');
  const anon = await request(a).post('/transport/sticker-scans').set('X-Forwarded-For', '10.0.0.9').send({ stopId: 'st_0015', side: 'b' }).expect(201);
  assert.equal(anon.body.person, undefined, 'без id браузера людини немає');
  await request(a).post('/transport/sticker-returns').send({ stopId: 'st_0015', side: 'a', clientId: A, via: 'tab', page: 'transport' }).expect(201);
  assert.equal(store.tables.stickerPerson[0].returns, 1);
});

test('GET /transport/sticker-wall/people — лише з ключем стіни, без кешу; GET /admin/transport/sticker-people — лише адмін', async () => {
  const { app: a } = await app();
  await request(a).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'a', clientId: A }).expect(201);
  await request(a).get('/transport/sticker-wall/people').expect(403);
  const wall = await request(a).get(`/transport/sticker-wall/people?key=${stickerWallKey(ADMIN)}`).expect(200);
  assert.equal(wall.headers['cache-control'], 'no-store');
  assert.equal(wall.body.total, 1);
  assert.equal(wall.body.people[0].number, 1);
  await request(a).get(`/transport/sticker-wall/people?key=${stickerWallKey(ADMIN)}&city=Atlantis`).expect(404);
  await request(a).get('/admin/transport/sticker-people').expect(401);
  const admin = await request(a).get('/admin/transport/sticker-people?days=7').set('Authorization', adminAuthToken(ADMIN)).expect(200);
  assert.equal(admin.body.days, 7);
  assert.equal(admin.body.newInPeriod, 1);
});
