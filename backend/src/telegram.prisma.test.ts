/**
 * Юніт-тести Prisma-залежної логіки в telegram.ts через setTelegramPrismaForTests (мок-клієнт).
 * test-pretest.cjs знімає TELEGRAM_BOT_TOKEN; після кожного тесту — resetTelegramPrismaForTests().
 */
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  setTelegramPrismaForTests,
  resetTelegramPrismaForTests,
  resetTelegramBotForTests,
  resetSpawnForTests,
  setSendMatchMessageToPersonForTests,
  getChatIdByPhone,
  getPersonByPhone,
  findOrCreatePersonByPhone,
  getNameByPhone,
  getPhoneByTelegramUser,
  getDriverFutureBookingsForMybookings,
  createOrMergeViberListing,
  notifyMatchingPassengersForNewDriver,
  notifyMatchingDriversForNewPassenger,
  notifyPassengerAboutDriverPair,
  notifyDriverAboutPassengerPair,
  executeBookViberRideShare,
} from './telegram';

afterEach(() => {
  setSendMatchMessageToPersonForTests(null);
  resetTelegramPrismaForTests();
  resetTelegramBotForTests();
  resetSpawnForTests();
});

function asPrisma(p: unknown): PrismaClient {
  return p as PrismaClient;
}

test('getChatIdByPhone: з Person.telegramChatId', async () => {
  const findUnique = mock.fn(async () => ({
    telegramChatId: '999888',
    phoneNormalized: '380501112233',
  }));
  setTelegramPrismaForTests(
    asPrisma({
      person: { findUnique },
      booking: { findMany: mock.fn(async () => []) },
    })
  );
  const chatId = await getChatIdByPhone('0501112233');
  assert.equal(chatId, '999888');
  assert.equal(findUnique.mock.calls.length, 1);
});

test('getChatIdByPhone: fallback на Booking', async () => {
  const findUnique = mock.fn(async () => ({ telegramChatId: null, phoneNormalized: '380501112233' }));
  const findMany = mock.fn(async () => [
    {
      phone: '0501112233',
      telegramChatId: '777',
      telegramUserId: 'u1',
    },
  ]);
  setTelegramPrismaForTests(asPrisma({ person: { findUnique }, booking: { findMany } }));
  assert.equal(await getChatIdByPhone('0501112233'), '777');
});

test('getPersonByPhone: findUnique з нормалізованим номером', async () => {
  const findUnique = mock.fn(async () => ({ id: 1, phoneNormalized: '380671234567' }));
  setTelegramPrismaForTests(asPrisma({ person: { findUnique } }));
  const p = await getPersonByPhone('0671234567');
  assert(p);
  assert.equal(p.id, 1);
  const firstCall = findUnique.mock.calls[0] as unknown as
    | { arguments: [{ where: { phoneNormalized: string } }] }
    | undefined;
  assert.equal(firstCall?.arguments[0]?.where?.phoneNormalized, '380671234567');
});

test('findOrCreatePersonByPhone: upsert', async () => {
  const upsert = mock.fn(async () => ({
    id: 42,
    phoneNormalized: '380501112233',
    fullName: 'Тест',
  }));
  setTelegramPrismaForTests(asPrisma({ person: { upsert } }));
  const r = await findOrCreatePersonByPhone('0501112233', { fullName: 'Тест' });
  assert.equal(r.id, 42);
  assert.equal(upsert.mock.calls.length, 1);
});

test('getNameByPhone: Person.fullName', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      person: {
        findUnique: mock.fn(async () => ({ fullName: '  Іван  ' })),
      },
      booking: { findMany: mock.fn(async () => []) },
    })
  );
  assert.equal(await getNameByPhone('0501112233'), 'Іван');
});

test('getNameByPhone: з Booking якщо Person без імені', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      person: { findUnique: mock.fn(async () => ({ fullName: null })) },
      booking: {
        findMany: mock.fn(async () => [
          { phone: '0990000000', name: 'Інший' },
          { phone: '0501112233', name: 'Петро' },
        ]),
      },
    })
  );
  assert.equal(await getNameByPhone('0501112233'), 'Петро');
});

test('getPhoneByTelegramUser: з Person', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      person: {
        findFirst: mock.fn(async () => ({ phoneNormalized: '380501112233' })),
      },
      booking: { findFirst: mock.fn(async () => null) },
    })
  );
  assert.equal(await getPhoneByTelegramUser('u1', 'c1'), '380501112233');
});

