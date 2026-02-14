/**
 * Одноразова міграція даних: з таблиць Booking та ViberListing у таблицю Person.
 * Запустити після застосування міграції add_person_and_person_id:
 *   npx prisma migrate deploy
 *   npx ts-node src/migrate-to-person.ts
 */

import { PrismaClient } from '@prisma/client';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '38' + cleaned;
  }
  return cleaned;
}

async function main() {
  const prisma = new PrismaClient();

  console.log('🔄 Початок міграції даних у Person...\n');

  // 1. Збираємо всі унікальні номери з Booking та ViberListing з найкращими даними
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

  console.log(`📋 Знайдено ${byPhone.size} унікальних номерів для персон.\n`);

  // 2. Створюємо Person та зберігаємо мапу phoneNormalized -> personId
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

  // 3. Оновлюємо Booking.personId
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
  console.log(`✅ Оновлено Booking.personId: ${updatedBookings} записів.`);

  // 4. Оновлюємо ViberListing.personId
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
  console.log(`✅ Оновлено ViberListing.personId: ${updatedListings} записів.`);

  console.log('\n✅ Міграція даних у Person завершена.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
