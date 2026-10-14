/**
 * Імпорт оголошень з Telegram-груп попуток через «Джуру».
 *
 * Раніше `POST /telegram/fetch-group-messages` (зовнішній cron-job.org) спавнив Python/Telethon
 * (`fetch_telegram_messages.py`) — друга Telethon-розмова з тією ж сесією. Тепер слухач Джури вже
 * пише ці групи в `DzhuraMessage`, тож тут ми лише читаємо базу: без spawn, без блокування сесії.
 * Курсор той самий — `TelegramFetchState` (chat, topicId) → останній оброблений tgMessageId.
 */
import type { PrismaClient } from '@prisma/client';
import { startIntervalJob, type IntervalJob } from './interval-job';

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

/** Одне повідомлення групи: рядок-протокол для парсера + звідки воно (провенанс оголошення). */
export interface DzhuraFetchItem {
  chat: string;
  /** 0 — плоска група без топіків */
  topicId: number;
  messageId: number;
  /** "Ім'я|@user: текст" */
  line: string;
  /** Числовий Telegram-id автора (зв'язок з автором без username і номера) */
  senderTgId: string | null;
}

export interface DzhuraFetchResult {
  /** Текст у форматі parseTelegramMessages: "Ім'я|@user: текст\n---\n" */
  text: string;
  /** Те саме по одному повідомленню — з групою, топіком і id (для провенансу) */
  items: DzhuraFetchItem[];
  /** Курсори, які слід зберегти ПІСЛЯ імпорту */
  cursors: DzhuraCursorUpdate[];
  /** Групи, яких Джура не бачить (немає діалогу в DzhuraChat) */
  missingGroups: string[];
  /** Групи, для яких довелося увімкнути «Читати» */
  enabledGroups: string[];
}

/** Ім'я для рядка-протоколу: без переносів і "|" (роздільник з @username), не довше 60 символів. */
function sanitizeDisplayName(raw: string): string {
  return raw.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

export function formatSenderLine(
  sender: { firstName: string | null; lastName: string | null; username: string | null } | null,
  text: string,
): string {
  const username = sender?.username?.trim().replace(/^@/, '') || null;
  const name = sanitizeDisplayName([sender?.firstName, sender?.lastName].filter((p) => p && p.trim()).join(' '));
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
  const items: DzhuraFetchItem[] = [];
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
        include: { sender: { select: { firstName: true, lastName: true, username: true, tgUserId: true } } },
      });
      if (rows.length === 0) continue;

      let maxId = cursor;
      for (const row of rows) {
        const id = Number(row.tgMessageId);
        if (id > maxId) maxId = id;
        if (!row.text.trim()) continue; // медіа без підпису
        const line = formatSenderLine(row.sender, row.text);
        lines.push(line, '---');
        items.push({ chat: g.chat, topicId, messageId: id, line, senderTgId: row.sender ? String(row.sender.tgUserId) : null });
      }
      if (maxId > cursor) cursors.push({ chat: g.chat, topicId, lastMessageId: maxId });
    }
  }

  return { text: lines.length ? lines.join('\n') + '\n' : '', items, cursors, missingGroups, enabledGroups };
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

export type TelegramImportScheduler = IntervalJob;

/** Внутрішній планувальник замість cron-job.org (`runImport` не кидає — повертає результат). */
export function startTelegramImportScheduler(
  runImport: () => Promise<{ success: boolean; created: number; total: number; error?: string }>,
  opts: { intervalMin?: number; firstDelayMs?: number; log?: (m: string) => void } = {},
): TelegramImportScheduler | null {
  const log = opts.log ?? ((m: string) => console.log(m));
  return startIntervalJob(
    'telegram-import',
    async () => {
      const r = await runImport();
      if (!r.success) log(`[telegram-import] помилка: ${r.error ?? 'unknown'}`);
    },
    {
      intervalMin: opts.intervalMin ?? Number(process.env.TELEGRAM_IMPORT_INTERVAL_MIN ?? 10),
      firstDelayMs: opts.firstDelayMs,
      log,
      note: 'source: Джура',
    },
  );
}