test('getPhoneByTelegramUser: з Booking', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      person: { findFirst: mock.fn(async () => null) },
      booking: {
        findFirst: mock.fn(async () => ({ phone: '0670000000' })),
      },
    })
  );
  assert.equal(await getPhoneByTelegramUser('u1', 'c1'), '0670000000');
});

test('getDriverFutureBookingsForMybookings: порожньо без Person', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      person: { findFirst: mock.fn(async () => null) },
    })
  );
  const rows = await getDriverFutureBookingsForMybookings('u', 'c', new Date());
  assert.deepEqual(rows, []);
});

test('getDriverFutureBookingsForMybookings: з оголошеннями та бронюваннями', async () => {
  const since = new Date('2026-01-01');
  setTelegramPrismaForTests(
    asPrisma({
      person: { findFirst: mock.fn(async () => ({ id: 5 })) },
      viberListing: {
        findMany: mock.fn(async () => [{ id: 10 }, { id: 11 }]),
      },
      booking: {
        findMany: mock.fn(async () => [
          { id: 1, route: 'Kyiv-Malyn', date: new Date('2026-06-01'), departureTime: '09:00', seats: 2, name: 'A', phone: '0501' },
        ]),
      },
    })
  );
  const rows = await getDriverFutureBookingsForMybookings('u', 'c', since);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route, 'Kyiv-Malyn');
});

test('createOrMergeViberListing: новий запис — create', async () => {
  const findMany = mock.fn(async () => []);
  const create = mock.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 100,
    source: 'Viber1',
    ...args.data,
  }));
  setTelegramPrismaForTests(asPrisma({ viberListing: { findMany, create, update: mock.fn() } }));
  const date = new Date(2026, 5, 15);
  const { listing, isNew } = await createOrMergeViberListing({
    rawMessage: 'нове',
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    date,
    departureTime: '10:00',
    seats: 2,
    phone: '0679551952',
    notes: null,
    isActive: true,
  });
  assert.equal(isNew, true);
  assert.equal(listing.id, 100);
  assert.equal(create.mock.calls.length, 1);
  assert.equal(findMany.mock.calls.length, 1);
});

test('createOrMergeViberListing: merge за телефоном — update', async () => {
  const date = new Date(2026, 5, 15);
  const existing = {
    id: 50,
    phone: '380679551952',
    personId: null,
    rawMessage: 'старе',
    senderName: 'Старе імʼя',
    notes: 'n1',
    seats: 1,
    departureTime: '10:00',
    isActive: true,
    source: 'Viber1',
  };
  const findMany = mock.fn(async () => [existing]);
  const update = mock.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...existing,
    ...data,
  }));
  setTelegramPrismaForTests(asPrisma({ viberListing: { findMany, create: mock.fn(), update } }));
  const { listing, isNew } = await createOrMergeViberListing({
    rawMessage: 'додаток',
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    date,
    departureTime: '10:00',
    seats: 3,
    phone: '0679551952',
    notes: 'n2',
    isActive: true,
    senderName: 'Нове',
  });
  assert.equal(isNew, false);
  assert.equal(listing.id, 50);
  assert.equal(update.mock.calls.length, 1);
  const upCall = update.mock.calls[0] as unknown as
    | { arguments: [{ data: { rawMessage?: string } }] }
    | undefined;
  const rawMerged = String(upCall?.arguments[0]?.data?.rawMessage ?? '');
  assert.ok(rawMerged.includes('старе'));
  assert.ok(rawMerged.includes('додаток'));
});

test('notifyMatchingPassengersForNewDriver: findMany для пасажирів і завершення без throw', async () => {
  const passenger = {
    id: 201,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T00:00:00.000Z'),
    departureTime: '10:00',
    phone: '0501111111',
    senderName: 'Пас',
    notes: null,
  };
  const findMany = mock.fn(async () => [passenger]);
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: { findMany },
      viberMatchPairNotification: { findUnique, upsert },
      person: { findUnique: mock.fn(async () => null) },
      booking: { findMany: mock.fn(async () => []) },
    })
  );
  const driverListing = {
    id: 100,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T12:00:00.000Z'),
    departureTime: '10:15',
    seats: 3,
    phone: '0679000000',
    senderName: 'Водій',
    notes: null,
  };
  await notifyMatchingPassengersForNewDriver(driverListing, null);
  assert.equal(findMany.mock.calls.length, 1);
  const fmCall = findMany.mock.calls[0] as unknown as
    | { arguments: [{ where: { listingType: string; route: string } }] }
    | undefined;
  const where = fmCall?.arguments[0]?.where;
  assert.equal(where?.listingType, 'passenger');
  assert.equal(where?.route, 'Kyiv-Malyn');
});

