"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneForMerge = normalizePhoneForMerge;
exports.createOrMergeViberListing = createOrMergeViberListing;
const index_helpers_1 = require("./index-helpers");
const schedule_trip_1 = require("./schedule-trip");
const poputky_od_1 = require("./poputky-od");
const phone_block_1 = require("./phone-block");
function normalizePhoneForMerge(phone) {
    const trimmed = phone.trim();
    if (trimmed.startsWith('@')) {
        return trimmed.toLowerCase();
    }
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = `38${cleaned}`;
    }
    return cleaned;
}
async function resolveOdFields(prisma, data) {
    let fromPointId = data.fromPointId ?? null;
    let toPointId = data.toPointId ?? null;
    if ((fromPointId == null || toPointId == null) && data.route) {
        const od = await (0, poputky_od_1.resolveOdPointIdsFromRoute)(prisma, data.route);
        if (od) {
            fromPointId = fromPointId ?? od.fromPointId;
            toPointId = toPointId ?? od.toPointId;
        }
    }
    let tripRouteId = data.tripRouteId ?? null;
    if (tripRouteId == null && data.route) {
        tripRouteId = await (0, schedule_trip_1.resolveCorridorTripRouteId)(prisma, data.route);
    }
    return { fromPointId, toPointId, tripRouteId };
}
async function createOrMergeViberListing(prisma, data) {
    // Єдиний шлюз для всіх оголошень (сайт, бот, імпорт із груп, адмінка) — тут же
    // й заборона номера. Кидає PhoneBlockedError; масові імпорти ловлять її поелементно.
    await (0, phone_block_1.assertPhoneNotBlocked)(prisma, data.phone);
    const personId = data.personId ?? null;
    const date = data.date;
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const normalizedPhone = data.phone?.trim() ? normalizePhoneForMerge(data.phone) : '';
    // Поїздка вже минула (вчора чи раніше) — архівуємо одразу (для аналітики) і ніколи
    // не активуємо/сповіщуємо про неї, незалежно від джерела (Viber, Telegram-групи).
    const isPastDate = (0, index_helpers_1.isPastRideDate)(date);
    const odFields = await resolveOdFields(prisma, data);
    const candidates = await prisma.viberListing.findMany({
        where: {
            listingType: data.listingType,
            isActive: true,
            date: {
                gte: startOfDay,
                lt: endOfDay,
            },
            departureTime: data.departureTime ?? null,
            OR: [
                ...(odFields.fromPointId != null && odFields.toPointId != null
                    ? [{ fromPointId: odFields.fromPointId, toPointId: odFields.toPointId }]
                    : []),
                ...(odFields.tripRouteId != null ? [{ tripRouteId: odFields.tripRouteId }] : []),
                { route: data.route },
            ],
        },
        orderBy: { createdAt: 'desc' },
    });
    let existing = null;
    if (normalizedPhone) {
        existing = candidates.find((c) => normalizePhoneForMerge(c.phone) === normalizedPhone) ?? null;
    }
    if (!existing && personId) {
        existing = candidates.find((c) => c.personId === personId) ?? null;
    }
    if (!existing) {
        const listing = await prisma.viberListing.create({
            data: {
                ...data,
                isActive: isPastDate ? false : data.isActive,
                source: data.source ?? 'Viber1',
                tripRouteId: odFields.tripRouteId,
                fromPointId: odFields.fromPointId,
                toPointId: odFields.toPointId,
            },
        });
        if (isPastDate) {
            console.log(`🗄️ Listing #${listing.id} archived on import — ride date ${date.toISOString().slice(0, 10)} is in the past, isActive forced to false`);
        }
        return { listing, isNew: true, isPastDate };
    }
    const mergedNotes = (0, index_helpers_1.mergeTextField)(existing.notes, data.notes);
    const mergedSenderName = (0, index_helpers_1.mergeSenderName)(existing.senderName, data.senderName ?? null);
    const tripRouteId = existing.tripRouteId ?? odFields.tripRouteId;
    const fromPointId = existing.fromPointId ?? odFields.fromPointId;
    const toPointId = existing.toPointId ?? odFields.toPointId;
    const updated = await prisma.viberListing.update({
        where: { id: existing.id },
        data: {
            rawMessage: (0, index_helpers_1.mergeRawMessage)(existing.rawMessage, data.rawMessage),
            senderName: mergedSenderName ?? undefined,
            seats: data.seats != null ? data.seats : existing.seats,
            phone: existing.phone || data.phone,
            tripRouteId: tripRouteId ?? undefined,
            fromPointId: fromPointId ?? undefined,
            toPointId: toPointId ?? undefined,
            notes: mergedNotes,
            priceUah: data.priceUah != null ? data.priceUah : existing.priceUah,
            isActive: isPastDate ? false : existing.isActive || data.isActive,
            personId: existing.personId ?? personId,
            // source не оновлюємо — залишаємо перший
        },
    });
    console.log(`♻️ Listing merged with existing #${existing.id} (route+date+time+phone match, source=${existing.source})`);
    if (isPastDate) {
        console.log(`🗄️ Listing #${updated.id} archived on merge — ride date is in the past`);
    }
    return { listing: updated, isNew: false, isPastDate };
}
