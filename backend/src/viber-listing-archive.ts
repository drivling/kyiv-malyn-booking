/**
 * Архів оголошень: нові рядки → ViberRideEvent (аналітика), потім видаляємо неактивні старші за `days`.
 * Ідемпотентно (імпорт іде після найбільшого вже імпортованого id, skipDuplicates), тож безпечно
 * запускати щодоби: таймер у процесі (index.ts) замінив щомісячний cron-job.org, а
 * POST /viber-listings/archive-old лишився для ручного запуску.
 */
import type { PrismaClient } from '@prisma/client';
import { importListingsToRideEvents, type ImportResult } from './viber-analytics-import';

export const ARCHIVE_DEFAULT_DAYS = 90;
export const ARCHIVE_MIN_DAYS = 30;

export function normalizeArchiveDays(raw: unknown): number {
  const n = Number(raw ?? ARCHIVE_DEFAULT_DAYS);
  return Number.isFinite(n) ? Math.max(ARCHIVE_MIN_DAYS, Math.round(n)) : ARCHIVE_DEFAULT_DAYS;
}

export async function archiveOldListings(
  prisma: PrismaClient,
  days: number = ARCHIVE_DEFAULT_DAYS,
  now: Date = new Date(),
): Promise<ImportResult & { days: number; cutoff: Date; deleted: number }> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const imported = await importListingsToRideEvents(prisma);
  const deleted = await prisma.viberListing.deleteMany({ where: { isActive: false, date: { lt: cutoff } } });
  return { ...imported, days, cutoff, deleted: deleted.count };
}
