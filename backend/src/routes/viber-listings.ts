import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  findOrCreatePersonByPhone,
  getChatIdByPhone,
  getNameByPhone,
  isTelegramEnabled,
  notifyMatchingDriversForNewPassenger,
  notifyMatchingPassengersForNewDriver,
  resolveNameByPhoneFromTelegram,
  sendViberListingConfirmationToUser,
  sendViberListingNotificationToAdmin,
} from '../telegram';
import { parseViberMessage, parseViberMessages } from '../viber-parser';
import {
  serializeViberListing,
  getViberListingEndDateTime,
} from '../index-helpers';
import { requireAdmin } from '../middleware/require-admin';
import { dedupeViberListingsAfterUpdate } from '../viber-listing-dedupe-after-update';
import { createOrMergeViberListing } from '../viber-listing-merge';

const VIBER_LISTING_UPDATE_FIELDS = [
  'rawMessage',
  'senderName',
  'listingType',
  'route',
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

  r.get('/viber-listings', async (req, res) => {
    try {
      const { active } = req.query;
      const where = active === 'true' ? { isActive: true } : {};
      const listings = await prisma.viberListing.findMany({
        where,
        orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
      });
      res.json(listings.map(serializeViberListing));
    } catch (error) {
      console.error('❌ Помилка отримання Viber оголошень:', error);
      res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
    }
  });

  r.get('/viber-listings/search', async (req, res) => {
    const { route, date } = req.query;

    if (!route || !date) {
      return res.status(400).json({ error: 'Route and date are required' });
    }

    try {
      const searchDate = new Date(date as string);
      const startOfDay = new Date(searchDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(searchDate);
      endOfDay.setHours(23, 59, 59, 999);

      const listings = await prisma.viberListing.findMany({
        where: {
          route: route as string,
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
          isActive: true,
        },
        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
      });

      res.json(listings.map(serializeViberListing));
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

      const { listing } = await createOrMergeViberListing(prisma, {
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
      });

      const matchingRecheckTriggered = isTelegramEnabled();
      if (matchingRecheckTriggered) {
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
        const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
        if (listing.listingType === 'driver') {
          notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify (driver):', err),
          );
        } else if (listing.listingType === 'passenger') {
          notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify (passenger):', err),
          );
        }
      }

      res.status(201).json({ ...serializeViberListing(listing), matchingRecheckTriggered });
    } catch (error: unknown) {
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
          const { listing, isNew } = await createOrMergeViberListing(prisma, {
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
          if (matchingRecheckTriggered) {
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
            const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
            if (listing.listingType === 'driver') {
              notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) =>
                console.error('Telegram match notify (driver):', err),
              );
            } else if (listing.listingType === 'passenger') {
              notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) =>
                console.error('Telegram match notify (passenger):', err),
              );
            }
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
        } else {
          updates[key] = body[key];
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No allowed fields to update' });
    }
    try {
      let listing = await prisma.viberListing.update({
        where: { id: Number(id) },
        data: updates,
      });
      const { listing: afterDedupe, mergedAwayIds } = await dedupeViberListingsAfterUpdate(prisma, listing.id);
      listing = afterDedupe;
      let matchingRecheckTriggered = false;
      if (isTelegramEnabled()) {
        matchingRecheckTriggered = true;
        const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
        if (listing.listingType === 'driver') {
          notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify after admin update (driver):', err),
          );
        } else if (listing.listingType === 'passenger') {
          notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify after admin update (passenger):', err),
          );
        }
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
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - CLEANUP_CUTOFF_HOURS);

      const activeListings = await prisma.viberListing.findMany({
        where: { isActive: true },
        select: { id: true, date: true, departureTime: true },
      });

      const idsToDeactivate = activeListings
        .filter((l) => getViberListingEndDateTime(l.date, l.departureTime) < cutoff)
        .map((l) => l.id);

      const count = idsToDeactivate.length;
      if (count > 0) {
        await prisma.viberListing.updateMany({
          where: { id: { in: idsToDeactivate } },
          data: { isActive: false },
        });
      }

      console.log(`🧹 Деактивовано ${count} старих Viber оголошень (дата по < ${cutoff.toISOString()})`);

      res.json({
        success: true,
        deactivated: count,
        message: `Деактивовано ${count} оголошень`,
      });
    } catch (error) {
      console.error('❌ Помилка очищення старих Viber оголошень:', error);
      res.status(500).json({ error: 'Failed to cleanup old listings' });
    }
  });

  return r;
}
