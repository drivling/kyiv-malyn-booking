/**
 * HTTP tests for trip-points + schedule vehicleType / elektrichka booking reject.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';

const TEST_ADMIN_PASSWORD = 'trip-test-admin';

type Point = {
  id: number;
  code: string;
  nameUk: string;
  requiredOnTrip: boolean;
  appearInFromTo: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type Sched = {
  id: number;
  route: string;
  departureTime: string;
  maxSeats: number;
  supportPhone: string | null;
  priceUah: number | null;
  startPointId: number | null;
  endPointId: number | null;
  viaPointIds: number[];
  vehicleType: string;
  boardingPlace: string | null;
  alightingPlace: string | null;
  tripNumber: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  ticketPurchaseUrl: string | null;
  activeWeekdays: number[];
  createdAt: Date;
  updatedAt: Date;
};

function seedPoints(): Point[] {
  const now = new Date();
  return [
    { id: 1, code: 'Kyiv', nameUk: 'Київ', requiredOnTrip: false, appearInFromTo: true, sortOrder: 10, createdAt: now, updatedAt: now },
    { id: 2, code: 'Malyn', nameUk: 'Малин', requiredOnTrip: true, appearInFromTo: true, sortOrder: 20, createdAt: now, updatedAt: now },
    { id: 3, code: 'Irpin', nameUk: 'Ірпінь', requiredOnTrip: false, appearInFromTo: false, sortOrder: 50, createdAt: now, updatedAt: now },
    { id: 4, code: 'Korosten', nameUk: 'Коростень', requiredOnTrip: false, appearInFromTo: true, sortOrder: 40, createdAt: now, updatedAt: now },
  ];
}

function createTripPrismaStub(store: { points: Point[]; schedules: Sched[]; bookings: any[] }): PrismaClient {
  const withPoints = (s: Sched) => ({
    ...s,
    startPoint: store.points.find((p) => p.id === s.startPointId) ?? null,
    endPoint: store.points.find((p) => p.id === s.endPointId) ?? null,
  });

  const stub: any = {
    tripPoint: {
      findMany: async ({ where, orderBy }: any = {}) => {
        let rows = [...store.points];
        if (where?.appearInFromTo != null) rows = rows.filter((p) => p.appearInFromTo === where.appearInFromTo);
        if (orderBy) rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
        return rows;
      },
      create: async ({ data }: any) => {
        const row: Point = {
          id: store.points.length + 1,
          code: data.code,
          nameUk: data.nameUk,
          requiredOnTrip: Boolean(data.requiredOnTrip),
          appearInFromTo: data.appearInFromTo !== false,
          sortOrder: data.sortOrder ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.points.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const i = store.points.findIndex((p) => p.id === where.id);
        if (i < 0) {
          const err: any = new Error('not found');
          err.code = 'P2025';
          throw err;
        }
        store.points[i] = { ...store.points[i], ...data, updatedAt: new Date() };
        return store.points[i];
      },
      delete: async ({ where }: any) => {
        const i = store.points.findIndex((p) => p.id === where.id);
        if (i < 0) {
          const err: any = new Error('not found');
          err.code = 'P2025';
          throw err;
        }
        const [row] = store.points.splice(i, 1);
        return row;
      },
    },
    schedule: {
      findMany: async ({ where }: any = {}) => {
        let rows = store.schedules.map(withPoints);
        if (where?.route) rows = rows.filter((s) => s.route === where.route);
        if (where?.vehicleType) rows = rows.filter((s) => s.vehicleType === where.vehicleType);
        return rows;
      },
      findUnique: async ({ where }: any) => {
        if (where?.route_departureTime) {
          const s = store.schedules.find(
            (x) => x.route === where.route_departureTime.route && x.departureTime === where.route_departureTime.departureTime
          );
          return s ? withPoints(s) : null;
        }
        if (where?.id != null) {
          const s = store.schedules.find((x) => x.id === where.id);
          return s ? withPoints(s) : null;
        }
        return null;
      },
      findFirst: async ({ where }: any = {}) => {
        const s = store.schedules.find((x) => {
          if (where?.supportPhone?.not != null) return x.supportPhone != null;
          return true;
        });
        return s ? withPoints(s) : null;
      },
      create: async ({ data }: any) => {
        const dup = store.schedules.some((s) => s.route === data.route && s.departureTime === data.departureTime);
        if (dup) {
          const err: any = new Error('dup');
          err.code = 'P2002';
          throw err;
        }
        const row: Sched = {
          id: store.schedules.length + 1,
          route: data.route,
          departureTime: data.departureTime,
          maxSeats: data.maxSeats ?? 20,
          supportPhone: data.supportPhone ?? null,
          priceUah: data.priceUah ?? null,
          startPointId: data.startPointId ?? null,
          endPointId: data.endPointId ?? null,
          viaPointIds: data.viaPointIds ?? [],
          vehicleType: data.vehicleType ?? 'marshrutka',
          boardingPlace: data.boardingPlace ?? null,
          alightingPlace: data.alightingPlace ?? null,
          tripNumber: data.tripNumber ?? null,
          arrivalTime: data.arrivalTime ?? null,
          durationMinutes: data.durationMinutes ?? null,
          ticketPurchaseUrl: data.ticketPurchaseUrl ?? null,
          activeWeekdays: data.activeWeekdays ?? [1, 2, 3, 4, 5, 6, 7],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.schedules.push(row);
        return withPoints(row);
      },
      update: async ({ where, data }: any) => {
        const i = store.schedules.findIndex((s) => s.id === where.id);
        if (i < 0) {
          const err: any = new Error('not found');
          err.code = 'P2025';
          throw err;
        }
        store.schedules[i] = { ...store.schedules[i], ...data, updatedAt: new Date() };
        return withPoints(store.schedules[i]);
      },
      delete: async ({ where }: any) => {
        const i = store.schedules.findIndex((s) => s.id === where.id);
        if (i < 0) {
          const err: any = new Error('not found');
          err.code = 'P2025';
          throw err;
        }
        const [row] = store.schedules.splice(i, 1);
        return row;
      },
      count: async ({ where }: any = {}) => {
        return store.schedules.filter((s) => {
          if (where?.OR) {
            return where.OR.some((c: any) =>
              (c.startPointId != null && s.startPointId === c.startPointId) ||
              (c.endPointId != null && s.endPointId === c.endPointId)
            );
          }
          return true;
        }).length;
      },
    },
    booking: {
      findMany: async () => store.bookings,
      create: async ({ data }: any) => {
        const row = { id: store.bookings.length + 1, ...data, source: 'schedule', createdAt: new Date() };
        store.bookings.push(row);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      findUnique: async () => null,
      delete: async () => ({}),
    },
    viberListing: { updateMany: async () => ({ count: 0 }) },
    person: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 1, ...data }),
      update: async ({ data }: any) => ({ id: 1, ...data }),
    },
  };

  return stub as PrismaClient;
}

function appWith(store: { points: Point[]; schedules: Sched[]; bookings: any[] }) {
  return createApp({ prisma: createTripPrismaStub(store), adminPassword: TEST_ADMIN_PASSWORD });
}

async function adminToken(app: ReturnType<typeof createApp>) {
  const res = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token as string;
}

test('GET /trip-points returns catalog', async () => {
  const store = { points: seedPoints(), schedules: [] as Sched[], bookings: [] as any[] };
  const res = await request(appWith(store)).get('/trip-points');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 4);
});

test('POST /schedules creates marshrutka with points', async () => {
  const store = { points: seedPoints(), schedules: [] as Sched[], bookings: [] as any[] };
  const app = appWith(store);
  const token = await adminToken(app);
  const res = await request(app)
    .post('/schedules')
    .set('Authorization', token)
    .send({
      startPointId: 1,
      endPointId: 2,
      viaPointIds: [3],
      departureTime: '09:00',
      vehicleType: 'marshrutka',
      boardingPlace: 'м. Ірпінь',
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.route, 'Kyiv-Malyn-Irpin');
  assert.equal(res.body.vehicleType, 'marshrutka');
  assert.equal(res.body.boardingPlace, 'м. Ірпінь');
});

test('POST /schedules elektrichka requires ticket URL', async () => {
  const store = { points: seedPoints(), schedules: [] as Sched[], bookings: [] as any[] };
  const app = appWith(store);
  const token = await adminToken(app);
  const bad = await request(app)
    .post('/schedules')
    .set('Authorization', token)
    .send({
      startPointId: 4,
      endPointId: 2,
      departureTime: '07:10',
      vehicleType: 'elektrichka',
    });
  assert.equal(bad.status, 400);

  const ok = await request(app)
    .post('/schedules')
    .set('Authorization', token)
    .send({
      startPointId: 4,
      endPointId: 2,
      departureTime: '07:10',
      vehicleType: 'elektrichka',
      ticketPurchaseUrl: 'https://tickets.example/buy',
      tripNumber: '6102',
    });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.tripNumber, '6102');
});

test('POST /bookings rejects elektrichka', async () => {
  const now = new Date();
  const store = {
    points: seedPoints(),
    schedules: [
      {
        id: 1,
        route: 'Korosten-Malyn',
        departureTime: '07:10',
        maxSeats: 20,
        supportPhone: null,
        priceUah: null,
        startPointId: 4,
        endPointId: 2,
        viaPointIds: [],
        vehicleType: 'elektrichka',
        boardingPlace: null,
        alightingPlace: null,
        tripNumber: '6102',
        arrivalTime: null,
        durationMinutes: null,
        ticketPurchaseUrl: 'https://tickets.example/buy',
        activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
        createdAt: now,
        updatedAt: now,
      },
    ] as Sched[],
    bookings: [] as any[],
  };
  const res = await request(appWith(store)).post('/bookings').send({
    route: 'Korosten-Malyn',
    date: '2026-08-12',
    departureTime: '07:10',
    seats: 1,
    name: 'Іван Петренко',
    phone: '+380501112233',
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Електричк/i);
});
