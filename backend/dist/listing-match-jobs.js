"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultListingMatchDeps = defaultListingMatchDeps;
exports.runListingMatchJob = runListingMatchJob;
exports.lookupBestNameByPhone = lookupBestNameByPhone;
exports.defaultResolveNameDeps = defaultResolveNameDeps;
exports.runResolveSenderNameJob = runResolveSenderNameJob;
exports.startListingMatchWorker = startListingMatchWorker;
const index_helpers_1 = require("./index-helpers");
const telegram_1 = require("./telegram");
const notification_queue_1 = require("./notification-queue");
function defaultListingMatchDeps(prisma) {
    return {
        findListing: (id) => prisma.viberListing.findUnique({ where: { id } }),
        notifyForDriver: telegram_1.notifyMatchingPassengersForNewDriver,
        notifyForPassenger: telegram_1.notifyMatchingDriversForNewPassenger,
        chatIdByPhone: telegram_1.getChatIdByPhone,
    };
}
async function runListingMatchJob(job, deps) {
    const payload = job.payload;
    const listingId = Number(payload?.listingId);
    if (!Number.isInteger(listingId))
        throw new Error('listing_match: payload.listingId missing');
    const listing = await deps.findListing(listingId);
    if (!listing)
        return 'skipped_missing';
    // Поки job чекав, оголошення могли зняти або змержити — не будимо людей даремно
    if (!listing.isActive)
        return 'skipped_inactive';
    if ((0, index_helpers_1.isPastRideDate)(listing.date))
        return 'skipped_past';
    const authorChatId = payload.authorChatId ?? (listing.phone?.trim() ? await deps.chatIdByPhone(listing.phone) : null);
    if (listing.listingType === 'driver')
        await deps.notifyForDriver(listing, authorChatId);
    else if (listing.listingType === 'passenger')
        await deps.notifyForPassenger(listing, authorChatId);
    return 'sent';
}
/** Найкраще ім'я з трьох джерел: бот (по chatId), особистий акаунт (Telethon), Opendatabot. */
async function lookupBestNameByPhone(phone) {
    const person = await (0, telegram_1.getPersonByPhone)(phone);
    const { nameFromBot, nameFromUser, nameFromOpendatabot } = await (0, telegram_1.getResolvedNameForPerson)(phone, person?.telegramChatId ?? null);
    return (0, telegram_1.pickBestNameFromCandidates)(null, nameFromBot, nameFromUser, nameFromOpendatabot).newName;
}
function defaultResolveNameDeps(prisma) {
    return {
        lookupName: lookupBestNameByPhone,
        getListing: (id) => prisma.viberListing.findUnique({ where: { id }, select: { id: true, senderName: true, phone: true } }),
        setListingName: async (id, name) => {
            await prisma.viberListing.update({ where: { id }, data: { senderName: name } });
        },
        setPersonName: async (phone, name) => {
            await (0, telegram_1.findOrCreatePersonByPhone)(phone, { fullName: name });
        },
    };
}
/** Job resolve_sender_name: Telethon-пошук імені по телефону поза HTTP-запитом (Фаза 5.2). */
async function runResolveSenderNameJob(job, deps) {
    const payload = job.payload;
    const listingId = Number(payload?.listingId);
    const phone = String(payload?.phone ?? '').trim();
    if (!Number.isInteger(listingId) || !phone)
        throw new Error('resolve_sender_name: payload.listingId/phone missing');
    const listing = await deps.getListing(listingId);
    if (!listing)
        return 'not_found';
    if (listing.senderName?.trim())
        return 'already_named';
    const name = (await deps.lookupName(phone))?.trim();
    if (!name)
        return 'no_name';
    await deps.setListingName(listingId, name);
    await deps.setPersonName(phone, name);
    return 'updated';
}
/** Воркер процесу: index.ts запускає після app.listen, зупиняє на SIGTERM. */
function startListingMatchWorker(prisma, opts = {}) {
    const deps = defaultListingMatchDeps(prisma);
    const nameDeps = defaultResolveNameDeps(prisma);
    const worker = (0, notification_queue_1.createNotificationWorker)(prisma, {
        [notification_queue_1.LISTING_MATCH_JOB]: (job) => runListingMatchJob(job, deps).then(() => undefined),
        [notification_queue_1.RESOLVE_SENDER_NAME_JOB]: (job) => runResolveSenderNameJob(job, nameDeps).then(() => undefined),
    }, opts);
    worker.start();
    return worker;
}
