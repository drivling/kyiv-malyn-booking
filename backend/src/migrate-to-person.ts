/**
 * Одноразова міграція даних: з таблиць Booking та ViberListing у таблицю Person.
 * Можна викликати: ts-node src/migrate-to-person.ts або HTTP POST /admin/migrate-to-person (тільки адмін).
 * Після виконання на проді — ендпоінт можна прибрати.
 */

import { PrismaClient } from '@prisma/client';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '38' + cleaned;
  }
  return cleaned;
}

function maskDbUrl(url: string | undefined): string {
  if (!url) return '(не встановлено)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname ? '***' + u.pathname.slice(-6) : ''}`;
  } catch {
    return url.slice(0, 20) + '...';
  }
}

export interface MigrateToPersonResult {
  ok: boolean;
  dbHost: string;
  personsFound: number;
  updatedBookings: number;
  updatedListings: number;
  personCount: number;
  bookingsWithPerson: number;
  listingsWithPerson: number;
  error?: string;
}

/** Виконує міграцію даних у Person. Можна викликати з HTTP (на Railway буде прод-БД). */
export async function runMigrateToPerson(options?: { log?: boolean }): Promise<MigrateToPersonResult> {
  const log = options?.log !== false;
  const prisma = new PrismaClient();
  const dbUrl = process.env.DATABASE_URL;
  if (log) {
    console.log('🔄 Початок міграції даних у Person...');
    console.log('📍 Підключення до БД:', maskDbUrl(dbUrl), '\n');
  }

  try {
    const bookings = await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } });
    const listings = await prisma.viberListing.findMany({ orderBy: { createdAt: 'desc' } });

  type PersonData = {
    phoneNormalized: string;
    fullName: string | null;
    telegramChatId: string | null;
    telegramUserId: string | null;
  };

  const byPhone = new Map<string, PersonData>();

  for (const b of bookings) {
    const norm = normalizePhone(b.phone);
    const existing = byPhone.get(norm);
    const hasTelegram =
      b.telegramUserId &&
      b.telegramUserId !== '0' &&
      b.telegramUserId.trim() !== '' &&
      b.telegramChatId &&
      b.telegramChatId !== '0' &&
      b.telegramChatId.trim() !== '';
    if (!existing) {
      byPhone.set(norm, {
        phoneNormalized: norm,
        fullName: b.name?.trim() || null,
        telegramChatId: hasTelegram ? b.telegramChatId : null,
        telegramUserId: hasTelegram ? b.telegramUserId : null,
      });
    } else {
      if (hasTelegram && !existing.telegramUserId) {
        existing.telegramChatId = b.telegramChatId;
        existing.telegramUserId = b.telegramUserId;
      }
      if (b.name?.trim() && !existing.fullName) {
        existing.fullName = b.name.trim();
      }
    }
  }

  for (const l of listings) {
    const norm = normalizePhone(l.phone);
    const existing = byPhone.get(norm);
    if (!existing) {
      byPhone.set(norm, {
        phoneNormalized: norm,
        fullName: l.senderName?.trim() || null,
        telegramChatId: null,
        telegramUserId: null,
      });
    } else if (l.senderName?.trim() && !existing.fullName) {
      existing.fullName = l.senderName.trim();
    }
  }

    if (log) console.log(`📋 Знайдено ${byPhone.size} унікальних номерів для персон.\n`);

    const phoneToPersonId = new Map<string, number>();
    for (const data of byPhone.values()) {
      const person = await prisma.person.upsert({
        where: { phoneNormalized: data.phoneNormalized },
        create: {
          phoneNormalized: data.phoneNormalized,
          fullName: data.fullName,
          telegramChatId: data.telegramChatId,
          telegramUserId: data.telegramUserId,
        },
        update: {
          ...(data.fullName != null && { fullName: data.fullName }),
          ...(data.telegramChatId != null && { telegramChatId: data.telegramChatId }),
          ...(data.telegramUserId != null && { telegramUserId: data.telegramUserId }),
        },
      });
      phoneToPersonId.set(data.phoneNormalized, person.id);
    }

    let updatedBookings = 0;
    for (const b of bookings) {
      const norm = normalizePhone(b.phone);
      const personId = phoneToPersonId.get(norm);
      if (personId) {
        await prisma.booking.update({
          where: { id: b.id },
          data: { personId },
        });
        updatedBookings++;
      }
    }
    if (log) console.log(`✅ Оновлено Booking.personId: ${updatedBookings} записів.`);

    let updatedListings = 0;
    for (const l of listings) {
      const norm = normalizePhone(l.phone);
      const personId = phoneToPersonId.get(norm);
      if (personId) {
        await prisma.viberListing.update({
          where: { id: l.id },
          data: { personId },
        });
        updatedListings++;
      }
    }
    if (log) console.log(`✅ Оновлено ViberListing.personId: ${updatedListings} записів.`);

    const personCount = await prisma.person.count();
    const bookingsWithPerson = await prisma.booking.count({ where: { personId: { not: null } } });
    const listingsWithPerson = await prisma.viberListing.count({ where: { personId: { not: null } } });
    if (log) {
      console.log('\n📊 Перевірка після запису:');
      console.log(`   Person: ${personCount} записів`);
      console.log(`   Booking з personId: ${bookingsWithPerson}`);
      console.log(`   ViberListing з personId: ${listingsWithPerson}`);
      console.log('\n✅ Міграція даних у Person завершена.');
    }
    await prisma.$disconnect();
    return {
      ok: true,
      dbHost: maskDbUrl(dbUrl),
      personsFound: byPhone.size,
      updatedBookings,
      updatedListings,
      personCount,
      bookingsWithPerson,
      listingsWithPerson,
    };
  } catch (err) {
    await prisma.$disconnect().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (log) console.error('❌ Помилка міграції:', err);
    return {
      ok: false,
      dbHost: maskDbUrl(dbUrl),
      personsFound: 0,
      updatedBookings: 0,
      updatedListings: 0,
      personCount: 0,
      bookingsWithPerson: 0,
      listingsWithPerson: 0,
      error: message,
    };
  }
}

async function main() {
  const result = await runMigrateToPerson({ log: true });
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
