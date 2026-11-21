import type { PrismaClient } from '@prisma/client';
import { getViberListingEndDateTime, isPastRideDate, mergeRawMessage, mergeSenderName, mergeTextField } from './index-helpers';
import { resolveCorridorTripRouteId } from './schedule-trip';
import { resolveOdPointIdsFromRoute } from './poputky-od';
import { getCatalog, type CatalogPrisma } from './catalog-cache';
import { assertPhoneNotBlocked } from './phone-block';
import { tripDayWhere } from './trip-day';

export type ViberListingMergeInput = {
  rawMessage: string;
  source?: 'Viber1' | 'telegram1';
  senderName?: string | null;
  listingType: 'driver' | 'passenger';
  route: string;
  tripRouteId?: number | null;
  fromPointId?: number | null;
  toPointId?: number | null;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  priceUah?: number | null;
  isActive: boolean;
  personId?: number | null;
  /** Першоджерело (імпорт Telegram-груп): група, топік, id повідомлення */
  sourceChat?: string | null;
  sourceTopicId?: number | null;
  sourceMessageId?: number | null;
};

export function normalizePhoneForMerge(phone: string): string {
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

/**
 * Пасажир «Ірпінь → Малин» / «Буча → Малин» не є окремим коридором, але лежить на варіанті
 * Київ–Малин «через Ірпінь / Бучу» (TripRoute зі зупинками). Привʼязуємо до найконкретнішого
 * маршруту, що містить його пару в тому ж напрямку: найкоротший маршрут, потім менший id.
 * Лише для пасажирів: `driverItinerary` бере зупинки водія з його tripRouteId, тож водій
 * «Ірпінь → Малин» на варіанті Київ–Ірпінь–Малин збирав би пасажирів із Києва. Водій без
 * маршруту порівнюється по своїй парі from→to — це правильно.
 */
export async function resolveAlongTripRouteId(
  prisma: CatalogPrisma,
  fromPointId: number | null | undefined,
  toPointId: number | null | undefined,
): Promise<number | null> {
  if (fromPointId == null || toPointId == null) return null;
  const catalog = await getCatalog(prisma);
  const ids = catalog.routeIdsAlong(fromPointId, toPointId);
  if (ids.length === 0) return null;
  const len = (id: number) => catalog.itineraryByRouteId.get(id)?.length ?? Number.MAX_SAFE_INTEGER;
  return [...ids].sort((a, b) => len(a) - len(b) || a - b)[0];
}

async function resolveOdFields(
  prisma: PrismaClient,
  data: ViberListingMergeInput
): Promise<{ fromPointId: number | null; toPointId: number | null; tripRouteId: number | null }> {
  let fromPointId = data.fromPointId ?? null;
  let toPointId = data.toPointId ?? null;
  if ((fromPointId == null || toPointId == null) && data.route) {
    const od = await resolveOdPointIdsFromRoute(prisma, data.route);
    if (od) {
      fromPointId = fromPointId ?? od.fromPointId;
      toPointId = toPointId ?? od.toPointId;
    }
  }
  let tripRouteId = data.tripRouteId ?? null;
  if (tripRouteId == null && data.route) {
    tripRouteId = await resolveCorridorTripRouteId(prisma, data.route);
  }
  if (tripRouteId == null && data.listingType === 'passenger') {
    tripRouteId = await resolveAlongTripRouteId(prisma as unknown as CatalogPrisma, fromPointId, toPointId);
  }
  return { fromPointId, toPointId, tripRouteId };
}

export async function createOrMergeViberListing(
  prisma: PrismaClient,
  data: ViberListingMergeInput,
): Promise<{ listing: Awaited<ReturnType<PrismaClient['viberListing']['create']>>; isNew: boolean; isPastDate: boolean }> {
  // Єдиний шлюз для всіх оголошень (сайт, бот, імпорт із груп, адмінка) — тут же
  // й заборона номера. Кидає PhoneBlockedError; масові імпорти ловлять її поелементно.
  await assertPhoneNotBlocked(prisma, data.phone);

  const personId = data.personId ?? null;
  const date = data.date;
  const normalizedPhone = data.phone?.trim() ? normalizePhoneForMerge(data.phone) : '';
  // Поїздка вже минула (вчора чи раніше) — архівуємо одразу (для аналітики) і ніколи
  // не активуємо/сповіщуємо про неї, незалежно від джерела (Viber, Telegram-групи).
  const isPastDate = isPastRideDate(date);

  const odFields = await resolveOdFields(prisma, data);

  const candidates = await prisma.viberListing.findMany({
    where: {
      listingType: data.listingType,
      isActive: true,
      date: tripDayWhere(date),
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

  let existing: (typeof candidates)[0] | null = null;
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
        // «Дата по» рахується при записі — cleanup стає одним updateMany по індексу
        endsAt: getViberListingEndDateTime(date, data.departureTime),
      },
    });
    if (isPastDate) {
      console.log(
        `🗄️ Listing #${listing.id} archived on import — ride date ${date.toISOString().slice(0, 10)} is in the past, isActive forced to false`,
      );
    }
    return { listing, isNew: true, isPastDate };
  }

  const mergedNotes = mergeTextField(existing.notes, data.notes);
  const mergedSenderName = mergeSenderName(existing.senderName, data.senderName ?? null);
  const tripRouteId = existing.tripRouteId ?? odFields.tripRouteId;
  const fromPointId = existing.fromPointId ?? odFields.fromPointId;
  const toPointId = existing.toPointId ?? odFields.toPointId;

  const updated = await prisma.viberListing.update({
    where: { id: existing.id },
    data: {
      rawMessage: mergeRawMessage(existing.rawMessage, data.rawMessage),
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
      endsAt: existing.endsAt ?? getViberListingEndDateTime(existing.date, existing.departureTime),
      // source не оновлюємо — залишаємо перший; провенанс лише доповнюємо, якщо його ще не було
      ...(existing.sourceMessageId == null && data.sourceMessageId != null
        ? {
            sourceChat: data.sourceChat ?? null,
            sourceTopicId: data.sourceTopicId ?? null,
            sourceMessageId: data.sourceMessageId,
          }
        : {}),
    },
  });

  console.log(
    `♻️ Listing merged with existing #${existing.id} (route+date+time+phone match, source=${existing.source})`,
  );
  if (isPastDate) {
    console.log(`🗄️ Listing #${updated.id} archived on merge — ride date is in the past`);
  }

  return { listing: updated, isNew: false, isPastDate };
}
