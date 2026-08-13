import type { PrismaClient } from '@prisma/client';
import { mergeRawMessage, mergeSenderName, mergeTextField } from './index-helpers';
import { resolveCorridorTripRouteId } from './schedule-trip';
import { resolveOdPointIdsFromRoute } from './poputky-od';

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
  return { fromPointId, toPointId, tripRouteId };
}

export async function createOrMergeViberListing(
  prisma: PrismaClient,
  data: ViberListingMergeInput,
): Promise<{ listing: Awaited<ReturnType<PrismaClient['viberListing']['create']>>; isNew: boolean }> {
  const personId = data.personId ?? null;
  const date = data.date;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const normalizedPhone = data.phone?.trim() ? normalizePhoneForMerge(data.phone) : '';

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
        source: data.source ?? 'Viber1',
        tripRouteId: odFields.tripRouteId,
        fromPointId: odFields.fromPointId,
        toPointId: odFields.toPointId,
      },
    });
    return { listing, isNew: true };
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
      isActive: existing.isActive || data.isActive,
      personId: existing.personId ?? personId,
      // source не оновлюємо — залишаємо перший
    },
  });

  console.log(
    `♻️ Listing merged with existing #${existing.id} (route+date+time+phone match, source=${existing.source})`,
  );

  return { listing: updated, isNew: false };
}
