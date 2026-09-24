/**
 * Черга фонових сповіщень у БД (таблиця NotificationJob) + воркер у процесі.
 *
 * Навіщо: розсилка перетинів (Telegram → Telethon → SMS, 1.5 с на пару) жила в пам'яті
 * процесу після HTTP-відповіді — рестарт деплою її губив, помилка зупиняла fan-out, а
 * масовий імпорт запускав десятки паралельних ланцюжків. Тепер ingest лише кладе job,
 * воркер забирає по одному, повторює з бекофом і фіксує помилку.
 * Docs/poputky-search-performance-plan.md, Фаза 4.3.
 *
 * Модуль не знає про Telegram: обробники реєструють ззовні (listing-match-jobs.ts).
 */

export type NotificationJobRow = {
  id: number;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  runAfter: Date;
  lockedAt: Date | null;
};

export type JobHandler = (job: NotificationJobRow) => Promise<void>;

export type QueuePrisma = {
  notificationJob?: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<NotificationJobRow | null>;
    updateMany: (args: any) => Promise<{ count: number }>;
    update: (args: any) => Promise<any>;
  };
};

export const LISTING_MATCH_JOB = 'listing_match';

export type ListingMatchPayload = { listingId: number; authorChatId: string | null };

/**
 * Поставити в чергу пошук перетинів для оголошення. `authorChatId` — якщо автор щойно
 * писав боту (щоб він одразу отримав список збігів); інакше воркер знайде chatId по телефону.
 * Стаби без notificationJob (юніт-тести) — попередження й нічого.
 */
export async function enqueueListingMatch(
  prisma: QueuePrisma,
  listingId: number,
  authorChatId?: string | null,
): Promise<{ id: number } | null> {
  if (!prisma.notificationJob?.create) {
    console.warn(`[notification-queue] notificationJob model missing — job for listing #${listingId} skipped`);
    return null;
  }
  const payload: ListingMatchPayload = { listingId, authorChatId: authorChatId ?? null };
  return prisma.notificationJob.create({ data: { kind: LISTING_MATCH_JOB, payload } });
}

export type WorkerOptions = {
  /** Пауза між тиками, мс (за замовчуванням 10 с) */
  intervalMs?: number;
  /** Скільки job-ів за тик */
  batchSize?: number;
  /** Після скількох спроб — failed */
  maxAttempts?: number;
  /** «Завислий» running старіший за це — забираємо знову (краш процесу посеред job) */
  staleMs?: number;
  now?: () => Date;
  log?: (msg: string) => void;
};

/** Бекоф між спробами: 1, 2, 4, 8… хв. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

export function createNotificationWorker(
  prisma: QueuePrisma,
  handlers: Record<string, JobHandler>,
  opts: WorkerOptions = {},
) {
  const intervalMs = opts.intervalMs ?? 10_000;
  const batchSize = opts.batchSize ?? 10;
  const maxAttempts = opts.maxAttempts ?? 5;
  const staleMs = opts.staleMs ?? 15 * 60_000;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.log(m));
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function claimNext(): Promise<NotificationJobRow | null> {
    const q = prisma.notificationJob;
    if (!q) return null;
    const t = now();
    const job = await q.findFirst({
      where: {
        OR: [
          { status: 'pending', runAfter: { lte: t } },
          { status: 'running', lockedAt: { lt: new Date(t.getTime() - staleMs) } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    if (!job) return null;
    // Оптимістичний захват: рядок міг забрати інший тик/інстанс
    const claimed = await q.updateMany({
      where: { id: job.id, status: job.status, attempts: job.attempts },
      data: { status: 'running', lockedAt: t, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return { ...job, status: 'running', attempts: job.attempts + 1, lockedAt: t };
  }

  async function runOne(job: NotificationJobRow): Promise<void> {
    const q = prisma.notificationJob!;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`no handler for kind "${job.kind}"`);
      await handler(job);
      await q.update({ where: { id: job.id }, data: { status: 'done', lockedAt: null, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const exhausted = job.attempts >= maxAttempts;
      await q.update({
        where: { id: job.id },
        data: exhausted
          ? { status: 'failed', lockedAt: null, lastError: message }
          : {
              status: 'pending',
              lockedAt: null,
              lastError: message,
              runAfter: new Date(now().getTime() + retryDelayMs(job.attempts)),
            },
      });
      log(`[notification-queue] job #${job.id} ${job.kind} attempt ${job.attempts} failed: ${message}${exhausted ? ' — giving up' : ''}`);
    }
  }

  /** Обробити до batchSize job-ів; повертає кількість виконаних (для тестів і ручного виклику). */
  async function tick(): Promise<number> {
    if (running) return 0;
    running = true;
    let done = 0;
    try {
      for (let i = 0; i < batchSize; i++) {
        const job = await claimNext();
        if (!job) break;
        await runOne(job);
        done++;
      }
    } catch (e) {
      log(`[notification-queue] tick error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
    return done;
  }

  return {
    tick,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      setTimeout(() => void tick(), 1_000).unref();
      log(`[notification-queue] worker started (every ${Math.round(intervalMs / 1000)} s)`);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
