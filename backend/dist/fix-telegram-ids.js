"use strict";
/**
 * Скрипт для виправлення telegramUserId в існуючих бронюваннях
 *
 * Проблема: в деяких записах telegramUserId = '0' або null,
 * але telegramChatId правильний (для приватних чатів chat_id = user_id)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function fixTelegramIds() {
    console.log('🔧 Початок виправлення telegramUserId...\n');
    try {
        // 1. Знаходимо всі бронювання де є chatId але немає валідного userId
        const problematicBookings = await prisma.booking.findMany({
            where: {
                telegramChatId: { not: null },
                OR: [
                    { telegramUserId: null },
                    { telegramUserId: '0' },
                    { telegramUserId: '' }
                ]
            }
        });
        console.log(`📋 Знайдено ${problematicBookings.length} бронювань з невалідним telegramUserId\n`);
        if (problematicBookings.length === 0) {
            console.log('✅ Всі записи вже правильні!');
            return;
        }
        // 2. Виправляємо кожне бронювання
        let fixed = 0;
        let skipped = 0;
        for (const booking of problematicBookings) {
            if (booking.telegramChatId &&
                booking.telegramChatId !== '0' &&
                booking.telegramChatId.trim() !== '') {
                // Для приватних чатів chat_id = user_id
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: {
                        telegramUserId: booking.telegramChatId
                    }
                });
                console.log(`✅ #${booking.id}: telegramUserId оновлено з '${booking.telegramUserId}' на '${booking.telegramChatId}'`);
                fixed++;
            }
            else {
                console.log(`⚠️ #${booking.id}: пропущено (невалідний chatId: '${booking.telegramChatId}')`);
                skipped++;
            }
        }
        console.log(`\n📊 Результат:`);
        console.log(`   ✅ Виправлено: ${fixed}`);
        console.log(`   ⚠️ Пропущено: ${skipped}`);
        console.log(`   📋 Всього: ${problematicBookings.length}`);
    }
    catch (error) {
        console.error('❌ Помилка виправлення:', error);
        throw error;
    }
    finally {
        await prisma.$disconnect();
    }
}
// Запуск скрипта
fixTelegramIds()
    .then(() => {
    console.log('\n✅ Виправлення завершено!');
    process.exit(0);
})
    .catch((error) => {
    console.error('\n❌ Помилка виконання скрипта:', error);
    process.exit(1);
});
