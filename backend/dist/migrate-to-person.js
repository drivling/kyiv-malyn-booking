"use strict";
/**
 * Одноразова міграція даних: з таблиць Booking та ViberListing у таблицю Person.
 * Запустити після застосування міграції add_person_and_person_id:
 *   npx prisma migrate deploy
 *   npx ts-node src/migrate-to-person.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
function normalizePhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '38' + cleaned;
    }
    return cleaned;
}
function maskDbUrl(url) {
    if (!url)
        return '(не встановлено)';
    try {
        const u = new URL(url);
        return `${u.hostname}${u.pathname ? '***' + u.pathname.slice(-6) : ''}`;
    }
    catch {
        return url.slice(0, 20) + '...';
    }
}
async function main() {
    const prisma = new client_1.PrismaClient();
    const dbUrl = process.env.DATABASE_URL;
    console.log('🔄 Початок міграції даних у Person...');
    console.log('📍 Підключення до БД:', maskDbUrl(dbUrl), '\n');
    // 1. Збираємо всі унікальні номери з Booking та ViberListing з найкращими даними
    const bookings = await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } });
    const listings = await prisma.viberListing.findMany({ orderBy: { createdAt: 'desc' } });
    const byPhone = new Map();
    for (const b of bookings) {
        const norm = normalizePhone(b.phone);
        const existing = byPhone.get(norm);
        const hasTelegram = b.telegramUserId &&
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
        }
        else {
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
        }
        else if (l.senderName?.trim() && !existing.fullName) {
            existing.fullName = l.senderName.trim();
        }
    }
    console.log(`📋 Знайдено ${byPhone.size} унікальних номерів для персон.\n`);
    // 2. Створюємо Person та зберігаємо мапу phoneNormalized -> personId
    const phoneToPersonId = new Map();
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
    // Перевірка: чи дані справді в БД
    const personCount = await prisma.person.count();
    const bookingsWithPerson = await prisma.booking.count({ where: { personId: { not: null } } });
    const listingsWithPerson = await prisma.viberListing.count({ where: { personId: { not: null } } });
    console.log('\n📊 Перевірка після запису:');
    console.log(`   Person: ${personCount} записів`);
    console.log(`   Booking з personId: ${bookingsWithPerson}`);
    console.log(`   ViberListing з personId: ${listingsWithPerson}`);
    if (personCount === 0 || (updatedBookings > 0 && bookingsWithPerson === 0)) {
        console.log('\n⚠️  Увага: очікувані записи не збігаються. Можливо скрипт підключився до іншої БД.');
        console.log('   Переконайтесь, що запускаєте: cd backend && railway run npm run migrate-to-person');
        console.log('   і переглядаєте ту саму БД у Railway (Data / Postgres).');
    }
    console.log('\n✅ Міграція даних у Person завершена.');
    await prisma.$disconnect();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
