"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERSON_DATA_EXPORT_SCHEMA_VERSION = void 0;
exports.personDataExportFileName = personDataExportFileName;
exports.collectPersonData = collectPersonData;
exports.PERSON_DATA_EXPORT_SCHEMA_VERSION = 1;
/** Ім'я файла `malin-kiev-ua-my-data-YYYY-MM-DD.json` */
function personDataExportFileName(now) {
    return `malin-kiev-ua-my-data-${now.toISOString().slice(0, 10)}.json`;
}
const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
/**
 * Збирає все про людину за `telegramUserId`. `null` — коли нема ані Person, ані жодного рядка за цим id.
 * Лише читання; кожен `findMany` з `select`/`include`, щоб у файл не потрапили зайві колонки.
 */
async function collectPersonData(prisma, opts) {
    const telegramUserId = opts.telegramUserId.trim();
    const now = opts.now ?? new Date();
    const person = await prisma.person.findFirst({ where: { telegramUserId } });
    const personId = person?.id ?? null;
    const bookingWhere = personId ? { OR: [{ personId }, { telegramUserId }] } : { telegramUserId };
    const bookings = await prisma.booking.findMany({
        where: bookingWhere,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        include: { reminders: true, viberListing: { select: { senderName: true } } },
    });
    const listings = personId
        ? await prisma.viberListing.findMany({
            where: { personId },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            include: {
                rideShareRequestsAsPassenger: { select: { id: true, status: true, createdAt: true } },
                rideShareRequestsAsDriver: { select: { id: true, status: true, createdAt: true } },
            },
        })
        : [];
    const rideEvents = personId ? await prisma.viberRideEvent.findMany({ where: { personId }, orderBy: { id: 'desc' } }) : [];
    const invites = personId ? await prisma.referralInvite.findMany({ where: { referrerId: personId }, orderBy: { id: 'desc' } }) : [];
    const rewards = personId
        ? await prisma.referralReward.findMany({ where: { OR: [{ referrerId: personId }, { referredPersonId: personId }] }, orderBy: { id: 'desc' } })
        : [];
    const rideProofs = personId ? await prisma.rideCompletionProof.findMany({ where: { personId }, orderBy: { id: 'desc' } }) : [];
    const tgUserIdBig = /^\d+$/.test(telegramUserId) ? BigInt(telegramUserId) : null;
    const dzhuraPerson = tgUserIdBig != null ? await prisma.dzhuraPerson.findUnique({ where: { tgUserId: tgUserIdBig } }) : null;
    const capturedMessages = dzhuraPerson
        ? await prisma.dzhuraMessage.findMany({
            where: { senderPersonId: dzhuraPerson.id },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true, editedAt: true, text: true, mediaKind: true, chat: { select: { title: true } } },
        })
        : [];
    const lunchParticipant = await prisma.lunchParticipant.findUnique({ where: { telegramUserId } });
    const lunchOrders = lunchParticipant
        ? await prisma.lunchOrder.findMany({
            where: { participantId: lunchParticipant.id },
            orderBy: { id: 'desc' },
            select: { rawText: true, totalUah: true, status: true, day: { select: { date: true } } },
        })
        : [];
    const lunchPayments = lunchParticipant
        ? await prisma.lunchPayment.findMany({
            where: { participantId: lunchParticipant.id },
            orderBy: { id: 'desc' },
            select: { amountUah: true, day: { select: { date: true } } },
        })
        : [];
    const smsSent = person
        ? await prisma.smsSendLog.findMany({
            where: { phoneNormalized: person.phoneNormalized },
            orderBy: { id: 'desc' },
            select: { useCase: true, status: true, createdAt: true },
        })
        : [];
    const hasAnything = person || bookings.length || listings.length || rideEvents.length || capturedMessages.length || lunchParticipant;
    if (!hasAnything)
        return null;
    return {
        schemaVersion: exports.PERSON_DATA_EXPORT_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
        about: 'Усі дані про вас на malin.kiev.ua і в Telegram-боті на момент експорту. Чужі дані (телефон водія, контакт друга) ' +
            'у файл не входять. Видалити акаунт — на сторінці профілю або командою /deleteme у боті.',
        telegramUserId,
        person: person
            ? {
                id: person.id,
                fullName: person.fullName,
                phone: person.phoneNormalized,
                telegramUsername: person.telegramUsername,
                createdAt: iso(person.createdAt),
                smsOptOut: person.smsOptOut,
                phoneBlocked: person.phoneBlockedAt != null,
                referralCode: person.referralCode,
                invitedByFriend: person.referredByPersonId != null,
            }
            : null,
        bookings: bookings.map((b) => ({
            id: b.id,
            route: b.route,
            date: iso(b.date),
            departureTime: b.departureTime,
            seats: b.seats,
            name: b.name,
            phone: b.phone,
            source: b.source,
            createdAt: iso(b.createdAt),
            driverName: b.viberListing?.senderName ?? null,
            reminders: (b.reminders ?? []).map((r) => ({ kind: r.kind, delivered: r.delivered, sentAt: iso(r.sentAt) })),
        })),
        listings: listings.map((l) => ({
            id: l.id,
            listingType: l.listingType,
            route: l.route,
            date: iso(l.date),
            departureTime: l.departureTime,
            seats: l.seats,
            priceUah: l.priceUah,
            notes: l.notes,
            senderName: l.senderName,
            phone: l.phone,
            message: l.rawMessage,
            source: l.source,
            isActive: l.isActive,
            createdAt: iso(l.createdAt),
            rideShareRequests: [
                ...(l.rideShareRequestsAsPassenger ?? []).map((r) => ({ id: r.id, role: 'passenger', status: r.status, createdAt: iso(r.createdAt) })),
                ...(l.rideShareRequestsAsDriver ?? []).map((r) => ({ id: r.id, role: 'driver', status: r.status, createdAt: iso(r.createdAt) })),
            ],
        })),
        rideEvents: rideEvents.map((e) => ({
            id: e.id,
            route: e.route,
            departureDate: iso(e.departureDate),
            departureTime: e.departureTime,
            seats: e.availableSeats,
            priceUah: e.priceUah,
            isParsed: e.isParsed,
            createdAt: iso(e.createdAt),
        })),
        referral: {
            code: person?.referralCode ?? null,
            invitesSent: invites.map((i) => ({ id: i.id, inviteType: i.inviteType, status: i.status, registeredAt: iso(i.registeredAt), createdAt: iso(i.createdAt) })),
            rewardsAsReferrer: rewards
                .filter((r) => r.referrerId === personId)
                .map((r) => ({ id: r.id, rewardType: r.rewardType, amountUah: r.amountUah, status: r.status, createdAt: iso(r.createdAt), paidAt: iso(r.paidAt) })),
            rewardsForFriendsCount: rewards.filter((r) => r.referredPersonId === personId && r.referrerId !== personId).length,
            rideProofs: rideProofs.map((p) => ({ id: p.id, route: p.route, rideDate: iso(p.rideDate), departureTime: p.departureTime, status: p.status, createdAt: iso(p.createdAt) })),
        },
        capturedMessages: capturedMessages.map((m) => ({
            chat: m.chat?.title ?? '',
            sentAt: iso(m.sentAt),
            editedAt: iso(m.editedAt),
            text: m.text,
            mediaKind: m.mediaKind,
        })),
        lunch: lunchParticipant
            ? {
                displayName: lunchParticipant.displayName,
                orders: lunchOrders.map((o) => ({ date: iso(o.day?.date), text: o.rawText, totalUah: o.totalUah, status: o.status })),
                payments: lunchPayments.map((p) => ({ date: iso(p.day?.date), amountUah: p.amountUah })),
            }
            : null,
        smsSent: smsSent.map((s) => ({ useCase: s.useCase, status: s.status, createdAt: iso(s.createdAt) })),
    };
}
