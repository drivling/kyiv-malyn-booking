"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DZHURA_SEARCH_MAX_LEN = exports.DZHURA_MESSAGES_PAGE_MAX = exports.DZHURA_MESSAGES_PAGE = exports.DZHURA_QUEUE_RETRY_WINDOW_MS = exports.bigintReplacer = exports.DzhuraHttpError = exports.DZHURA_AUTOREPLY_NOTE_MAX_LEN = exports.DZHURA_AUTOREPLY_DELAY_MAX_SEC = exports.DZHURA_AUTOREPLY_DELAY_MIN_SEC = exports.DZHURA_AUTOREPLY_DELAY_DEFAULT_SEC = exports.DZHURA_IMPORT_MAX_MEDIA = exports.DZHURA_IMPORT_MAX_TEXT = exports.DZHURA_POST_MAX_CAPTION = exports.DZHURA_POST_MAX_TEXT = exports.DZHURA_POST_MAX_PHOTO_BYTES = exports.DZHURA_POST_MAX_ITEMS = exports.DZHURA_GROUP_KINDS = exports.DZHURA_KYIV_TZ = exports.DZHURA_MAX_BACKFILL_DAYS = exports.DZHURA_HEARTBEAT_FRESH_MS = exports.DZHURA_EXPORT_LIMIT = void 0;
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
exports.isAutoReplyAvailable = isAutoReplyAvailable;
exports.getQueueStats = getQueueStats;
exports.retryFailedSaved = retryFailedSaved;
exports.getStatus = getStatus;
exports.parseMessagesQuery = parseMessagesQuery;
exports.buildMessagesWhere = buildMessagesWhere;
exports.listMessages = listMessages;
exports.parseChatPatch = parseChatPatch;
exports.updateChatFlags = updateChatFlags;
exports.compactJobParams = compactJobParams;
exports.serializeJob = serializeJob;
exports.parseImportRequest = parseImportRequest;
exports.parsePostItems = parsePostItems;
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
/** Відновлення історії (`post_items`): пости в одній задачі, розмір картинки, довжини тексту й підпису Telegram */
exports.DZHURA_POST_MAX_ITEMS = 10;
exports.DZHURA_POST_MAX_PHOTO_BYTES = 1000000;
exports.DZHURA_POST_MAX_TEXT = 4096;
exports.DZHURA_POST_MAX_CAPTION = 1024;
/** Вбудований імпорт історії (`import_history`): розмір файлу чату і картинок до нього */
exports.DZHURA_IMPORT_MAX_TEXT = 1500000;
exports.DZHURA_IMPORT_MAX_MEDIA = 20;
/** Автовідповідь: затримка в секундах (за замовчуванням 80) і довжина підказки на чат */
exports.DZHURA_AUTOREPLY_DELAY_DEFAULT_SEC = 80;
exports.DZHURA_AUTOREPLY_DELAY_MIN_SEC = 5;
exports.DZHURA_AUTOREPLY_DELAY_MAX_SEC = 3600;
exports.DZHURA_AUTOREPLY_NOTE_MAX_LEN = 2000;
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
        autoReplyEnabled: row.autoReplyEnabled,
        autoReplyDelaySec: row.autoReplyDelaySec,
        autoReplyNote: row.autoReplyNote,
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
/** Слухач отримує env бекенда, тож ключ тут = ключ там; DZHURA_AUTOREPLY_ENABLED=0 вимикає все. */
function isAutoReplyAvailable(env = process.env) {
    const off = ['0', 'false', 'no', 'off'].includes((env.DZHURA_AUTOREPLY_ENABLED ?? '1').trim().toLowerCase());
    return !off && Boolean((env.ANTHROPIC_API_KEY ?? '').trim());
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
        autoReplyAvailable: isAutoReplyAvailable(),
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
        isAutoReply: m.isAutoReply,
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
    if ('autoReplyEnabled' in b) {
        if (typeof b.autoReplyEnabled !== 'boolean')
            throw new DzhuraHttpError(400, 'autoReplyEnabled має бути boolean');
        patch.autoReplyEnabled = b.autoReplyEnabled;
    }
    if ('autoReplyDelaySec' in b) {
        const sec = b.autoReplyDelaySec;
        if (typeof sec !== 'number' ||
            !Number.isInteger(sec) ||
            sec < exports.DZHURA_AUTOREPLY_DELAY_MIN_SEC ||
            sec > exports.DZHURA_AUTOREPLY_DELAY_MAX_SEC) {
            throw new DzhuraHttpError(400, `Затримка автовідповіді — ціле число секунд від ${exports.DZHURA_AUTOREPLY_DELAY_MIN_SEC} до ${exports.DZHURA_AUTOREPLY_DELAY_MAX_SEC}`);
        }
        patch.autoReplyDelaySec = sec;
    }
    if ('autoReplyNote' in b) {
        if (b.autoReplyNote !== null && typeof b.autoReplyNote !== 'string') {
            throw new DzhuraHttpError(400, 'autoReplyNote має бути рядком або null');
        }
        const note = (b.autoReplyNote ?? '').trim();
        if (note.length > exports.DZHURA_AUTOREPLY_NOTE_MAX_LEN) {
            throw new DzhuraHttpError(400, `Підказка задовга (до ${exports.DZHURA_AUTOREPLY_NOTE_MAX_LEN} символів)`);
        }
        patch.autoReplyNote = note || null;
    }
    if (Object.keys(patch).length === 0) {
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
    if (patch.autoReplyEnabled === true && existing.kind !== 'private') {
        throw new DzhuraHttpError(400, 'Автовідповідь працює лише в особистих чатах');
    }
    if (patch.autoReplyEnabled !== undefined)
        data.autoReplyEnabled = patch.autoReplyEnabled;
    if (patch.autoReplyDelaySec !== undefined)
        data.autoReplyDelaySec = patch.autoReplyDelaySec;
    if (patch.autoReplyNote !== undefined)
        data.autoReplyNote = patch.autoReplyNote;
    // Без читання нема куди дублювати і нема з чого відповідати (контекст і стиль беруться зі збереженого).
    const nextCapture = patch.captureEnabled ?? existing.captureEnabled;
    if (!nextCapture) {
        if (patch.autoReplyEnabled === true)
            throw new DzhuraHttpError(400, 'Спершу ввімкніть «Читати»');
        data.relayToSaved = false;
        data.autoReplyEnabled = false;
    }
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
/** У списку задач без base64 картинок і HTML постів — лише що це було (слухач після публікації прибирає їх сам) */
function compactJobParams(type, params) {
    if (type === 'import_history' && params && typeof params.text === 'string') {
        const { text, media, ...rest } = params;
        return { ...rest, textChars: text.length, mediaCount: Array.isArray(media) ? media.length : 0 };
    }
    if (type !== 'post_items' || !params || !Array.isArray(params.items))
        return params;
    const { items, ...rest } = params;
    const list = items;
    return {
        ...rest,
        itemsCount: list.length,
        photos: list.filter((i) => i?.kind === 'photo').length,
    };
}
function serializeJob(row) {
    return {
        id: row.id,
        type: row.type,
        status: row.status,
        params: compactJobParams(row.type, asRecord(row.paramsJson)),
        progress: asRecord(row.progressJson),
        result: asRecord(row.resultJson),
        errorText: row.errorText,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
}
function parseChatId(raw) {
    const chatId = Number(raw);
    if (!Number.isInteger(chatId) || chatId <= 0)
        throw new DzhuraHttpError(400, 'Потрібен chatId');
    return chatId;
}
/** base64 → кількість байтів без декодування; null — не base64 */
function base64Bytes(s) {
    if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s))
        return null;
    return (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}
/** JPEG / PNG base64 до DZHURA_POST_MAX_PHOTO_BYTES, інакше 400 з префіксом `where` */
function parsePhotoBase64(raw, where) {
    const b64 = typeof raw === 'string' ? raw : '';
    const bytes = base64Bytes(b64);
    if (bytes == null || bytes > exports.DZHURA_POST_MAX_PHOTO_BYTES) {
        throw new DzhuraHttpError(400, `${where}: картинка — base64 до ${exports.DZHURA_POST_MAX_PHOTO_BYTES} байтів`);
    }
    const head = Buffer.from(b64.slice(0, 12), 'base64');
    const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isPng = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (!isJpeg && !isPng)
        throw new DzhuraHttpError(400, `${where}: лише JPEG або PNG`);
    return b64;
}
function parseImportRequest(b) {
    const chatId = parseChatId(b.chatId);
    const text = typeof b.text === 'string' ? b.text : '';
    if (!text.trim() || text.length > exports.DZHURA_IMPORT_MAX_TEXT) {
        throw new DzhuraHttpError(400, `text — файл чату від 1 до ${exports.DZHURA_IMPORT_MAX_TEXT} символів`);
    }
    const fileName = typeof b.fileName === 'string' && b.fileName.trim() ? b.fileName.trim() : 'WhatsApp Chat.txt';
    if (!/^[^/\\]{1,120}\.txt$/.test(fileName))
        throw new DzhuraHttpError(400, 'fileName — до 120 символів, .txt');
    const rawMedia = b.media == null ? [] : b.media;
    if (!Array.isArray(rawMedia) || rawMedia.length > exports.DZHURA_IMPORT_MAX_MEDIA) {
        throw new DzhuraHttpError(400, `media — до ${exports.DZHURA_IMPORT_MAX_MEDIA} картинок`);
    }
    const media = rawMedia.map((it, i) => {
        const o = (it ?? {});
        const name = typeof o.name === 'string' ? o.name : '';
        if (!/^[\w.-]{1,100}\.(jpe?g|png)$/i.test(name))
            throw new DzhuraHttpError(400, `Картинка ${i + 1}: name — ім'я файлу .jpg/.png`);
        if (!text.includes(name))
            throw new DzhuraHttpError(400, `Картинка ${i + 1}: ${name} не згадана в text`);
        return { name, jpegBase64: parsePhotoBase64(o.jpegBase64, `Картинка ${i + 1}`) };
    });
    return { type: 'import_history', chatId, text, fileName, dryRun: b.dryRun === true, media };
}
function parsePostItems(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        throw new DzhuraHttpError(400, 'Потрібен непорожній items');
    if (raw.length > exports.DZHURA_POST_MAX_ITEMS) {
        throw new DzhuraHttpError(400, `Не більше ${exports.DZHURA_POST_MAX_ITEMS} постів в одній задачі`);
    }
    return raw.map((it, i) => {
        const o = (it ?? {});
        if (o.kind === 'text') {
            const html = typeof o.html === 'string' ? o.html : '';
            if (!html.trim() || html.length > exports.DZHURA_POST_MAX_TEXT) {
                throw new DzhuraHttpError(400, `Пост ${i + 1}: текст від 1 до ${exports.DZHURA_POST_MAX_TEXT} символів`);
            }
            return { kind: 'text', html };
        }
        if (o.kind === 'photo') {
            const b64 = parsePhotoBase64(o.jpegBase64, `Пост ${i + 1}`);
            const caption = typeof o.caption === 'string' ? o.caption : '';
            if (caption.length > exports.DZHURA_POST_MAX_CAPTION) {
                throw new DzhuraHttpError(400, `Пост ${i + 1}: підпис до ${exports.DZHURA_POST_MAX_CAPTION} символів`);
            }
            return caption ? { kind: 'photo', jpegBase64: b64, caption } : { kind: 'photo', jpegBase64: b64 };
        }
        throw new DzhuraHttpError(400, `Пост ${i + 1}: kind — text або photo`);
    });
}
function parseJobRequest(body) {
    const b = (body ?? {});
    if (b.type === 'sync_dialogs')
        return { type: 'sync_dialogs' };
    if (b.type === 'avatars')
        return { type: 'avatars', chatId: parseChatId(b.chatId) };
    if (b.type === 'import_history')
        return parseImportRequest(b);
    if (b.type === 'post_items') {
        const chatId = parseChatId(b.chatId);
        const batch = typeof b.batch === 'string' ? b.batch.trim() : '';
        if (!/^[\w.-]{1,64}$/.test(batch))
            throw new DzhuraHttpError(400, 'batch — 1–64 символи [A-Za-z0-9_.-]');
        const seq = Number(b.seq);
        if (!Number.isInteger(seq) || seq < 0)
            throw new DzhuraHttpError(400, 'seq — ціле ≥ 0');
        return { type: 'post_items', chatId, batch, seq, silent: b.silent !== false, items: parsePostItems(b.items) };
    }
    if (b.type === 'backfill') {
        const chatId = Number(b.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0)
            throw new DzhuraHttpError(400, 'Потрібен chatId');
        const { from, to } = validateDateRange(b.from, b.to);
        return { type: 'backfill', chatId, from, to };
    }
    if (b.type === 'autoreply_preview') {
        const chatId = Number(b.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0)
            throw new DzhuraHttpError(400, 'Потрібен chatId');
        return { type: 'autoreply_preview', chatId };
    }
    throw new DzhuraHttpError(400, 'Невідомий тип задачі');
}
async function createJob(prisma, req) {
    if (req.type !== 'sync_dialogs') {
        const chat = await prisma.dzhuraChat.findUnique({ where: { id: req.chatId } });
        if (!chat)
            throw new DzhuraHttpError(404, 'Чат не знайдено');
        if (req.type === 'autoreply_preview') {
            if (chat.kind !== 'private')
                throw new DzhuraHttpError(400, 'Автовідповідь працює лише в особистих чатах');
            if (!chat.captureEnabled)
                throw new DzhuraHttpError(400, 'Спершу ввімкніть «Читати»');
            if (!isAutoReplyAvailable())
                throw new DzhuraHttpError(400, 'У бекенда немає ANTHROPIC_API_KEY');
        }
        if ((req.type === 'post_items' || req.type === 'import_history') && (chat.isLunchGroup || !exports.DZHURA_GROUP_KINDS.includes(chat.kind))) {
            throw new DzhuraHttpError(400, 'Публікуємо лише у звичайні групи (не в групу обідів і не в особисті)');
        }
    }
    if (req.type === 'post_items')
        return createPostJob(prisma, req);
    const params = req.type === 'import_history'
        ? {
            chatId: req.chatId,
            text: req.text,
            fileName: req.fileName,
            dryRun: req.dryRun,
            media: req.media,
        }
        : req.type === 'backfill'
            ? { chatId: req.chatId, from: req.from, to: req.to }
            : req.type === 'autoreply_preview' || req.type === 'avatars'
                ? { chatId: req.chatId }
                : undefined;
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
/**
 * Частина партії публікації: та сама пара batch / seq, що вже чекає, іде чи опублікована, — 409
 * (скрипт можна перезапустити — опубліковане вдруге не піде).
 */
async function createPostJob(prisma, req) {
    const same = await prisma.dzhuraJob.findFirst({
        where: {
            type: 'post_items',
            status: { in: ['pending', 'running', 'done'] },
            AND: [{ paramsJson: { path: ['batch'], equals: req.batch } }, { paramsJson: { path: ['seq'], equals: req.seq } }],
        },
        select: { id: true, status: true },
    });
    if (same) {
        throw new DzhuraHttpError(409, `Частина ${req.batch} №${req.seq} вже ${same.status === 'done' ? 'опублікована' : 'в черзі'} (задача №${same.id})`);
    }
    const params = {
        chatId: req.chatId,
        batch: req.batch,
        seq: req.seq,
        silent: req.silent,
        items: req.items,
    };
    const row = await prisma.dzhuraJob.create({ data: { type: 'post_items', status: 'pending', paramsJson: params } });
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
            isAutoReply: m.isAutoReply,
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
