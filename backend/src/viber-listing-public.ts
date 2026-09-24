/**
 * Публічна форма оголошення для сайту й пошуку: без телефону, сирого тексту та службових полів.
 *
 * Контакт видається окремим кліком через GET /viber-listings/:id/contact; повний рядок
 * (з `phone`, `rawMessage`, `personId`, `authorNotifiedAt`) бачить лише адмінка.
 * Docs/poputky-search-performance-plan.md, D4 і Фаза 2.3.
 */

export const PUBLIC_LISTING_SELECT = {
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
} as const;

export type PublicListingRow = {
  id: number;
  source?: string;
  senderName: string | null;
  listingType: string;
  route: string;
  tripRouteId: number | null;
  fromPointId: number | null;
  toPointId: number | null;
  date: Date | string;
  departureTime: string | null;
  seats: number | null;
  notes: string | null;
  priceUah: number | null;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PublicListing = Omit<PublicListingRow, 'date' | 'createdAt' | 'updatedAt'> & {
  date: string;
  createdAt: string;
  updatedAt: string;
};

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : d);

/** Явний список полів: нове поле в моделі не витече на сайт випадково. */
export function toPublicListing(row: PublicListingRow): PublicListing {
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
