/**
 * GET /poputky/search — один запит на пошук: попутки (публічний DTO), розклад на OD-пару, місця.
 */
import { expect, test, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { bookedSeatsBySchedule } from './poputky-search';

const points = [
  { id: 1, code: 'Kyiv', nameUk: 'Київ', appearInPoputky: true },
  { id: 2, code: 'Malyn', nameUk: 'Малин', appearInPoputky: true },
  { id: 3, code: 'Irpin', nameUk: 'Ірпінь', appearInPoputky: true },
];
const routes = [
  { id: 10, slug: 'Kyiv-Malyn', corridorTripRouteId: null, stops: [{ pointId: 1, position: 0 }, { pointId: 2, position: 1 }] },
  {
    id: 11,
    slug: 'Kyiv-Malyn-Irpin',
    corridorTripRouteId: 10,
    stops: [{ pointId: 1, position: 0 }, { pointId: 3, position: 1 }, { pointId: 2, position: 2 }],
  },
];
const listingRow = {
  id: 7,
  source: 'Viber1',
  senderName: 'Іван',
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  tripRouteId: 10,
  fromPointId: 1,
  toPointId: 2,
  date: new Date('2026-12-01T00:00:00.000Z'),
  departureTime: '18:00',
  seats: 3,
  notes: null,
  priceUah: 250,
  isActive: true,
  createdAt: new Date('2026-11-30T00:00:00.000Z'),
  updatedAt: new Date('2026-11-30T00:00:00.000Z'),
  // те, що НЕ має вийти назовні (select у запиті це відсікає; DTO — друга лінія)
  phone: '380501112233',
  rawMessage: 'секрет',
};
const bus = {
  id: 101,
  route: 'Kyiv-Malyn-Irpin',
  tripRouteId: 11,
  departureTime: '09:00',
  maxSeats: 8,
  vehicleType: 'marshrutka',
  activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  ticketPurchaseUrl: null,
  tripRoute: { id: 11, stops: routes[1].stops },
};
const train = { ...bus, id: 201, route: 'Kyiv-Malyn', tripRouteId: 10, vehicleType: 'elektrichka', maxSeats: 0, ticketPurchaseUrl: 'https://t', tripRoute: { id: 10, stops: routes[0].stops } };
const weekendOnly = { ...bus, id: 102, activeWeekdays: [6, 7] }; // 2026-12-01 — вівторок

function buildPrisma() {
  const viberFindMany = vi.fn(async () => [listingRow]);
  const scheduleFindMany = vi.fn(async () => [bus, train, weekendOnly]);
  const bookingFindMany = vi.fn(async () => [
    { scheduleId: 101, route: 'Kyiv-Malyn-Irpin', departureTime: '09:00', seats: 2 },
    { scheduleId: null, route: 'Kyiv-Malyn-Irpin', departureTime: '09:00', seats: 1 },
    { scheduleId: null, route: 'Kyiv-Malyn-Irpin', departureTime: '10:00', seats: 5 },
  ]);
  const prisma = {
    tripPoint: { findMany: vi.fn(async () => points) },
    tripRoute: { findMany: vi.fn(async () => routes) },
    viberListing: { findMany: viberFindMany },
    schedule: { findMany: scheduleFindMany },
    booking: { findMany: bookingFindMany },
  };
  return { prisma: prisma as unknown as PrismaClient, viberFindMany, scheduleFindMany, bookingFindMany };
}

test('повертає попутки без телефону, розклад на OD-пару й вільні місця одним запитом', async () => {
  const { prisma, viberFindMany, scheduleFindMany, bookingFindMany } = buildPrisma();
  const res = await request(createApp({ prisma, adminPassword: 'x' }))
    .get('/poputky/search?from=kyiv&to=Malyn&date=2026-12-01')
    .expect(200);

  expect(res.headers['cache-control']).toBe('public, max-age=20');
  expect(res.body.from.code).toBe('Kyiv');
  expect(res.body.listings).toHaveLength(1);
  expect(res.body.listings[0]).not.toHaveProperty('phone');
  expect(res.body.listings[0]).not.toHaveProperty('rawMessage');
  expect(res.body.listings[0].date).toBe('2026-12-01T00:00:00.000Z');

  // along-route: коридор 10 і варіант 11 обидва містять Kyiv→Malyn
  const listingWhere = (viberFindMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }])[0].where;
  expect(listingWhere.OR).toContainEqual({ tripRouteId: { in: [10, 11] } });
  const scheduleWhere = (scheduleFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
  expect(scheduleWhere).toEqual({ tripRouteId: { in: [10, 11] } });

  // розклад: маршрутка + електричка; рейс лише по вихідних відсіяно за датою
  expect(res.body.schedules.map((s: { id: number }) => s.id)).toEqual([101, 201]);
  // місця: 2 (по scheduleId) + 1 (legacy по route+time), 5 по іншому часу не рахуємо
  expect(bookingFindMany).toHaveBeenCalledTimes(1);
  expect(res.body.availability['101']).toEqual({
    scheduleId: 101,
    maxSeats: 8,
    bookedSeats: 3,
    availableSeats: 5,
    isAvailable: true,
  });
  expect(res.body.availability['201']).toMatchObject({ isAvailable: false, vehicleType: 'elektrichka', ticketPurchaseUrl: 'https://t' });
});

test('невідоме місто → порожній результат, погана дата → 400', async () => {
  const { prisma } = buildPrisma();
  const app = createApp({ prisma, adminPassword: 'x' });
  const empty = await request(app).get('/poputky/search?from=Kyiv&to=Nowhere&date=2026-12-01').expect(200);
  expect(empty.body).toMatchObject({ listings: [], schedules: [], availability: {} });
  await request(app).get('/poputky/search?from=Kyiv&to=Malyn&date=01.12.2026').expect(400);
  await request(app).get('/poputky/search?from=Kyiv&date=2026-12-01').expect(400);
});

test('bookedSeatsBySchedule: рахує по scheduleId і по legacy route+time', () => {
  const m = bookedSeatsBySchedule(
    [{ id: 1, route: 'A-B', departureTime: '09:00' }, { id: 2, route: 'A-B', departureTime: '10:00' }],
    [
      { scheduleId: 1, route: 'A-B', departureTime: '09:00', seats: 2 },
      { scheduleId: null, route: 'A-B', departureTime: '10:00', seats: 4 },
      { scheduleId: null, route: 'A-C', departureTime: '10:00', seats: 9 },
    ]
  );
  expect(m.get(1)).toBe(2);
  expect(m.get(2)).toBe(4);
});
