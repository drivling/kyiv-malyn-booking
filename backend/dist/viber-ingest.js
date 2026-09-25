"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRawForHash = normalizeRawForHash;
exports.rawMessageHash = rawMessageHash;
exports.ingestRawListing = ingestRawListing;
/**
 * Єдиний шлях прийому сирого повідомлення з парсерів (Viber, Telegram-групи через HTTP):
 * parse → ідемпотентний ключ → Person → createOrMergeViberListing → фонові job-и.
 *
 * Docs/poputky-search-performance-plan.md, Фаза 5:
 * - 5.1: sha256(source + нормалізований текст) у ViberListingSource — retry парсера після
 *   мережевої помилки повертає те саме оголошення, а не запускає мерж-евристику вдруге.
 * - 5.2: ім'я відправника через Telethon (spawn Python) більше не шукається в HTTP-запиті —
 *   це job `resolve_sender_name` у черзі; відповідь парсеру повертається одразу після мержу.
 */
const crypto_1 = require("crypto");
const viber_parser_1 = require("./viber-parser");
const viber_listing_merge_1 = require("./viber-listing-merge");
const telegram_1 = require("./telegram");
const notification_queue_1 = require("./notification-queue");
/** Нормалізація перед хешем: пробіли/переноси не змінюють ідентичність повідомлення. */
function normalizeRawForHash(raw) {
    return raw
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
}
function rawMessageHash(source, raw) {
    return (0, crypto_1.createHash)('sha256').update(`${source}\n${normalizeRawForHash(raw)}`).digest('hex');
}
async function ingestRawListing(prisma, input, deps = {}) {
    const source = input.source ?? 'Viber1';
    const parse = deps.parse ?? viber_parser_1.parseViberMessage;
    const parsed = parse(input.rawMessage);
    if (!parsed)
        return { ok: false, reason: 'unparsable' };
    const matchingRecheckTriggered = deps.notify ?? (0, telegram_1.isTelegramEnabled)();
    const sources = prisma.viberListingSource;
    const hash = rawMessageHash(source, input.rawMessage);
    // 5.1 — уже приймали це повідомлення: віддаємо готове оголошення, нічого не мержимо й не шлемо
    if (sources) {
        const seen = await sources.findUnique({ where: { hash }, select: { listingId: true } });
        if (seen) {
            const listing = await prisma.viberListing.findUnique({ where: { id: seen.listingId } });
            if (listing) {
                return { ok: true, listing, isNew: false, isPastDate: false, duplicate: true, matchingRecheckTriggered };
            }
            // Оголошення видалили (архів) — приймаємо як нове, рядок-джерело перезапишемо нижче
        }
    }
    // Ім'я: лише те, що вже є в базі; Telethon-пошук — окремим job-ом після відповіді (5.2)
    const nameFromDb = parsed.phone ? await (0, telegram_1.getNameByPhone)(parsed.phone) : null;
    const senderName = (nameFromDb ?? parsed.senderName ?? null)?.trim() || null;
    const person = parsed.phone
        ? await (0, telegram_1.findOrCreatePersonByPhone)(parsed.phone, { fullName: senderName ?? undefined })
        : null;
    const { listing, isNew, isPastDate } = await (0, viber_listing_merge_1.createOrMergeViberListing)(prisma, {
        rawMessage: input.rawMessage,
        source,
        senderName: senderName ?? undefined,
        listingType: parsed.listingType,
        route: parsed.route,
        date: parsed.date,
        departureTime: parsed.departureTime,
        seats: parsed.seats,
        phone: parsed.phone,
        notes: parsed.notes,
        isActive: true,
        personId: person?.id ?? undefined,
    });
    if (sources) {
        // Unique-конфлікт можливий лише при гонці двох однакових POST — другий і так знайшов би листинг
        await sources
            .create({ data: { hash, source, listingId: listing.id } })
            .catch((err) => console.warn('[viber-ingest] source row:', err instanceof Error ? err.message : err));
    }
    if (matchingRecheckTriggered && !isPastDate) {
        (0, telegram_1.sendViberListingNotificationToAdmin)({
            id: listing.id,
            listingType: listing.listingType,
            route: listing.route,
            date: listing.date,
            departureTime: listing.departureTime,
            seats: listing.seats,
            phone: listing.phone,
            senderName: listing.senderName,
            notes: listing.notes,
            priceUah: listing.priceUah ?? undefined,
            source: listing.source,
        }).catch((err) => console.error('Telegram Viber notify:', err));
        if (listing.phone && listing.phone.trim()) {
            (0, telegram_1.sendViberListingConfirmationToUser)(listing.phone, {
                id: listing.id,
                route: listing.route,
                date: listing.date,
                departureTime: listing.departureTime,
                seats: listing.seats,
                listingType: listing.listingType,
                priceUah: listing.priceUah ?? undefined,
            }).catch((err) => console.error('Telegram Viber user notify:', err));
        }
        // Порядок job-ів = порядок id: спершу ім'я (щоб у розсилці був не «Водій»), потім перетини
        if (!listing.senderName?.trim() && listing.phone?.trim()) {
            await (0, notification_queue_1.enqueueResolveSenderName)(prisma, listing.id, listing.phone).catch((err) => console.error('enqueue resolve sender name:', err));
        }
        await (0, notification_queue_1.enqueueListingMatch)(prisma, listing.id).catch((err) => console.error('enqueue listing match:', err));
    }
    return { ok: true, listing, isNew, isPastDate, duplicate: false, matchingRecheckTriggered };
}
