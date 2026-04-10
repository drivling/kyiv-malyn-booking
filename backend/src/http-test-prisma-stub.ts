/**
 * Заглушка Prisma для HTTP-даун-тестів без реального підключення до БД.
 *
 * Приклади записів узгоджені зі схемою Prisma (як у локальній Postgres),
 * але значення вигадані — лише орієнтир для майбутніх точкових моків (findUnique тощо).
 */
import type { PrismaClient } from '@prisma/client';

/** Приклад `Person` (поля як у БД; не використовується як живий рядок) */
export const examplePersonRow = {
  id: 42,
  phoneNormalized: '380679551952',
  fullName: 'Тест Тестович',
  telegramChatId: '123456789',
  telegramUserId: '123456789',
  telegramUsername: 'testuser',
  telegramPromoSentAt: null as Date | null,
  telegramReminderSentAt: null as Date | null,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  updatedAt: new Date('2026-01-15T10:00:00.000Z'),
};

/** Приклад `ViberListing` (водій, маршрут як у проді) */
export const exampleViberListingRow = {
  id: 1001,
  rawMessage: 'Київ-Малин завтра 18:00 2 місця',
  source: 'Viber1' as const,
  senderName: 'Водій Т.',
  listingType: 'driver' as const,
  route: 'Kyiv-Malyn',
  date: new Date('2026-04-11T00:00:00.000Z'),
  departureTime: '18:00',
  seats: 2,
  phone: '380679551952',
  notes: null as string | null,
  priceUah: null as number | null,
  isActive: true,
  personId: 42,
  createdAt: new Date('2026-04-10T08:00:00.000Z'),
  updatedAt: new Date('2026-04-10T08:00:00.000Z'),
};

/**
 * Prisma без методів: будь-який випадковий виклик на БД у тесті дасть зрозумілу помилку.
 * Для маршрутів фази 2 (/health, /status, /admin/login, /localtransport/data) БД не чіпається.
 */
export function createNoDbPrismaStub(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      throw new Error(
        `Prisma stub: property "${String(prop)}" was accessed — this smoke test must not hit the database.`,
      );
    },
  });
}
