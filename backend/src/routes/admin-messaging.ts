import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  buildInactivityReminderMessage,
  getTelegramScenarioLinks,
  getPersonByPhone,
  isTelegramEnabled,
  normalizePhone,
  sendInactivityReminder,
  sendMessageViaUserAccount,
} from '../telegram';
import { getTelegramReminderWhere, getChannelPromoWhere, PROMO_NOT_FOUND_SENTINEL } from '../index-helpers';
import { requireAdmin } from '../middleware/require-admin';

function buildChannelPromoMessage(): string {
  const links = getTelegramScenarioLinks();
  return `
📢 <b>Поїздки Київ ↔ Малин ↔ Житомир ↔ Коростень</b>

Підпишіться на наш бот — бронювання маршруток та попуток у один клік:
• як водій: ${links.driver}
• як пасажир: ${links.passenger}

Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
}

export function createAdminMessagingRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

/** Список Person для Telegram-нагадувань (база = з ботом). Query: ?filter=all|no_active_viber|no_reminder_7_days */
r.get('/admin/telegram-reminder-persons', requireAdmin, async (req, res) => {
  try {
    const filter = (req.query.filter as string)?.trim() || 'all';
    const where = getTelegramReminderWhere(filter);
    const persons = await prisma.person.findMany({
      where,
      select: {
        id: true,
        phoneNormalized: true,
        fullName: true,
        telegramChatId: true,
        telegramReminderSentAt: true,
      },
      orderBy: { id: 'asc' },
    });
    res.json(
      persons.map(
        (p: {
          id: number;
          phoneNormalized: string;
          fullName: string | null;
          telegramReminderSentAt: Date | null;
        }) => ({
          id: p.id,
          phoneNormalized: p.phoneNormalized,
          fullName: p.fullName,
          telegramReminderSentAt: p.telegramReminderSentAt ? p.telegramReminderSentAt.toISOString() : null,
        })
      )
    );
  } catch (e) {
    console.error('❌ telegram-reminder-persons:', e);
    res.status(500).json({ error: 'Failed to load telegram reminder persons' });
  }
});

/** Помилки відправки через персональний акаунт (PRIVACY_PREMIUM_REQUIRED тощо) */
r.get('/admin/telegram-user-send-errors', requireAdmin, async (_req, res) => {
  try {
    const rows = await prisma.telegramUserSendError.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (e) {
    console.error('❌ telegram-user-send-errors:', e);
    res.status(500).json({ error: 'Не вдалося завантажити помилки' });
  }
});

/** Обнулити таблицю помилок user-sender */
r.delete('/admin/telegram-user-send-errors', requireAdmin, async (_req, res) => {
  try {
    const result = await prisma.telegramUserSendError.deleteMany({});
    res.json({ deleted: result.count });
  } catch (e) {
    console.error('❌ DELETE telegram-user-send-errors:', e);
    res.status(500).json({ error: 'Не вдалося обнулити' });
  }
});

/** Відправити Telegram-нагадування неактивним користувачам. Body: { filter?, limit?, delaysMs? } */
r.post('/admin/send-telegram-reminders', requireAdmin, async (req, res) => {
  if (!isTelegramEnabled()) {
    return res.status(400).json({ error: 'Telegram bot не налаштовано' });
  }
  try {
    const filter = (req.body?.filter as string)?.trim() || 'all';
    if (!['all', 'no_active_viber', 'no_reminder_7_days'].includes(filter)) {
      res.status(400).json({ error: 'Invalid filter' });
      return;
    }
    const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
    const delaysMs = Array.isArray(req.body?.delaysMs)
      ? (req.body.delaysMs as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
      : undefined;
    const where = getTelegramReminderWhere(filter);
    let persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true, telegramChatId: true },
      orderBy: { id: 'asc' },
    });
    if (limit !== undefined) {
      persons = persons.slice(0, limit);
    }
    let sent = 0;
    let failed = 0;
    const blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }> = [];
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const chatId = p.telegramChatId;
      if (!chatId || chatId === '0' || !chatId.trim()) {
        failed++;
      } else {
        try {
          await sendInactivityReminder(chatId);
          sent++;
          await prisma.person.update({
            where: { id: p.id },
            data: { telegramReminderSentAt: new Date() },
          });
        } catch (err) {
          const errMsg = String((err as Error)?.message ?? err);
          const isBlocked = errMsg.includes('blocked by the user') || (errMsg.includes('403') && errMsg.toLowerCase().includes('forbidden'));
          if (isBlocked) {
            blocked.push({ id: p.id, phoneNormalized: p.phoneNormalized, fullName: p.fullName });
          }
          console.error(`❌ send-telegram-reminders person #${p.id}:`, err);
          failed++;
        }
      }
      if (delaysMs?.length && i < persons.length - 1) {
        const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    const total = persons.length;
    const message = `Нагадування відправлено: ${sent}, помилок: ${failed}, всього в вибірці: ${total}${blocked.length > 0 ? `; заблокували бота: ${blocked.length}` : ''}`;
    console.log(`📢 Telegram reminders (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent}, failed=${failed}, blocked=${blocked.length}, total=${total}`);
    res.json({ success: true, total, sent, failed, message, blocked });
  } catch (e) {
    console.error('❌ send-telegram-reminders:', e);
    res.status(500).json({ error: 'Failed to send telegram reminders' });
  }
});

