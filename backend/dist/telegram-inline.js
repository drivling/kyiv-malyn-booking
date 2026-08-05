"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INLINE_CACHE = exports.INLINE_QUERY_PREFIX = void 0;
exports.isInlineMenuQuery = isInlineMenuQuery;
exports.matchInlineQueryPrefix = matchInlineQueryPrefix;
exports.buildInlineHelpMessageText = buildInlineHelpMessageText;
exports.buildListingShareMessageText = buildListingShareMessageText;
exports.logInlineQueryHandled = logInlineQueryHandled;
exports.handleInlineQuery = handleInlineQuery;
exports.handleChosenInlineResult = handleChosenInlineResult;
const referral_1 = require("./referral");
const inline_listings_1 = require("./inline-listings");
exports.INLINE_QUERY_PREFIX = {
    REF_SHARE: referral_1.REFERRAL_INLINE_QUERY_PREFIX,
    RIDES_TODAY: 'rides_today',
    RIDES: 'rides',
    HELP: 'help',
    BOOK: 'book',
    SHARE_LISTING: 'share_listing_',
    SETUP_PHONE: 'setup_phone',
};
exports.INLINE_CACHE = {
    MENU: 120,
    REFERRAL: 300,
    RIDES: 45,
    LISTING: 120,
    HELP: 600,
};
function isInlineMenuQuery(query) {
    return query.trim() === '';
}
function matchInlineQueryPrefix(query) {
    const q = query.trim();
    if (!q)
        return { kind: 'menu', payload: '' };
    if (q === exports.INLINE_QUERY_PREFIX.REF_SHARE || q.startsWith(`${exports.INLINE_QUERY_PREFIX.REF_SHARE} `)) {
        return { kind: 'ref_share', payload: q.slice(exports.INLINE_QUERY_PREFIX.REF_SHARE.length).trim() };
    }
    if (q === exports.INLINE_QUERY_PREFIX.RIDES_TODAY || q.startsWith(`${exports.INLINE_QUERY_PREFIX.RIDES_TODAY} `)) {
        return {
            kind: 'rides_today',
            payload: q.slice(exports.INLINE_QUERY_PREFIX.RIDES_TODAY.length).trim(),
        };
    }
    if (q === exports.INLINE_QUERY_PREFIX.RIDES || q.startsWith(`${exports.INLINE_QUERY_PREFIX.RIDES} `)) {
        return { kind: 'rides', payload: q.slice(exports.INLINE_QUERY_PREFIX.RIDES.length).trim() };
    }
    if (q === exports.INLINE_QUERY_PREFIX.HELP || q.startsWith(`${exports.INLINE_QUERY_PREFIX.HELP} `)) {
        return { kind: 'help', payload: q.slice(exports.INLINE_QUERY_PREFIX.HELP.length).trim() };
    }
    if (q === exports.INLINE_QUERY_PREFIX.BOOK || q.startsWith(`${exports.INLINE_QUERY_PREFIX.BOOK} `)) {
        return { kind: 'book', payload: q.slice(exports.INLINE_QUERY_PREFIX.BOOK.length).trim() };
    }
    if (q.startsWith(exports.INLINE_QUERY_PREFIX.SHARE_LISTING)) {
        return {
            kind: 'share_listing',
            payload: q.slice(exports.INLINE_QUERY_PREFIX.SHARE_LISTING.length).trim(),
        };
    }
    if (q === exports.INLINE_QUERY_PREFIX.SETUP_PHONE || q.startsWith(`${exports.INLINE_QUERY_PREFIX.SETUP_PHONE} `)) {
        return { kind: 'setup_phone', payload: q.slice(exports.INLINE_QUERY_PREFIX.SETUP_PHONE.length).trim() };
    }
    return { kind: 'unknown', payload: q };
}
function buildInlineHelpMessageText(botUsername) {
    return (`📚 Попутки Київ ↔ Малин у боті @${botUsername}\n\n` +
        'Команди в боті:\n' +
        '/allrides — всі попутки\n' +
        '/book — бронювання\n' +
        '/invite — акція «Приведи друга»\n' +
        '/confirmride — підтвердити поїздку фото\n' +
        '/help — повна довідка\n\n' +
        'У групі: @' +
        botUsername +
        ' → виберіть карточку зі списку.\n\n' +
        '🌐 https://malin.kiev.ua/poputky');
}
function buildListingShareMessageText(listing, botUsername, formatDate, getRouteName) {
    const routeName = getRouteName(listing.route);
    const dateStr = formatDate(listing.date);
    const typeLabel = listing.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир';
    const bookLink = `https://t.me/${botUsername}?start=book_viber_${listing.id}`;
    const lines = [
        `${typeLabel} · ${routeName}`,
        `📅 ${dateStr}`,
        listing.departureTime ? `🕐 ${listing.departureTime}` : null,
        listing.seats != null ? `🎫 ${listing.seats} місць` : null,
        listing.priceUah != null ? `💰 ${listing.priceUah} грн` : null,
        listing.senderName ? `👤 ${listing.senderName}` : null,
        '',
        `Забронювати: ${bookLink}`,
        '🌐 https://malin.kiev.ua/poputky',
    ];
    return lines.filter((line) => line != null).join('\n');
}
function article(id, title, description, messageText) {
    return {
        type: 'article',
        id,
        title,
        description: description.slice(0, 256),
        input_message_content: { message_text: messageText.slice(0, 4096) },
    };
}
function buildMenuArticles(ctx) {
    const bot = ctx.botUsername;
    return [
        article('menu_ref', '📤 Запросити друга', 'Акція «Приведи друга» — персональне посилання', `🎁 Акція «Приведи друга»\n\nВідкрийте бот і натисніть /invite — або @${bot} ${exports.INLINE_QUERY_PREFIX.REF_SHARE}\n\nhttps://t.me/${bot}`),
        article('menu_rides_today', '🚌 Попутки сьогодні', 'Активні оголошення на сьогодні', `🚌 Попутки сьогодні — @${bot} ${exports.INLINE_QUERY_PREFIX.RIDES_TODAY}\n\nАбо /allrides у боті\nhttps://t.me/${bot}?start=view`),
        article('menu_help', '📋 Допомога', 'Команди бота', buildInlineHelpMessageText(bot)),
        article('menu_book', '🎫 Забронювати', 'Нове бронювання в боті', `🎫 Бронювання попутки\n\nhttps://t.me/${bot}?start=book\n\nАбо команда /book у боті.`),
    ];
}
async function answerReferralShare(bot, queryId, userId, ctx) {
    const person = await ctx.getPersonByTelegram(userId, '');
    if (!person) {
        await bot.answerInlineQuery(queryId, [
            article('referral_need_start', 'Спочатку /start у боті', 'Тоді знову «Поділитися з другом»', `Спочатку відкрийте @${ctx.botUsername} і напишіть /start — тоді зможете поділитися персональним посиланням.`),
        ], { cache_time: exports.INLINE_CACHE.MENU });
        return;
    }
    const code = await (0, referral_1.ensurePersonReferralCode)(ctx.prisma, person.id);
    const link = (0, referral_1.getReferralBotLink)(ctx.botUsername, code);
    await bot.answerInlineQuery(queryId, [(0, referral_1.buildReferralShareInlineQueryResult)(link)], {
        cache_time: exports.INLINE_CACHE.REFERRAL,
        is_personal: true,
    });
}
async function answerRidesInline(bot, queryId, kind, payload, ctx) {
    const today = (0, inline_listings_1.startOfLocalDay)(new Date());
    const searchOpts = kind === 'rides_today'
        ? { dateFrom: today, dateTo: (0, inline_listings_1.addLocalDays)(today, 1), take: 20 }
        : { ...(0, inline_listings_1.parseInlineRidesQueryPayload)(payload), take: 20 };
    const listings = await (0, inline_listings_1.searchListingsForInline)(ctx.prisma, searchOpts);
    if (listings.length === 0) {
        await bot.answerInlineQuery(queryId, [
            article('rides_empty', 'Немає активних попуток', 'Змініть дату або додайте оголошення', `📭 Зараз немає попуток за цим фільтром.\n\nДодати: https://t.me/${ctx.botUsername}?start=driver\n🌐 https://malin.kiev.ua/poputky`),
        ], { cache_time: exports.INLINE_CACHE.RIDES });
        return;
    }
    const results = listings.map((l) => {
        const routeName = ctx.getRouteName(l.route);
        const dateStr = ctx.formatDate(l.date);
        const time = l.departureTime ?? '—';
        const typeEmoji = l.listingType === 'driver' ? '🚗' : '👤';
        const title = `${typeEmoji} ${routeName} · ${dateStr} ${time}`;
        const desc = l.listingType === 'driver'
            ? `${l.senderName ?? 'Водій'} · ${l.seats ?? '—'} місць`
            : `${l.senderName ?? 'Пасажир'}`;
        return article(`ride_${l.id}`, title.slice(0, 64), desc, buildListingShareMessageText(l, ctx.botUsername, ctx.formatDate, ctx.getRouteName));
    });
    await bot.answerInlineQuery(queryId, results.slice(0, 20), {
        cache_time: exports.INLINE_CACHE.RIDES,
    });
}
async function answerShareListing(bot, queryId, userId, listingIdRaw, ctx) {
    const listingId = parseInt(listingIdRaw, 10);
    if (!Number.isInteger(listingId) || listingId <= 0) {
        await bot.answerInlineQuery(queryId, [], { cache_time: 5 });
        return;
    }
    const listing = await ctx.prisma.viberListing.findUnique({
        where: { id: listingId },
        select: {
            id: true,
            listingType: true,
            route: true,
            date: true,
            departureTime: true,
            seats: true,
            phone: true,
            senderName: true,
            notes: true,
            priceUah: true,
            personId: true,
            isActive: true,
        },
    });
    if (!listing || !listing.isActive) {
        await bot.answerInlineQuery(queryId, [
            article('listing_missing', 'Оголошення не знайдено', 'Можливо вже закрито', '❌ Оголошення неактивне або видалене.'),
        ], { cache_time: 60 });
        return;
    }
    const person = await ctx.getPersonByTelegram(userId, '');
    const isAdmin = ctx.isAdminTelegramUser?.(userId) ?? false;
    const isOwner = person &&
        (listing.personId === person.id ||
            (person.phoneNormalized && ctx.normalizePhone(listing.phone) === person.phoneNormalized));
    if (!isOwner && !isAdmin) {
        await bot.answerInlineQuery(queryId, [
            article('listing_forbidden', 'Це не ваше оголошення', 'Можна ділитися лише своїми', '❌ Поділитися можна лише своїм активним оголошенням.'),
        ], { cache_time: 60 });
        return;
    }
    await bot.answerInlineQuery(queryId, [
        article(`share_listing_${listing.id}`, `📤 Оголошення #${listing.id}`, ctx.getRouteName(listing.route), buildListingShareMessageText(listing, ctx.botUsername, ctx.formatDate, ctx.getRouteName)),
    ], { cache_time: exports.INLINE_CACHE.LISTING, is_personal: false });
}
/** Лог inline без PII (тільки id запиту, префікс, telegram user id). */
function logInlineQueryHandled(queryId, fromUserId, kind, resultCount, ms) {
    console.log(`inline_query ok id=${queryId} from=${fromUserId} kind=${kind} results=${resultCount} ${ms}ms`);
}
async function handleInlineQuery(bot, query, ctx) {
    const started = Date.now();
    const queryId = query.id;
    const userId = query.from.id.toString();
    const matched = matchInlineQueryPrefix(query.query);
    let resultCount = 0;
    try {
        switch (matched.kind) {
            case 'menu':
                const menu = buildMenuArticles(ctx);
                resultCount = menu.length;
                await bot.answerInlineQuery(queryId, menu, { cache_time: exports.INLINE_CACHE.MENU });
                break;
            case 'ref_share':
                await answerReferralShare(bot, queryId, userId, ctx);
                resultCount = 1;
                break;
            case 'rides_today':
                await answerRidesInline(bot, queryId, 'rides_today', matched.payload, ctx);
                resultCount = 20;
                break;
            case 'rides':
                await answerRidesInline(bot, queryId, 'rides', matched.payload, ctx);
                resultCount = 20;
                break;
            case 'help':
                resultCount = 1;
                await bot.answerInlineQuery(queryId, [
                    article('help_full', '📋 Допомога', 'Команди бота', buildInlineHelpMessageText(ctx.botUsername)),
                ], { cache_time: exports.INLINE_CACHE.HELP });
                break;
            case 'book':
                resultCount = 1;
                await bot.answerInlineQuery(queryId, [
                    article('book_start', '🎫 Забронювати', 'Відкрити бот', `🎫 Бронювання\n\nhttps://t.me/${ctx.botUsername}?start=book`),
                ], { cache_time: exports.INLINE_CACHE.HELP });
                break;
            case 'share_listing':
                await answerShareListing(bot, queryId, userId, matched.payload, ctx);
                resultCount = 1;
                break;
            case 'setup_phone':
                resultCount = 1;
                await bot.answerInlineQuery(queryId, [
                    article('setup_phone_hint', '📱 Номер у боті', 'Потрібен для бронювання', `📱 Для бронювання та персональних кнопок поділіться номером у боті:\n\nhttps://t.me/${ctx.botUsername}?start=${exports.INLINE_QUERY_PREFIX.SETUP_PHONE}`),
                ], {
                    cache_time: exports.INLINE_CACHE.HELP,
                    button: {
                        text: '📱 Відкрити бот і додати номер',
                        start_parameter: exports.INLINE_QUERY_PREFIX.SETUP_PHONE,
                    },
                });
                break;
            default:
                await bot.answerInlineQuery(queryId, [], { cache_time: 5 });
                break;
        }
        logInlineQueryHandled(queryId, query.from.id, matched.kind, resultCount, Date.now() - started);
    }
    catch (e) {
        console.error('❌ handleInlineQuery:', matched.kind, e);
        try {
            await bot.answerInlineQuery(queryId, [], { cache_time: 0 });
        }
        catch {
            /* ignore */
        }
    }
}
async function handleChosenInlineResult(result) {
    console.log(`inline_chosen result_id=${result.result_id} from=${result.from.id} inline_msg=${result.inline_message_id ?? '—'}`);
}
