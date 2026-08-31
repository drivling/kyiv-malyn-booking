import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  fetchAndImportTelegramGroupMessages,
  getTelegramScenarioLinks,
  isTelegramEnabled,
  sendTripReminder,
  sendTripReminderSmsOnly,
  sendTripReminderToday,
} from '../telegram';
import { requireAdmin } from '../middleware/require-admin';

export function createTelegramRoutesRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.post('/telegram/send-reminders', requireAdmin, async (_req, res) => {
    if (!isTelegramEnabled()) {
      return res.status(400).json({ error: 'Telegram bot не налаштовано' });
    }

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startOfDay = new Date(tomorrow);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(tomorrow);
      endOfDay.setHours(23, 59, 59, 999);

      // Беремо всі бронювання на завтра (не лише з Telegram) — тих, хто без бота
      // або заблокував його, намагаємось дістати платним SMS-фолбеком.
      const bookings = await prisma.booking.findMany({
        where: {
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        include: { viberListing: true },
      });

      let sent = 0;
      let smsSent = 0;
      let failed = 0;
      let skipped = 0;

      for (const booking of bookings) {
        const driver = booking.viberListing
          ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
          : undefined;
        const rb = {
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
          name: booking.name,
          driver,
          personId: booking.personId,
          phone: booking.phone,
          bookingId: booking.id,
        };
        try {
          if (booking.telegramChatId) {
            const d = await sendTripReminder(booking.telegramChatId, rb);
            if (d.delivered === 'bot') sent++;
            else if (d.delivered === 'sms') smsSent++;
            else failed++;
          } else {
            const d = await sendTripReminderSmsOnly(rb, 'tomorrow');
            if (d.delivered === 'sms') smsSent++;
            else skipped++; // немає Telegram і платний SMS не пройшов/вимкнено
          }
        } catch (error) {
          console.error(`❌ Не вдалося надіслати нагадування для booking #${booking.id}:`, error);
          failed++;
        }
      }

      res.json({
        success: true,
        message: `Нагадування: бот ${sent}, SMS ${smsSent}, помилок ${failed}, без каналу ${skipped}`,
        total: bookings.length,
        sent,
        smsSent,
        failed,
        skipped,
      });
    } catch (error) {
      console.error('❌ Помилка відправки нагадувань:', error);
      res.status(500).json({ error: 'Failed to send reminders' });
    }
  });

  r.post('/telegram/fetch-group-messages', requireAdmin, async (_req, res) => {
    try {
      const result = await fetchAndImportTelegramGroupMessages();
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error,
          created: 0,
          total: 0,
        });
      }
      res.json({
        success: true,
        message:
          result.created > 0 ? `Імпортовано ${result.created} нових з ${result.total} повідомлень` : 'Немає нових повідомлень',
        created: result.created,
        total: result.total,
      });
    } catch (error) {
      console.error('❌ /telegram/fetch-group-messages:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch and import', created: 0, total: 0 });
    }
  });

  r.post('/telegram/send-reminders-today', requireAdmin, async (_req, res) => {
    if (!isTelegramEnabled()) {
      return res.status(400).json({ error: 'Telegram bot не налаштовано' });
    }

    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const bookings = await prisma.booking.findMany({
        where: {
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        include: { viberListing: true },
      });

      let sent = 0;
      let smsSent = 0;
      let failed = 0;
      let skipped = 0;

      for (const booking of bookings) {
        const driver = booking.viberListing
          ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
          : undefined;
        const rb = {
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
          name: booking.name,
          driver,
          personId: booking.personId,
          phone: booking.phone,
          bookingId: booking.id,
        };
        try {
          if (booking.telegramChatId) {
            const d = await sendTripReminderToday(booking.telegramChatId, rb);
            if (d.delivered === 'bot') sent++;
            else if (d.delivered === 'sms') smsSent++;
            else failed++;
          } else {
            const d = await sendTripReminderSmsOnly(rb, 'today');
            if (d.delivered === 'sms') smsSent++;
            else skipped++;
          }
        } catch (error) {
          console.error(`❌ Не вдалося надіслати нагадування (сьогодні) для booking #${booking.id}:`, error);
          failed++;
        }
      }

      res.json({
        success: true,
        message: `Нагадування (сьогодні): бот ${sent}, SMS ${smsSent}, помилок ${failed}, без каналу ${skipped}`,
        total: bookings.length,
        sent,
        smsSent,
        failed,
        skipped,
      });
    } catch (error) {
      console.error('❌ Помилка відправки нагадувань (сьогодні):', error);
      res.status(500).json({ error: 'Failed to send reminders (today)' });
    }
  });

  r.get('/telegram/status', requireAdmin, (_req, res) => {
    res.json({
      enabled: isTelegramEnabled(),
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ? 'configured' : 'not configured',
      botToken: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured',
    });
  });

  r.get('/telegram/scenarios', (_req, res) => {
    const links = getTelegramScenarioLinks();
    res.json({
      enabled: isTelegramEnabled(),
      scenarios: {
        driver: {
          title: 'Запит на поїздку як водій',
          command: '/adddriverride',
          deepLink: links.driver,
        },
        passenger: {
          title: 'Запит на поїздку як пасажир',
          command: '/addpassengerride',
          deepLink: links.passenger,
        },
        view: {
          title: 'Вільний перегляд поїздок',
          command: '/poputky',
          deepLink: links.view,
          webLink: links.poputkyWeb,
        },
      },
    });
  });

  return r;
}
