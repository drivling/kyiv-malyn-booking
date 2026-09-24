"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultListingMatchDeps = defaultListingMatchDeps;
exports.runListingMatchJob = runListingMatchJob;
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
/** Воркер процесу: index.ts запускає після app.listen, зупиняє на SIGTERM. */
function startListingMatchWorker(prisma, opts = {}) {
    const deps = defaultListingMatchDeps(prisma);
    const worker = (0, notification_queue_1.createNotificationWorker)(prisma, { [notification_queue_1.LISTING_MATCH_JOB]: (job) => runListingMatchJob(job, deps).then(() => undefined) }, opts);
    worker.start();
    return worker;
}
