"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARCHIVE_MIN_DAYS = exports.ARCHIVE_DEFAULT_DAYS = void 0;
exports.normalizeArchiveDays = normalizeArchiveDays;
exports.archiveOldListings = archiveOldListings;
const viber_analytics_import_1 = require("./viber-analytics-import");
exports.ARCHIVE_DEFAULT_DAYS = 90;
exports.ARCHIVE_MIN_DAYS = 30;
function normalizeArchiveDays(raw) {
    const n = Number(raw ?? exports.ARCHIVE_DEFAULT_DAYS);
    return Number.isFinite(n) ? Math.max(exports.ARCHIVE_MIN_DAYS, Math.round(n)) : exports.ARCHIVE_DEFAULT_DAYS;
}
async function archiveOldListings(prisma, days = exports.ARCHIVE_DEFAULT_DAYS, now = new Date()) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    const imported = await (0, viber_analytics_import_1.importListingsToRideEvents)(prisma);
    const deleted = await prisma.viberListing.deleteMany({ where: { isActive: false, date: { lt: cutoff } } });
    return { ...imported, days, cutoff, deleted: deleted.count };
}
