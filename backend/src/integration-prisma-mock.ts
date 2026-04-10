/**
 * Спрощений in-memory Prisma для інтеграційних HTTP-тестів критичних POST
 * (створення ViberListing + Person) без реальної БД.
 *
 * Форми полів узгоджені зі схемою Prisma / типовими рядками з продакшену
 * (phoneNormalized 380…, route Kyiv-Malyn тощо) — не копія живих id з вашої БД.
 */
import type { PrismaClient } from '@prisma/client';

type PersonRow = {
  id: number;
  phoneNormalized: string;
  fullName: string | null;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramPromoSentAt: Date | null;
  telegramReminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ListingRow = {
  id: number;
  rawMessage: string;
  source: string;
  senderName: string | null;
  listingType: string;
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  priceUah: number | null;
  isActive: boolean;
  personId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export function createListingFlowPrismaMock(options?: { firstPersonId?: number; firstListingId?: number }): PrismaClient {
  let nextPersonId = options?.firstPersonId ?? 900_001;
  let nextListingId = options?.firstListingId ?? 800_001;
  const personsByPhone = new Map<string, PersonRow>();
  const listings: ListingRow[] = [];

  const person = {
    async findUnique(args: { where: { phoneNormalized: string } }): Promise<PersonRow | null> {
      return personsByPhone.get(args.where.phoneNormalized) ?? null;
    },
    async upsert(args: {
      where: { phoneNormalized: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<PersonRow> {
      const key = args.where.phoneNormalized;
      let row = personsByPhone.get(key);
      const now = new Date();
      if (!row) {
        row = {
          id: nextPersonId++,
          phoneNormalized: key,
          fullName: (args.create.fullName as string | null) ?? null,
          telegramChatId: (args.create.telegramChatId as string | null) ?? null,
          telegramUserId: (args.create.telegramUserId as string | null) ?? null,
          telegramUsername: (args.create.telegramUsername as string | null) ?? null,
          telegramPromoSentAt: null,
          telegramReminderSentAt: null,
          createdAt: now,
          updatedAt: now,
        };
        personsByPhone.set(key, row);
        return row;
      }
      if (args.update.fullName != null) row.fullName = args.update.fullName as string | null;
      if (args.update.telegramChatId != null) row.telegramChatId = args.update.telegramChatId as string | null;
      if (args.update.telegramUserId != null) row.telegramUserId = args.update.telegramUserId as string | null;
      if (args.update.telegramUsername != null) row.telegramUsername = args.update.telegramUsername as string | null;
      row.updatedAt = now;
      return row;
    },
  };

  const booking = {
    async findMany(): Promise<unknown[]> {
      return [];
    },
  };

  const viberListing = {
    async findMany(args: {
      where: {
        listingType: string;
        route: string;
        isActive: boolean;
        date: { gte: Date; lt: Date };
        departureTime: string | null;
      };
      orderBy?: { createdAt: string };
    }): Promise<ListingRow[]> {
      const { gte, lt } = args.where.date;
      return listings.filter(
        (l) =>
          l.listingType === args.where.listingType &&
          l.route === args.where.route &&
          l.isActive === args.where.isActive &&
          l.date >= gte &&
          l.date < lt &&
          (l.departureTime ?? null) === (args.where.departureTime ?? null)
      );
    },
    async create(args: { data: Record<string, unknown> }): Promise<ListingRow> {
      const now = new Date();
      const d = args.data.date as Date;
      const row: ListingRow = {
        id: nextListingId++,
        rawMessage: String(args.data.rawMessage),
        source: String(args.data.source ?? 'Viber1'),
        senderName: (args.data.senderName as string | null) ?? null,
        listingType: String(args.data.listingType),
        route: String(args.data.route),
        date: d,
        departureTime: (args.data.departureTime as string | null) ?? null,
        seats: (args.data.seats as number | null) ?? null,
        phone: String(args.data.phone),
        notes: (args.data.notes as string | null) ?? null,
        priceUah: (args.data.priceUah as number | null) ?? null,
        isActive: Boolean(args.data.isActive ?? true),
        personId: (args.data.personId as number | null) ?? null,
        createdAt: now,
        updatedAt: now,
      };
      listings.push(row);
      return row;
    },
    async update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<ListingRow> {
      const row = listings.find((l) => l.id === args.where.id);
      if (!row) throw new Error(`listing ${args.where.id} not found`);
      const now = new Date();
      if (args.data.rawMessage != null) row.rawMessage = String(args.data.rawMessage);
      if (args.data.senderName !== undefined) row.senderName = args.data.senderName as string | null;
      if (args.data.seats !== undefined) row.seats = args.data.seats as number | null;
      if (args.data.phone != null) row.phone = String(args.data.phone);
      if (args.data.notes !== undefined) row.notes = args.data.notes as string | null;
      if (args.data.priceUah !== undefined) row.priceUah = args.data.priceUah as number | null;
      if (args.data.isActive !== undefined) row.isActive = Boolean(args.data.isActive);
      if (args.data.personId !== undefined) row.personId = args.data.personId as number | null;
      row.updatedAt = now;
      return row;
    },
  };

  const shell: Record<string, unknown> = {
    person,
    booking,
    viberListing,
    $connect: async () => {},
    $disconnect: async () => {},
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(shell),
  };

  return new Proxy(shell, {
    get(target, prop, receiver) {
      if (prop === Symbol.toStringTag) return 'PrismaClient';
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`integration-prisma-mock: unmocked prisma.${String(prop)}`);
    },
  }) as unknown as PrismaClient;
}

/** Приклад нормалізованого телефону (як у Person.phoneNormalized) — не з реальної БД */
export const EXAMPLE_PHONE_NORMALIZED = '380687211477';