const driverListingStub = {
  id: 100,
  route: 'Kyiv-Malyn' as const,
  date: new Date('2026-06-15T12:00:00.000Z'),
  departureTime: '10:00',
  seats: 3,
  phone: '0679000000',
  senderName: 'Водій',
  notes: null as string | null,
};

test('notifyPassengerAboutDriverPair: skipped якщо вже passengerNotifiedAt', async () => {
  const findUnique = mock.fn(async () => ({ passengerNotifiedAt: new Date() }));
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(asPrisma({ viberMatchPairNotification: { findUnique, upsert } }));
  setSendMatchMessageToPersonForTests(async () => ({ sent: true, via: 'bot' }));
  const out = await notifyPassengerAboutDriverPair(
    driverListingStub,
    { id: 201, phone: '0501111111' },
    'exact'
  );
  assert.equal(out.kind, 'skipped');
  assert.equal(upsert.mock.calls.length, 0);
});

test('notifyPassengerAboutDriverPair: sent + upsert при успішній доставці (стаб)', async () => {
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(asPrisma({ viberMatchPairNotification: { findUnique, upsert } }));
  const sendStub = mock.fn(async () => ({ sent: true, via: 'user' as const }));
  setSendMatchMessageToPersonForTests(sendStub);
  const out = await notifyPassengerAboutDriverPair(
    driverListingStub,
    { id: 201, phone: '0501111111' },
    'exact'
  );
  assert.equal(out.kind, 'sent');
  assert.equal(out.via, 'user');
  assert.equal(sendStub.mock.calls.length, 1);
  const sendCall = sendStub.mock.calls[0] as unknown as { arguments: [string, string] } | undefined;
  assert.ok(String(sendCall?.arguments[1] ?? '').includes('Пряме співпадіння'));
  assert.equal(upsert.mock.calls.length, 1);
});

test('notifyPassengerAboutDriverPair: failed без upsert якщо стаб не доставив', async () => {
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(asPrisma({ viberMatchPairNotification: { findUnique, upsert } }));
  setSendMatchMessageToPersonForTests(async () => ({ sent: false, via: 'none' }));
  const out = await notifyPassengerAboutDriverPair(
    driverListingStub,
    { id: 201, phone: '0501111111' },
    'approximate'
  );
  assert.equal(out.kind, 'failed');
  assert.equal(upsert.mock.calls.length, 0);
});

test('notifyDriverAboutPassengerPair: skipped якщо вже driverNotifiedAt', async () => {
  const findUnique = mock.fn(async () => ({ driverNotifiedAt: new Date() }));
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(asPrisma({ viberMatchPairNotification: { findUnique, upsert } }));
  setSendMatchMessageToPersonForTests(async () => ({ sent: true, via: 'bot' }));
  const passenger = {
    id: 20,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T00:00:00.000Z'),
    departureTime: '10:00',
    phone: '0502222222',
    senderName: 'Пас',
    notes: null as string | null,
  };
  const out = await notifyDriverAboutPassengerPair({ id: 10, phone: '0671111111' }, passenger, 'exact');
  assert.equal(out.kind, 'skipped');
  assert.equal(upsert.mock.calls.length, 0);
});

test('notifyDriverAboutPassengerPair: sent + upsert (стаб)', async () => {
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(asPrisma({ viberMatchPairNotification: { findUnique, upsert } }));
  setSendMatchMessageToPersonForTests(async () => ({ sent: true, via: 'bot' }));
  const passenger = {
    id: 20,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T00:00:00.000Z'),
    departureTime: '10:05',
    phone: '0502222222',
    senderName: 'Пас',
    notes: null as string | null,
  };
  const out = await notifyDriverAboutPassengerPair({ id: 10, phone: '0671111111' }, passenger, 'exact');
  assert.equal(out.kind, 'sent');
  assert.equal(upsert.mock.calls.length, 1);
});

test('notifyMatchingDriversForNewPassenger: findMany водіїв + upsert для кожної пари (стаб доставки)', async () => {
  const driver = {
    id: 10,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T00:00:00.000Z'),
    departureTime: '10:00',
    seats: 4,
    phone: '0671111111',
    senderName: 'Водій А',
    notes: null as string | null,
  };
  const findManyDrivers = mock.fn(async () => [driver]);
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: { findMany: findManyDrivers },
      viberMatchPairNotification: { findUnique, upsert },
    })
  );
  setSendMatchMessageToPersonForTests(async () => ({ sent: true, via: 'bot' }));
  const passengerListing = {
    id: 20,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T12:00:00.000Z'),
    departureTime: '10:02',
    phone: '0502222222',
    senderName: 'Пас Б',
    notes: null as string | null,
  };
  await notifyMatchingDriversForNewPassenger(passengerListing, null);
  assert.equal(findManyDrivers.mock.calls.length, 1);
  assert.equal(upsert.mock.calls.length, 1);
});

