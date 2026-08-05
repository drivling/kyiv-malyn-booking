/**
 * Inline-режим Telegram-бота: єдиний вхід для @бот у чатах.
 */
import type TelegramBot from 'node-telegram-bot-api';
import type { PrismaClient } from '@prisma/client';
import {
  buildReferralShareInlineQueryResult,
  ensurePersonReferralCode,
  getReferralBotLink,
  REFERRAL_INLINE_QUERY_PREFIX,
} from './referral';
import {
  addLocalDays,
  parseInlineRidesQueryPayload,
  searchListingsForInline,
  startOfLocalDay,
  type InlineListingRow,
} from './inline-listings';

export const INLINE_QUERY_PREFIX = {
  REF_SHARE: REFERRAL_INLINE_QUERY_PREFIX,
  RIDES_TODAY: 'rides_today',
  RIDES: 'rides',
  HELP: 'help',
  BOOK: 'book',
  SHARE_LISTING: 'share_listing_',
  SETUP_PHONE: 'setup_phone',
} as const;

export const INLINE_CACHE = {
  MENU: 120,
  REFERRAL: 300,
  RIDES: 45,
  LISTING: 120,
  HELP: 600,
} as const;

export type InlineQueryHandlerContext = {
  prisma: PrismaClient;
  botUsername: string;
  getPersonByTelegram: (userId: string, chatId: string) => Promise<{
    id: number;
    phoneNormalized?: string;
  } | null>;
  isAdminTelegramUser?: (userId: string) => boolean;
  formatDate: (date: Date) => string;
  getRouteName: (route: string) => string;
  normalizePhone: (phone: string) => string;
};

type InlineArticle = TelegramBot.InlineQueryResultArticle;

export function isInlineMenuQuery(query: string): boolean {
  return query.trim() === '';
}

export function matchInlineQueryPrefix(query: string): {
  kind: 'menu' | 'ref_share' | 'rides_today' | 'rides' | 'help' | 'book' | 'share_listing' | 'setup_phone' | 'unknown';
  payload: string;
} {
  const q = query.trim();
  if (!q) return { kind: 'menu', payload: '' };
  if (q === INLINE_QUERY_PREFIX.REF_SHARE || q.startsWith(`${INLINE_QUERY_PREFIX.REF_SHARE} `)) {
    return { kind: 'ref_share', payload: q.slice(INLINE_QUERY_PREFIX.REF_SHARE.length).trim() };
  }
  if (q === INLINE_QUERY_PREFIX.RIDES_TODAY || q.startsWith(`${INLINE_QUERY_PREFIX.RIDES_TODAY} `)) {
    return {
      kind: 'rides_today',
      payload: q.slice(INLINE_QUERY_PREFIX.RIDES_TODAY.length).trim(),
    };
  }
  if (q === INLINE_QUERY_PREFIX.RIDES || q.startsWith(`${INLINE_QUERY_PREFIX.RIDES} `)) {
    return { kind: 'rides', payload: q.slice(INLINE_QUERY_PREFIX.RIDES.length).trim() };
  }
  if (q === INLINE_QUERY_PREFIX.HELP || q.startsWith(`${INLINE_QUERY_PREFIX.HELP} `)) {
    return { kind: 'help', payload: q.slice(INLINE_QUERY_PREFIX.HELP.length).trim() };
  }
  if (q === INLINE_QUERY_PREFIX.BOOK || q.startsWith(`${INLINE_QUERY_PREFIX.BOOK} `)) {
    return { kind: 'book', payload: q.slice(INLINE_QUERY_PREFIX.BOOK.length).trim() };
  }
  if (q.startsWith(INLINE_QUERY_PREFIX.SHARE_LISTING)) {
    return {
      kind: 'share_listing',
      payload: q.slice(INLINE_QUERY_PREFIX.SHARE_LISTING.length).trim(),
    };
  }
  if (q === INLINE_QUERY_PREFIX.SETUP_PHONE || q.startsWith(`${INLINE_QUERY_PREFIX.SETUP_PHONE} `)) {
    return { kind: 'setup_phone', payload: q.slice(INLINE_QUERY_PREFIX.SETUP_PHONE.length).trim() };
  }
  return { kind: 'unknown', payload: q };
}

