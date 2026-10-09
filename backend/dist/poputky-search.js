"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATE_RE = void 0;
exports.dayBounds = dayBounds;
exports.bookedSeatsBySchedule = bookedSeatsBySchedule;
exports.searchPoputky = searchPoputky;
const catalog_cache_1 = require("./catalog-cache");
const schedule_include_1 = require("./schedule-include");
const schedule_trip_1 = require("./schedule-trip");
const viber_listing_public_1 = require("./viber-listing-public");
const trip_day_1 = require("./trip-day");
const poputky_od_1 = require("./poputky-od");
exports.DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Межі доби поїздки — спільна утиліта (trip-day.ts), як у пошуку, мержі й матчингу. */
function dayBounds(dateStr) {
    const { start, end } = (0, trip_day_1.tripDayWindow)(dateStr);
    return { startOfDay: start, endOfDay: end };
}
/** Сума заброньованих місць по кожному розкладу з однієї вибірки бронювань. */
function bookedSeatsBySchedule(schedules, bookings) {
    const out = new Map();
    for (const s of schedules) {
        let sum = 0;
        for (const b of bookings) {
            if (b.scheduleId === s.id)
                sum += b.seats;
            else if (b.scheduleId == null && b.route === s.route && b.departureTime === s.departureTime)
                sum += b.seats;
        }
        out.set(s.id, sum);
    }
    return out;
}
async function searchPoputky(prisma, input) {
    const catalog = await (0, catalog_cache_1.getCatalog)(prisma);
    const from = catalog.pointByCode(input.fromCode);
    const to = catalog.pointByCode(input.toCode);
    if (!from || !to || from.id === to.id)
        return null;
    const { startOfDay, endOfDay } = dayBounds(input.date);
    const alongTripRouteIds = catalog.routeIdsAlong(from.id, to.id);
    const [listingRows, scheduleRows] = await Promise.all([
        prisma.viberListing.findMany({
            where: {
                isActive: true,
                date: { gte: startOfDay, lt: endOfDay },
                OR: [
                    { fromPointId: from.id, toPointId: to.id },
                    ...(alongTripRouteIds.length ? [{ tripRouteId: { in: alongTripRouteIds } }] : []),
                    { route: `${from.code}-${to.code}`, fromPointId: null, toPointId: null },
                ],
            },
            orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
            select: viber_listing_public_1.PUBLIC_LISTING_SELECT,
        }),
        prisma.schedule.findMany({
            where: alongTripRouteIds.length ? { tripRouteId: { in: alongTripRouteIds } } : { id: -1 },
            include: schedule_include_1.scheduleInclude,
            orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
        }),
    ]);
    const search = { fromId: from.id, toId: to.id, fromCode: from.code, toCode: to.code };
    const listings = listingRows.filter((l) => (0, poputky_od_1.listingMatchesSearchOd)(l, search, catalog.itineraryByRouteId));
    const schedules = scheduleRows.filter((s) => (0, schedule_trip_1.isScheduleActiveOnDate)(s.activeWeekdays, input.date) &&
        (0, schedule_trip_1.scheduleMatchesOdAlongStops)(s.tripRoute?.stops, from.id, to.id));
    const marshrutky = schedules.filter((s) => s.vehicleType !== 'elektrichka');
    const bookings = marshrutky.length
        ? await prisma.booking.findMany({
            where: {
                date: { gte: startOfDay, lt: endOfDay },
                OR: [
                    { scheduleId: { in: marshrutky.map((s) => s.id) } },
                    { scheduleId: null, route: { in: [...new Set(marshrutky.map((s) => s.route))] } },
                ],
            },
            select: { scheduleId: true, route: true, departureTime: true, seats: true },
        })
        : [];
    const booked = bookedSeatsBySchedule(marshrutky, bookings);
    const availability = {};
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
        listings: listings.map(viber_listing_public_1.toPublicListing),
        schedules,
        availability,
    };
}
