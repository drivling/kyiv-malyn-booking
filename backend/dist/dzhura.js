"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DZHURA_SEARCH_MAX_LEN = exports.DZHURA_MESSAGES_PAGE_MAX = exports.DZHURA_MESSAGES_PAGE = exports.DZHURA_QUEUE_RETRY_WINDOW_MS = exports.bigintReplacer = exports.DzhuraHttpError = exports.DZHURA_GROUP_KINDS = exports.DZHURA_KYIV_TZ = exports.DZHURA_MAX_BACKFILL_DAYS = exports.DZHURA_HEARTBEAT_FRESH_MS = exports.DZHURA_EXPORT_LIMIT = void 0;
exports.parseIsoDate = parseIsoDate;
exports.addDaysIso = addDaysIso;
exports.daysBetweenInclusive = daysBetweenInclusive;
exports.kyivMidnightUtc = kyivMidnightUtc;
exports.kyivDayRangeUtc = kyivDayRangeUtc;
exports.validateDateRange = validateDateRange;
exports.exportFileName = exportFileName;
exports.serializeChat = serializeChat;
exports.parseKindsFilter = parseKindsFilter;
exports.listChats = listChats;
exports.getQueueStats = getQueueStats;
exports.retryFailedSaved = retryFailedSaved;
exports.getStatus = getStatus;
exports.parseMessagesQuery = parseMessagesQuery;
exports.buildMessagesWhere = buildMessagesWhere;
exports.listMessages = listMessages;
exports.parseChatPatch = parseChatPatch;
exports.updateChatFlags = updateChatFlags;
exports.serializeJob = serializeJob;
exports.parseJobRequest = parseJobRequest;
exports.createJob = createJob;
exports.listJobs = listJobs;
exports.getJob = getJob;
exports.personDisplayName = personDisplayName;
exports.buildChatExport = buildChatExport;
exports.DZHURA_EXPORT_LIMIT = 50000;
exports.DZHURA_HEARTBEAT_FRESH_MS = 60000;
exports.DZHURA_MAX_BACKFILL_DAYS = 366;
exports.DZHURA_KYIV_TZ = 'Europe/Kyiv';
exports.DZHURA_GROUP_KINDS = ['group', 'supergroup'];
class DzhuraHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'DzhuraHttpError';
    }
}
exports.DzhuraHttpError = DzhuraHttpError;
/** BigInt → string для res.json / JSON.stringify */
const bigintReplacer = (_key, value) => typeof value === 'bigint' ? value.toString() : value;
exports.bigintReplacer = bigintReplacer;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 'YYYY-MM-DD' → те саме або null, якщо не дата календаря */
function parseIsoDate(raw) {
    if (typeof raw !== 'string')
        return null;
    const m = ISO_DATE_RE.exec(raw.trim());
    if (!m)
        return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d)
        return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}