test('notifyMatchingPassengersForNewDriver: upsert при стабі доставки', async () => {
  const passenger = {
    id: 201,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-15T00:00:00.000Z'),
    departureTime: '10:02',
    phone: '0501111111',
    senderName: 'Пас',
    notes: null as string | null,
  };
  const findMany = mock.fn(async () => [passenger]);
  const findUnique = mock.fn(async () => null);
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: { findMany },
      viberMatchPairNotification: { findUnique, upsert },
      person: { findUnique: mock.fn(async () => null) },
      booking: { findMany: mock.fn(async () => []) },
    })
  );
  setSendMatchMessageToPersonForTests(async () => ({ sent: true, via: 'bot' }));
  await notifyMatchingPassengersForNewDriver(
    {
      id: 100,
      route: 'Kyiv-Malyn',
      date: new Date('2026-06-15T12:00:00.000Z'),
      departureTime: '10:00',
      seats: 3,
      phone: '0679000000',
      senderName: 'Водій',
      notes: null,
    },
    null
  );
  assert.equal(upsert.mock.calls.length, 1);
});

test('executeBookViberRideShare: ok + rideShareRequest.create', async () => {
  const driverRow = {
    id: 5,
    listingType: 'driver' as const,
    isActive: true,
    route: 'Kyiv-Malyn',
    date: new Date('2026-06-20T08:00:00.000Z'),
    departureTime: '09:00',
    phone: '0670000001',
    personId: 1,
  };
  const viberFindUnique = mock.fn(async (args: { where: { id?: number } }) => {
    if (args.where.id === 5) return driverRow;
    return null;
  });
  const viberFindMany = mock.fn(async () => []);
  const viberCreate = mock.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 88,
    senderName: data.senderName,
    phone: data.phone,
    ...data,
  }));
  const rideCreate = mock.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 401,
    ...data,
  }));
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: {
        findUnique: viberFindUnique,
        findMany: viberFindMany,
        create: viberCreate,
        update: mock.fn(async () => ({})),
      },
      rideShareRequest: { create: rideCreate },
      person: {
        findFirst: mock.fn(async () => ({
          id: 9,
          phoneNormalized: '380501112233',
          fullName: 'Пасажир Тест',
        })),
        findUnique: mock.fn(async (args: { where: { id?: number; phoneNormalized?: string } }) => {
          if (args.where.id === 1) return { telegramChatId: null as string | null };
          return null;
        }),
      },
      booking: { findMany: mock.fn(async () => []) },
    })
  );
  const result = await executeBookViberRideShare('chat1', 'user1', 5);
  assert.equal(result.ok, true);
  assert.equal(viberFindUnique.mock.calls.length, 1);
  assert.equal(viberCreate.mock.calls.length, 1);
  assert.equal(rideCreate.mock.calls.length, 1);
  const rideData = rideCreate.mock.calls[0] as unknown as { arguments: [{ data: { driverListingId: number; passengerListingId: number } }] };
  assert.equal(rideData?.arguments[0]?.data?.driverListingId, 5);
  assert.equal(rideData?.arguments[0]?.data?.passengerListingId, 88);
});

test('executeBookViberRideShare: неактивне або не водій — помилка', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: {
        findUnique: mock.fn(async () => null),
      },
    })
  );
  const r = await executeBookViberRideShare('c', 'u', 999);
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes('не знайдено'));
});

test('executeBookViberRideShare: без телефону в Person — помилка', async () => {
  setTelegramPrismaForTests(
    asPrisma({
      viberListing: {
        findUnique: mock.fn(async () => ({
          id: 5,
          listingType: 'driver',
          isActive: true,
          route: 'Kyiv-Malyn',
          date: new Date(),
          departureTime: '10:00',
          phone: '067',
          personId: 1,
        })),
      },
      person: {
        findFirst: mock.fn(async () => ({ id: 9, phoneNormalized: null, fullName: null })),
      },
    })
  );
  const r = await executeBookViberRideShare('c', 'u', 5);
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes('телефон'));
});
