/**
 * Імпорт оголошень з Telegram-груп попуток через «Джуру».
 *
 * Раніше `POST /telegram/fetch-group-messages` (зовнішній cron-job.org) спавнив Python/Telethon
 * (`fetch_telegram_messages.py`) — друга Telethon-розмова з тією ж сесією. Тепер слухач Джури вже
 * пише ці групи в `DzhuraMessage`, тож тут ми лише читаємо базу: без spawn, без блокування сесії.
 * Курсор той самий — `TelegramFetchState` (chat, topicId) → останній оброблений tgMessageId.
 */
import type { PrismaClient } from '@prisma/client';

export interface TelegramSourceGroup {
  /** username групи без @ (PoDoroguem) */
  chat: string;
  /** topicId форуму; 0 = плоска група без топіків */
  topicIds: number[];
}

/** Скільки годин історії брати для топіка без курсору (як COLD_START_HOURS у Python). */
export const COLD_START_HOURS = 120;
/** Максимум повідомлень на топік за один прохід; решта — наступним тіком (курсор не губить). */
export const TOPIC_BATCH_LIMIT = 200;

export interface DzhuraCursorUpdate {
  chat: string;
  topicId: number;
  lastMessageId: number;
}

export interface DzhuraFetchResult {
  /** Текст у форматі parseTelegramMessages: "Ім'я|@user: текст\n---\n" */
  text: string;
  /** Курсори, які слід зберегти ПІСЛЯ імпорту */
  cursors: DzhuraCursorUpdate[];
  /** Групи, яких Джура не бачить (немає діалогу в DzhuraChat) */
  missingGroups: string[];
  /** Групи, для яких довелося увімкнути «Читати» */
  enabledGroups: string[];
}

export function formatSenderLine(
  sender: { firstName: string | null; lastName: string | null; username: string | null } | null,
  text: string,
): string {
  const username = sender?.username?.trim().replace(/^@/, '') || null;
  const name = [sender?.firstName, sender?.lastName].filter((p) => p && p.trim()).join(' ').trim();
  const display = name || (username ? `@${username}` : 'Невідомий');
  const body = text.trim();
  return username ? `${display}|@${username}: ${body}` : `${display}: ${body}`;
}

export async function fetchGroupMessagesFromDzhura(
  prisma: PrismaClient,
  groups: TelegramSourceGroup[],
  opts: { now?: Date } = {},
): Promise<DzhuraFetchResult> {
  const now = opts.now ?? new Date();
  const coldStart = new Date(now.getTime() - COLD_START_HOURS * 3_600_000);

  const states = await prisma.telegramFetchState.findMany();
  const cursorOf = (chat: string, topicId: number): number =>
    states.find((s) => (s.chat || 'PoDoroguem') === chat && s.topicId === topicId)?.lastMessageId ?? 0;

  const lines: string[] = [];
  const cursors: DzhuraCursorUpdate[] = [];
  const missingGroups: string[] = [];
  const enabledGroups: string[] = [];

  for (const g of groups) {
    const chatRow = await prisma.dzhuraChat.findFirst({
      where: { username: { equals: g.chat, mode: 'insensitive' } },
      select: { id: true, captureEnabled: true },
    });
    if (!chatRow) {
      missingGroups.push(g.chat);
      continue;
    }
    if (!chatRow.captureEnabled) {
      // Без «Читати» слухач нічого не збирає — вмикаємо; історія до цього моменту → backfill в адмінці
      await prisma.dzhuraChat.update({ where: { id: chatRow.id }, data: { captureEnabled: true } });
      enabledGroups.push(g.chat);
      continue;
    }

    for (const topicId of g.topicIds) {
      const cursor = cursorOf(g.chat, topicId);
      const rows = await prisma.dzhuraMessage.findMany({
        where: {
          chatId: chatRow.id,
          deletedAt: null,
          ...(topicId ? { topicId } : {}),
          tgMessageId: { gt: BigInt(cursor) },
          ...(cursor === 0 ? { sentAt: { gte: coldStart } } : {}),
        },
        orderBy: { tgMessageId: 'asc' },
        take: TOPIC_BATCH_LIMIT,
        include: { sender: { select: { firstName: true, lastName: true, username: true } } },
      });
      if (rows.length === 0) continue;

      let maxId = cursor;
      for (const row of rows) {
        const id = Number(row.tgMessageId);
        if (id > maxId) maxId = id;
        if (!row.text.trim()) continue; // медіа без підпису
        lines.push(formatSenderLine(row.sender, row.text), '---');
      }
      if (maxId > cursor) cursors.push({ chat: g.chat, topicId, lastMessageId: maxId });
    }
  }

  return { text: lines.length ? lines.join('\n') + '\n' : '', cursors, missingGroups, enabledGroups };
}

export async function saveCursors(prisma: PrismaClient, cursors: DzhuraCursorUpdate[]): Promise<void> {
  for (const c of cursors) {
    await prisma.telegramFetchState.upsert({
      where: { chat_topicId: { chat: c.chat, topicId: c.topicId } },
      create: { chat: c.chat, topicId: c.topicId, lastMessageId: c.lastMessageId },
      update: { lastMessageId: c.lastMessageId },
    });
  }
}

export interface TelegramImportScheduler {
  stop(): void;
}

/**
 * Внутрішній планувальник замість cron-job.org. `runImport` не кидає (повертає результат);
 * наступний тік не стартує, поки попередній не завершився.
 */
export function startTelegramImportScheduler(
  runImport: () => Promise<{ success: boolean; created: number; total: number; error?: string }>,
  opts: { intervalMin?: number; firstDelayMs?: number; log?: (m: string) => void } = {},
): TelegramImportScheduler | null {
  const intervalMin = opts.intervalMin ?? Number(process.env.TELEGRAM_IMPORT_INTERVAL_MIN ?? 10);
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return null; // 0 = вимкнено (лише ручний POST)
  const log = opts.log ?? ((m: string) => console.log(m));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await runImport();
      if (!r.success) log(`[telegram-import] помилка: ${r.error ?? 'unknown'}`);
    } catch (e) {
      log(`[telegram-import] tick error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMin * 60_000);
  timer.unref();
  const first = setTimeout(() => void tick(), opts.firstDelayMs ?? 60_000);
  first.unref();
  log(`[telegram-import] scheduler started (every ${intervalMin} min, source: Джура)`);
  return {
    stop(): void {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
