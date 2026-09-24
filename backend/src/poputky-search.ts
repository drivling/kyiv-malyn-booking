/**
 * Один пошук на головній = один HTTP-запит (Docs/poputky-search-performance-plan.md, Фаза 2.4).
 *
 * Повертає попутки (публічний DTO), розклад маршруток/електричок на цю OD-пару й дату
 * та вільні місця по всіх маршрутках однією вибіркою бронювань. Точки й маршрути — з
 * кешу процесу (catalog-cache.ts), тож на бекенді це 3 SQL-запити замість 4+2N HTTP.
 */
import type { PrismaClient } from '@prisma/client';
import { getCatalog } from './catalog-cache';
import { scheduleInclude } from './schedule-include';
import { isScheduleActiveOnDate, scheduleMatchesOdAlongStops } from './schedule-trip';
import { PUBLIC_LISTING_SELECT, toPublicListing, type PublicListing } from './viber-listing-public';

export type PoputkyAvailability = {
  scheduleId: number;
  maxSeats: number;
  bookedSeats: number;
  availableSeats: number;
  isAvailable: boolean;
  vehicleType?: string;
  ticketPurchaseUrl?: string | null;
};

export type PoputkySearchResult = {
  from: { id: number; code: string; nameUk: string };
  to: { id: number; code: string; nameUk: string };
  date: string;
  listings: PublicListing[];
  schedules: unknown[];
  availability: Record<number, PoputkyAvailability>;
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Межі календарної доби так само, як у GET /viber-listings/search (локальний час сервера). */
export function dayBounds(dateStr: string): { startOfDay: Date; endOfDay: Date } {
  const d = new Date(dateStr);
  const startOfDay = new Date(d);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(d);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
}

type BookingRow = { scheduleId: number | null; route: string; departureTime: string; seats: number };

/** Сума заброньованих місць по кожному розкладу з однієї вибірки бронювань. */
export function bookedSeatsBySchedule(
  schedules: Array<{ id: number; route: string; departureTime: string }>,
  bookings: BookingRow[]
): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of schedules) {
    let sum = 0;
    for (const b of bookings) {
      if (b.scheduleId === s.id) sum += b.seats;
      else if (b.scheduleId == null && b.route === s.route && b.departureTime === s.departureTime) sum += b.seats;
    }
    out.set(s.id, sum);
  }
  return out;
}

export async function searchPoputky(
  prisma: PrismaClient,
  input: { fromCode: string; toCode: string; date: string }
): Promise<PoputkySearchResult | null> {
  const catalog = await getCatalog(prisma);
  const from = catalog.pointByCode(input.fromCode);
  const to = catalog.pointByCode(input.toCode);
  if (!from || !to || from.id === to.id) return null;

  const { startOfDay, endOfDay } = dayBounds(input.date);
  const alongTripRouteIds = catalog.routeIdsAlong(from.id, to.id);

  const [listingRows, scheduleRows] = await Promise.all([
    prisma.viberListing.findMany({
      where: {
        isActive: true,
        date: { gte: startOfDay, lte: endOfDay },
        OR: [
          { fromPointId: from.id, toPointId: to.id },
          ...(alongTripRouteIds.length ? [{ tripRouteId: { in: alongTripRouteIds } }] : []),
          { route: `${from.code}-${to.code}`, fromPointId: null, toPointId: null },
        ],
      },
      orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
      select: PUBLIC_LISTING_SELECT,
    }),
    prisma.schedule.findMany({
      where: alongTripRouteIds.length ? { tripRouteId: { in: alongTripRouteIds } } : { id: -1 },
      include: scheduleInclude,
      orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
    }),
  ]);

  const schedules = scheduleRows.filter(
    (s) =>
      isScheduleActiveOnDate(s.activeWeekdays, input.date) &&
      scheduleMatchesOdAlongStops(s.tripRoute?.stops, from.id, to.id)
  );

  const marshrutky = schedules.filter((s) => s.vehicleType !== 'elektrichka');
  const bookings: BookingRow[] = marshrutky.length
    ? await prisma.booking.findMany({
        where: {
          date: { gte: startOfDay, lte: endOfDay },
          OR: [
            { scheduleId: { in: marshrutky.map((s) => s.id) } },
            { scheduleId: null, route: { in: [...new Set(marshrutky.map((s) => s.route))] } },
          ],
        },
        select: { scheduleId: true, route: true, departureTime: true, seats: true },
      })
    : [];
  const booked = bookedSeatsBySchedule(marshrutky, bookings);

  const availability: Record<number, PoputkyAvailability> = {};
  for (const s of schedules) {
    if (s.vehicleType === 'elektrichka') {
      availability[s.id] = {
        scheduleId: s.id,
        maxSeats: s.maxSeats,
        bookedSeats: 0,
        availableSeats: 0,
        isAvailable: false,
        vehicleType: s.vehicleType,
        ticketPurchaseUrl: s.ticketPurchaseUrl,
      };
      continue;
    }
    const bookedSeats = booked.get(s.id) ?? 0;
    const availableSeats = s.maxSeats - bookedSeats;
    availability[s.id] = {
      scheduleId: s.id,
      maxSeats: s.maxSeats,
      bookedSeats,
      availableSeats,
      isAvailable: availableSeats > 0,
    };
  }

  return {
    from: { id: from.id, code: from.code, nameUk: from.nameUk },
    to: { id: to.id, code: to.code, nameUk: to.nameUk },
    date: input.date,
    listings: listingRows.map(toPublicListing),
    schedules,
    availability,
  };
}
