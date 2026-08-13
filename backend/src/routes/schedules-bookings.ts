import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  findOrCreatePersonByPhone,
  getChatIdByPhone,
  getPersonByPhone,
  isTelegramEnabled,
  normalizePhone,
  sendBookingConfirmationToCustomer,
  sendBookingNotificationToAdmin,
} from '../telegram';
import { getSupportPhoneForRoute } from '../support-phone-route';
import { isValidScheduleDepartureTime, SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE } from '../validation/schedule-departure-time';
import { validateBookingPhoneInput } from '../validation/booking-phone';
import { requireAdmin } from '../middleware/require-admin';
import { defaultSchedulePriceUah, parseOptionalPriceUah } from '../schedule-price';
import {
  buildLegacyRouteKey,
  findOrCreateTripRoute,
  isScheduleActiveOnDate,
  isVehicleType,
  normalizeActiveWeekdays,
  normalizeViaPointIds,
  parseHhMm,
  parseLegacyRoute,
  scheduleMatchesOdAlongStops,
  validateTripPointSelection,
  type VehicleType,
} from '../schedule-trip';
import { applyTimetablePreview, buildTimetablePreview, parseTimetablePages } from '../schedule-timetable-sync';

async function buildAvailabilityPayload(
  prisma: PrismaClient,
  schedule: {
    id: number;
    route: string;
    departureTime: string;
    maxSeats: number;
    vehicleType: string;
    ticketPurchaseUrl: string | null;
    activeWeekdays: unknown;
  },
  date: string
) {
  if (schedule.vehicleType === 'elektrichka') {
    return {
      scheduleId: schedule.id,
      maxSeats: schedule.maxSeats,
      bookedSeats: 0,
      availableSeats: 0,
      isAvailable: false,
      vehicleType: schedule.vehicleType,
      ticketPurchaseUrl: schedule.ticketPurchaseUrl,
    };
  }

  if (!isScheduleActiveOnDate(schedule.activeWeekdays, date)) {
    return {
      scheduleId: schedule.id,
      maxSeats: schedule.maxSeats,
      bookedSeats: 0,
      availableSeats: 0,
      isAvailable: false,
      inactiveOnDate: true,
    };
  }

  const bookingDate = new Date(date);
  const startOfDay = new Date(bookingDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(bookingDate);
  endOfDay.setHours(23, 59, 59, 999);

  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { scheduleId: schedule.id },
        { scheduleId: null, route: schedule.route, departureTime: schedule.departureTime },
      ],
      date: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  const bookedSeats = bookings.reduce((sum, booking) => sum + booking.seats, 0);
  const availableSeats = schedule.maxSeats - bookedSeats;

  return {
    scheduleId: schedule.id,
    maxSeats: schedule.maxSeats,
    bookedSeats,
    availableSeats,
    isAvailable: availableSeats > 0,
  };
}

const scheduleInclude = {
  startPoint: true,
  endPoint: true,
  tripRoute: {
    include: {
      startPoint: true,
      endPoint: true,
      corridorRoute: true,
      stops: { include: { point: true }, orderBy: { position: 'asc' as const } },
    },
  },
} as const;

async function applyStopOffsets(
  prisma: PrismaClient,
  tripRouteId: number,
  stopOffsets: unknown
): Promise<void> {
  if (!Array.isArray(stopOffsets)) return;
  for (const raw of stopOffsets) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { pointId?: unknown; departureOffsetMinutes?: unknown };
    const pointId = Number(row.pointId);
    if (!Number.isInteger(pointId) || pointId <= 0) continue;
    let offset: number | null = null;
    if (row.departureOffsetMinutes === null || row.departureOffsetMinutes === '') {
      offset = null;
    } else if (row.departureOffsetMinutes !== undefined) {
      const n = Number(row.departureOffsetMinutes);
      if (!Number.isFinite(n) || n < 0) continue;
      offset = Math.round(n);
    } else {
      continue;
    }
    await prisma.tripRouteStop.updateMany({
      where: { tripRouteId, pointId },
      data: { departureOffsetMinutes: offset },
    });
  }
}

async function loadPointsMap(prisma: PrismaClient) {
  const points = await prisma.tripPoint.findMany();
  return new Map(points.map((p) => [p.id, p]));
}