export function buildInlineHelpMessageText(botUsername: string): string {
  return (
    `📚 Попутки Київ ↔ Малин у боті @${botUsername}\n\n` +
    'Команди в боті:\n' +
    '/allrides — всі попутки\n' +
    '/book — бронювання\n' +
    '/invite — акція «Приведи друга»\n' +
    '/confirmride — підтвердити поїздку фото\n' +
    '/help — повна довідка\n\n' +
    'У групі: @' +
    botUsername +
    ' → виберіть карточку зі списку.\n\n' +
    '🌐 https://malin.kiev.ua/poputky'
  );
}

export function buildListingShareMessageText(
  listing: InlineListingRow,
  botUsername: string,
  formatDate: (d: Date) => string,
  getRouteName: (route: string) => string
): string {
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

function article(
  id: string,
  title: string,
  description: string,
  messageText: string
): InlineArticle {
  return {
    type: 'article',
    id,
    title,
    description: description.slice(0, 256),
    input_message_content: { message_text: messageText.slice(0, 4096) },
  };
}

function buildMenuArticles(ctx: InlineQueryHandlerContext): InlineArticle[] {
  const bot = ctx.botUsername;
  return [
    article(
      'menu_ref',
      '📤 Запросити друга',
      'Акція «Приведи друга» — персональне посилання',
      `🎁 Акція «Приведи друга»\n\nВідкрийте бот і натисніть /invite — або @${bot} ${INLINE_QUERY_PREFIX.REF_SHARE}\n\nhttps://t.me/${bot}`
    ),
    article(
      'menu_rides_today',
      '🚌 Попутки сьогодні',
      'Активні оголошення на сьогодні',
      `🚌 Попутки сьогодні — @${bot} ${INLINE_QUERY_PREFIX.RIDES_TODAY}\n\nАбо /allrides у боті\nhttps://t.me/${bot}?start=view`
    ),
    article(
      'menu_help',
      '📋 Допомога',
      'Команди бота',
      buildInlineHelpMessageText(bot)
    ),
    article(
      'menu_book',
      '🎫 Забронювати',
      'Нове бронювання в боті',
      `🎫 Бронювання попутки\n\nhttps://t.me/${bot}?start=book\n\nАбо команда /book у боті.`
    ),
  ];
}

async function answerReferralShare(
  bot: TelegramBot,
  queryId: string,
  userId: string,
  ctx: InlineQueryHandlerContext
): Promise<void> {
  const person = await ctx.getPersonByTelegram(userId, '');
  if (!person) {
    await bot.answerInlineQuery(queryId, [
      article(
        'referral_need_start',
        'Спочатку /start у боті',
        'Тоді знову «Поділитися з другом»',
        `Спочатку відкрийте @${ctx.botUsername} і напишіть /start — тоді зможете поділитися персональним посиланням.`
      ),
    ], { cache_time: INLINE_CACHE.MENU });
    return;
  }
  const code = await ensurePersonReferralCode(ctx.prisma, person.id);
  const link = getReferralBotLink(ctx.botUsername, code);
  await bot.answerInlineQuery(queryId, [buildReferralShareInlineQueryResult(link)], {
    cache_time: INLINE_CACHE.REFERRAL,
    is_personal: true,
  });
}

async function answerRidesInline(
  bot: TelegramBot,
  queryId: string,
  kind: 'rides_today' | 'rides',
  payload: string,
  ctx: InlineQueryHandlerContext
): Promise<void> {
  const today = startOfLocalDay(new Date());
  const searchOpts =
    kind === 'rides_today'
      ? { dateFrom: today, dateTo: addLocalDays(today, 1), take: 20 }
      : { ...parseInlineRidesQueryPayload(payload), take: 20 };

  const listings = await searchListingsForInline(ctx.prisma, searchOpts);
  if (listings.length === 0) {
    await bot.answerInlineQuery(queryId, [
      article(
        'rides_empty',
        'Немає активних попуток',
        'Змініть дату або додайте оголошення',
        `📭 Зараз немає попуток за цим фільтром.\n\nДодати: https://t.me/${ctx.botUsername}?start=driver\n🌐 https://malin.kiev.ua/poputky`
      ),
    ], { cache_time: INLINE_CACHE.RIDES });
    return;
  }

  const results: InlineArticle[] = listings.map((l) => {
    const routeName = ctx.getRouteName(l.route);
    const dateStr = ctx.formatDate(l.date);
    const time = l.departureTime ?? '—';
    const typeEmoji = l.listingType === 'driver' ? '🚗' : '👤';
    const title = `${typeEmoji} ${routeName} · ${dateStr} ${time}`;
    const desc =
      l.listingType === 'driver'
        ? `${l.senderName ?? 'Водій'} · ${l.seats ?? '—'} місць`
        : `${l.senderName ?? 'Пасажир'}`;
    return article(
      `ride_${l.id}`,
      title.slice(0, 64),
      desc,
      buildListingShareMessageText(l, ctx.botUsername, ctx.formatDate, ctx.getRouteName)
    );
  });

  await bot.answerInlineQuery(queryId, results.slice(0, 20), {
    cache_time: INLINE_CACHE.RIDES,
  });
}

async function answerShareListing(
  bot: TelegramBot,
  queryId: string,
  userId: string,
  listingIdRaw: string,
  ctx: InlineQueryHandlerContext
): Promise<void> {
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
  const isOwner =
    person &&
    (listing.personId === person.id ||
      (person.phoneNormalized && ctx.normalizePhone(listing.phone) === person.phoneNormalized));

  if (!isOwner && !isAdmin) {
    await bot.answerInlineQuery(queryId, [
      article(
        'listing_forbidden',
        'Це не ваше оголошення',
        'Можна ділитися лише своїми',
        '❌ Поділитися можна лише своїм активним оголошенням.'
      ),
    ], { cache_time: 60 });
    return;
  }

  await bot.answerInlineQuery(
    queryId,
    [
      article(
        `share_listing_${listing.id}`,
        `📤 Оголошення #${listing.id}`,
        ctx.getRouteName(listing.route),
        buildListingShareMessageText(listing, ctx.botUsername, ctx.formatDate, ctx.getRouteName)
      ),
    ],
    { cache_time: INLINE_CACHE.LISTING, is_personal: false }
  );
}

/** Лог inline без PII (тільки id запиту, префікс, telegram user id). */
export function logInlineQueryHandled(
  queryId: string,
  fromUserId: number,
  kind: string,
  resultCount: number,
  ms: number
): void {
  console.log(
    `inline_query ok id=${queryId} from=${fromUserId} kind=${kind} results=${resultCount} ${ms}ms`
  );
}

export async function handleInlineQuery(
  bot: TelegramBot,
  query: TelegramBot.InlineQuery,
  ctx: InlineQueryHandlerContext
): Promise<void> {
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
        await bot.answerInlineQuery(queryId, menu, { cache_time: INLINE_CACHE.MENU });
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
        ], { cache_time: INLINE_CACHE.HELP });
        break;
      case 'book':
        resultCount = 1;
        await bot.answerInlineQuery(queryId, [
          article(
            'book_start',
            '🎫 Забронювати',
            'Відкрити бот',
            `🎫 Бронювання\n\nhttps://t.me/${ctx.botUsername}?start=book`
          ),
        ], { cache_time: INLINE_CACHE.HELP });
        break;
      case 'share_listing':
        await answerShareListing(bot, queryId, userId, matched.payload, ctx);
        resultCount = 1;
        break;
      case 'setup_phone':
        resultCount = 1;
        await bot.answerInlineQuery(
          queryId,
          [
            article(
              'setup_phone_hint',
              '📱 Номер у боті',
              'Потрібен для бронювання',
              `📱 Для бронювання та персональних кнопок поділіться номером у боті:\n\nhttps://t.me/${ctx.botUsername}?start=${INLINE_QUERY_PREFIX.SETUP_PHONE}`
            ),
          ],
          {
            cache_time: INLINE_CACHE.HELP,
            button: {
              text: '📱 Відкрити бот і додати номер',
              start_parameter: INLINE_QUERY_PREFIX.SETUP_PHONE,
            },
          } as TelegramBot.AnswerInlineQueryOptions
        );
        break;
      default:
        await bot.answerInlineQuery(queryId, [], { cache_time: 5 });
        break;
    }
    logInlineQueryHandled(queryId, query.from.id, matched.kind, resultCount, Date.now() - started);
  } catch (e) {
    console.error('❌ handleInlineQuery:', matched.kind, e);
    try {
      await bot.answerInlineQuery(queryId, [], { cache_time: 0 });
    } catch {
      /* ignore */
    }
  }
}

export async function handleChosenInlineResult(
  result: TelegramBot.ChosenInlineResult
): Promise<void> {
  console.log(
    `inline_chosen result_id=${result.result_id} from=${result.from.id} inline_msg=${result.inline_message_id ?? '—'}`
  );
}
