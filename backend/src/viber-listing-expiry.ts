/**
 * Строк життя оголошення попутки: коли воно перестає показуватись на сайті.
 *
 * Правило: оголошення видно до `endsAt + LISTING_GRACE_MS` (кінець часу відправлення + 1 год).
 * `endsAt` — київський час стіни, переведений в UTC (departureTime вводять за Києвом, а процес
 * на Railway працює в TZ=UTC: раніше «14:30» ставало 14:30 UTC = 17:30 Київ, і оголошення жили
 * ще 2–3 год зверху).
 *
 * Публічні читання фільтрують за `notExpiredWhere()` самі, тож сайт не залежить від того, коли
 * востаннє пройшов прибиральник; `deactivateExpiredListings` лише переводить `isActive=false`
 * (для матчингу, сповіщень, адмінки) і запускається таймером у процесі, а не зовнішнім cron.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Скільки після кінця поїздки оголошення ще лишається на сайті. */
export const LISTING_GRACE_MS = 60 * 60 * 1000;

const KYIV_TZ = 'Europe/Kyiv';
const kyivParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: KYIV_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Зсув Києва відносно UTC (хв) у момент `utcMs`: +120 взимку, +180 влітку. */
function kyivOffsetMinutes(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of kyivParts.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Київський настінний час (рік, місяць 0-11, день, год, хв) → момент у UTC. */
export function kyivWallToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month, day, hour, minute);
  // Зсув залежить від самого моменту (літній/зимовий час) — уточнюємо за кілька ітерацій
  let utc = naive - kyivOffsetMinutes(naive) * 60000;
  utc = naive - kyivOffsetMinutes(utc) * 60000;
  return new Date(utc);
}

/**
 * «Дата по» оголошення: доба поїздки + кінець часу за Києвом.
 * `date` — північ доби поїздки в локальному часі процесу (див. trip-day.ts); "HH:MM-HH:MM" → кінець
 * інтервалу, "HH:MM" → цей час, інакше 23:59.
 */
export function getListingEndsAt(date: Date, departureTime: string | null): Date {
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return day; // як раніше: некоректна дата → Invalid Date, без виключення
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  const t = (departureTime ?? '').trim();
  const range = t.match(/^\d{1,2}:\d{2}-(\d{1,2}):(\d{2})$/);
  const single = t.match(/^(\d{1,2}):(\d{2})$/);
  const hit = range ?? single;
  if (hit) return kyivWallToUtc(y, m, d, Number(hit[1]), Number(hit[2]));
  return kyivWallToUtc(y, m, d, 23, 59);
}

/** Prisma-фрагмент: оголошення, що ще не пройшло «кінець + 1 год». Рядки без endsAt лишаємо. */
export function notExpiredWhere(now: Date = new Date()): Prisma.ViberListingWhereInput {
  return {
    OR: [{ endsAt: { gte: new Date(now.getTime() - LISTING_GRACE_MS) } }, { endsAt: null }],
  };
}

/** Те саме правило для одного рядка (напр. контакт по кліку). */
export function isListingExpired(endsAt: Date | null, now: Date = new Date()): boolean {
  return endsAt != null && endsAt.getTime() < now.getTime() - LISTING_GRACE_MS;
}

export interface ListingCleanupResult {
  deactivated: number;
  expiredRequests: number;
}

/** isActive=false для протермінованих оголошень + закриття прострочених запитів пасажир→водій. */
export async function deactivateExpiredListings(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ListingCleanupResult> {
  const cutoff = new Date(now.getTime() - LISTING_GRACE_MS);

  const byEndsAt = await prisma.viberListing.updateMany({
    where: { isActive: true, endsAt: { lt: cutoff } },
    data: { isActive: false },
  });

  // Рядки без endsAt (обхідний шлях запису) — у JS; їх одиниці
  const withoutEndsAt = await prisma.viberListing.findMany({
    where: { isActive: true, endsAt: null },
    select: { id: true, date: true, departureTime: true },
  });
  const legacyIds = withoutEndsAt
    .filter((l) => getListingEndsAt(l.date, l.departureTime) < cutoff)
    .map((l) => l.id);
  if (legacyIds.length > 0) {
    await prisma.viberListing.updateMany({ where: { id: { in: legacyIds } }, data: { isActive: false } });
  }

  const expiredRequests = await prisma.rideShareRequest.updateMany({
    where: { status: 'pending', expiresAt: { lt: now } },
    data: { status: 'expired' },
  });

  return { deactivated: byEndsAt.count + legacyIds.length, expiredRequests: expiredRequests.count };
}
