import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  getChatIdByPhone,
  getPersonByTelegram,
  isTelegramEnabled,
  notifyMatchingDriversForNewPassenger,
  notifyMatchingPassengersForNewDriver,
} from '../telegram';
import { serializeViberListing } from '../index-helpers';
import { dedupeViberListingsAfterUpdate } from '../viber-listing-dedupe-after-update';

async function getViberListingForUser(prisma: PrismaClient, listingId: number, telegramUserId: string) {
  const person = await getPersonByTelegram(telegramUserId, '');
  if (!person) return null;
  const listing = await prisma.viberListing.findFirst({
    where: { id: listingId, personId: person.id },
  });
  return listing;
}

export function createViberListingsUserRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.patch('/viber-listings/:id/by-user', async (req, res) => {
    const id = Number(req.params.id);
    const { telegramUserId, ...body } = req.body as Record<string, unknown>;
    if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
      return res.status(400).json({ error: 'telegramUserId is required' });
    }
    try {
      const listing = await getViberListingForUser(prisma, id, telegramUserId.trim());
      if (!listing) {
        return res.status(404).json({ error: 'Оголошення не знайдено або це не ваше оголошення' });
      }
      const allowed = ['route', 'date', 'departureTime', 'seats', 'notes', 'priceUah'] as const;
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (body[key] !== undefined) {
          if (key === 'date') updates[key] = new Date(body[key] as string);
          else if (key === 'seats' || key === 'priceUah') {
            const v = body[key];
            updates[key] = v === null || v === '' ? null : typeof v === 'number' ? v : parseInt(String(v), 10);
          } else updates[key] = body[key];
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No allowed fields to update' });
      }
      let updated = await prisma.viberListing.update({
        where: { id },
        data: updates,
      });
      const { listing: afterDedupe, mergedAwayIds } = await dedupeViberListingsAfterUpdate(prisma, updated.id);
      updated = afterDedupe;
      const matchingRecheckTriggered = isTelegramEnabled();
      if (matchingRecheckTriggered) {
        const authorChatId = updated.phone?.trim() ? await getChatIdByPhone(updated.phone) : null;
        if (updated.listingType === 'driver') {
          notifyMatchingPassengersForNewDriver(updated, authorChatId).catch((err) =>
            console.error('Telegram match notify after user update (driver):', err),
          );
        } else if (updated.listingType === 'passenger') {
          notifyMatchingDriversForNewPassenger(updated, authorChatId).catch((err) =>
            console.error('Telegram match notify after user update (passenger):', err),
          );
        }
      }
      res.json({ ...serializeViberListing(updated), matchingRecheckTriggered, mergedAwayIds });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return res.status(404).json({ error: 'Listing not found' });
      console.error('❌ PATCH /viber-listings/:id/by-user:', error);
      res.status(500).json({ error: 'Failed to update listing' });
    }
  });

  r.patch('/viber-listings/:id/deactivate/by-user', async (req, res) => {
    const id = Number(req.params.id);
    const { telegramUserId } = req.body as { telegramUserId?: string };
    if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
      return res.status(400).json({ error: 'telegramUserId is required' });
    }
    try {
      const listing = await getViberListingForUser(prisma, id, telegramUserId.trim());
      if (!listing) {
        return res.status(404).json({ error: 'Оголошення не знайдено або це не ваше оголошення' });
      }
      const updated = await prisma.viberListing.update({
        where: { id },
        data: { isActive: false },
      });
      res.json(serializeViberListing(updated));
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return res.status(404).json({ error: 'Listing not found' });
      console.error('❌ PATCH /viber-listings/:id/deactivate/by-user:', error);
      res.status(500).json({ error: 'Failed to deactivate listing' });
    }
  });

  return r;
}
