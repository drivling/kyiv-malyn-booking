"use strict";
/**
 * Публічна форма оголошення для сайту й пошуку: без телефону, сирого тексту та службових полів.
 *
 * Контакт видається окремим кліком через GET /viber-listings/:id/contact; повний рядок
 * (з `phone`, `rawMessage`, `personId`, `authorNotifiedAt`) бачить лише адмінка.
 * Docs/poputky-search-performance-plan.md, D4 і Фаза 2.3.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_LISTING_SELECT = void 0;
exports.toPublicListing = toPublicListing;
exports.PUBLIC_LISTING_SELECT = {
    id: true,
    source: true,
    senderName: true,
    listingType: true,
    route: true,
    tripRouteId: true,
    fromPointId: true,
    toPointId: true,
    date: true,
    departureTime: true,
    seats: true,
    notes: true,
    priceUah: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
};
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
/** Явний список полів: нове поле в моделі не витече на сайт випадково. */
function toPublicListing(row) {
    return {
        id: row.id,
        source: row.source,
        senderName: row.senderName,
        listingType: row.listingType,
        route: row.route,
        tripRouteId: row.tripRouteId ?? null,
        fromPointId: row.fromPointId ?? null,
        toPointId: row.toPointId ?? null,
        date: iso(row.date),
        departureTime: row.departureTime,
        seats: row.seats,
        notes: row.notes,
        priceUah: row.priceUah ?? null,
        isActive: row.isActive,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
    };
}
