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
  findOrCreatePersonByPhone,
  getChatIdByPhone,
  getPersonByPhone,
  getResolvedNameForPerson,
  notifyMatchingDriversForNewPassenger,
  notifyMatchingPassengersForNewDriver,
  pickBestNameFromCandidates,
} from './telegram';
import {
  LISTING_MATCH_JOB,
  RESOLVE_SENDER_NAME_JOB,
  createNotificationWorker,
  type ListingMatchPayload,
  type NotificationJobRow,
  type ResolveSenderNamePayload,
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

export type ResolveNameDeps = {
  lookupName: (phone: string) => Promise<string | null>;
  getListing: (id: number) => Promise<{ id: number; senderName: string | null; phone: string } | null>;
  setListingName: (id: number, name: string) => Promise<void>;
  setPersonName: (phone: string, name: string) => Promise<void>;
};

/** Найкраще ім'я з трьох джерел: бот (по chatId), особистий акаунт (Telethon), Opendatabot. */
export async function lookupBestNameByPhone(phone: string): Promise<string | null> {
  const person = await getPersonByPhone(phone);
  const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
    phone,
    person?.telegramChatId ?? null,
  );
  return pickBestNameFromCandidates(null, nameFromBot, nameFromUser, nameFromOpendatabot).newName;
}

export function defaultResolveNameDeps(prisma: PrismaClient): ResolveNameDeps {
  return {
    lookupName: lookupBestNameByPhone,
    getListing: (id) => prisma.viberListing.findUnique({ where: { id }, select: { id: true, senderName: true, phone: true } }),
    setListingName: async (id, name) => {
      await prisma.viberListing.update({ where: { id }, data: { senderName: name } });
    },
    setPersonName: async (phone, name) => {
      await findOrCreatePersonByPhone(phone, { fullName: name });
    },
  };
}

export type ResolveNameOutcome = 'updated' | 'already_named' | 'not_found' | 'no_name';

/** Job resolve_sender_name: Telethon-пошук імені по телефону поза HTTP-запитом (Фаза 5.2). */
export async function runResolveSenderNameJob(job: NotificationJobRow, deps: ResolveNameDeps): Promise<ResolveNameOutcome> {
  const payload = job.payload as Partial<ResolveSenderNamePayload>;
  const listingId = Number(payload?.listingId);
  const phone = String(payload?.phone ?? '').trim();
  if (!Number.isInteger(listingId) || !phone) throw new Error('resolve_sender_name: payload.listingId/phone missing');
  const listing = await deps.getListing(listingId);
  if (!listing) return 'not_found';
  if (listing.senderName?.trim()) return 'already_named';
  const name = (await deps.lookupName(phone))?.trim();
  if (!name) return 'no_name';
  await deps.setListingName(listingId, name);
  await deps.setPersonName(phone, name);
  return 'updated';
}

/** Воркер процесу: index.ts запускає після app.listen, зупиняє на SIGTERM. */
export function startListingMatchWorker(prisma: PrismaClient, opts: WorkerOptions = {}) {
  const deps = defaultListingMatchDeps(prisma);
  const nameDeps = defaultResolveNameDeps(prisma);
  const worker = createNotificationWorker(
    prisma,
    {
      [LISTING_MATCH_JOB]: (job) => runListingMatchJob(job, deps).then(() => undefined),
      [RESOLVE_SENDER_NAME_JOB]: (job) => runResolveSenderNameJob(job, nameDeps).then(() => undefined),
    },
    opts,
  );
  worker.start();
  return worker;
}
