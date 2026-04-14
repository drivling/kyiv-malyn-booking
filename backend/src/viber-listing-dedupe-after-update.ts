/**
 * Після редагування оголошення воно може стати «таким самим», що й інший рядок
 * (той самий маршрут/день/час + телефон або personId). Тоді залишаємо один запис
 * (той, що зберегли), переносимо поля, які не входять у ключ схожості, і видаляємо дублікат.
 */
import type { PrismaClient, ViberListing } from '@prisma/client';
import { mergeRawMessage, mergeSenderName, mergeTextField } from './index-helpers';
import { normalizePhone } from './telegram';

export function listingsAreMergeDuplicates(
  a: Pick<
    ViberListing,
    'listingType' | 'route' | 'date' | 'departureTime' | 'phone' | 'personId'
  >,
  b: Pick<
    ViberListing,
    'listingType' | 'route' | 'date' | 'departureTime' | 'phone' | 'personId'
  >,
): boolean {
  if (a.listingType !== b.listingType || a.route !== b.route) return false;
  const da = new Date(a.date);
  const db = new Date(b.date);
  if (
    da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate()
  ) {
    return false;
  }
  if ((a.departureTime ?? null) !== (b.departureTime ?? null)) return false;

  const na = a.phone?.trim() ? normalizePhone(a.phone) : '';
  const nb = b.phone?.trim() ? normalizePhone(b.phone) : '';
  if (na && nb && na === nb) return true;
  if (a.personId != null && b.personId != null && a.personId === b.personId) return true;
  return false;
}

function buildMergedUpdateData(survivor: ViberListing, twin: ViberListing): Partial<ViberListing> {
  return {
    rawMessage: mergeRawMessage(survivor.rawMessage, twin.rawMessage),
    notes: mergeTextField(survivor.notes, twin.notes),
    senderName: mergeSenderName(survivor.senderName, twin.senderName),
    seats: survivor.seats != null ? survivor.seats : twin.seats,
    priceUah: survivor.priceUah != null ? survivor.priceUah : twin.priceUah,
    phone: survivor.phone?.trim() ? survivor.phone : twin.phone,
    personId: survivor.personId ?? twin.personId,
    isActive: survivor.isActive || twin.isActive,
  };
}

type TxSubset = Pick<
  PrismaClient,
  'rideShareRequest' | 'viberMatchPairNotification' | 'booking' | 'viberListing'
>;

async function repointRideShareRequests(tx: TxSubset, fromId: number, toId: number): Promise<void> {
  const asPassenger = await tx.rideShareRequest.findMany({ where: { passengerListingId: fromId } });
  for (const r of asPassenger) {
    const clash = await tx.rideShareRequest.findFirst({
      where: { passengerListingId: toId, driverListingId: r.driverListingId },
    });
    if (clash) {
      await tx.rideShareRequest.delete({ where: { id: r.id } });
    } else {
      await tx.rideShareRequest.update({
        where: { id: r.id },
        data: { passengerListingId: toId },
      });
    }
  }

  const asDriver = await tx.rideShareRequest.findMany({ where: { driverListingId: fromId } });
  for (const r of asDriver) {
    const clash = await tx.rideShareRequest.findFirst({
      where: { passengerListingId: r.passengerListingId, driverListingId: toId },
    });
    if (clash) {
      await tx.rideShareRequest.delete({ where: { id: r.id } });
    } else {
      await tx.rideShareRequest.update({
        where: { id: r.id },
        data: { driverListingId: toId },
      });
    }
  }
}

async function repointMatchNotifications(tx: TxSubset, fromId: number, toId: number): Promise<void> {
  const asPassenger = await tx.viberMatchPairNotification.findMany({
    where: { passengerListingId: fromId },
  });
  for (const n of asPassenger) {
    const clash = await tx.viberMatchPairNotification.findFirst({
      where: { passengerListingId: toId, driverListingId: n.driverListingId },
    });
    if (clash) {
      await tx.viberMatchPairNotification.delete({ where: { id: n.id } });
    } else {
      await tx.viberMatchPairNotification.update({
        where: { id: n.id },
        data: { passengerListingId: toId },
      });
    }
  }

  const asDriver = await tx.viberMatchPairNotification.findMany({ where: { driverListingId: fromId } });
  for (const n of asDriver) {
    const clash = await tx.viberMatchPairNotification.findFirst({
      where: { passengerListingId: n.passengerListingId, driverListingId: toId },
    });
    if (clash) {
      await tx.viberMatchPairNotification.delete({ where: { id: n.id } });
    } else {
      await tx.viberMatchPairNotification.update({
        where: { id: n.id },
        data: { driverListingId: toId },
      });
    }
  }
}

/**
 * Якщо після оновлення залишився інший активний рядок з тим самим ключем злиття,
 * об'єднує його в `survivorId`, переносить залежності й видаляє дублікат(и).
 */
export async function dedupeViberListingsAfterUpdate(
  prisma: PrismaClient,
  survivorId: number,
): Promise<{ listing: ViberListing; mergedAwayIds: number[] }> {
  const survivor = await prisma.viberListing.findUnique({ where: { id: survivorId } });
  if (!survivor || !survivor.isActive) {
    if (!survivor) {
      throw new Error(`ViberListing ${survivorId} not found`);
    }
    return { listing: survivor, mergedAwayIds: [] };
  }

  const date = survivor.date;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const candidates = await prisma.viberListing.findMany({
    where: {
      listingType: survivor.listingType,
      route: survivor.route,
      isActive: true,
      date: { gte: startOfDay, lt: endOfDay },
      departureTime: survivor.departureTime ?? null,
      id: { not: survivorId },
    },
    orderBy: { id: 'asc' },
  });

  const twins = candidates.filter((c) => listingsAreMergeDuplicates(survivor, c));
  if (twins.length === 0) {
    return { listing: survivor, mergedAwayIds: [] };
  }

  const mergedAwayIds: number[] = [];
  let current = survivor;

  for (const twin of twins) {
    mergedAwayIds.push(twin.id);

    await prisma.$transaction(async (tx) => {
      await repointRideShareRequests(tx, twin.id, survivorId);
      await repointMatchNotifications(tx, twin.id, survivorId);
      await tx.booking.updateMany({
        where: { viberListingId: twin.id },
        data: { viberListingId: survivorId },
      });

      const mergedData = buildMergedUpdateData(current, twin);
      current = await tx.viberListing.update({
        where: { id: survivorId },
        data: mergedData,
      });

      await tx.viberListing.delete({ where: { id: twin.id } });
    });

    console.log(
      `♻️ Dedupe after edit: merged duplicate #${twin.id} into #${survivorId} (route+date+time+phone/person match)`,
    );
  }

  return { listing: current, mergedAwayIds };
}
