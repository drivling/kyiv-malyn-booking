/**
 * Та сама логіка злиття, що на backend (createOrMergeViberListing), без priceUah —
 * у схемі viberparser/prisma немає поля ціни.
 */
import type { PrismaClient } from './__generated__/prisma';

export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '38' + cleaned;
  }
  return cleaned;
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function mergeTextField(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(newVal)) return oldVal ?? null;
  if (!hasNonEmptyText(oldVal)) return newVal ?? null;
  const oldTrim = oldVal!.trim();
  const newTrim = newVal!.trim();
  if (oldTrim === newTrim) return oldVal;
  if (newTrim.length > oldTrim.length && !oldTrim.includes(newTrim)) {
    return `${oldTrim} | ${newTrim}`;
  }
  return oldVal;
}

function mergeSenderName(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(oldVal) && hasNonEmptyText(newVal)) return newVal;
  return oldVal;
}

function mergeRawMessage(oldRaw: string, newRaw: string): string {
  const oldTrim = (oldRaw || '').trim();
  const newTrim = (newRaw || '').trim();
  if (!newTrim) return oldRaw;
  if (!oldTrim) return newRaw;
  if (oldTrim.includes(newTrim)) return oldRaw;
  if (newTrim.includes(oldTrim)) return newRaw;
  return `${oldRaw}\n---\n${newRaw}`;
}

export type ViberListingMergeInput = {
  rawMessage: string;
  senderName?: string | null;
  listingType: 'driver' | 'passenger';
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  isActive: boolean;
  personId?: number | null;
  source?: string;
};

export async function createOrMergeViberListing(
  prisma: PrismaClient,
  data: ViberListingMergeInput,
): Promise<{ listing: Awaited<ReturnType<PrismaClient['viberListing']['create']>>; isNew: boolean }> {
  const personId = data.personId ?? null;
  const date = data.date;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const normalizedPhone = data.phone?.trim() ? normalizePhone(data.phone) : '';

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
    existing = candidates.find((c) => normalizePhone(c.phone) === normalizedPhone) ?? null;
  }
  if (!existing && personId) {
    existing = candidates.find((c) => c.personId === personId) ?? null;
  }

  if (!existing) {
    const listing = await prisma.viberListing.create({
      data: {
        rawMessage: data.rawMessage,
        senderName: data.senderName ?? null,
        listingType: data.listingType,
        route: data.route,
        date: data.date,
        departureTime: data.departureTime,
        seats: data.seats,
        phone: data.phone || '',
        notes: data.notes,
        isActive: data.isActive,
        personId: personId ?? undefined,
        source: data.source ?? 'Viber1',
      },
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
      isActive: existing.isActive || data.isActive,
      personId: existing.personId ?? personId,
    },
  });

  console.log(
    `♻️ Viber parser: merged into #${existing.id} (route+date+time+phone/person, source=${existing.source})`,
  );

  return { listing: updated, isNew: false };
}