/** Нагадати від особистого акаунта тим, хто заблокував бота. Body: { phones: string[], delaysSec?: number[] }. */
r.post('/admin/send-reminder-via-user-account', requireAdmin, async (req, res) => {
  try {
    const phones = Array.isArray(req.body?.phones) ? (req.body.phones as string[]).map((p) => String(p).trim()).filter(Boolean) : [];
    if (phones.length === 0) {
      return res.status(400).json({ error: 'Потрібен масив phones' });
    }
    const delaysSec = Array.isArray(req.body?.delaysSec)
      ? (req.body.delaysSec as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120))
      : [2, 15, 25, 30];
    const delaysMs = delaysSec.length > 0 ? delaysSec.map((s) => s * 1000) : [];
    const message = buildInactivityReminderMessage();
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < phones.length; i++) {
      const rawPhone = phones[i];
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        failed++;
      } else {
        const person = await getPersonByPhone(phone);
        const ok = await sendMessageViaUserAccount(phone, message, {
          telegramUsername: person?.telegramUsername ?? undefined,
        });
        if (ok) sent++;
        else failed++;
      }
      if (delaysMs.length > 0 && i < phones.length - 1) {
        const delayMs = delaysMs[i % delaysMs.length] ?? 30000;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    const resultMessage = `Відправлено від вашого імені: ${sent}, помилок: ${failed}`;
    console.log(`📢 Reminder via user account: ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed, message: resultMessage });
  } catch (e) {
    console.error('❌ send-reminder-via-user-account:', e);
    res.status(500).json({ error: 'Failed to send reminder via user account' });
  }
});

type ViberClientBehavior = {
  phoneNormalized: string;
  fullName: string | null;
  totalRides: number;
  firstRideDate: string | null;
  lastRideDate: string | null;
  routes: Array<{ route: string; count: number; share: number }>;
  weekdayStats: Array<{ weekday: number; count: number }>;
  timeOfDayStats: { morning: number; day: number; evening: number; night: number };
  behaviorSummary: string;
  recommendations: string[];
  /** Є прив'язка до Telegram бота (можна слати через бота). */
  hasTelegramBot: boolean;
  /** Пробували комунікувати, але не знайдено в Telegram — кнопки реклами неактивні. */
  communicationFailed: boolean;
  /** Профіль з аналітики: driver | passenger | mixed (показувати кнопки обох типів). */
  profileRole: 'driver' | 'passenger' | 'mixed';
};

/** Список Person для реклами каналу (база = без бота). Query: ?filter=no_telegram|no_communication|promo_not_found */
r.get('/admin/channel-promo-persons', requireAdmin, async (req, res) => {
  try {
    const filter = (req.query.filter as string)?.trim() || 'no_telegram';
    const where = getChannelPromoWhere(filter);
    const persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true },
      orderBy: { id: 'asc' },
    });
    res.json(persons);
  } catch (e) {
    console.error('❌ channel-promo-persons:', e);
    res.status(500).json({ error: 'Failed to load persons' });
  }
});

/** Відправити рекламу каналу. Body: { filter?, limit?, delaysMs? }. limit — лише перші N; delaysMs — паузи в мс між відправками [після 1-го, після 2-го, ...]. */
r.post('/admin/send-channel-promo', requireAdmin, async (req, res) => {
  try {
    const filter = (req.body?.filter as string)?.trim() || 'no_telegram';
    if (!['no_telegram', 'no_communication', 'promo_not_found'].includes(filter)) {
      res.status(400).json({ error: 'Invalid filter' });
      return;
    }
    const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
    const delaysMs = Array.isArray(req.body?.delaysMs)
      ? (req.body.delaysMs as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
      : undefined;
    const where = getChannelPromoWhere(filter);
    let persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true, telegramUsername: true },
      orderBy: { id: 'asc' },
    });
    if (limit !== undefined) {
      persons = persons.slice(0, limit);
    }
    const message = buildChannelPromoMessage();
    const sent: Array<{ phone: string; fullName: string | null }> = [];
    const notFound: Array<{ phone: string; fullName: string | null }> = [];
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const phone = normalizePhone(p.phoneNormalized);
      if (!phone) continue;
      const ok = await sendMessageViaUserAccount(phone, message, {
        telegramUsername: p.telegramUsername ?? undefined,
      });
      if (ok) {
        sent.push({ phone: p.phoneNormalized, fullName: p.fullName });
        await prisma.person.update({
          where: { id: p.id },
          data: { telegramPromoSentAt: new Date() },
        });
      } else {
        notFound.push({ phone: p.phoneNormalized, fullName: p.fullName });
        await prisma.person.update({
          where: { id: p.id },
          data: { telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL },
        });
      }
      if (delaysMs?.length && i < persons.length - 1) {
        const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    console.log(`📢 Channel promo (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent.length}, notFound=${notFound.length}`);
    res.json({ sent, notFound });
  } catch (e) {
    console.error('❌ send-channel-promo:', e);
    res.status(500).json({ error: 'Failed to send channel promo' });
  }
});

  return r;
}