function addDaysIso(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
}
function daysBetweenInclusive(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}
function kyivOffsetMinutes(at) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: exports.DZHURA_KYIV_TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - at.getTime()) / 60000);
}
/** Північ Києва для календарної дати → UTC-момент (враховує літній/зимовий час) */
function kyivMidnightUtc(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
    let offset = kyivOffsetMinutes(new Date(naive));
    let guess = naive - offset * 60000;
    offset = kyivOffsetMinutes(new Date(guess));
    guess = naive - offset * 60000;
    return new Date(guess);
}
/** Доби Києва [from 00:00, to+1 00:00) */
function kyivDayRangeUtc(from, to) {
    return { start: kyivMidnightUtc(from), endExclusive: kyivMidnightUtc(addDaysIso(to, 1)) };
}
/** Перевірити діапазон дат із query/body; кидає DzhuraHttpError(400) */
function validateDateRange(fromRaw, toRaw) {
    const from = parseIsoDate(fromRaw);
    const to = parseIsoDate(toRaw);
    if (!from || !to)
        throw new DzhuraHttpError(400, 'Потрібні дати from і to у форматі YYYY-MM-DD');
    if (to < from)
        throw new DzhuraHttpError(400, 'Дата «до» раніша за дату «від»');
    if (daysBetweenInclusive(from, to) > exports.DZHURA_MAX_BACKFILL_DAYS) {
        throw new DzhuraHttpError(400, `Період не більше ${exports.DZHURA_MAX_BACKFILL_DAYS} днів`);
    }
    return { from, to };
}
/** dzhura-<ascii-slug|chat-id>-<from>_<to>.json (лише ASCII — заголовок Content-Disposition) */
function exportFileName(chat, from, to) {
    const slug = (chat.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return `dzhura-${slug || `chat-${chat.id}`}-${from}_${to}.json`;
}
function serializeChat(row) {
    return {
        id: row.id,
        tgChatId: row.tgChatId.toString(),
        kind: row.kind,
        title: row.title,
        username: row.username,
        membersCount: row.membersCount,
        isLunchGroup: row.isLunchGroup,
        captureEnabled: row.captureEnabled,
        relayToSaved: row.relayToSaved,
        lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
        lastCapturedAt: row.lastCapturedAt ? row.lastCapturedAt.toISOString() : null,
        dialogSyncedAt: row.dialogSyncedAt ? row.dialogSyncedAt.toISOString() : null,
        messagesCount: row._count.messages,
    };
}
/** ?kind=group,supergroup (default) | all | private … */
function parseKindsFilter(raw) {
    if (typeof raw !== 'string' || !raw.trim())
        return [...exports.DZHURA_GROUP_KINDS];
    if (raw.trim() === 'all')
        return null;
    const kinds = raw
        .split(',')
        .map((k) => k.trim())
        .filter((k) => ['group', 'supergroup', 'private', 'channel'].includes(k));
    return kinds.length ? kinds : [...exports.DZHURA_GROUP_KINDS];
}
async function listChats(prisma, kinds) {
    const rows = await prisma.dzhuraChat.findMany({
        where: kinds ? { kind: { in: kinds } } : {},
        orderBy: [{ captureEnabled: 'desc' }, { lastMessageAt: 'desc' }, { title: 'asc' }],
        include: { _count: { select: { messages: true } } },
    });
    return rows.map(serializeChat);
}
exports.DZHURA_QUEUE_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
async function getQueueStats(prisma, now = new Date()) {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [pending, retrying, failed24h] = await Promise.all([
        prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'pending' } }),
        prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'pending', nextAttemptAt: { gt: now } } }),
        prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'failed', createdAt: { gte: dayAgo } } }),
    ]);
    return { pending, retrying, failed24h };
}
/** Повернути невдалі дублі за останній тиждень у чергу (attempts=0, одразу) */
async function retryFailedSaved(prisma, now = new Date()) {
    const res = await prisma.lunchOutboundMessage.updateMany({
        where: { target: 'saved', status: 'failed', createdAt: { gte: new Date(now.getTime() - exports.DZHURA_QUEUE_RETRY_WINDOW_MS) } },
        data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorText: null },
    });
    return res.count;
}
async function getStatus(prisma, listenerWanted, now = new Date()) {
    const [state, queue] = await Promise.all([
        prisma.dzhuraState.findUnique({ where: { id: 1 } }),
        getQueueStats(prisma, now),
    ]);
    const heartbeatAt = state?.heartbeatAt ?? null;
    return {
        listenerWanted,
        heartbeatAt: heartbeatAt ? heartbeatAt.toISOString() : null,
        heartbeatFresh: Boolean(heartbeatAt && now.getTime() - heartbeatAt.getTime() < exports.DZHURA_HEARTBEAT_FRESH_MS),
        dialogsSyncedAt: state?.dialogsSyncedAt ? state.dialogsSyncedAt.toISOString() : null,
        meTgUserId: state?.meTgUserId != null ? state.meTgUserId.toString() : null,
        queue,
    };
}
// ---------- messages (перегляд в адмінці) ----------
exports.DZHURA_MESSAGES_PAGE = 50;
exports.DZHURA_MESSAGES_PAGE_MAX = 200;
exports.DZHURA_SEARCH_MAX_LEN = 200;
/** ?from&to (обидві або жодної), ?q (пошук по тексту/автору), ?beforeId (курсор), ?limit */
function parseMessagesQuery(query) {
    const hasFrom = typeof query.from === 'string' && query.from.trim() !== '';
    const hasTo = typeof query.to === 'string' && query.to.trim() !== '';
    let from = null;
    let to = null;
    if (hasFrom || hasTo) {
        if (!hasFrom || !hasTo)
            throw new DzhuraHttpError(400, 'Потрібні обидві дати from і to або жодної');
        const range = validateDateRange(query.from, query.to);
        from = range.from;
        to = range.to;
    }
    const qRaw = typeof query.q === 'string' ? query.q.trim() : '';
    if (qRaw.length > exports.DZHURA_SEARCH_MAX_LEN)
        throw new DzhuraHttpError(400, `Пошуковий запит довший за ${exports.DZHURA_SEARCH_MAX_LEN} символів`);
    let beforeId = null;
    if (query.beforeId !== undefined && query.beforeId !== '') {
        const n = Number(query.beforeId);
        if (!Number.isInteger(n) || n <= 0)
            throw new DzhuraHttpError(400, 'Некоректний beforeId');
        beforeId = n;
    }
    const limitRaw = Number(query.limit ?? exports.DZHURA_MESSAGES_PAGE);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, exports.DZHURA_MESSAGES_PAGE_MAX) : exports.DZHURA_MESSAGES_PAGE;
    return { from, to, q: qRaw, beforeId, limit };
}
function buildMessagesWhere(chatId, mq) {
    const where = { chatId };
    if (mq.from && mq.to) {
        const { start, endExclusive } = kyivDayRangeUtc(mq.from, mq.to);
        where.sentAt = { gte: start, lt: endExclusive };
    }
    if (mq.beforeId)
        where.id = { lt: mq.beforeId };
    if (mq.q) {
        const contains = { contains: mq.q, mode: 'insensitive' };
        where.OR = [
            { text: contains },
            { sender: { is: { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }] } } },
        ];
    }
    return where;
}
async function listMessages(prisma, chatId, mq) {
    const chat = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
    if (!chat)
        throw new DzhuraHttpError(404, 'Чат не знайдено');
    const rows = await prisma.dzhuraMessage.findMany({
        where: buildMessagesWhere(chatId, mq),
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: mq.limit + 1,
        include: { sender: true, reactions: { where: { removedAt: null }, include: { person: true }, orderBy: { id: 'asc' } } },
    });
    const hasMore = rows.length > mq.limit;
    const page = hasMore ? rows.slice(0, mq.limit) : rows;
    const messages = page.map((m) => ({
        id: m.id,
        tgMessageId: m.tgMessageId.toString(),
        sentAt: m.sentAt.toISOString(),
        sender: m.sender
            ? { tgUserId: m.sender.tgUserId.toString(), name: personDisplayName(m.sender), username: m.sender.username }
            : null,
        isOutgoing: m.isOutgoing,
        text: m.text,
        mediaKind: m.mediaKind,
        replyToTgMessageId: m.replyToTgMessageId != null ? m.replyToTgMessageId.toString() : null,
        editedAt: m.editedAt ? m.editedAt.toISOString() : null,
        deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
        source: m.source,
        reactions: m.reactions.map((r) => ({
            emoji: r.emoji,
            by: r.person ? personDisplayName(r.person) : null,
            isMine: r.isMine,
        })),
        reactionsCounts: asCounts(m.reactionsJson),
    }));
    return { messages, nextBeforeId: hasMore ? page[page.length - 1].id : null };
}
function asCounts(v) {
    const rec = asRecord(v);
    if (!rec)
        return null;
    const out = {};
    for (const [k, n] of Object.entries(rec)) {
        if (typeof n === 'number' && n > 0)
            out[k] = n;
    }
    return Object.keys(out).length ? out : null;
}
function parseChatPatch(body) {
    const b = (body ?? {});
    const patch = {};
    if ('captureEnabled' in b) {
        if (typeof b.captureEnabled !== 'boolean')
            throw new DzhuraHttpError(400, 'captureEnabled має бути boolean');
        patch.captureEnabled = b.captureEnabled;
    }
    if ('relayToSaved' in b) {
        if (typeof b.relayToSaved !== 'boolean')
            throw new DzhuraHttpError(400, 'relayToSaved має бути boolean');
        patch.relayToSaved = b.relayToSaved;
    }
    if (!('captureEnabled' in patch) && !('relayToSaved' in patch)) {
        throw new DzhuraHttpError(400, 'Нема що змінювати');
    }
    return patch;
}
async function updateChatFlags(prisma, chatId, patch) {
    const existing = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
    if (!existing)
        throw new DzhuraHttpError(404, 'Чат не знайдено');
    if (existing.isLunchGroup && patch.captureEnabled === false) {
        throw new DzhuraHttpError(400, 'Групу обідів читаємо завжди — вимкнути не можна');
    }
    const data = {};
    if (patch.captureEnabled !== undefined)
        data.captureEnabled = patch.captureEnabled;
    if (patch.relayToSaved !== undefined)
        data.relayToSaved = patch.relayToSaved;
    // Без читання нема куди дублювати.
    const nextCapture = patch.captureEnabled ?? existing.captureEnabled;
    if (!nextCapture)
        data.relayToSaved = false;
    const row = await prisma.dzhuraChat.update({
        where: { id: chatId },
        data,
        include: { _count: { select: { messages: true } } },
    });
    return serializeChat(row);
}
function asRecord(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function serializeJob(row) {
    return {
        id: row.id,
        type: row.type,
        status: row.status,
        params: asRecord(row.paramsJson),
        progress: asRecord(row.progressJson),
        result: asRecord(row.resultJson),
        errorText: row.errorText,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
}
function parseJobRequest(body) {
    const b = (body ?? {});
    if (b.type === 'sync_dialogs')
        return { type: 'sync_dialogs' };
    if (b.type === 'backfill') {
        const chatId = Number(b.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0)
            throw new DzhuraHttpError(400, 'Потрібен chatId');
        const { from, to } = validateDateRange(b.from, b.to);
        return { type: 'backfill', chatId, from, to };
    }
    throw new DzhuraHttpError(400, 'Невідомий тип задачі');
}
async function createJob(prisma, req) {
    if (req.type === 'backfill') {
        const chat = await prisma.dzhuraChat.findUnique({ where: { id: req.chatId } });
        if (!chat)
            throw new DzhuraHttpError(404, 'Чат не знайдено');
    }
    const params = req.type === 'backfill' ? { chatId: req.chatId, from: req.from, to: req.to } : undefined;
    const active = await prisma.dzhuraJob.findFirst({
        where: { type: req.type, status: { in: ['pending', 'running'] } },
        orderBy: { createdAt: 'desc' },
    });
    if (active) {
        const sameParams = req.type === 'sync_dialogs' ||
            JSON.stringify(asRecord(active.paramsJson) ?? {}) === JSON.stringify(params ?? {});
        if (sameParams) {
            throw new DzhuraHttpError(409, `Така задача вже виконується (№${active.id})`);
        }
    }
    const row = await prisma.dzhuraJob.create({
        data: { type: req.type, status: 'pending', ...(params !== undefined ? { paramsJson: params } : {}) },
    });
    return serializeJob(row);
}
async function listJobs(prisma, limit) {
    const rows = await prisma.dzhuraJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(serializeJob);
}
async function getJob(prisma, id) {
    const row = await prisma.dzhuraJob.findUnique({ where: { id } });
    if (!row)
        throw new DzhuraHttpError(404, 'Задачу не знайдено');
    return serializeJob(row);
}
function personDisplayName(p) {
    const full = [p.firstName, p.lastName].filter((s) => s && s.trim()).join(' ').trim();
    if (full)
        return full;
    if (p.username)
        return `@${p.username}`;
    return p.tgUserId.toString();
}
async function buildChatExport(prisma, chatId, from, to, now = new Date()) {
    const chat = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
    if (!chat)
        throw new DzhuraHttpError(404, 'Чат не знайдено');
    const { start, endExclusive } = kyivDayRangeUtc(from, to);
    const rows = await prisma.dzhuraMessage.findMany({
        where: { chatId, sentAt: { gte: start, lt: endExclusive } },
        orderBy: [{ sentAt: 'asc' }, { tgMessageId: 'asc' }],
        take: exports.DZHURA_EXPORT_LIMIT + 1,
        include: { sender: true, reactions: { include: { person: true }, orderBy: { id: 'asc' } } },
    });
    if (rows.length > exports.DZHURA_EXPORT_LIMIT) {
        throw new DzhuraHttpError(413, `Понад ${exports.DZHURA_EXPORT_LIMIT} повідомлень — звузьте період`);
    }
    const persons = new Map();
    const addPerson = (p) => {
        if (!p)
            return;
        const key = p.tgUserId.toString();
        if (!persons.has(key)) {
            persons.set(key, {
                tgUserId: key,
                firstName: p.firstName,
                lastName: p.lastName,
                username: p.username,
                phone: p.phone,
                isMe: p.isMe,
            });
        }
    };
    const messages = rows.map((m) => {
        addPerson(m.sender);
        for (const r of m.reactions)
            addPerson(r.person);
        return {
            tgMessageId: m.tgMessageId.toString(),
            sentAt: m.sentAt.toISOString(),
            sender: m.sender
                ? {
                    tgUserId: m.sender.tgUserId.toString(),
                    name: personDisplayName(m.sender),
                    username: m.sender.username,
                    phone: m.sender.phone,
                }
                : null,
            isOutgoing: m.isOutgoing,
            text: m.text,
            mediaKind: m.mediaKind,
            replyToTgMessageId: m.replyToTgMessageId != null ? m.replyToTgMessageId.toString() : null,
            topicId: m.topicId,
            forward: m.forwardFromName || m.forwardFromTgId != null || m.forwardDate
                ? {
                    name: m.forwardFromName,
                    tgId: m.forwardFromTgId != null ? m.forwardFromTgId.toString() : null,
                    date: m.forwardDate ? m.forwardDate.toISOString() : null,
                }
                : null,
            editedAt: m.editedAt ? m.editedAt.toISOString() : null,
            editHistory: m.editHistoryJson ?? null,
            reactionsCounts: m.reactionsJson ?? null,
            deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
            source: m.source,
            reactions: m.reactions.map((r) => ({
                emoji: r.emoji,
                by: r.person ? { tgUserId: r.person.tgUserId.toString(), name: personDisplayName(r.person) } : null,
                isMine: r.isMine,
                addedAt: r.addedAt.toISOString(),
                removedAt: r.removedAt ? r.removedAt.toISOString() : null,
            })),
        };
    });
    return {
        project: 'dzhura',
        version: 1,
        exportedAt: now.toISOString(),
        chat: {
            id: chat.id,
            tgChatId: chat.tgChatId.toString(),
            kind: chat.kind,
            title: chat.title,
            username: chat.username,
        },
        range: { from, to, timezone: exports.DZHURA_KYIV_TZ },
        persons: [...persons.values()],
        messages,
    };
}
