"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importListingsToRideEvents = importListingsToRideEvents;
const telegram_1 = require("./telegram");
/** Копіює в ViberRideEvent ті ViberListing, яких там ще немає (по viberRideId = listing.id). */
async function importListingsToRideEvents(prisma) {
    // id автоінкрементний, тож «нові» = усе після найбільшого вже імпортованого — без повного скану
    const maxImported = await prisma.viberRideEvent.aggregate({ _max: { viberRideId: true } });
    const since = maxImported._max.viberRideId ?? 0;
    const [totalSource, newRows] = await Promise.all([
        prisma.viberListing.count(),
        prisma.viberListing.findMany({
            where: { id: { gt: since } },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                route: true,
                date: true,
                departureTime: true,
                seats: true,
                phone: true,
                priceUah: true,
                isActive: true,
                createdAt: true,
                personId: true,
            },
        }),
    ]);
    if (newRows.length === 0) {
        return { totalSource, alreadyImported: totalSource, importedNow: 0 };
    }
    const toInsert = newRows.map((r) => {
        const rawPhone = (r.phone ?? '').trim();
        const normalized = rawPhone ? (0, telegram_1.normalizePhone)(rawPhone) : '';
        let hour = null;
        if (r.departureTime) {
            const hNum = parseInt(r.departureTime.split('-')[0].trim().split(':')[0], 10);
            if (!Number.isNaN(hNum) && hNum >= 0 && hNum <= 23)
                hour = hNum;
        }
        return {
            viberRideId: r.id,
            contactPhone: rawPhone || normalized,
            phoneNormalized: normalized || rawPhone || '',
            personId: r.personId ?? null,
            route: r.route ?? null,
            departureDate: r.date ?? null,
            departureTime: r.departureTime ?? null,
            availableSeats: r.seats ?? null,
            priceUah: r.priceUah ?? null,
            isParsed: true,
            isActive: r.isActive ?? null,
            parsingErrors: null,
            weekday: r.date instanceof Date ? r.date.getDay() : null,
            hour,
            createdAt: r.createdAt ?? new Date(),
        };
    });
    let created = 0;
    const chunkSize = 500;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
        const result = await prisma.viberRideEvent.createMany({ data: toInsert.slice(i, i + chunkSize), skipDuplicates: true });
        created += result.count;
    }
    return { totalSource, alreadyImported: totalSource - newRows.length, importedNow: created };
}