function optionalTrimmedString(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function parseOptionalDuration(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

async function resolveScheduleTripFields(
  prisma: PrismaClient,
  body: Record<string, unknown>,
  existing?: {
    route: string;
    tripRouteId?: number;
    startPointId: number | null;
    endPointId: number | null;
    viaPointIds: unknown;
    vehicleType: string;
    ticketPurchaseUrl: string | null;
  }
): Promise<{ ok: true; data: Record<string, unknown>; route: string } | { ok: false; status: number; error: string }> {
  const pointsById = await loadPointsMap(prisma);

  let startPointId =
    body.startPointId !== undefined ? Number(body.startPointId) : existing?.startPointId ?? null;
  let endPointId = body.endPointId !== undefined ? Number(body.endPointId) : existing?.endPointId ?? null;
  let viaPointIds =
    body.viaPointIds !== undefined
      ? normalizeViaPointIds(body.viaPointIds)
      : normalizeViaPointIds(existing?.viaPointIds);

  // Legacy: allow route-only create/update and derive points
  if ((startPointId == null || endPointId == null) && (body.route || existing?.route)) {
    const { startCode, endCode, viaCodes } = parseLegacyRoute(String(body.route || existing?.route));
    const byCode = new Map([...pointsById.values()].map((p) => [p.code, p]));
    const start = byCode.get(startCode);
    const end = byCode.get(endCode);
    if (start && end) {
      startPointId = start.id;
      endPointId = end.id;
      if (body.viaPointIds === undefined) {
        viaPointIds = viaCodes.map((c) => byCode.get(c)?.id).filter((id): id is number => id != null);
      }
    }
  }

  if (startPointId == null || endPointId == null || !Number.isInteger(startPointId) || !Number.isInteger(endPointId)) {
    return { ok: false, status: 400, error: 'startPointId and endPointId are required (or provide legacy route)' };
  }

  const validated = validateTripPointSelection({
    startPointId,
    endPointId,
    viaPointIds,
    pointsById,
  });
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  const start = pointsById.get(startPointId)!;
  const end = pointsById.get(endPointId)!;
  const viaCodes = validated.viaPointIds.map((id) => pointsById.get(id)!.code);
  const route = buildLegacyRouteKey(start.code, end.code, viaCodes);

  // Always resolve TripRoute from current points so Schedule.route and tripRouteId stay in sync.
  // Explicit body.tripRouteId is honored only when it already matches the computed slug.
  let tripRouteId: number;
  try {
    const resolved = await findOrCreateTripRoute(prisma, {
      startPointId,
      endPointId,
      viaPointIds: validated.viaPointIds,
    });
    tripRouteId = resolved.id;
    if (body.tripRouteId !== undefined) {
      const requested = Number(body.tripRouteId);
      if (Number.isInteger(requested) && requested > 0 && requested !== resolved.id) {
        const requestedRow = await prisma.tripRoute.findUnique({ where: { id: requested } });
        if (requestedRow && requestedRow.slug === route) {
          tripRouteId = requestedRow.id;
        }
        // else ignore mismatched FK — keep findOrCreate result
      }
    }
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : 'Failed to resolve trip route' };
  }

  const vehicleTypeRaw =
    body.vehicleType !== undefined ? body.vehicleType : existing?.vehicleType ?? 'marshrutka';
  if (!isVehicleType(vehicleTypeRaw)) {
    return { ok: false, status: 400, error: 'vehicleType must be marshrutka or elektrichka' };
  }
  const vehicleType: VehicleType = vehicleTypeRaw;

  const ticketPurchaseUrl = optionalTrimmedString(body.ticketPurchaseUrl);
  const arrivalTime = optionalTrimmedString(body.arrivalTime);
  if (arrivalTime && !parseHhMm(arrivalTime)) {
    return { ok: false, status: 400, error: 'arrivalTime must be HH:MM' };
  }

  const data: Record<string, unknown> = {
    route,
    tripRouteId,
    startPointId,
    endPointId,
    viaPointIds: validated.viaPointIds,
    vehicleType,
  };

  if (body.boardingPlace !== undefined) data.boardingPlace = optionalTrimmedString(body.boardingPlace);
  if (body.alightingPlace !== undefined) data.alightingPlace = optionalTrimmedString(body.alightingPlace);
  if (body.tripNumber !== undefined) data.tripNumber = optionalTrimmedString(body.tripNumber);
  if (body.arrivalTime !== undefined) data.arrivalTime = arrivalTime ?? null;
  if (body.durationMinutes !== undefined) data.durationMinutes = parseOptionalDuration(body.durationMinutes);
  if (body.ticketPurchaseUrl !== undefined) data.ticketPurchaseUrl = ticketPurchaseUrl ?? null;
  if (body.timetableSourceUrl !== undefined) {
    data.timetableSourceUrl = optionalTrimmedString(body.timetableSourceUrl) ?? null;
  }
  if (body.activeWeekdays !== undefined) data.activeWeekdays = normalizeActiveWeekdays(body.activeWeekdays);

  return { ok: true, data, route };
}

export function createSchedulesBookingsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/schedules', async (req, res) => {
    const { route, vehicleType, date, fromCode, toCode } = req.query;
    const where: Record<string, unknown> = {};
    if (route) where.route = route as string;
    if (vehicleType && isVehicleType(vehicleType)) where.vehicleType = vehicleType;

    let schedules = await prisma.schedule.findMany({
      where,
      include: scheduleInclude,
      orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
    });

    if (date && typeof date === 'string') {
      schedules = schedules.filter((s) => isScheduleActiveOnDate(s.activeWeekdays, date));
    }

    if (typeof fromCode === 'string' && typeof toCode === 'string' && fromCode.trim() && toCode.trim()) {
      const points = await prisma.tripPoint.findMany();
      const from = points.find((p) => p.code.toLowerCase() === fromCode.trim().toLowerCase());
      const to = points.find((p) => p.code.toLowerCase() === toCode.trim().toLowerCase());
      if (from && to) {
        schedules = schedules.filter((s) =>
          scheduleMatchesOdAlongStops(s.tripRoute?.stops, from.id, to.id)
        );
      } else {
        schedules = [];
      }
    }

    res.json(schedules);
  });

  r.get('/schedules/:route', async (req, res) => {
    const { route } = req.params;
    const { date, vehicleType } = req.query;
    const where: Record<string, unknown> = { route };
    if (vehicleType && isVehicleType(vehicleType)) where.vehicleType = vehicleType;

    let schedules = await prisma.schedule.findMany({
      where,
      include: scheduleInclude,
      orderBy: { departureTime: 'asc' },
    });

    if (date && typeof date === 'string') {
      schedules = schedules.filter((s) => isScheduleActiveOnDate(s.activeWeekdays, date));
    }

    res.json(schedules);
  });

  r.get('/schedules-support-phone', async (_req, res) => {
    try {
      const schedule = await prisma.schedule.findFirst({
        where: { supportPhone: { not: null } },
        select: { supportPhone: true },
      });
      res.json({ supportPhone: schedule?.supportPhone ?? null });
    } catch (_error) {
      res.status(500).json({ supportPhone: null });
    }
  });

  /** Preview SW Railway timetable diffs for schedules with timetableSourceUrl. */
  r.post('/schedules/timetable-preview', requireAdmin, async (req, res) => {
    try {
      const pages = parseTimetablePages(req.body?.pages);
      const preview = await buildTimetablePreview(prisma, { pages });
      res.json(preview);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : 'Failed to build timetable preview';
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: message });
      }
      console.error('timetable-preview failed', error);
      res.status(500).json({ error: 'Failed to build timetable preview' });
    }
  });

  /** Apply selected patches from a preview token (fail-all on unique conflicts). */
  r.post('/schedules/timetable-apply', requireAdmin, async (req, res) => {
    try {
      const previewToken = String(req.body?.previewToken || '').trim();
      const scheduleIds = Array.isArray(req.body?.scheduleIds)
        ? req.body.scheduleIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
        : [];
      if (!previewToken) {
        return res.status(400).json({ error: 'previewToken is required' });
      }
      const result = await applyTimetablePreview(prisma, previewToken, scheduleIds);
      if (result.conflicts.length > 0) {
        return res.status(409).json({
          error: 'Unique time conflicts — nothing applied',
          ...result,
        });
      }
      res.json(result);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : 'Failed to apply timetable';
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: message });
      }
      console.error('timetable-apply failed', error);
      res.status(500).json({ error: 'Failed to apply timetable' });
    }
  });

  /** Rebind all schedules whose tripRoute.slug ≠ schedule.route (or points mismatch). */
  r.post('/schedules-rebind-trip-routes', requireAdmin, async (_req, res) => {
    try {
      const schedules = await prisma.schedule.findMany({
        include: { tripRoute: true },
      });
      let updated = 0;
      let unchanged = 0;
      const errors: Array<{ id: number; error: string }> = [];
      for (const s of schedules) {
        const trip = await resolveScheduleTripFields(
          prisma,
          {
            startPointId: s.startPointId,
            endPointId: s.endPointId,
            viaPointIds: s.viaPointIds,
            vehicleType: s.vehicleType,
            ticketPurchaseUrl: s.ticketPurchaseUrl,
            route: s.route,
          },
          {
            route: s.route,
            tripRouteId: s.tripRouteId,
            startPointId: s.startPointId,
            endPointId: s.endPointId,
            viaPointIds: s.viaPointIds,
            vehicleType: s.vehicleType,
            ticketPurchaseUrl: s.ticketPurchaseUrl,
          }
        );
        if (!trip.ok) {
          errors.push({ id: s.id, error: trip.error });
          continue;
        }
        const nextId = Number(trip.data.tripRouteId);
        const nextRoute = String(trip.data.route);
        if (nextId === s.tripRouteId && nextRoute === s.route) {
          unchanged++;
          continue;
        }
        await prisma.schedule.update({
          where: { id: s.id },
          data: {
            tripRouteId: nextId,
            route: nextRoute,
            startPointId: trip.data.startPointId as number,
            endPointId: trip.data.endPointId as number,
            viaPointIds: trip.data.viaPointIds as number[],
          },
        });
        updated++;
      }
      res.json({ updated, unchanged, errors });
    } catch (error) {
      console.error('schedules-rebind-trip-routes failed', error);
      res.status(500).json({ error: 'Failed to rebind schedules' });
    }
  });

  /** Preferred availability by scheduleId — register before /schedules/:route/:departureTime/availability. */
  r.get('/schedules/by-id/:scheduleId/availability', async (req, res) => {
    const scheduleId = Number(req.params.scheduleId);
    const { date } = req.query;
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduleId' });
    }
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Date parameter is required' });
    }
    try {
      const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      return res.json(await buildAvailabilityPayload(prisma, schedule, date));
    } catch (_error) {
      res.status(500).json({ error: 'Failed to check availability' });
    }
  });

  /** @deprecated Prefer GET /schedules/by-id/:scheduleId/availability */
  r.get('/schedules/:route/:departureTime/availability', async (req, res) => {
    const { route, departureTime } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    try {
      const schedule = await prisma.schedule.findFirst({
        where: {
          OR: [
            { tripRoute: { slug: route }, departureTime },
            { route, departureTime },
          ],
        },
      });

      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      res.json(await buildAvailabilityPayload(prisma, schedule, date as string));
    } catch (_error) {
      res.status(500).json({ error: 'Failed to check availability' });
    }
  });

  r.post('/schedules', requireAdmin, async (req, res) => {
    const body = req.body ?? {};
    const { departureTime, maxSeats, supportPhone, priceUah } = body;
    if (!departureTime) {
      return res.status(400).json({ error: 'Missing fields: departureTime is required' });
    }

    if (!isValidScheduleDepartureTime(departureTime)) {
      return res.status(400).json({ error: SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
    }

    const trip = await resolveScheduleTripFields(prisma, body);
    if (!trip.ok) {
      return res.status(trip.status).json({ error: trip.error });
    }

    if (trip.data.vehicleType === 'elektrichka' && !trip.data.ticketPurchaseUrl) {
      return res.status(400).json({ error: 'ticketPurchaseUrl is required for elektrichka' });
    }

    const parsedPrice = parseOptionalPriceUah(priceUah);
    const resolvedPrice =
      parsedPrice !== undefined ? parsedPrice : defaultSchedulePriceUah(trip.route);

    try {
      const schedule = await prisma.schedule.create({
        data: {
          ...trip.data,
          departureTime,
          maxSeats: maxSeats ? Number(maxSeats) : 20,
          supportPhone:
            supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null,
          priceUah: resolvedPrice,
          activeWeekdays: trip.data.activeWeekdays ?? normalizeActiveWeekdays(undefined),
        } as never,
        include: scheduleInclude,
      });
      await applyStopOffsets(prisma, Number(trip.data.tripRouteId), body.stopOffsets);
      const refreshed = await prisma.schedule.findUnique({
        where: { id: schedule.id },
        include: scheduleInclude,
      });
      res.status(201).json(refreshed ?? schedule);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Schedule with this route and time already exists' });
      }
      console.error('Failed to create schedule', error);
      res.status(500).json({ error: 'Failed to create schedule' });
    }
  });

  r.put('/schedules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const { departureTime, maxSeats, supportPhone, priceUah } = body;

    if (!departureTime) {
      return res.status(400).json({ error: 'Missing fields: departureTime is required' });
    }

    if (!isValidScheduleDepartureTime(departureTime)) {
      return res.status(400).json({ error: SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
    }

    const existing = await prisma.schedule.findUnique({ where: { id: Number(id) } });
    if (!existing) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const trip = await resolveScheduleTripFields(prisma, body, existing);
    if (!trip.ok) {
      return res.status(trip.status).json({ error: trip.error });
    }

    const vehicleType = (trip.data.vehicleType as string) || existing.vehicleType;
    const nextUrl =
      trip.data.ticketPurchaseUrl !== undefined
        ? (trip.data.ticketPurchaseUrl as string | null)
        : existing.ticketPurchaseUrl;
    if (vehicleType === 'elektrichka' && !nextUrl) {
      return res.status(400).json({ error: 'ticketPurchaseUrl is required for elektrichka' });
    }

    const parsedPrice = parseOptionalPriceUah(priceUah);

    try {
      const schedule = await prisma.schedule.update({
        where: { id: Number(id) },
        data: {
          ...trip.data,
          departureTime,
          maxSeats: maxSeats ? Number(maxSeats) : undefined,
          supportPhone:
            supportPhone !== undefined
              ? supportPhone != null && String(supportPhone).trim() !== ''
                ? String(supportPhone).trim()
                : null
              : undefined,
          ...(parsedPrice !== undefined ? { priceUah: parsedPrice } : {}),
        } as never,
        include: scheduleInclude,
      });
      const tripRouteId = Number(trip.data.tripRouteId ?? schedule.tripRouteId);
      await applyStopOffsets(prisma, tripRouteId, body.stopOffsets);
      const refreshed = await prisma.schedule.findUnique({
        where: { id: schedule.id },
        include: scheduleInclude,
      });
      res.json(refreshed ?? schedule);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Schedule with this route and time already exists' });
      }
      console.error('Failed to update schedule', error);
      res.status(500).json({ error: 'Failed to update schedule' });
    }
  });

  r.delete('/schedules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      await prisma.schedule.delete({
        where: { id: Number(id) },
      });
      res.status(204).send();
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      res.status(500).json({ error: 'Failed to delete schedule' });
    }
  });

  r.post('/bookings', async (req, res) => {
    const { route, date, departureTime, seats, name, phone, scheduleId, telegramUserId } = req.body;
    if (!date || !seats || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (scheduleId == null && (!route || !departureTime)) {
      return res.status(400).json({
        error: 'scheduleId is required (or legacy route + departureTime)',
      });
    }

    const phoneValid = validateBookingPhoneInput(phone);
    if (!phoneValid.ok) {
      return res.status(400).json({ error: phoneValid.error });
    }

    if (departureTime && !isValidScheduleDepartureTime(departureTime)) {
      return res.status(400).json({ error: SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
    }

    let resolvedSchedule =
      scheduleId != null
        ? await prisma.schedule.findUnique({ where: { id: Number(scheduleId) } })
        : await prisma.schedule.findFirst({
            where: {
              OR: [
                { tripRoute: { slug: route }, departureTime },
                { route, departureTime },
              ],
            },
          });

    if (!resolvedSchedule) {
      return res.status(400).json({ error: 'Schedule not found for this route and time' });
    }

    if (route && resolvedSchedule.route !== route && resolvedSchedule.tripRouteId) {
      const tr = await prisma.tripRoute.findUnique({
        where: { id: resolvedSchedule.tripRouteId },
        select: { slug: true },
      });
      if (tr && tr.slug !== route && resolvedSchedule.route !== route) {
        return res.status(400).json({ error: 'route does not match scheduleId' });
      }
    }

    if (departureTime && resolvedSchedule.departureTime !== departureTime) {
      return res.status(400).json({ error: 'departureTime does not match scheduleId' });
    }

    if (resolvedSchedule.vehicleType === 'elektrichka') {
      return res.status(400).json({
        error: 'Електрички не бронюються на сайті. Купіть квиток за посиланням перевізника.',
        ticketPurchaseUrl: resolvedSchedule.ticketPurchaseUrl,
      });
    }

    if (!isScheduleActiveOnDate(resolvedSchedule.activeWeekdays, date)) {
      return res.status(400).json({ error: 'Рейс не курсує в обрану дату' });
    }

    {
      const bookingDate = new Date(date);
      const startOfDay = new Date(bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(bookingDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingBookings = await prisma.booking.findMany({
        where: {
          scheduleId: resolvedSchedule.id,
          date: { gte: startOfDay, lte: endOfDay },
        },
      });

      const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
      const requestedSeats = Number(seats);
      const availableSeats = resolvedSchedule.maxSeats - bookedSeats;

      if (requestedSeats > availableSeats) {
        return res.status(400).json({
          error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}`,
        });
      }
    }

    let telegramChatId: string | null = null;
    let bookingTelegramUserId: string | null = telegramUserId || null;
    const fullNameForPerson = typeof name === 'string' && name.trim() ? name.trim() : name;
    const person = await findOrCreatePersonByPhone(phone, { fullName: fullNameForPerson });

    if (fullNameForPerson) {
      try {
        const [bookingsUpdated, viberUpdated] = await Promise.all([
          prisma.booking.updateMany({
            where: { personId: person.id },
            data: { name: fullNameForPerson },
          }),
          prisma.viberListing.updateMany({
            where: { personId: person.id },
            data: { senderName: fullNameForPerson },
          }),
        ]);
        if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
          console.log(`📝 Оновлено ім'я персони: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
        }
      } catch (err) {
        console.error('Помилка оновлення імені в бронюваннях/Viber:', err);
      }
    }

    try {
      const normalizedPhone = normalizePhone(phone);
      const personRecord = await getPersonByPhone(phone);

      if (personRecord?.telegramChatId && personRecord.telegramChatId !== '0' && personRecord.telegramChatId.trim() !== '') {
        telegramChatId = personRecord.telegramChatId;
      }
      if (personRecord?.telegramUserId && personRecord.telegramUserId !== '0' && personRecord.telegramUserId.trim() !== '') {
        bookingTelegramUserId = bookingTelegramUserId || personRecord.telegramUserId;
      }

      if (!telegramChatId || !bookingTelegramUserId) {
        const allBookings = await prisma.booking.findMany({
          where: {
            telegramUserId: { not: null, notIn: ['0', '', ' '] },
          },
          orderBy: { createdAt: 'desc' },
        });
        const previousBooking = allBookings.find((b) => normalizePhone(b.phone) === normalizedPhone);
        if (previousBooking) {
          if (previousBooking.telegramChatId && previousBooking.telegramChatId !== '0' && previousBooking.telegramChatId.trim() !== '') {
            telegramChatId = telegramChatId || previousBooking.telegramChatId;
          }
          if (!bookingTelegramUserId && previousBooking.telegramUserId && previousBooking.telegramUserId !== '0' && previousBooking.telegramUserId.trim() !== '') {
            bookingTelegramUserId = previousBooking.telegramUserId;
          } else if (!bookingTelegramUserId && previousBooking.telegramChatId) {
            bookingTelegramUserId = previousBooking.telegramChatId;
          }
        }
      }

      console.log(`🔍 Person id=${person.id}, Telegram: chatId=${telegramChatId}, userId=${bookingTelegramUserId}`);
    } catch (error) {
      console.error('❌ Помилка пошуку Person/попередніх бронювань:', error);
    }

    if (telegramChatId && telegramChatId !== '0' && telegramChatId.trim() !== '' && !bookingTelegramUserId) {
      bookingTelegramUserId = telegramChatId;
      console.log(`⚠️ Використовуємо telegramChatId як telegramUserId для приватного чату: ${bookingTelegramUserId}`);
    }

    if (telegramChatId === '0' || telegramChatId === '') {
      console.log(`⚠️ Невалідний telegramChatId (${telegramChatId}), встановлюємо null`);
      telegramChatId = null;
    }
    if (bookingTelegramUserId === '0' || bookingTelegramUserId === '') {
      console.log(`⚠️ Невалідний telegramUserId (${bookingTelegramUserId}), встановлюємо null`);
      bookingTelegramUserId = null;
    }

    console.log(`📝 Створюємо бронювання з Telegram даними:`, {
      chatId: telegramChatId,
      userId: bookingTelegramUserId,
      phone: phone,
    });

    const booking = await prisma.booking.create({
      data: {
        route: resolvedSchedule.route,
        date: new Date(date),
        departureTime: resolvedSchedule.departureTime,
        seats: Number(seats),
        name,
        phone,
        scheduleId: resolvedSchedule.id,
        tripRouteId: resolvedSchedule.tripRouteId,
        telegramChatId,
        telegramUserId: bookingTelegramUserId,
        personId: person.id,
        source: 'schedule',
      },
    });

    if (isTelegramEnabled()) {
      try {
        await sendBookingNotificationToAdmin({
          id: booking.id,
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
          seats: booking.seats,
          name: booking.name,
          phone: booking.phone,
          source: booking.source,
        });

        const customerChatId = await getChatIdByPhone(booking.phone);
        if (customerChatId) {
          const supportPhone = await getSupportPhoneForRoute(prisma, booking.route);
          await sendBookingConfirmationToCustomer(customerChatId, {
            id: booking.id,
            route: booking.route,
            date: booking.date,
            departureTime: booking.departureTime,
            seats: booking.seats,
            name: booking.name,
            source: booking.source,
            supportPhone: supportPhone ?? undefined,
            personId: person.id,
            phone: booking.phone,
          });
        }
      } catch (error) {
        console.error('Помилка відправки Telegram повідомлення:', error);
      }
    }

    res.status(201).json(booking);
  });

  r.get('/bookings', requireAdmin, async (_req, res) => {
    res.json(await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }));
  });

  r.get('/bookings/by-phone/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
      const normalized = normalizePhone(phone);

      const person = await getPersonByPhone(phone);
      if (person) {
        const byPerson = await prisma.booking.findFirst({
          where: { personId: person.id },
          orderBy: { createdAt: 'desc' },
        });
        if (byPerson) {
          return res.json(byPerson);
        }
        if (person.fullName && person.fullName.trim()) {
          return res.json({ name: person.fullName.trim(), phone: person.phoneNormalized });
        }
      }

      const allRecent = await prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const lastBooking = allRecent.find((b) => normalizePhone(b.phone) === normalized) ?? null;
      res.json(lastBooking);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to find booking' });
    }
  });

  r.delete('/bookings/:id/by-user', async (req, res) => {
    const { id } = req.params;
    const { telegramUserId } = req.body;

    if (!telegramUserId) {
      return res.status(400).json({ error: 'telegramUserId is required' });
    }

    try {
      const booking = await prisma.booking.findUnique({
        where: { id: Number(id) },
      });

      if (!booking) {
        return res.status(404).json({ error: 'Бронювання не знайдено' });
      }

      if (booking.telegramUserId !== telegramUserId) {
        return res.status(403).json({ error: 'Це не ваше бронювання' });
      }

      await prisma.booking.delete({
        where: { id: Number(id) },
      });

      console.log(`✅ Користувач ${telegramUserId} скасував бронювання #${id}`);

      res.json({
        success: true,
        message: 'Бронювання скасовано',
        booking: {
          id: booking.id,
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
        },
      });
    } catch (error: unknown) {
      console.error('❌ Помилка скасування бронювання:', error);
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Booking not found' });
      }
      res.status(500).json({ error: 'Failed to cancel booking' });
    }
  });

  r.delete('/bookings/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      await prisma.booking.delete({
        where: { id: Number(id) },
      });
      res.status(204).send();
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Booking not found' });
      }
      res.status(500).json({ error: 'Failed to delete booking' });
    }
  });

  return r;
}
