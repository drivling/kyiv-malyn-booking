import type { PrismaClient } from '@prisma/client';
import { mergeRawMessage, mergeSenderName, mergeTextField } from './index-helpers';

export type ViberListingMergeInput = {
  rawMessage: string;
  source?: 'Viber1' | 'telegram1';
  senderName?: string | null;
  listingType: 'driver' | 'passenger';
  route: string;
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
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = `38${cleaned}`;
  }
  return cleaned;
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

  const candidates = await prisma.viberListing.findMany({
    where: {
      listingType: data.listingType,
      route: data.route,
      isActive: true,
      date: {
        gte: startOfDay,
        lt: endOfDay,
      },
      departureTime: data.departureTime ?? null,
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
      data: { ...data, source: data.source ?? 'Viber1' },
    });
    return { listing, isNew: true };
  }

  const mergedNotes = mergeTextField(existing.notes, data.notes);
  const mergedSenderName = mergeSenderName(existing.senderName, data.senderName ?? null);

  const updated = await prisma.viberListing.update({
    where: { id: existing.id },
    data: {
      rawMessage: mergeRawMessage(existing.rawMessage, data.rawMessage),
      senderName: mergedSenderName ?? undefined,
      seats: data.seats != null ? data.seats : existing.seats,
      phone: existing.phone || data.phone,
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
