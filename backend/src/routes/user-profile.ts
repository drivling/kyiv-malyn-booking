/**
 * `/user/*` — профіль людини, що увійшла через Telegram Login (сторінка `/user`).
 *
 * Хто ця людина — лише з підписаного заголовка `X-Telegram-Login` (`requireTelegramLogin`,
 * Docs/transport-open-data-2026-10.md, фаза 4): `telegramUserId` у query/body більше не читаємо, бо його
 * знає будь-хто. Експорт (`GET /user/export`) і видалення (`DELETE /user`) — «Дані належать людині», П4.
 */
import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { serializeViberListing } from '../index-helpers';
import { requireTelegramLogin, telegramLoginFromRes } from '../telegram-login-auth';
import { collectPersonData, personDataExportFileName } from '../person-data-export';
import { describeEraseResult, erasePerson } from '../person-erase';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type UserProfileRouterDeps = {
  prisma: PrismaClient;
  /** Токен бота — ключ перевірки підпису віджета; без нього `/user/*` відповідає 503 */
  telegramBotToken?: string | null;
  /** Службове повідомлення власнику про видалення акаунта (HTML); у тестах — стаб */
  notifyAdmin?: (html: string) => Promise<unknown>;
  now?: () => Date;
};

export function createUserProfileRouter(deps: UserProfileRouterDeps): Router {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const r = express.Router();
  const auth = requireTelegramLogin({ botToken: deps.telegramBotToken, now: () => Math.floor(now().getTime() / 1000) });

  r.get('/user/profile', auth, async (_req, res) => {
    const telegramUserId = telegramLoginFromRes(res).id;
    try {
      const person = await prisma.person.findFirst({ where: { telegramUserId } });
      const since = startOfToday();

      const [bookings, passengerListings, driverListings] = await Promise.all([
        prisma.booking.findMany({
          where: { telegramUserId, date: { gte: since } },
          orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
        }),
        person
          ? prisma.viberListing.findMany({
              where: { personId: person.id, listingType: 'passenger', isActive: true, date: { gte: since } },
              orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
            })
          : [],
        person
          ? prisma.viberListing.findMany({
              where: { personId: person.id, listingType: 'driver', isActive: true, date: { gte: since } },
              orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
            })
          : [],
      ]);

      const profile = {
        person: person
          ? {
              id: person.id,
              fullName: person.fullName,
              phoneNormalized: person.phoneNormalized,
              telegramUserId: person.telegramUserId,
            }
          : null,
        bookings: bookings.map((b) => ({
          id: b.id,
          route: b.route,
          date: b.date instanceof Date ? b.date.toISOString() : b.date,
          departureTime: b.departureTime,
          seats: b.seats,
          name: b.name,
          phone: b.phone,
          source: b.source,
          createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
        })),
        passengerListings: passengerListings.map((l) => serializeViberListing(l)),
        driverListings: driverListings.map((l) => serializeViberListing(l)),
      };
      res.json(profile);
    } catch (error) {
      console.error('❌ GET /user/profile:', error);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  r.put('/user/profile/name', auth, async (req, res) => {
    const telegramUserId = telegramLoginFromRes(res).id;
    const { fullName } = req.body as { fullName?: string | null };
    try {
      const person = await prisma.person.findFirst({ where: { telegramUserId } });
      if (!person) {
        return res.status(404).json({ error: 'Профіль не знайдено. Підключіть номер телефону в боті.' });
      }
      const newName = fullName != null && String(fullName).trim() !== '' ? String(fullName).trim() : null;
      const displayName = newName ?? '';

      await prisma.$transaction([
        prisma.person.update({
          where: { id: person.id },
          data: { fullName: newName },
        }),
        prisma.booking.updateMany({
          where: { personId: person.id },
          data: { name: displayName },
        }),
        prisma.viberListing.updateMany({
          where: { personId: person.id },
          data: { senderName: newName },
        }),
      ]);

      res.json({ success: true, fullName: newName });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return res.status(404).json({ error: 'Profile not found' });
      console.error('❌ PUT /user/profile/name:', error);
      res.status(500).json({ error: 'Failed to update name' });
    }
  });

  /** «Завантажити мої дані» — один JSON файлом (той самий збирач, що й /mydata у боті) */
  r.get('/user/export', auth, async (_req, res) => {
    const telegramUserId = telegramLoginFromRes(res).id;
    try {
      const at = now();
      const data = await collectPersonData(prisma, { telegramUserId, now: at });
      if (!data) {
        return res.status(404).json({ error: 'Про вас у нас немає жодного запису — експортувати нічого.' });
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${personDataExportFileName(at)}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ GET /user/export:', error);
      res.status(500).json({ error: 'Failed to export data' });
    }
  });

  /** «Видалити акаунт» — знеособлення (person-erase.ts); підтвердження — на сторінці, тіло `{ confirm: true }` */
  r.delete('/user', auth, async (req, res) => {
    const login = telegramLoginFromRes(res);
    const body = (req.body ?? {}) as { confirm?: unknown };
    if (body.confirm !== true) {
      return res.status(400).json({ error: 'Підтвердіть видалення: { "confirm": true }' });
    }
    try {
      const result = await erasePerson(prisma, { telegramUserId: login.id, now: now() });
      if (!result) {
        return res.status(404).json({ error: 'Про вас у нас немає жодного запису — видаляти нічого.' });
      }
      const summary = describeEraseResult(result);
      if (deps.notifyAdmin) {
        await deps
          .notifyAdmin(
            `🧹 <b>Людина видалила акаунт</b> (сайт): Person #${result.personId ?? '—'}, tg ${login.id}.\n${summary}`,
          )
          .catch((e) => console.error('❌ notifyAdmin (DELETE /user):', e));
      }
      res.json({ success: true, erasedAt: result.erasedAt.toISOString(), counts: result.counts, summary });
    } catch (error) {
      console.error('❌ DELETE /user:', error);
      res.status(500).json({ error: 'Failed to delete account' });
    }
  });

  return r;
}
