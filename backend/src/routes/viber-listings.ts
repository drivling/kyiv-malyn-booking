import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  findOrCreatePersonByPhone,
  getNameByPhone,
  isTelegramEnabled,
  resolveNameByPhoneFromTelegram,
  sendViberListingConfirmationToUser,
  sendViberListingNotificationToAdmin,
} from '../telegram';
import { enqueueListingMatch } from '../notification-queue';
import { importListingsToRideEvents } from '../viber-analytics-import';
import { parseViberMessage, parseViberMessages } from '../viber-parser';
import {
  serializeViberListing,
  getViberListingEndDateTime,
  isPastRideDate,
} from '../index-helpers';
import { ADMIN_AUTH_TOKEN, requireAdmin } from '../middleware/require-admin';
import { getCatalog } from '../catalog-cache';
import { listingMatchesSearchOd } from '../poputky-od';
import { PUBLIC_LISTING_SELECT, toPublicListing } from '../viber-listing-public';
import { tripDayWhere } from '../trip-day';
import { dedupeViberListingsAfterUpdate } from '../viber-listing-dedupe-after-update';
import { createOrMergeViberListing } from '../viber-listing-merge';
import { PHONE_BLOCKED_ADMIN_MESSAGE, isPhoneBlockedError } from '../phone-block';

const VIBER_LISTING_UPDATE_FIELDS = [
  'rawMessage',
  'senderName',
  'listingType',
  'route',
  'tripRouteId',
  'fromPointId',
  'toPointId',
  'date',
  'departureTime',
  'seats',
  'phone',
  'notes',
  'priceUah',
  'isActive',
] as const;

const CLEANUP_CUTOFF_HOURS = 1;

