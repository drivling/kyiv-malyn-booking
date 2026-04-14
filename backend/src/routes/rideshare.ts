import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { getPersonByTelegram, sendRideShareRequestToDriver } from '../telegram';
import { createOrMergeViberListing } from '../viber-listing-merge';

export function createRideshareRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.post('/rideshare/request', async (req, res) => {
    const { driverListingId, telegramUserId } = req.body as { driverListingId?: number; telegramUserId?: string };

    if (!driverListingId || !telegramUserId) {
      return res.status(400).json({ error: 'driverListingId and telegramUserId are required' });
    }

    try {
      const driverListing = await prisma.viberListing.findUnique({ where: { id: Number(driverListingId) } });
      if (!driverListing || driverListing.listingType !== 'driver' || !driverListing.isActive) {
        return res.status(404).json({ error: 'Оголошення водія не знайдено або неактивне' });
      }

      const person = await getPersonByTelegram(String(telegramUserId), '');
      if (!person?.phoneNormalized) {
        return res.status(400).json({
          error: 'Щоб бронювати попутки, підключіть номер телефону в Telegram боті через /start',
        });
      }

      const { listing: passengerListing } = await createOrMergeViberListing(prisma, {
        rawMessage: `[Сайт /poputky] ${driverListing.route} ${driverListing.date.toISOString().slice(0, 10)} ${driverListing.departureTime ?? ''}`,
        source: 'Viber1',
        senderName: person.fullName?.trim() || 'Пасажир',
        listingType: 'passenger',
        route: driverListing.route,
        date: driverListing.date,
        departureTime: driverListing.departureTime,
        seats: null,
        phone: person.phoneNormalized,
        notes: 'Запит створено з сайту /poputky',
        isActive: true,
        personId: person.id,
      });

      const existingRequest = await prisma.rideShareRequest.findFirst({
        where: {
          passengerListingId: passengerListing.id,
          driverListingId: driverListing.id,
          status: { in: ['pending', 'confirmed'] },
        },
      });
      if (existingRequest) {
        return res.status(400).json({
          error: 'Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження або перегляньте /mybookings.',
        });
      }

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const requestRecord = await prisma.rideShareRequest.create({
        data: {
          passengerListingId: passengerListing.id,
          driverListingId: driverListing.id,
          status: 'pending',
          expiresAt,
        },
      });

      const driverNotified = await sendRideShareRequestToDriver(
        requestRecord.id,
        {
          route: driverListing.route,
          date: driverListing.date,
          departureTime: driverListing.departureTime,
          phone: driverListing.phone,
          senderName: driverListing.senderName,
        },
        {
          phone: passengerListing.phone,
          senderName: passengerListing.senderName,
          notes: passengerListing.notes,
        },
      ).catch((err) => {
        console.error('Telegram ride-share notify driver error:', err);
        return false;
      });

      res.status(201).json({
        success: true,
        requestId: requestRecord.id,
        message: driverNotified
          ? 'Запит надіслано водію. Очікуйте підтвердження до 1 години.'
          : 'Запит створено, але водій ще не підключений до Telegram. Спробуйте зв’язатися телефоном.',
        driverNotified,
      });
    } catch (error) {
      console.error('❌ Помилка створення ride-share запиту з сайту:', error);
      res.status(500).json({ error: 'Не вдалося створити запит на попутку' });
    }
  });

  return r;
}
