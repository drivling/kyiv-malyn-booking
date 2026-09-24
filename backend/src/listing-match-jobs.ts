/**
 * Обробник job-а «перетини для оголошення» (NotificationJob.kind = listing_match).
 *
 * Продюсери (ingest, адмінка, бот, імпорт груп) лише кладуть { listingId, authorChatId } у чергу;
 * тут — та сама розсилка, що була раніше синхронною: notifyMatching* з telegram.ts.
 * Docs/poputky-search-performance-plan.md, Фаза 4.3.
 */
import type { PrismaClient } from '@prisma/client';
import { isPastRideDate } from './index-helpers';
import {
  getChatIdByPhone,
  notifyMatchingDriversForNewPassenger,
  notifyMatchingPassengersForNewDriver,
} from './telegram';
import {
  LISTING_MATCH_JOB,
  createNotificationWorker,
  type ListingMatchPayload,
  type NotificationJobRow,
  type WorkerOptions,
} from './notification-queue';

type ListingRow = {
  id: number;
  listingType: string;
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  senderName: string | null;
  notes: string | null;
  fromPointId: number | null;
  toPointId: number | null;
  tripRouteId: number | null;
  isActive: boolean;
};

export type ListingMatchDeps = {
  findListing: (id: number) => Promise<ListingRow | null>;
  notifyForDriver: typeof notifyMatchingPassengersForNewDriver;
  notifyForPassenger: typeof notifyMatchingDriversForNewPassenger;
  chatIdByPhone: (phone: string) => Promise<string | null>;
};

export function defaultListingMatchDeps(prisma: PrismaClient): ListingMatchDeps {
  return {
    findListing: (id) => prisma.viberListing.findUnique({ where: { id } }) as Promise<ListingRow | null>,
    notifyForDriver: notifyMatchingPassengersForNewDriver,
    notifyForPassenger: notifyMatchingDriversForNewPassenger,
    chatIdByPhone: getChatIdByPhone,
  };
}

export type ListingMatchOutcome = 'sent' | 'skipped_missing' | 'skipped_inactive' | 'skipped_past';

export async function runListingMatchJob(job: NotificationJobRow, deps: ListingMatchDeps): Promise<ListingMatchOutcome> {
  const payload = job.payload as Partial<ListingMatchPayload>;
  const listingId = Number(payload?.listingId);
  if (!Number.isInteger(listingId)) throw new Error('listing_match: payload.listingId missing');
  const listing = await deps.findListing(listingId);
  if (!listing) return 'skipped_missing';
  // Поки job чекав, оголошення могли зняти або змержити — не будимо людей даремно
  if (!listing.isActive) return 'skipped_inactive';
  if (isPastRideDate(listing.date)) return 'skipped_past';
  const authorChatId =
    payload.authorChatId ?? (listing.phone?.trim() ? await deps.chatIdByPhone(listing.phone) : null);
  if (listing.listingType === 'driver') await deps.notifyForDriver(listing, authorChatId);
  else if (listing.listingType === 'passenger') await deps.notifyForPassenger(listing, authorChatId);
  return 'sent';
}

/** Воркер процесу: index.ts запускає після app.listen, зупиняє на SIGTERM. */
export function startListingMatchWorker(prisma: PrismaClient, opts: WorkerOptions = {}) {
  const deps = defaultListingMatchDeps(prisma);
  const worker = createNotificationWorker(
    prisma,
    { [LISTING_MATCH_JOB]: (job) => runListingMatchJob(job, deps).then(() => undefined) },
    opts,
  );
  worker.start();
  return worker;
}
