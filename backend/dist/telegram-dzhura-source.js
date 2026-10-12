"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPIC_BATCH_LIMIT = exports.COLD_START_HOURS = void 0;
exports.formatSenderLine = formatSenderLine;
exports.fetchGroupMessagesFromDzhura = fetchGroupMessagesFromDzhura;
exports.saveCursors = saveCursors;
exports.startTelegramImportScheduler = startTelegramImportScheduler;
const interval_job_1 = require("./interval-job");
/** Скільки годин історії брати для топіка без курсору (як COLD_START_HOURS у Python). */
exports.COLD_START_HOURS = 120;
/** Максимум повідомлень на топік за один прохід; решта — наступним тіком (курсор не губить). */
exports.TOPIC_BATCH_LIMIT = 200;
function formatSenderLine(sender, text) {
    const username = sender?.username?.trim().replace(/^@/, '') || null;
    const name = [sender?.firstName, sender?.lastName].filter((p) => p && p.trim()).join(' ').trim();
    const display = name || (username ? `@${username}` : 'Невідомий');
    const body = text.trim();
    return username ? `${display}|@${username}: ${body}` : `${display}: ${body}`;
}
async function fetchGroupMessagesFromDzhura(prisma, groups, opts = {}) {
    const now = opts.now ?? new Date();
    const coldStart = new Date(now.getTime() - exports.COLD_START_HOURS * 3600000);
    const states = await prisma.telegramFetchState.findMany();
    const cursorOf = (chat, topicId) => states.find((s) => (s.chat || 'PoDoroguem') === chat && s.topicId === topicId)?.lastMessageId ?? 0;
    const lines = [];
    const cursors = [];
    const missingGroups = [];
    const enabledGroups = [];
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
                take: exports.TOPIC_BATCH_LIMIT,
                include: { sender: { select: { firstName: true, lastName: true, username: true } } },
            });
            if (rows.length === 0)
                continue;
            let maxId = cursor;
            for (const row of rows) {
                const id = Number(row.tgMessageId);
                if (id > maxId)
                    maxId = id;
                if (!row.text.trim())
                    continue; // медіа без підпису
                lines.push(formatSenderLine(row.sender, row.text), '---');
            }
            if (maxId > cursor)
                cursors.push({ chat: g.chat, topicId, lastMessageId: maxId });
        }
    }
    return { text: lines.length ? lines.join('\n') + '\n' : '', cursors, missingGroups, enabledGroups };
}
async function saveCursors(prisma, cursors) {
    for (const c of cursors) {
        await prisma.telegramFetchState.upsert({
            where: { chat_topicId: { chat: c.chat, topicId: c.topicId } },
            create: { chat: c.chat, topicId: c.topicId, lastMessageId: c.lastMessageId },
            update: { lastMessageId: c.lastMessageId },
        });
    }
}
/** Внутрішній планувальник замість cron-job.org (`runImport` не кидає — повертає результат). */
function startTelegramImportScheduler(runImport, opts = {}) {
    const log = opts.log ?? ((m) => console.log(m));
    return (0, interval_job_1.startIntervalJob)('telegram-import', async () => {
        const r = await runImport();
        if (!r.success)
            log(`[telegram-import] помилка: ${r.error ?? 'unknown'}`);
    }, {
        intervalMin: opts.intervalMin ?? Number(process.env.TELEGRAM_IMPORT_INTERVAL_MIN ?? 10),
        firstDelayMs: opts.firstDelayMs,
        log,
        note: 'source: Джура',
    });
}
