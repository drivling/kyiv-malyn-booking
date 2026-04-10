import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { getPersonByTelegram } from '../telegram';
import { serializeViberListing } from '../index-helpers';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function createUserProfileRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/user/profile', async (req, res) => {
    const telegramUserId = (req.query.telegramUserId as string)?.trim();
    if (!telegramUserId) {
      return res.status(400).json({ error: 'telegramUserId is required' });
    }
    try {
      const person = await getPersonByTelegram(telegramUserId, '');
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

  r.put('/user/profile/name', async (req, res) => {
    const { telegramUserId, fullName } = req.body as { telegramUserId?: string; fullName?: string | null };
    if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
      return res.status(400).json({ error: 'telegramUserId is required' });
    }
    try {
      const person = await getPersonByTelegram(telegramUserId.trim(), '');
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

  return r;
}