export function createViberListingsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  /**
   * Повний рядок (телефон, сирий текст) — лише адмінці; сайту віддаємо публічний DTO.
   * Публічний список обмежений активними оголошеннями від сьогодні (історія — в адмінці).
   */
  r.get('/viber-listings', async (req, res) => {
    try {
      const { active } = req.query;
      const isAdmin = req.headers.authorization === ADMIN_AUTH_TOKEN;
      if (isAdmin) {
        const where = active === 'true' ? { isActive: true } : {};
        const listings = await prisma.viberListing.findMany({
          where,
          orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
        });
        res.json(listings.map(serializeViberListing));
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const listings = await prisma.viberListing.findMany({
        where: { isActive: true, date: { gte: today } },
        orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
        select: PUBLIC_LISTING_SELECT,
      });
      res.json(listings.map(toPublicListing));
    } catch (error) {
      console.error('❌ Помилка отримання Viber оголошень:', error);
      res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
    }
  });

  /**
   * Контакт автора оголошення (телефон або @username) — окремим запитом, по кліку.
   * На сторінках сайту контакт не рендериться: у DOM його немає, пошуковики й
   * прості скрейпери сторінки нічого не збирають.
   * Публічний і лише для активних оголошень — заборонені/зняті не віддаємо.
   */
  r.get('/viber-listings/:id/contact', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Невірний id' });
      }
      const listing = await prisma.viberListing.findUnique({
        where: { id },
        select: { phone: true, isActive: true },
      });
      if (!listing || !listing.isActive || !listing.phone?.trim()) {
        return res.status(404).json({ error: 'Контакт недоступний' });
      }
      return res.json({ contact: listing.phone.trim() });
    } catch (error) {
      console.error('❌ Помилка отримання контакту оголошення:', error);
      return res.status(500).json({ error: 'Не вдалося отримати контакт' });
    }
  });

  r.get('/viber-listings/search', async (req, res) => {
    const { route, date, fromCode, toCode } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    const hasOd =
      typeof fromCode === 'string' &&
      typeof toCode === 'string' &&
      fromCode.trim() &&
      toCode.trim();
    if (!route && !hasOd) {
      return res.status(400).json({ error: 'fromCode+toCode or route is required' });
    }

    try {
      const dateFilter = {
        date: tripDayWhere(String(date)),
        isActive: true,
      };

      let listings;
      if (hasOd) {
        // Точки й маршрути — з кешу процесу, не з БД на кожен пошук
        const catalog = await getCatalog(prisma);
        const from = catalog.pointByCode(String(fromCode));
        const to = catalog.pointByCode(String(toCode));
        if (!from || !to) {
          return res.json([]);
        }
        const alongTripRouteIds = catalog.routeIdsAlong(from.id, to.id);

        listings = await prisma.viberListing.findMany({
          where: {
            ...dateFilter,
            OR: [
              { fromPointId: from.id, toPointId: to.id },
              ...(alongTripRouteIds.length
                ? [{ tripRouteId: { in: alongTripRouteIds } }]
                : []),
              ...(route ? [{ route: route as string, fromPointId: null, toPointId: null }] : []),
              {
                route: `${from.code}-${to.code}`,
                fromPointId: null,
                toPointId: null,
              },
            ],
          },
          orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
          select: PUBLIC_LISTING_SELECT,
        });
        // SQL звузив по маршруту; тут перевіряємо OD самого оголошення (пасажир з іншою парою — ні)
        const search = { fromId: from.id, toId: to.id, fromCode: from.code, toCode: to.code };
        listings = listings.filter((l) => listingMatchesSearchOd(l, search, catalog.itineraryByRouteId));
      } else {
        listings = await prisma.viberListing.findMany({
          where: {
            ...dateFilter,
            route: route as string,
          },
          orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
          select: PUBLIC_LISTING_SELECT,
        });
      }

      res.json(listings.map(toPublicListing));
    } catch (error) {
      console.error('❌ Помилка пошуку Viber оголошень:', error);
      res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
    }
  });

  r.post('/viber-listings', requireAdmin, async (req, res) => {
    const { rawMessage } = req.body;

    if (!rawMessage) {
      return res.status(400).json({ error: 'rawMessage is required' });
    }

    try {
      const parsed = parseViberMessage(rawMessage);

      if (!parsed) {
        return res.status(400).json({
          error: 'Не вдалося розпарсити повідомлення. Перевірте формат.',
        });
      }

      const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
      let senderName = nameFromDb ?? parsed.senderName ?? null;
      if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
        const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
        if (nameFromTg?.trim()) senderName = nameFromTg.trim();
      }
      const person = parsed.phone
        ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
        : null;

      const { listing, isPastDate } = await createOrMergeViberListing(prisma, {
        rawMessage,
        senderName: senderName ?? undefined,
        listingType: parsed.listingType,
        route: parsed.route,
        date: parsed.date,
        departureTime: parsed.departureTime,
        seats: parsed.seats,
        phone: parsed.phone,
        notes: parsed.notes,
        isActive: true,
        personId: person?.id ?? undefined,
      });

      console.log(`✅ Створено Viber оголошення #${listing.id}:`, {
        type: listing.listingType,
        route: listing.route,
        date: listing.date,
        phone: listing.phone,
        archived: isPastDate,
      });

      const matchingRecheckTriggered = isTelegramEnabled();
      if (matchingRecheckTriggered && !isPastDate) {
        sendViberListingNotificationToAdmin({
          id: listing.id,
          listingType: listing.listingType,
          route: listing.route,
          date: listing.date,
          departureTime: listing.departureTime,
          seats: listing.seats,
          phone: listing.phone,
          senderName: listing.senderName,
          notes: listing.notes,
          priceUah: listing.priceUah ?? undefined,
          source: listing.source,
        }).catch((err) => console.error('Telegram Viber notify:', err));
        if (listing.phone && listing.phone.trim()) {
          sendViberListingConfirmationToUser(listing.phone, {
            id: listing.id,
            route: listing.route,
            date: listing.date,
            departureTime: listing.departureTime,
            seats: listing.seats,
            listingType: listing.listingType,
            priceUah: listing.priceUah ?? undefined,
          }).catch((err) => console.error('Telegram Viber user notify:', err));
        }
        // Перетини й розсилка — у фоновій черзі (notification-queue.ts), відповідь не чекає
        void enqueueListingMatch(prisma, listing.id).catch((err) => console.error('enqueue listing match:', err));
      }

      res.status(201).json({ ...serializeViberListing(listing), matchingRecheckTriggered });
    } catch (error: unknown) {
      if (isPhoneBlockedError(error)) {
        // Інакше і адмінка, і Python-парсер побачили б незрозумілу 500.
        res.status(403).json({ error: PHONE_BLOCKED_ADMIN_MESSAGE });
        return;
      }
      console.error('❌ Помилка створення Viber оголошення:', error);
      res.status(500).json({ error: 'Failed to create Viber listing' });
    }
  });

  r.post('/viber-listings/bulk', requireAdmin, async (req, res) => {
    const { rawMessages } = req.body;

    if (!rawMessages) {
      return res.status(400).json({ error: 'rawMessages is required' });
    }

    try {
      const parsedMessages = parseViberMessages(rawMessages);

      if (parsedMessages.length === 0) {
        return res.status(400).json({
          error: 'Не вдалося розпарсити жодне повідомлення',
        });
      }

      const created = [];
      const errors = [];
      const matchingRecheckTriggered = isTelegramEnabled();

      for (let i = 0; i < parsedMessages.length; i++) {
        const { parsed, rawMessage: rawText } = parsedMessages[i];
        try {
          const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
          let senderName = nameFromDb ?? parsed.senderName ?? null;
          if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
            const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
            if (nameFromTg?.trim()) senderName = nameFromTg.trim();
          }
          const person = parsed.phone
            ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
            : null;
          const { listing, isNew, isPastDate } = await createOrMergeViberListing(prisma, {
            rawMessage: rawText,
            senderName: senderName ?? undefined,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone,
            notes: parsed.notes,
            isActive: true,
            personId: person?.id ?? undefined,
          });
          if (isNew) {
            created.push(listing);
          }
          if (matchingRecheckTriggered && !isPastDate) {
            sendViberListingNotificationToAdmin({
              id: listing.id,
              listingType: listing.listingType,
              route: listing.route,
              date: listing.date,
              departureTime: listing.departureTime,
              seats: listing.seats,
              phone: listing.phone,
              senderName: listing.senderName,
              notes: listing.notes,
              priceUah: listing.priceUah ?? undefined,
              source: listing.source,
            }).catch((err) => console.error('Telegram Viber notify:', err));
            if (listing.phone && listing.phone.trim()) {
              sendViberListingConfirmationToUser(listing.phone, {
                id: listing.id,
                route: listing.route,
                date: listing.date,
                departureTime: listing.departureTime,
                seats: listing.seats,
                listingType: listing.listingType,
                priceUah: listing.priceUah ?? undefined,
              }).catch((err) => console.error('Telegram Viber user notify:', err));
            }
            // Перетини й розсилка — у фоновій черзі (notification-queue.ts), відповідь не чекає
            void enqueueListingMatch(prisma, listing.id).catch((err) => console.error('enqueue listing match:', err));
          }
        } catch (error) {
          errors.push({ index: i, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      console.log(`✅ Створено ${created.length} Viber оголошень з ${parsedMessages.length}`);

      res.status(201).json({
        success: true,
        created: created.length,
        total: parsedMessages.length,
        errors: errors.length > 0 ? errors : undefined,
        listings: created,
        matchingRecheckTriggered,
      });
    } catch (error: unknown) {
      console.error('❌ Помилка масового створення Viber оголошень:', error);
      res.status(500).json({ error: 'Failed to create Viber listings' });
    }
  });

  r.put('/viber-listings/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const key of VIBER_LISTING_UPDATE_FIELDS) {
      if (body[key] !== undefined) {
        if (key === 'date' && typeof body[key] === 'string') {
          updates[key] = new Date(body[key] as string);
        } else if (key === 'priceUah') {
          const v = body[key];
          updates[key] = v === null || v === '' ? null : typeof v === 'number' ? v : parseInt(String(v), 10);
        } else if (key === 'tripRouteId' || key === 'fromPointId' || key === 'toPointId') {
          const v = body[key];
          if (v === null || v === '' || v === 'null') {
            updates[key] = null;
          } else {
            const n = typeof v === 'number' ? v : parseInt(String(v), 10);
            if (!Number.isInteger(n) || n <= 0) {
              return res.status(400).json({ error: `${key} must be a positive integer or null` });
            }
            updates[key] = n;
          }
        } else {
          updates[key] = body[key];
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No allowed fields to update' });
    }
    try {
      const explicitTripRouteId = Object.prototype.hasOwnProperty.call(body, 'tripRouteId');
      if (explicitTripRouteId && updates.tripRouteId != null) {
        const tr = await prisma.tripRoute.findUnique({ where: { id: updates.tripRouteId as number } });
        if (!tr) {
          return res.status(400).json({ error: 'TripRoute not found' });
        }
        // Admin can pin corridor OR variant (e.g. Kyiv-Malyn-Irpin). Keep route snapshot in sync if not overridden.
        if (updates.route === undefined) {
          updates.route = tr.slug;
        }
      } else if (!explicitTripRouteId && typeof updates.route === 'string' && updates.route) {
        // Legacy: changing route alone still auto-binds corridor (not variant).
        const { resolveCorridorTripRouteId } = await import('../schedule-trip');
        updates.tripRouteId = await resolveCorridorTripRouteId(prisma, String(updates.route));
      }
      if (typeof updates.route === 'string' && updates.route) {
        const { resolveOdPointIdsFromRoute } = await import('../poputky-od');
        const od = await resolveOdPointIdsFromRoute(prisma, String(updates.route));
        if (od && updates.fromPointId === undefined && updates.toPointId === undefined) {
          updates.fromPointId = od.fromPointId;
          updates.toPointId = od.toPointId;
        }
      }
      if (updates.date !== undefined || updates.departureTime !== undefined) {
        const current = await prisma.viberListing.findUnique({
          where: { id: Number(id) },
          select: { date: true, departureTime: true },
        });
        if (current) {
          updates.endsAt = getViberListingEndDateTime(
            (updates.date as Date | undefined) ?? current.date,
            (updates.departureTime as string | null | undefined) ?? current.departureTime,
          );
        }
      }
      let listing = await prisma.viberListing.update({
        where: { id: Number(id) },
        data: updates,
      });
      const { listing: afterDedupe, mergedAwayIds } = await dedupeViberListingsAfterUpdate(prisma, listing.id);
      listing = afterDedupe;
      let matchingRecheckTriggered = false;
      if (isTelegramEnabled()) {
        matchingRecheckTriggered = true;
        // Перетини й розсилка — у фоновій черзі (notification-queue.ts), відповідь не чекає
        void enqueueListingMatch(prisma, listing.id).catch((err) => console.error('enqueue listing match:', err));
      }
      res.json({ ...serializeViberListing(listing), matchingRecheckTriggered, mergedAwayIds });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Viber listing not found' });
      }
      console.error('❌ Помилка оновлення Viber оголошення:', error);
      res.status(500).json({ error: 'Failed to update Viber listing' });
    }
  });

  r.patch('/viber-listings/:id/deactivate', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const listing = await prisma.viberListing.update({
        where: { id: Number(id) },
        data: { isActive: false },
      });
      res.json(listing);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Viber listing not found' });
      }
      console.error('❌ Помилка деактивації Viber оголошення:', error);
      res.status(500).json({ error: 'Failed to deactivate Viber listing' });
    }
  });

  r.delete('/viber-listings/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      await prisma.viberListing.delete({
        where: { id: Number(id) },
      });
      res.status(204).send();
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Viber listing not found' });
      }
      console.error('❌ Помилка видалення Viber оголошення:', error);
      res.status(500).json({ error: 'Failed to delete Viber listing' });
    }
  });

  r.post('/viber-listings/cleanup-old', requireAdmin, async (_req, res) => {
    try {
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setHours(cutoff.getHours() - CLEANUP_CUTOFF_HOURS);

      // Основний шлях: один updateMany по індексу (isActive, endsAt)
      const byEndsAt = await prisma.viberListing.updateMany({
        where: { isActive: true, endsAt: { lt: cutoff } },
        data: { isActive: false },
      });

      // Рядки без endsAt (до backfill або з обхідного шляху запису) — як раніше, в JS; їх одиниці
      const withoutEndsAt = await prisma.viberListing.findMany({
        where: { isActive: true, endsAt: null },
        select: { id: true, date: true, departureTime: true },
      });
      const legacyIds = withoutEndsAt
        .filter((l) => getViberListingEndDateTime(l.date, l.departureTime) < cutoff)
        .map((l) => l.id);
      if (legacyIds.length > 0) {
        await prisma.viberListing.updateMany({
          where: { id: { in: legacyIds } },
          data: { isActive: false },
        });
      }

      // Протерміновані запити «пасажир → водій» (1 год на підтвердження) — раніше їх ніхто не закривав
      const expiredRequests = await prisma.rideShareRequest.updateMany({
        where: { status: 'pending', expiresAt: { lt: now } },
        data: { status: 'expired' },
      });

      const count = byEndsAt.count + legacyIds.length;
      console.log(
        `🧹 Деактивовано ${count} старих Viber оголошень (дата по < ${cutoff.toISOString()}), протерміновано запитів: ${expiredRequests.count}`,
      );

      res.json({
        success: true,
        deactivated: count,
        expiredRequests: expiredRequests.count,
        message: `Деактивовано ${count} оголошень`,
      });
    } catch (error) {
      console.error('❌ Помилка очищення старих Viber оголошень:', error);
      res.status(500).json({ error: 'Failed to cleanup old listings' });
    }
  });

  /**
   * Архів для cron (раз на місяць): нові рядки → ViberRideEvent (аналітика), потім видаляємо
   * неактивні оголошення старші за `days` (за замовчуванням 90, мінімум 30). Гаряча таблиця
   * лишається невеликою; Booking/RideShareRequest на видалені рядки — SetNull/Cascade у схемі.
   */
  r.post('/viber-listings/archive-old', requireAdmin, async (req, res) => {
    try {
      const raw = Number((req.query.days ?? (req.body as { days?: unknown } | undefined)?.days) ?? 90);
      const days = Number.isFinite(raw) ? Math.max(30, Math.round(raw)) : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const imported = await importListingsToRideEvents(prisma);
      const deleted = await prisma.viberListing.deleteMany({
        where: { isActive: false, date: { lt: cutoff } },
      });
      console.log(`🗄️ Архів: імпортовано в аналітику ${imported.importedNow}, видалено неактивних старших за ${days} дн.: ${deleted.count}`);
      res.json({ success: true, days, cutoff: cutoff.toISOString(), ...imported, deleted: deleted.count });
    } catch (error) {
      console.error('❌ Помилка архівування Viber оголошень:', error);
      res.status(500).json({ error: 'Failed to archive old listings' });
    }
  });

  return r;
}
