import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';

export function createAdminMaintenanceRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.post('/admin/fix-telegram-ids', requireAdmin, async (_req, res) => {
    try {
      console.log('🔧 Початок виправлення telegramUserId...');

      const problematicBookings = await prisma.booking.findMany({
        where: {
          telegramChatId: { not: null },
          OR: [{ telegramUserId: null }, { telegramUserId: '0' }, { telegramUserId: '' }],
        },
      });

      console.log(`📋 Знайдено ${problematicBookings.length} бронювань з невалідним telegramUserId`);

      if (problematicBookings.length === 0) {
        return res.json({
          success: true,
          message: 'Всі записи вже правильні!',
          fixed: 0,
          skipped: 0,
          total: 0,
        });
      }

      let fixed = 0;
      let skipped = 0;
      const details: string[] = [];

      for (const booking of problematicBookings) {
        if (booking.telegramChatId && booking.telegramChatId !== '0' && booking.telegramChatId.trim() !== '') {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              telegramUserId: booking.telegramChatId,
            },
          });

          const msg = `✅ #${booking.id}: telegramUserId оновлено з '${booking.telegramUserId}' на '${booking.telegramChatId}'`;
          console.log(msg);
          details.push(msg);
          fixed++;
        } else {
          const msg = `⚠️ #${booking.id}: пропущено (невалідний chatId: '${booking.telegramChatId}')`;
          console.log(msg);
          details.push(msg);
          skipped++;
        }
      }

      console.log(`📊 Виправлено: ${fixed}, Пропущено: ${skipped}, Всього: ${problematicBookings.length}`);

      res.json({
        success: true,
        message: 'Виправлення завершено!',
        fixed,
        skipped,
        total: problematicBookings.length,
        details,
      });
    } catch (error) {
      console.error('❌ Помилка виправлення:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return r;
}
