import TelegramBot from 'node-telegram-bot-api';
import { spawn as nodeSpawn } from 'child_process';
import path from 'path';

type SpawnFn = typeof nodeSpawn;
let spawnChild: SpawnFn = nodeSpawn;

/** Юніт-тести: підміна spawn (Python Telethon) без реальних процесів. */
export function setSpawnForTests(fn: SpawnFn | null): void {
  spawnChild = fn ?? nodeSpawn;
}

export function resetSpawnForTests(): void {
  spawnChild = nodeSpawn;
}
import { PrismaClient } from '@prisma/client';
import { extractDate, extractTime, parseViberMessage, parseViberMessages } from './viber-parser';
import { parseTelegramMessage, parseTelegramMessages } from './telegram-parser';
import {
  createOrMergeViberListing as createOrMergeViberListingShared,
  type ViberListingMergeInput,
} from './viber-listing-merge';
import { handleTelegramBotBlockedFromOutboundSend } from './revoke-telegram-bot';

const defaultTgPrisma = new PrismaClient();
let tgPrisma: PrismaClient = defaultTgPrisma;

/** Для юніт-тестів: підставити мок Prisma замість реального клієнта. */
export function setTelegramPrismaForTests(client: PrismaClient): void {
  tgPrisma = client;
}

/** Повернути дефолтний Prisma після тестів (той самий інстанс, що при старті). */
export function resetTelegramPrismaForTests(): void {
  tgPrisma = defaultTgPrisma;
}

export async function createOrMergeViberListing(
  data: ViberListingMergeInput
): Promise<{ listing: any; isNew: boolean }> {
  return createOrMergeViberListingShared(tgPrisma, data);
}

/** Кроки потоку "додати поїздку (водій)" */
type DriverRideStep = 'route' | 'date' | 'time' | 'seats' | 'price' | 'phone' | 'notes' | 'date_custom' | 'time_custom';
interface DriverRideFlowState {
  state: 'driver_ride_flow';
  step: DriverRideStep;
  route?: string;
  date?: string;
  departureTime?: string;
  seats?: number | null;
  priceUah?: number | null;
  phone?: string;
  since: number;
  /** Токен чернетки з сайту — після введення телефону підставляємо route/date/time з чернетки */
  draftToken?: string;
  /** Примітка з чернетки (з сайту) — використовується при «Пропустити» на кроці notes */
  notesFromDraft?: string | null;
}
const driverRideStateMap = new Map<string, DriverRideFlowState>();
const DRIVER_RIDE_STATE_TTL_MS = 15 * 60 * 1000; // 15 хв

/** Кроки потоку "додати поїздку (пасажир)" — звідки, куди, дата, час (опційно), без кількості місць */
type PassengerRideStep = 'route' | 'date' | 'time' | 'phone' | 'notes' | 'date_custom' | 'time_custom';
interface PassengerRideFlowState {
  state: 'passenger_ride_flow';
  step: PassengerRideStep;
  route?: string;
  date?: string;
  departureTime?: string | null;
  phone?: string;
  since: number;
  /** Токен чернетки з сайту — після введення телефону підставляємо route/date/time з чернетки */
  draftToken?: string;
  /** Примітка з чернетки (з сайту) — використовується при «Пропустити» на кроці notes */
  notesFromDraft?: string | null;
}
const passengerRideStateMap = new Map<string, PassengerRideFlowState>();
const PASSENGER_RIDE_STATE_TTL_MS = 15 * 60 * 1000; // 15 хв

/** Очікування тексту оголошення з Вайберу після /addviber (тільки адмін-чат) */
const addViberAwaitingMap = new Map<string, number>(); // chatId -> since
const ADDVIBER_STATE_TTL_MS = 10 * 60 * 1000; // 10 хв

/** Очікування тексту оголошення з Telegram (PoDoroguem) після /addtelegram (тільки адмін-чат) */
const addTelegramAwaitingMap = new Map<string, number>(); // chatId -> since
const ADDTELEGRAM_STATE_TTL_MS = 10 * 60 * 1000; // 10 хв

/** Очікування вводу дати для фільтра /allrides */
const allridesAwaitingDateInputMap = new Map<string, number>(); // chatId -> since
const ALLRIDES_FILTER_INPUT_TTL_MS = 10 * 60 * 1000; // 10 хв

/** Чернетка оголошення з сайту (poputky): маршрут, дата, час, примітки. Токен у start=driver_XXX / passenger_XXX */
export interface AnnounceDraft {
  role: 'driver' | 'passenger';
  route: string;
  date: string; // YYYY-MM-DD
  departureTime?: string | null;
  notes?: string | null;
  priceUah?: number | null;
  since: number;
}
const announceDraftsMap = new Map<string, AnnounceDraft>();
const ANNOUNCE_DRAFT_TTL_MS = 15 * 60 * 1000; // 15 хв

export function setAnnounceDraft(token: string, data: Omit<AnnounceDraft, 'since'>): void {
  announceDraftsMap.set(token, { ...data, since: Date.now() });
}

export function getAnnounceDraft(token: string): AnnounceDraft | null {
  const draft = announceDraftsMap.get(token);
  if (!draft) return null;
  if (Date.now() - draft.since > ANNOUNCE_DRAFT_TTL_MS) {
    announceDraftsMap.delete(token);
    return null;
  }
  return draft;
}

// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '5072659044';
const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';

let bot: TelegramBot | null = null;

export function getTelegramScenarioLinks() {
  return {
    driver: `https://t.me/${telegramBotUsername}?start=driver`,
    passenger: `https://t.me/${telegramBotUsername}?start=passenger`,
    view: `https://t.me/${telegramBotUsername}?start=view`,
    poputkyWeb: 'https://malin.kiev.ua/poputky',
  };
}

/** Ключі сценаріїв реклами з аналітики ViberRide (поведінкові пропозиції). */
export type BehaviorPromoScenarioKey =
  | 'driver_passengers'
  | 'driver_autocreate'
  | 'passenger_notify'
  | 'passenger_quick'
  | 'mixed_unified'
  | 'mixed_both';

export const BEHAVIOR_PROMO_SCENARIO_LABELS: Record<BehaviorPromoScenarioKey, string> = {
  driver_passengers: 'Пасажири на маршрутах',
  driver_autocreate: 'Автопідказка оголошень',
  passenger_notify: 'Сповіщення про водіїв',
  passenger_quick: 'Швидке бронювання',
  mixed_unified: 'Блок водій+пасажир',
  mixed_both: 'Водії й пасажири',
};

/** Для якого профілю показувати кнопку: driver | passenger | mixed (обидва типи кнопок для mixed). */
export const BEHAVIOR_PROMO_SCENARIO_PROFILES: Record<BehaviorPromoScenarioKey, ('driver' | 'passenger' | 'mixed')[]> = {
  driver_passengers: ['driver', 'mixed'],
  driver_autocreate: ['driver', 'mixed'],
  passenger_notify: ['passenger', 'mixed'],
  passenger_quick: ['passenger', 'mixed'],
  mixed_unified: ['mixed'],
  mixed_both: ['mixed'],
};

export interface BehaviorPromoContext {
  fullName?: string | null;
  mainRoute?: string;
  behaviorSummary?: string;
}

/**
 * Збирає HTML-повідомлення для поведінкової реклами (аналітика ViberRide).
 * Використовується і в боті, і (після спрощення) при відправці від особистого акаунта.
 */
export function buildBehaviorPromoMessage(
  scenarioKey: BehaviorPromoScenarioKey,
  context?: BehaviorPromoContext
): string {
  const links = getTelegramScenarioLinks();
  const name = context?.fullName?.trim() || 'Друже';
  const routeHint = context?.mainRoute ? ` (наприклад ${context.mainRoute})` : '';

  const templates: Record<BehaviorPromoScenarioKey, string> = {
    driver_passengers: `
📢 <b>Для вас як водія</b>

Ми бачимо, що ви часто їздите одними маршрутами. На платформі є пасажири, які шукають саме такі поїздки — перегляньте їх і додайте своє оголошення:

🚗 Додати поїздку як водій: ${links.driver}
🌐 Всі попутки: ${links.poputkyWeb}

<i>Один клік — і пасажири побачать ваше оголошення.</i>
    `.trim(),
    driver_autocreate: `
📢 <b>Швидке повторне оголошення</b>

Ви часто публікуєте поїздки — збережемо ваш час. Створіть оголошення з тим самим маршрутом і часом у кілька кліків:

🚗 Додати поїздку як водій: ${links.driver}
🌐 Сайт попуток: ${links.poputkyWeb}

<i>Дякуємо, що користуєтесь нашою платформою! 🚐</i>
    `.trim(),
    passenger_notify: `
📢 <b>Нові водії на ваших маршрутах</b>

Ми пам’ятаємо ваші поїздки${routeHint}. Підпишіться в боті — тоді ви зможете отримувати сповіщення про нових водіїв на цих напрямках:

👤 Шукаю поїздку (пасажир): ${links.passenger}
🌐 Вільний перегляд: ${links.poputkyWeb}

<i>Не пропустіть зручну попутку.</i>
    `.trim(),
    passenger_quick: `
📢 <b>Швидке бронювання</b>

На ваших частых напрямках з’являються нові поїздки. Забронюйте місце за 1–2 кліки:

👤 Запит на поїздку: ${links.passenger}
🌐 Всі попутки: ${links.poputkyWeb}

<i>Київ, Житомир, Коростень ↔️ Малин — одна платформа.</i>
    `.trim(),
    mixed_unified: `
📢 <b>Один блок: водій і пасажир</b>

Ви їздите і як водій, і як пасажир — ми підлаштували підказки під вас. Один блок з двома сценаріями:

🚗 Додати поїздку як водій: ${links.driver}
👤 Шукаю поїздку як пасажир: ${links.passenger}
🌐 Всі попутки: ${links.poputkyWeb}

<i>Обирайте роль — ми покажемо відповідні кроки.</i>
    `.trim(),
    mixed_both: `
📢 <b>Водії й пасажири на ваших маршрутах</b>

На ваших основних напрямках є і водії, і ті, хто шукає попутку. Перегляньте всі оголошення та оберіть зручний варіант:

🌐 Вільний перегляд: ${links.poputkyWeb}
🚗 Я водій: ${links.driver} | 👤 Я пасажир: ${links.passenger}

<i>Дякуємо, що користуєтесь нашим сервісом! 🚐</i>
    `.trim(),
  };

  let text = templates[scenarioKey];
  if (name && name !== 'Друже') {
    text = `Привіт, ${name}!\n\n` + text;
  }
  return text;
}

/** Відправляє поведінкове рекламне повідомлення в Telegram боті (за chatId). */
export async function sendBehaviorPromoMessage(
  chatId: string,
  scenarioKey: BehaviorPromoScenarioKey,
  context?: BehaviorPromoContext
): Promise<void> {
  if (!bot) {
    throw new Error('Telegram bot не налаштовано');
  }
  const message = buildBehaviorPromoMessage(scenarioKey, context);
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    await handleTelegramBotBlockedFromOutboundSend(tgPrisma, e, { chatId });
    throw e;
  }
}

/**
 * Нормалізація номера телефону
 * Перетворює всі формати в 380XXXXXXXXX
 */
export const normalizePhone = (phone: string): string => {
  // Видаляємо всі символи крім цифр
  let cleaned = phone.replace(/\D/g, '');
  
  // Якщо починається з 0 (наприклад 0679551952) -> додаємо 38
  if (cleaned.startsWith('0')) {
    cleaned = '38' + cleaned;
  }
  
  // Якщо починається з 380 - залишаємо як є
  // Якщо інший формат - повертаємо як є
  return cleaned;
};

/** Допоміжна: створити ViberListing зі стану потоку водія та опційних приміток */
async function createDriverListingFromState(
  chatId: string,
  state: DriverRideFlowState,
  notes: string | null,
  senderName: string | null
): Promise<void> {
  const phone = state.phone;
  if (!phone || !state.route || !state.date) {
    await bot?.sendMessage(chatId, '❌ Не вистачає даних. Почніть знову: /adddriverride');
    return;
  }
  const nameFromDb = await getNameByPhone(phone);
  const resolvedSenderName = nameFromDb ?? senderName;
  const person = await findOrCreatePersonByPhone(phone, { fullName: resolvedSenderName ?? undefined });
  const date = new Date(state.date);
  const { listing } = await createOrMergeViberListing({
    rawMessage: `[Бот] ${state.route} ${state.date} ${state.departureTime ?? ''} ${state.seats ?? ''} місць`,
    senderName: resolvedSenderName,
    listingType: 'driver',
    route: state.route,
    date,
    departureTime: state.departureTime ?? null,
    seats: state.seats ?? null,
    phone,
    notes,
    priceUah: state.priceUah ?? null,
    isActive: true,
    personId: person.id,
  });
  await sendViberListingNotificationToAdmin({
    id: listing.id,
    listingType: 'driver',
    route: listing.route,
    date: listing.date,
    departureTime: listing.departureTime,
    seats: listing.seats,
    phone: listing.phone,
    senderName: listing.senderName,
    notes: listing.notes,
    priceUah: listing.priceUah ?? undefined,
  }).catch((err) => console.error('Telegram Viber notify:', err));
  await bot?.sendMessage(
    chatId,
    '✅ <b>Поїздку додано!</b>\n\n' +
    `🛣 ${getRouteName(state.route)}\n` +
    `📅 ${formatDate(date)}\n` +
    (state.departureTime ? `🕐 ${state.departureTime}\n` : '') +
    (state.seats != null ? `🎫 ${state.seats} місць\n` : '') +
    (state.priceUah != null ? `💰 ${state.priceUah} грн\n` : '') +
    (notes ? `📝 ${notes}\n` : '') +
    '\nОголошення опубліковано. Адмін отримав сповіщення.',
    { parse_mode: 'HTML' }
  );
  await notifyMatchingPassengersForNewDriver(listing, chatId);
}

/** Допоміжна: створити ViberListing (пасажир) зі стану потоку. Кількість місць не збираємо. */
async function createPassengerListingFromState(
  chatId: string,
  state: PassengerRideFlowState,
  notes: string | null,
  senderName: string | null
): Promise<void> {
  const phone = state.phone;
  if (!phone || !state.route || !state.date) {
    await bot?.sendMessage(chatId, '❌ Не вистачає даних. Почніть знову: /addpassengerride');
    return;
  }
  const nameFromDb = await getNameByPhone(phone);
  const resolvedSenderName = nameFromDb ?? senderName;
  const person = await findOrCreatePersonByPhone(phone, { fullName: resolvedSenderName ?? undefined });
  const date = new Date(state.date);
  const { listing } = await createOrMergeViberListing({
    rawMessage: `[Бот-пасажир] ${state.route} ${state.date} ${state.departureTime ?? ''}`,
    senderName: resolvedSenderName,
    listingType: 'passenger',
    route: state.route,
    date,
    departureTime: state.departureTime ?? null,
    seats: null,
    phone,
    notes,
    isActive: true,
    personId: person.id,
  });
  await sendViberListingNotificationToAdmin({
    id: listing.id,
    listingType: 'passenger',
    route: listing.route,
    date: listing.date,
    departureTime: listing.departureTime,
    seats: listing.seats,
    phone: listing.phone,
    senderName: listing.senderName,
    notes: listing.notes
  }).catch((err) => console.error('Telegram Viber notify:', err));
  await bot?.sendMessage(
    chatId,
    '✅ <b>Запит на поїздку додано!</b>\n\n' +
    `🛣 ${getRouteName(state.route)}\n` +
    `📅 ${formatDate(date)}\n` +
    (state.departureTime ? `🕐 ${state.departureTime}\n` : '') +
    (notes ? `📝 ${notes}\n` : '') +
    '\nЯкщо з\'явиться відповідний водій, ми сповістимо вас.',
    { parse_mode: 'HTML' }
  );
  await notifyMatchingDriversForNewPassenger(listing, chatId);
}

/** Парсить "HH:MM" у хвилини від початку доби; якщо невалідно — null. */
function parseClockToMinutes(hoursRaw: string, minutesRaw: string): number | null {
  const h = Number(hoursRaw);
  const m = Number(minutesRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Нормалізує час у інтервал [start, end] хвилин; "17:40" => [17:40,17:40], "17:05-18:00" => [17:05,18:00]. */
function parseTimeRangeForMatch(t: string | null): { start: number; end: number } | null {
  if (!t || !t.trim()) return null;
  const normalized = t.trim().replace(/[–—]/g, '-');

  const rangeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (rangeMatch) {
    const start = parseClockToMinutes(rangeMatch[1], rangeMatch[2]);
    const end = parseClockToMinutes(rangeMatch[3], rangeMatch[4]);
    if (start == null || end == null) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const pointMatch = normalized.match(/(\d{1,2}):(\d{2})/);
  if (!pointMatch) return null;
  const point = parseClockToMinutes(pointMatch[1], pointMatch[2]);
  if (point == null) return null;
  return { start: point, end: point };
}

/** Чи збігається час: обидва задані і їхні часові інтервали перетинаються. */
type MatchType = 'exact' | 'approximate' | 'same_day';

const EXACT_MATCH_TOLERANCE_MINUTES = 45;
const APPROX_MATCH_TOLERANCE_MINUTES = 120;

function rangesOverlapWithTolerance(
  a: { start: number; end: number },
  b: { start: number; end: number },
  toleranceMinutes: number
): boolean {
  const aStart = a.start - toleranceMinutes;
  const aEnd = a.end + toleranceMinutes;
  const bStart = b.start - toleranceMinutes;
  const bEnd = b.end + toleranceMinutes;
  return aStart <= bEnd && bStart <= aEnd;
}

function isExactTimeMatch(timeA: string | null, timeB: string | null): boolean {
  const a = parseTimeRangeForMatch(timeA);
  const b = parseTimeRangeForMatch(timeB);
  if (!a || !b) return false;
  return rangesOverlapWithTolerance(a, b, EXACT_MATCH_TOLERANCE_MINUTES);
}

/** Чи є приблизний збіг часу (перетин з допуском ±2 години). */
function isApproximateTimeMatch(timeA: string | null, timeB: string | null): boolean {
  const a = parseTimeRangeForMatch(timeA);
  const b = parseTimeRangeForMatch(timeB);
  if (!a || !b) return false;
  return rangesOverlapWithTolerance(a, b, APPROX_MATCH_TOLERANCE_MINUTES);
}

/** Класифікація збігу часу: точний (±45 хв), приблизний (±2 год), або лише той самий день. */
function resolveMatchType(timeA: string | null, timeB: string | null): MatchType {
  if (isExactTimeMatch(timeA, timeB)) return 'exact';
  if (isApproximateTimeMatch(timeA, timeB)) return 'approximate';
  return 'same_day';
}

/** Діапазон хвилин від початку доби для фільтра /allrides по часу. */
const ALLRIDES_TIME_SLOTS = {
  morning: { start: 0, end: 12 * 60 },           // до 12:00
  afternoon: { start: 12 * 60, end: 18 * 60 },  // 12:00–18:00
  evening: { start: 18 * 60, end: 24 * 60 },    // після 18:00
} as const;

function allridesListingMatchesTimeSlot(departureTime: string | null, slot: keyof typeof ALLRIDES_TIME_SLOTS): boolean {
  const range = parseTimeRangeForMatch(departureTime);
  if (!range) return false; // без часу не показуємо в слоті
  const { start: s, end: e } = ALLRIDES_TIME_SLOTS[slot];
  return range.start < e && range.end > s;
}

/** Одна дата (YYYY-MM-DD) для порівняння. */
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Знайти активні оголошення пасажирів, що збігаються по маршруту та даті з оголошенням водія. */
async function findMatchingPassengersForDriver(driverListing: {
  route: string;
  date: Date;
  departureTime: string | null;
}): Promise<Array<{ listing: { id: number; route: string; date: Date; departureTime: string | null; phone: string; senderName: string | null; notes: string | null }; matchType: MatchType }>> {
  const dateKey = toDateKey(driverListing.date);
  const passengers = await tgPrisma.viberListing.findMany({
    where: {
      listingType: 'passenger',
      isActive: true,
      route: driverListing.route,
      date: {
        gte: new Date(dateKey + 'T00:00:00.000Z'),
        lt: new Date(new Date(dateKey).getTime() + 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const driverTime = driverListing.departureTime;
  return passengers.map((p) => {
    const matchType = resolveMatchType(driverTime, p.departureTime);
    return { listing: p, matchType };
  });
}

/** Знайти активні оголошення водіїв, що збігаються по маршруту та даті з оголошенням пасажира. */
async function findMatchingDriversForPassenger(passengerListing: {
  route: string;
  date: Date;
  departureTime: string | null;
}): Promise<Array<{ listing: { id: number; route: string; date: Date; departureTime: string | null; seats: number | null; phone: string; senderName: string | null; notes: string | null }; matchType: MatchType }>> {
  const dateKey = toDateKey(passengerListing.date);
  const drivers = await tgPrisma.viberListing.findMany({
    where: {
      listingType: 'driver',
      isActive: true,
      route: passengerListing.route,
      date: {
        gte: new Date(dateKey + 'T00:00:00.000Z'),
        lt: new Date(new Date(dateKey).getTime() + 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const passengerTime = passengerListing.departureTime;
  return drivers.map((d) => {
    const matchType = resolveMatchType(passengerTime, d.departureTime);
    return { listing: d, matchType };
  });
}

export type SendMatchMessageToPersonStub = (
  phone: string,
  messageHtml: string,
  botOptions?: { replyMarkup?: TelegramBot.InlineKeyboardMarkup; forceBotOnly?: boolean }
) => Promise<{ sent: boolean; via: 'bot' | 'user' | 'none' }>;

let sendMatchMessageToPersonTestStub: SendMatchMessageToPersonStub | null = null;

/** Юніт-тести: підміна доставки match-повідомлень (інакше без бота завжди failed). */
export function setSendMatchMessageToPersonForTests(stub: SendMatchMessageToPersonStub | null): void {
  sendMatchMessageToPersonTestStub = stub;
}

async function sendMatchMessageToPerson(
  phone: string,
  messageHtml: string,
  botOptions?: { replyMarkup?: TelegramBot.InlineKeyboardMarkup; forceBotOnly?: boolean }
): Promise<{ sent: boolean; via: 'bot' | 'user' | 'none' }> {
  if (sendMatchMessageToPersonTestStub) {
    return sendMatchMessageToPersonTestStub(phone, messageHtml, botOptions);
  }
  const normalizedPhone = normalizePhone(phone);
  const chatId = await getChatIdByPhone(phone);
  if (chatId && bot) {
    let botSendErr: unknown = null;
    const sent = await bot
      .sendMessage(chatId, messageHtml, {
        parse_mode: 'HTML',
        ...(botOptions?.replyMarkup ? { reply_markup: botOptions.replyMarkup } : {}),
      })
      .then(() => true)
      .catch((e: unknown) => {
        botSendErr = e;
        return false;
      });
    if (!sent && botSendErr) {
      await handleTelegramBotBlockedFromOutboundSend(tgPrisma, botSendErr, {
        chatId,
        normalizedPhone,
      });
    }
    if (sent) return { sent: true, via: 'bot' };
  }
  if (botOptions?.forceBotOnly) return { sent: false, via: 'none' };

  if (!isTelegramUserSenderEnabled()) return { sent: false, via: 'none' };
  const person = await getPersonByPhone(phone).catch(() => null);
  const ok = await sendMessageViaUserAccount(phone, messageHtml, {
    telegramUsername: person?.telegramUsername ?? null,
  }).catch(() => false);
  return ok ? { sent: true, via: 'user' } : { sent: false, via: 'none' };
}

async function sleepTelethonBatchDelay(): Promise<void> {
  if (isTelegramUserSenderEnabled()) {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

type CounterpartNotifyOutcome =
  | { kind: 'skipped' }
  | { kind: 'failed' }
  | { kind: 'sent'; via: 'bot' | 'user' };

/** Пасажир отримує повідомлення про водія для пари (дедуп у БД). */
export async function notifyPassengerAboutDriverPair(
  driverListing: {
    id: number;
    route: string;
    date: Date;
    departureTime: string | null;
    seats: number | null;
    phone: string;
    senderName: string | null;
    notes: string | null;
  },
  passengerListing: { id: number; phone: string },
  matchType: MatchType
): Promise<CounterpartNotifyOutcome> {
  const row = await tgPrisma.viberMatchPairNotification.findUnique({
    where: {
      passengerListingId_driverListingId: {
        passengerListingId: passengerListing.id,
        driverListingId: driverListing.id,
      },
    },
  });
  if (row?.passengerNotifiedAt) return { kind: 'skipped' };

  const label =
    matchType === 'exact'
      ? '🎯 Пряме співпадіння (час близький, ±45 хв)'
      : matchType === 'approximate'
        ? '📌 Приблизне співпадіння (час близький, ±2 год)'
        : '🗓️ Поїздки цього дня';
  const msg =
    `${label}: з\'явився водій на ваш маршрут і дату.\n\n` +
    `🛣 ${getRouteName(driverListing.route)}\n` +
    `📅 ${formatDate(driverListing.date)}\n` +
    (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
    (driverListing.seats != null ? `🎫 ${driverListing.seats} місць\n` : '') +
    `👤 ${driverListing.senderName ?? 'Водій'}\n` +
    `📞 ${formatPhoneTelLink(driverListing.phone)}` +
    (driverListing.notes ? `\n📝 ${driverListing.notes}` : '') +
    (matchType === 'exact'
      ? '\n\n_Натисніть кнопку нижче — водій отримає запит і матиме 1 годину на підтвердження._'
      : '');

  const replyMarkup =
    matchType === 'exact'
      ? {
          inline_keyboard: [
            [
              {
                text: `🎫 Забронювати у ${driverListing.senderName ?? 'водія'}`,
                callback_data: `vibermatch_book_${passengerListing.id}_${driverListing.id}`,
              },
            ],
          ],
        }
      : undefined;

  const result = await sendMatchMessageToPerson(
    passengerListing.phone,
    msg,
    matchType === 'same_day'
      ? { ...(replyMarkup ? { replyMarkup } : {}), forceBotOnly: true }
      : (replyMarkup ? { replyMarkup } : undefined)
  );
  if (!result.sent) return { kind: 'failed' };

  await tgPrisma.viberMatchPairNotification.upsert({
    where: {
      passengerListingId_driverListingId: {
        passengerListingId: passengerListing.id,
        driverListingId: driverListing.id,
      },
    },
    create: {
      passengerListingId: passengerListing.id,
      driverListingId: driverListing.id,
      passengerNotifiedAt: new Date(),
    },
    update: { passengerNotifiedAt: new Date() },
  });
  return { kind: 'sent', via: result.via === 'user' ? 'user' : 'bot' };
}

/** Водій отримує повідомлення про пасажира для пари (дедуп у БД). */
export async function notifyDriverAboutPassengerPair(
  driverListing: { id: number; phone: string },
  passengerListing: {
    id: number;
    route: string;
    date: Date;
    departureTime: string | null;
    phone: string;
    senderName: string | null;
    notes: string | null;
  },
  matchType: MatchType
): Promise<CounterpartNotifyOutcome> {
  const row = await tgPrisma.viberMatchPairNotification.findUnique({
    where: {
      passengerListingId_driverListingId: {
        passengerListingId: passengerListing.id,
        driverListingId: driverListing.id,
      },
    },
  });
  if (row?.driverNotifiedAt) return { kind: 'skipped' };

  const label =
    matchType === 'exact'
      ? '🎯 Пряме співпадіння (час близький, ±45 хв)'
      : matchType === 'approximate'
        ? '📌 Приблизне співпадіння (час близький, ±2 год)'
        : '🗓️ Поїздки цього дня';
  const msg =
    `${label}: новий запит пасажира на ваш маршрут і дату.\n\n` +
    `🛣 ${getRouteName(passengerListing.route)}\n` +
    `📅 ${formatDate(passengerListing.date)}\n` +
    (passengerListing.departureTime ? `🕐 ${passengerListing.departureTime}\n` : '') +
    `👤 ${passengerListing.senderName ?? 'Пасажир'}\n` +
    `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
    (passengerListing.notes ? `\n📝 ${passengerListing.notes}` : '');

  const replyMarkup =
    matchType === 'exact'
      ? {
          inline_keyboard: [
            [
              {
                text: `🤝 Запропонувати ${passengerListing.senderName ?? 'пасажиру'}`,
                callback_data: `vibermatch_book_driver_${driverListing.id}_${passengerListing.id}`,
              },
            ],
          ],
        }
      : undefined;

  const result = await sendMatchMessageToPerson(
    driverListing.phone,
    msg,
    matchType === 'same_day'
      ? { ...(replyMarkup ? { replyMarkup } : {}), forceBotOnly: true }
      : (replyMarkup ? { replyMarkup } : undefined)
  );
  if (!result.sent) return { kind: 'failed' };

  await tgPrisma.viberMatchPairNotification.upsert({
    where: {
      passengerListingId_driverListingId: {
        passengerListingId: passengerListing.id,
        driverListingId: driverListing.id,
      },
    },
    create: {
      passengerListingId: passengerListing.id,
      driverListingId: driverListing.id,
      driverNotifiedAt: new Date(),
    },
    update: { driverNotifiedAt: new Date() },
  });
  return { kind: 'sent', via: result.via === 'user' ? 'user' : 'bot' };
}

async function sendAdminNewListingMatchReport(
  listingId: number,
  listingType: 'driver' | 'passenger',
  pairCount: number,
  stats: { sent: number; skipped: number; failed: number }
): Promise<void> {
  if (pairCount === 0 || !bot || !adminChatId) return;
  // Після merge усі пари часто лише «skipped» — не засмічуємо адмін-чат
  if (stats.sent === 0 && stats.failed === 0) return;
  const typeUa = listingType === 'driver' ? 'водій' : 'пасажир';
  const targetUa = listingType === 'driver' ? 'пасажирів' : 'водіїв';
  await bot
    .sendMessage(
      adminChatId,
      `🔔 <b>Збіги після збереження оголошення</b> #${listingId} (${typeUa})\n\n` +
        `• Пар по маршруту/даті: ${pairCount}\n` +
        `• Сповіщено ${targetUa} (бот або ваш акаунт): надіслано ${stats.sent}, уже отримували цю пару: ${stats.skipped}, не доставлено: ${stats.failed}`,
      { parse_mode: 'HTML' }
    )
    .catch(() => {});
}

/** Після додавання поїздки водія: сповістити водія та всіх пасажирів, що збігаються. */
/** Викликати після створення оголошення водія (бот або адмінка). driverChatId — якщо є (з бота), сповістимо водія про збіги. */
export async function notifyMatchingPassengersForNewDriver(
  driverListing: { id: number; route: string; date: Date; departureTime: string | null; seats: number | null; phone: string; senderName: string | null; notes: string | null },
  driverChatId?: string | null
): Promise<void> {
  const matches = await findMatchingPassengersForDriver(driverListing);
  if (matches.length === 0) return;
  const exactList = matches.filter((m) => m.matchType === 'exact').map((m) => m.listing);
  const approxList = matches.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
  const sameDayList = matches.filter((m) => m.matchType === 'same_day').map((m) => m.listing);

  if (driverChatId && exactList.length > 0) {
    const lines = exactList.map((p) => {
      const time = p.departureTime ?? '—';
      return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
    }).join('\n');
    const confirmButtons = exactList.map((p) => ([
      { text: `🤝 Запропонувати ${p.senderName ?? 'пасажиру'}`, callback_data: `vibermatch_book_driver_${driverListing.id}_${p.id}` }
    ]));
    await bot?.sendMessage(
      driverChatId,
      '🎯 <b>Пряме співпадіння: знайшли пасажирів на вашу дату та маршрут (перетин з допуском ±45 хв)</b>\n\n' +
        lines +
        '\n\n_Натисніть кнопку, щоб надіслати пасажиру запит на підтвердження (1 година)._',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: confirmButtons } }
    ).catch(() => {});
  }
  if (driverChatId && approxList.length > 0) {
    const lines = approxList.map((p) => {
      const time = p.departureTime ?? '—';
      return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      driverChatId,
      '📌 <b>Приблизне співпадіння (перетин з допуском ±2 год)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
  if (driverChatId && sameDayList.length > 0) {
    const lines = sameDayList.map((p) => {
      const time = p.departureTime ?? '—';
      return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      driverChatId,
      '🗓️ <b>Поїздки цього дня (маршрут і дата збігаються, але час не перетинається навіть з допуском ±2 год)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const { listing: p, matchType } of matches) {
    const out = await notifyPassengerAboutDriverPair(driverListing, { id: p.id, phone: p.phone }, matchType);
    if (out.kind === 'sent') sent++;
    else if (out.kind === 'skipped') skipped++;
    else failed++;
    await sleepTelethonBatchDelay();
  }

  await sendAdminNewListingMatchReport(driverListing.id, 'driver', matches.length, { sent, skipped, failed });
}

/** Викликати після створення запиту пасажира (бот або адмінка). passengerChatId — якщо є (з бота), сповістимо пасажира про збіги. */
export async function notifyMatchingDriversForNewPassenger(
  passengerListing: { id: number; route: string; date: Date; departureTime: string | null; phone: string; senderName: string | null; notes: string | null },
  passengerChatId?: string | null
): Promise<void> {
  const matches = await findMatchingDriversForPassenger(passengerListing);
  if (matches.length === 0) return;
  const exactList = matches.filter((m) => m.matchType === 'exact').map((m) => m.listing);
  const approxList = matches.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
  const sameDayList = matches.filter((m) => m.matchType === 'same_day').map((m) => m.listing);

  if (passengerChatId && exactList.length > 0) {
    const lines = exactList.map((d) => {
      const time = d.departureTime ?? '—';
      return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
    }).join('\n');
    const bookButtons = exactList.map((d) => [
      { text: `🎫 Забронювати у ${d.senderName ?? 'водія'}`, callback_data: `vibermatch_book_${passengerListing.id}_${d.id}` }
    ]);
    await bot?.sendMessage(
      passengerChatId,
      '🎯 <b>Пряме співпадіння: знайшли водіїв на вашу дату та маршрут (перетин з допуском ±45 хв)</b>\n\n' + lines + '\n\n_Натисніть кнопку нижче — водій отримає запит і матиме 1 год на підтвердження._',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: bookButtons } }
    ).catch(() => {});
  }
  if (passengerChatId && approxList.length > 0) {
    const lines = approxList.map((d) => {
      const time = d.departureTime ?? '—';
      return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      passengerChatId,
      '📌 <b>Приблизне співпадіння (перетин з допуском ±2 год)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
  if (passengerChatId && sameDayList.length > 0) {
    const lines = sameDayList.map((d) => {
      const time = d.departureTime ?? '—';
      return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      passengerChatId,
      '🗓️ <b>Поїздки цього дня (маршрут і дата збігаються, але час не перетинається навіть з допуском ±2 год)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const { listing: d, matchType } of matches) {
    const out = await notifyDriverAboutPassengerPair({ id: d.id, phone: d.phone }, passengerListing, matchType);
    if (out.kind === 'sent') sent++;
    else if (out.kind === 'skipped') skipped++;
    else failed++;
    await sleepTelethonBatchDelay();
  }

  await sendAdminNewListingMatchReport(passengerListing.id, 'passenger', matches.length, { sent, skipped, failed });
}

// --- Робота з Person (єдина база людей) ---

/** Знайти людину за нормалізованим номером телефону */
export const getPersonByPhone = async (phone: string) => {
  const normalized = normalizePhone(phone);
  return tgPrisma.person.findUnique({
    where: { phoneNormalized: normalized }
  });
};

/** Знайти людину за Telegram userId або chatId */
export const getPersonByTelegram = async (userId: string, chatId: string) => {
  const or: Array<{ telegramUserId: string } | { telegramChatId: string }> = [];
  if (userId && userId !== '0' && userId.trim() !== '') or.push({ telegramUserId: userId });
  if (chatId && chatId !== '0' && chatId.trim() !== '') or.push({ telegramChatId: chatId });
  if (or.length === 0) return null;
  return tgPrisma.person.findFirst({ where: { OR: or } });
};

/**
 * Майбутні бронювання, де у користувача забронювали як у водія (для /mybookings).
 * Повертає бронювання з source viber_match по оголошеннях водія цього користувача.
 */
export const getDriverFutureBookingsForMybookings = async (
  userId: string,
  chatId: string,
  sinceDate: Date
): Promise<Array<{ id: number; route: string; date: Date; departureTime: string; seats: number; name: string; phone: string }>> => {
  const person = await getPersonByTelegram(userId, chatId);
  if (!person) return [];
  const myDriverListingIds = (await tgPrisma.viberListing.findMany({
    where: { personId: person.id, listingType: 'driver' },
    select: { id: true }
  })).map((l) => l.id);
  if (myDriverListingIds.length === 0) return [];
  return tgPrisma.booking.findMany({
    where: {
      viberListingId: { in: myDriverListingIds },
      date: { gte: sinceDate }
    },
    orderBy: { date: 'asc' },
    take: 10
  });
};

/**
 * Знайти або створити Person за номером; опційно оновити fullName та Telegram.
 * Повертає Person (phoneNormalized для відображення можна форматувати окремо).
 */
export const findOrCreatePersonByPhone = async (
  phone: string,
  options?: {
    fullName?: string | null;
    telegramChatId?: string | null;
    telegramUserId?: string | null;
    telegramUsername?: string | null;
  }
): Promise<{ id: number; phoneNormalized: string; fullName: string | null }> => {
  const normalized = normalizePhone(phone);
  const fullName = options?.fullName != null && String(options.fullName).trim() !== ''
    ? String(options.fullName).trim()
    : null;
  const person = await tgPrisma.person.upsert({
    where: { phoneNormalized: normalized },
    create: {
      phoneNormalized: normalized,
      fullName,
      telegramChatId: options?.telegramChatId ?? null,
      telegramUserId: options?.telegramUserId ?? null,
      telegramUsername: options?.telegramUsername ?? null,
    },
    update: {
      ...(fullName != null && { fullName }),
      ...(options?.telegramChatId != null && { telegramChatId: options.telegramChatId }),
      ...(options?.telegramUserId != null && { telegramUserId: options.telegramUserId }),
      ...(options?.telegramUsername != null && { telegramUsername: options.telegramUsername }),
    },
  });
  return { id: person.id, phoneNormalized: person.phoneNormalized, fullName: person.fullName };
};

/** Оновити Telegram у Person та у всіх бронюваннях з тим же номером (і привʼязати їх до Person). */
async function updatePersonAndBookingsTelegram(
  personId: number,
  chatId: string,
  userId: string
): Promise<void> {
  await tgPrisma.person.update({
    where: { id: personId },
    data: { telegramChatId: chatId, telegramUserId: userId },
  });
  const person = await tgPrisma.person.findUnique({ where: { id: personId }, select: { phoneNormalized: true } });
  if (!person) return;
  const allBookings = await tgPrisma.booking.findMany({ select: { id: true, phone: true, personId: true } });
  const samePhone = allBookings.filter((b) => normalizePhone(b.phone) === person.phoneNormalized);
  for (const b of samePhone) {
    await tgPrisma.booking.update({
      where: { id: b.id },
      data: { telegramChatId: chatId, telegramUserId: userId, personId },
    });
  }
}

/**
 * Отримати ім'я (ім'я + прізвище): спочатку з Person, інакше з Booking.
 */
export const getNameByPhone = async (phone: string): Promise<string | null> => {
  const person = await getPersonByPhone(phone);
  if (person?.fullName?.trim()) return person.fullName.trim();
  const bookings = await tgPrisma.booking.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { phone: true, name: true },
  });
  const match = bookings.find((b) => normalizePhone(b.phone) === normalizePhone(phone));
  return match?.name?.trim() ?? null;
};

/**
 * Отримати номер телефону користувача: спочатку з Person за Telegram, інакше з Booking.
 */
export const getPhoneByTelegramUser = async (userId: string, chatId: string): Promise<string | null> => {
  const person = await getPersonByTelegram(userId, chatId);
  if (person) return person.phoneNormalized;
  const booking = await tgPrisma.booking.findFirst({
    where: {
      OR: [{ telegramUserId: userId }, { telegramChatId: chatId }],
    },
    orderBy: { createdAt: 'desc' },
    select: { phone: true },
  });
  return booking?.phone ?? null;
};

/**
 * Форматування дати для українського формату
 */
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

/**
 * Формат номера для відображення в Telegram: +380(67)4476844 (без пропусків, оператор у дужках).
 * Український формат 380XXXXXXXXX: 38 + 0 (трак) + XX (оператор 2 цифри) + 7 цифр.
 */
function formatPhoneDisplay(phone: string | null | undefined): string {
  const normalized = normalizePhone(phone ?? '');
  if (normalized.length === 12 && normalized.startsWith('38')) {
    return `+380(${normalized.slice(3, 5)})${normalized.slice(5)}`;
  }
  if (normalized.length >= 10) return '+' + normalized;
  return (phone ?? '').trim() || '—';
}

/** Короткий номер для кнопки: 097…5645 (0XX + останні 4 цифри) */
function formatShortPhoneForButton(phone: string | null | undefined): string {
  const normalized = normalizePhone(phone ?? '');
  if (normalized.length >= 7) {
    const prefix = normalized.startsWith('38') ? '0' + normalized.slice(2, 5) : normalized.slice(0, 3);
    const last4 = normalized.slice(-4);
    return `${prefix}…${last4}`;
  }
  return normalized ? normalized.slice(-4) || '—' : '—';
}

/** Обрізати текст для кнопки Telegram (ліміт ~64 байти) */
function truncateForButton(name: string, maxLen: number = 18): string {
  const t = (name || '').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}

/**
 * Клікабельний номер телефону для Telegram (HTML): <a href="tel:+38...">+380(XX)YYYYYYY</a>
 */
function formatPhoneTelLink(phone: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (!p) return '—';
  const digits = '+' + normalizePhone(p);
  const display = formatPhoneDisplay(p);
  const displayEscaped = display.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href="tel:${digits}">${displayEscaped}</a>`;
}

/**
 * Отримання назви маршруту
 */
const getRouteName = (route: string): string => {
  if (route.includes('Kyiv-Malyn')) {
    if (route.includes('Irpin')) return 'Київ → Малин (через Ірпінь)';
    if (route.includes('Bucha')) return 'Київ → Малин (через Бучу)';
    return 'Київ → Малин';
  }
  if (route.includes('Malyn-Kyiv')) {
    if (route.includes('Irpin')) return 'Малин → Київ (через Ірпінь)';
    if (route.includes('Bucha')) return 'Малин → Київ (через Бучу)';
    return 'Малин → Київ';
  }
  if (route.includes('Malyn-Zhytomyr')) return 'Малин → Житомир';
  if (route.includes('Zhytomyr-Malyn')) return 'Житомир → Малин';
  if (route.includes('Korosten-Malyn')) return 'Коростень → Малин';
  if (route.includes('Malyn-Korosten')) return 'Малин → Коростень';
  return route;
};

/**
 * Відправка повідомлення про нове бронювання адміністратору.
 * Тільки для маршруток (schedule). Для попуток (viber_match) адміну шле окреме повідомлення в обробнику.
 */
export const sendBookingNotificationToAdmin = async (booking: {
  id: number;
  route: string;
  date: Date;
  departureTime: string;
  seats: number;
  name: string;
  phone: string;
  source?: string;
}) => {
  if (!bot || !adminChatId) {
    console.log('⚠️ Telegram bot або admin chat ID не налаштовано');
    return;
  }
  const isViberRide = booking.source === 'viber_match';

  try {
    const message = `
🎫 <b>Нове бронювання #${booking.id}</b>${isViberRide ? ' · 🚗 Попутка' : ''}

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}

👤 <b>Клієнт:</b> ${booking.name}
📞 <b>Телефон:</b> ${formatPhoneTelLink(booking.phone)}

${isViberRide ? '✅ <i>Попутка підтверджена</i>' : '✅ <i>Заявку прийнято</i> (технічний режим)'}
    `.trim();

    await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram повідомлення надіслано адміну (booking #${booking.id})`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram повідомлення адміну:', error);
  }
};

/**
 * Сповіщення адміну про першу реєстрацію в Telegram (ID раніше не був прив'язаний).
 */
function sendNewTelegramRegistrationNotificationToAdmin(
  userId: string,
  phone: string,
  name: string | null
): void {
  if (!bot || !adminChatId) return;
  const displayName = name?.trim() || '—';
  const message = `
🆕 <b>Нова реєстрація в Telegram</b>

👤 Ім'я: ${displayName}
📞 Телефон: ${formatPhoneTelLink(phone)}
🆔 Telegram ID: <code>${userId}</code>

<i>Раніше цей ID не був прив'язаний до жодного акаунту.</i>
  `.trim();
  bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' }).catch((err) => console.error('Notify admin new Telegram reg:', err));
}

/**
 * Відправка повідомлення адміну про нове Viber оголошення (поїздку з чату)
 */
export const sendViberListingNotificationToAdmin = async (listing: {
  id: number;
  listingType: string;
  route: string;
  date: Date | string;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  senderName: string | null;
  notes: string | null;
  priceUah?: number | null;
}) => {
  if (!bot || !adminChatId) {
    console.log('⚠️ Telegram bot або admin chat ID не налаштовано');
    return;
  }

  try {
    const dateStr = listing.date instanceof Date
      ? formatDate(listing.date)
      : (listing.date && listing.date.slice(0, 10))
        ? formatDate(new Date(listing.date))
        : '—';
    const typeEmoji = listing.listingType === 'driver' ? '🚗' : '👤';
    const typeLabel = listing.listingType === 'driver' ? 'Водій' : 'Пасажир';
    const message = `
📱 <b>Нове Viber оголошення #${listing.id}</b>

${typeEmoji} <b>Тип:</b> ${typeLabel}
🛣 <b>Маршрут:</b> ${listing.route}
📅 <b>Дата:</b> ${dateStr}
🕐 <b>Час:</b> ${listing.departureTime ?? '—'}
${listing.seats != null ? `🎫 <b>Місця:</b> ${listing.seats}\n` : ''}${listing.priceUah != null ? `💰 <b>Ціна:</b> ${listing.priceUah} грн\n` : ''}
📞 <b>Телефон:</b> ${formatPhoneTelLink(listing.phone)}
${listing.senderName ? `👤 <b>Відправник:</b> ${listing.senderName}\n` : ''}${listing.notes ? `📝 <b>Примітки:</b> ${listing.notes}` : ''}
    `.trim();

    await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram: адміну надіслано сповіщення про Viber оголошення #${listing.id}`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram сповіщення про Viber оголошення:', error);
  }
};

/**
 * Спроба надіслати автору оголошення повідомлення про публікацію на платформі.
 * Працює тільки якщо номер телефону вже є в базі (користувач колись брався через сайт/бота і прив’язав Telegram).
 * Якщо chatId по телефону не знайдено — нічого не відправляємо (без помилок).
 * При помилці "chat not found" — обнуляємо прив'язку до бота і пробуємо особистий акаунт.
 */
/** Обнулити прив'язку до бота та параметри останньої комунікації для номера (Person + Bookings). */
async function resetTelegramBindingForPhone(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const person = await getPersonByPhone(phone);
  if (person) {
    await tgPrisma.person.update({
      where: { id: person.id },
      data: { telegramChatId: null, telegramUserId: null, telegramPromoSentAt: null },
    });
    await tgPrisma.booking.updateMany({
      where: { personId: person.id },
      data: { telegramChatId: null, telegramUserId: null },
    });
  }
  const bookingsWithTg = await tgPrisma.booking.findMany({
    where: { telegramChatId: { not: null } },
    select: { id: true, phone: true },
  });
  const idsToClear = bookingsWithTg.filter((b) => normalizePhone(b.phone) === normalized).map((b) => b.id);
  if (idsToClear.length > 0) {
    await tgPrisma.booking.updateMany({
      where: { id: { in: idsToClear } },
      data: { telegramChatId: null, telegramUserId: null },
    });
  }
}

export const sendViberListingConfirmationToUser = async (
  phone: string,
  listing: {
    id: number;
    route: string;
    date: Date | string;
    departureTime: string | null;
    seats: number | null;
    listingType: string;
    priceUah?: number | null;
  }
) => {
  const trimmed = phone?.trim();
  if (!trimmed) return;

  try {
    let chatId = await getChatIdByPhone(trimmed);
    let botSendFailedChatNotFound = false;

    if (chatId && bot) {
      try {
        const message = buildViberListingConfirmationMessage(listing, { addSubscribeInstruction: false });
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram: автору Viber оголошення #${listing.id} надіслано сповіщення про публікацію (бот)`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isChatNotFound =
          /chat not found|400 Bad Request|bad request: chat|ETELEGRAM/i.test(msg) ||
          (msg.includes('400') && msg.toLowerCase().includes('chat'));
        if (isChatNotFound) {
          await resetTelegramBindingForPhone(trimmed);
          console.log(`ℹ️ Viber оголошення #${listing.id}: chat not found для ${trimmed}, прив'язку Telegram скинуто, пробуємо особистий акаунт`);
          botSendFailedChatNotFound = true;
          chatId = null;
        } else {
          throw err;
        }
      }
    }

    if (!chatId || botSendFailedChatNotFound) {
      const person = await getPersonByPhone(trimmed);
      const PROMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 днів
      const shouldSendPromo =
        person &&
        isTelegramUserSenderEnabled() &&
        (!person.telegramPromoSentAt || Date.now() - person.telegramPromoSentAt.getTime() > PROMO_COOLDOWN_MS);
      if (shouldSendPromo) {
        const promoMessage = buildViberListingConfirmationMessage(listing, { addSubscribeInstruction: true });
        const phoneForApi = normalizePhone(trimmed);
        const sent = await sendMessageViaUserAccount(phoneForApi, promoMessage, {
          telegramUsername: person.telegramUsername,
        });
        if (sent) {
          await tgPrisma.person.update({
            where: { id: person.id },
            data: { telegramPromoSentAt: new Date() },
          });
          console.log(`✅ Telegram: автору Viber оголошення #${listing.id} надіслано одноразове промо від вашого акаунта, Person.telegramPromoSentAt оновлено`);
        }
        return;
      }
      if (!person?.telegramPromoSentAt) {
        console.log(`ℹ️ Viber оголошення #${listing.id}: по телефону ${trimmed} Telegram не знайдено, пропускаємо сповіщення`);
      }
    }
  } catch (error) {
    console.error('❌ Помилка відправки сповіщення автору Viber оголошення:', error);
  }
};


/** Чи налаштовано відправку одноразового промо від вашого акаунта (Telethon): сесія + API */
function isTelegramUserSenderEnabled(): boolean {
  const session = process.env.TELEGRAM_USER_SESSION_PATH;
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  return !!(session?.trim() && apiId?.trim() && apiHash?.trim());
}

/** Текст сповіщення про публікацію оголошення (спільний для бота та одноразового промо). */
function buildViberListingConfirmationMessage(
  listing: {
    route: string;
    date: Date | string;
    departureTime: string | null;
    seats: number | null;
    listingType: string;
    priceUah?: number | null;
  },
  options: { addSubscribeInstruction?: boolean }
): string {
  const dateStr = listing.date instanceof Date
    ? formatDate(listing.date)
    : (listing.date && String(listing.date).slice(0, 10))
      ? formatDate(new Date(listing.date))
      : '—';
  const routeName = getRouteName(listing.route);
  const links = getTelegramScenarioLinks();
  let message = `
📱 <b>Ваше оголошення опубліковано на платформі Поїздки Київ, Житомир, Коростень ↔️ Малин</b>

🛣 <b>Маршрут:</b> ${routeName}
📅 <b>Дата:</b> ${dateStr}
${listing.departureTime ? `🕐 <b>Час:</b> ${listing.departureTime}\n` : ''}${listing.seats != null ? `🎫 <b>Місць:</b> ${listing.seats}\n` : ''}${listing.priceUah != null ? `💰 <b>Ціна:</b> ${listing.priceUah} грн\n` : ''}
Інші користувачі зможуть бачити це оголошення та зв'язатися з вами за телефоном.

<i>Дякуємо, що користуєтесь нашою платформою! 🚐</i>
Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
  if (options.addSubscribeInstruction) {
    message += `

——
<b>Щоб надалі отримувати такі сповіщення в Telegram автоматично</b>, один раз натисніть Start у нашому боті:
• як <b>водій</b>: ${links.driver}
• як <b>пасажир</b>: ${links.passenger}
Після реєстрації номера в боті ми більше не надсилатимемо листи на цей чат.`;
  }
  return message;
}

/**
 * Знайти ім'я в Telegram по номеру телефону (Python send_message.py --resolve).
 * Використовується перед збереженням Viber-оголошення/Person без імені.
 */
export async function resolveNameByPhoneFromTelegram(phone: string): Promise<string | null> {
  const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  const scriptDir = sessionPath ? path.dirname(sessionPath) : '';
  const scriptPath = path.join(scriptDir, 'send_message.py');
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!sessionPath || !apiId || !apiHash || !phone?.trim()) return null;
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  return new Promise((resolve) => {
    const child = spawnChild(pythonCmd, [scriptPath, '--resolve', phone.trim()], {
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        if (code !== 1) {
          console.error(`ℹ️ resolveNameByPhone (${phone}): код ${code}`, stderr.slice(0, 200));
        }
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
  });
}

/**
 * Знайти @username в Telegram по номеру телефону (Python send_message.py --resolve-username).
 * Повертає username без @ або null.
 */
export async function resolveUsernameByPhoneFromTelegram(phone: string): Promise<string | null> {
  const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  const scriptDir = sessionPath ? path.dirname(sessionPath) : '';
  const scriptPath = path.join(scriptDir, 'send_message.py');
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!sessionPath || !apiId || !apiHash || !phone?.trim()) return null;
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  return new Promise((resolve) => {
    const child = spawnChild(pythonCmd, [scriptPath, '--resolve-username', phone.trim()], {
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim()) as { telegramUsername?: string };
          const username = parsed.telegramUsername?.trim();
          resolve(username || null);
        } catch {
          resolve(null);
        }
      } else {
        if (code !== 1) {
          console.error(`ℹ️ resolveUsernameByPhone (${phone}): код ${code}`, stderr.slice(0, 200));
        }
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
  });
}

const TELEGRAM_TOPICS = [2, 6, 108] as const;

/**
 * Завантажити повідомлення з Telegram групи PoDoroguem через особистий акаунт (Telethon).
 * Зберігає lastMessageId по топиках — парсить тільки нові повідомлення.
 * Повертає текст у форматі "SenderName: text\n---\n" для парсингу parseTelegramMessages.
 * null = помилка, "" = успіх але немає нових повідомлень.
 */
export async function fetchTelegramGroupMessages(options?: {
  limit?: number;
  hours?: number;
  fullFetch?: boolean;
}): Promise<string | null> {
  const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  const scriptDir = sessionPath ? path.dirname(sessionPath) : '';
  const scriptPath = path.join(scriptDir, 'fetch_telegram_messages.py');
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!sessionPath || !apiId || !apiHash) return null;

  const limit = options?.limit ?? 50;
  const hours = options?.hours;
  const fullFetch = options?.fullFetch ?? false;

  let lastIds: Record<string, number> = {};
  if (!fullFetch) {
    const states = await tgPrisma.telegramFetchState.findMany();
    for (const s of states) {
      lastIds[String(s.topicId)] = s.lastMessageId;
    }
    for (const t of TELEGRAM_TOPICS) {
      if (!(String(t) in lastIds)) lastIds[String(t)] = 0;
    }
  } else {
    lastIds = { '2': 0, '6': 0, '108': 0 };
  }

  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  const args = [scriptPath, '--limit', String(limit)];
  if (hours != null && hours > 0) args.push('--hours', String(hours));
  if (fullFetch) args.push('--full');

  const result = await new Promise<string | null>((resolve) => {
    const child = spawnChild(pythonCmd, args, {
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
        TELEGRAM_LAST_IDS: JSON.stringify(lastIds),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null);
      } else {
        if (code !== 0) console.error('fetchTelegramGroupMessages:', code, stderr.slice(0, 500));
        resolve(null);
      }
    });
    child.on('error', (err) => {
      console.error('fetchTelegramGroupMessages spawn error:', err);
      resolve(null);
    });
  });

  if (result === null) return null;

  const metaIdx = result.indexOf('__LAST_IDS__');
  let messagesText = result;
  let newLastIdsJson: string | null = null;
  if (metaIdx >= 0) {
    messagesText = result.slice(0, metaIdx).trim();
    newLastIdsJson = result.slice(metaIdx + 12).trim();
  }

  if (newLastIdsJson) {
    try {
      const newLastIds = JSON.parse(newLastIdsJson) as Record<string, number>;
      for (const [topicStr, msgId] of Object.entries(newLastIds)) {
        const topicId = parseInt(topicStr, 10);
        if (Number.isNaN(topicId) || msgId <= 0) continue;
        await tgPrisma.telegramFetchState.upsert({
          where: { topicId },
          create: { topicId, lastMessageId: msgId },
          update: { lastMessageId: msgId },
        });
      }
    } catch (e) {
      console.error('fetchTelegramGroupMessages: parse LAST_IDS', e);
    }
  }

  // null = помилка, "" = успіх але немає нових повідомлень (не змішувати!)
  return messagesText;
}

/** Результат автоматичного імпорту з групи PoDoroguem */
export interface FetchAndImportResult {
  success: boolean;
  created: number;
  total: number;
  error?: string;
}

/**
 * Завантажити нові повідомлення з групи PoDoroguem і імпортувати їх у Viber listings.
 * Використовує TelegramFetchState — тільки нові повідомлення.
 * Для cron: POST /telegram/fetch-group-messages кожні 2 год.
 */
export async function fetchAndImportTelegramGroupMessages(): Promise<FetchAndImportResult> {
  const rawText = await fetchTelegramGroupMessages({ limit: 50, fullFetch: false });
  if (rawText === null) {
    return { success: false, created: 0, total: 0, error: 'Failed to fetch (check session, API, group access)' };
  }
  if (!rawText.trim()) {
    return { success: true, created: 0, total: 0 };
  }
  const parsedMessages = parseTelegramMessages(rawText);
  if (parsedMessages.length === 0) {
    return { success: true, created: 0, total: 0 };
  }
  let created = 0;
  for (let i = 0; i < parsedMessages.length; i++) {
    const { parsed, rawMessage: rawTextItem, telegramUsername: tgUsername } = parsedMessages[i];
    try {
      const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
      let senderName = nameFromDb ?? parsed.senderName ?? null;
      if (parsed.phone?.trim()) {
        const phone = parsed.phone.trim();
        const personForChat = await getPersonByPhone(phone);
        const chatIdForPerson = personForChat?.telegramChatId ?? null;
        const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
          phone,
          chatIdForPerson,
        );
        const baseCurrentName = nameFromDb;
        const { newName } = pickBestNameFromCandidates(
          baseCurrentName,
          nameFromBot,
          nameFromUser,
          nameFromOpendatabot,
        );
        if (newName?.trim()) senderName = newName.trim();
        else if (!senderName || !String(senderName).trim()) senderName = parsed.senderName ?? senderName;
      }
      const person = parsed.phone
        ? await findOrCreatePersonByPhone(parsed.phone, {
            fullName: senderName ?? undefined,
            telegramUsername: tgUsername ?? undefined,
          })
        : null;
      const { listing, isNew } = await createOrMergeViberListing({
        rawMessage: rawTextItem,
        source: 'telegram1',
        senderName: senderName ?? undefined,
        listingType: parsed.listingType,
        route: parsed.route,
        date: parsed.date,
        departureTime: parsed.departureTime,
        seats: parsed.seats,
        phone: parsed.phone,
        notes: parsed.notes,
        priceUah: parsed.price ?? undefined,
        isActive: true,
        personId: person?.id ?? undefined,
      });
      if (isNew) created++;
      if (isTelegramEnabled()) {
        await sendViberListingNotificationToAdmin({
          id: listing.id,
          listingType: listing.listingType,
          route: listing.route,
          date: listing.date,
          departureTime: listing.departureTime,
          seats: listing.seats,
          phone: listing.phone,
          senderName: listing.senderName,
          notes: listing.notes,
        }).catch((err) => console.error('Telegram notify:', err));
        if (listing.phone?.trim()) {
          sendViberListingConfirmationToUser(listing.phone, {
            id: listing.id,
            route: listing.route,
            date: listing.date,
            departureTime: listing.departureTime,
            seats: listing.seats,
            listingType: listing.listingType,
          }).catch((err) => console.error('Telegram user notify:', err));
        }
        const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
        if (listing.listingType === 'driver') {
          notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify (driver):', err),
          );
        } else if (listing.listingType === 'passenger') {
          notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) =>
            console.error('Telegram match notify (passenger):', err),
          );
        }
      }
    } catch (err) {
      console.error(`fetchAndImportTelegramGroupMessages item ${i} error:`, err);
    }
  }
  console.log(`📥 Telegram fetch: імпортовано ${created} нових з ${parsedMessages.length} повідомлень`);
  return { success: true, created, total: parsedMessages.length };
}

/**
 * Знайти ім'я ФОП за номером телефону через Opendatabot (Python run_opendatabot_phone_lookup.py).
 * Використовується як додаткове джерело імені при оновленні Person.
 */
export async function resolveNameByPhoneFromOpendatabot(phone: string): Promise<string | null> {
  if (!phone?.trim()) return null;
  const pythonCmd =
    process.env.OPENDATABOT_PYTHON?.trim() ||
    process.env.TELEGRAM_USER_PYTHON?.trim() ||
    'python3';
  const scriptPath = path.join(
    __dirname,
    '..',
    'opendatabot-fop-parser',
    'run_opendatabot_phone_lookup.py',
  );
  const normalizedPhone = phone.trim().replace(/^\+/, '');
  return new Promise((resolve) => {
    const child = spawnChild(pythonCmd, [scriptPath, normalizedPhone], {
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      const text = stdout.trim();
      if (code === 0 && text && text !== 'ФОП не знайдено') {
        resolve(text);
      } else {
        if (code && code !== 0) {
          console.error(
            `ℹ️ resolveNameByPhoneFromOpendatabot (${normalizedPhone}): код ${code}`,
            stderr.slice(0, 200),
          );
        }
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
  });
}

/**
 * Відправити одне повідомлення від вашого Telegram-акаунта по номеру телефону або username (Python Telethon).
 * Спочатку пробує по телефону; якщо не знайдено — по telegramUsername (якщо передано).
 * Повертає true, якщо повідомлення доставлено; false — помилка або користувач не знайдено.
 * Експортується для одноразової реклами каналу (без оновлення telegramPromoSentAt).
 */
export async function sendMessageViaUserAccount(
  phone: string,
  message: string,
  options?: { telegramUsername?: string | null }
): Promise<boolean> {
  const username = options?.telegramUsername?.trim().replace(/^@/, '');
  // Якщо є @username — спочатку пробуємо по ньому (1 API call). Інакше ResolvePhone (до 3 викликів) + send = багато запитів підряд → Too many requests.
  if (username) {
    const sentByUsername = await spawnSendMessage(username, message, true);
    if (sentByUsername) {
      console.log(`ℹ️ Telegram user-sender: надіслано по @${username}`);
      return true;
    }
    // Пауза перед спробою по телефону, щоб не перевищити rate limit
    await new Promise((r) => setTimeout(r, 10000));
  }
  const sentByPhone = await spawnSendMessage(phone, message, false);
  if (sentByPhone) return true;
  if (username) {
    console.log(`ℹ️ Telegram user-sender: по @${username} та по телефону ${phone} не вдалося`);
  }
  return false;
}

function spawnSendMessage(value: string, message: string, isUsername: boolean): Promise<boolean> {
  const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  const scriptDir = sessionPath ? path.dirname(sessionPath) : '';
  const scriptPath = path.join(scriptDir, 'send_message.py');
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!sessionPath || !apiId || !apiHash) return Promise.resolve(false);
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  const args = isUsername ? [scriptPath, '--username', value] : [scriptPath, '--report-name', value];
  return new Promise((resolve) => {
    const child = spawnChild(pythonCmd, args, {
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const stderrDone = new Promise<void>((r) => {
      if (!child.stderr) {
        r();
        return;
      }
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.stderr.once('end', r);
      child.stderr.once('close', r);
    });
    child.stdin?.end(message, 'utf8');
    child.on('close', async (code) => {
      await stderrDone; // Дочекатись повного stderr (close може спрацювати раніше)
      if (code === 0) {
        if (!isUsername && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as { phone?: string; telegramUsername?: string };
            if (parsed.phone && parsed.telegramUsername?.trim()) {
              await findOrCreatePersonByPhone(parsed.phone, { telegramUsername: parsed.telegramUsername.trim() }).catch((e) =>
                console.error('❌ Оновлення Person після send_message:', e)
              );
            }
          } catch {
            // stdout може містити щось інше — ігноруємо
          }
        }
        resolve(true);
        return;
      }
      if (code === 1 && !isUsername) {
        console.log(`ℹ️ Telegram user-sender: по телефону ${value} не знайдено або номер приховано (код 1)`);
      } else if (code !== 1) {
        console.error(`❌ Telegram user-sender помилка (код ${code}):`, stderr.slice(0, 500));
        const errorText = stderr.trim() || `(код ${code}, stderr порожній)`;
        recordTelegramUserSendError(value, isUsername ? 'username' : 'phone', code ?? 2, errorText).catch((e) =>
          console.error('❌ recordTelegramUserSendError:', e)
        );
      }
      resolve(false);
    });
    child.on('error', (err) => {
      console.error('❌ Telegram user-sender: не вдалося запустити Python:', err.message);
      resolve(false);
    });
  });
}

async function recordTelegramUserSendError(
  contact: string,
  contactType: 'phone' | 'username',
  errorCode: number,
  errorText: string
): Promise<void> {
  try {
    const displayContact = contactType === 'username' && !contact.startsWith('@') ? `@${contact}` : contact;
    await tgPrisma.telegramUserSendError.create({
      data: { contact: displayContact, contactType, errorCode, errorText: errorText || null },
    });
  } catch (e) {
    console.error('❌ Не вдалося зберегти TelegramUserSendError:', e);
  }
}

/**
 * Відправка водію запиту на попутку з кнопкою підтвердження.
 * Повертає true, якщо повідомлення водію відправлено.
 */
export const sendRideShareRequestToDriver = async (
  requestId: number,
  driver: {
    route: string;
    date: Date;
    departureTime: string | null;
    phone: string;
    senderName: string | null;
  },
  passenger: {
    phone: string;
    senderName: string | null;
    notes: string | null;
  }
): Promise<boolean> => {
  if (!bot) return false;
  const driverChatId = await getChatIdByPhone(driver.phone);
  if (!driverChatId) return false;

  const confirmKeyboard = {
    inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${requestId}` }]]
  };

  try {
    await bot.sendMessage(
      driverChatId,
      `🎫 <b>Запит на попутку</b>\n\n` +
        `👤 ${passenger.senderName ?? 'Пасажир'} хоче поїхати з вами.\n\n` +
        `🛣 ${getRouteName(driver.route)}\n` +
        `📅 ${formatDate(driver.date)}\n` +
        (driver.departureTime ? `🕐 ${driver.departureTime}\n` : '') +
        `📞 ${formatPhoneTelLink(passenger.phone)}` +
        (passenger.notes ? `\n📝 ${passenger.notes}` : '') +
        `\n\n_У вас є 1 година на підтвердження._`,
      { parse_mode: 'HTML', reply_markup: confirmKeyboard }
    );
  } catch (e) {
    await handleTelegramBotBlockedFromOutboundSend(tgPrisma, e, {
      chatId: driverChatId,
      normalizedPhone: normalizePhone(driver.phone),
    });
    console.error('❌ sendRideShareRequestToDriver:', e);
    return false;
  }

  return true;
};

/**
 * Відправка підтвердження бронювання клієнту.
 * Тільки для маршруток (schedule). Для попуток (viber_match) пасажиру шле окреме повідомлення "Водій підтвердив ваше бронювання!" в обробнику vibermatch_confirm_.
 */
export const sendBookingConfirmationToCustomer = async (
  chatId: string,
  booking: {
    id: number;
    route: string;
    date: Date;
    departureTime: string;
    seats: number;
    name: string;
    source?: string;
    supportPhone?: string | null;
    personId?: number | null;
    phone?: string | null;
  }
) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }
  const isViberRide = booking.source === 'viber_match';

  try {
    const message = isViberRide
      ? `
✅ <b>Попутку підтверджено</b>

🎫 <b>Номер:</b> #${booking.id}
🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час:</b> ${booking.departureTime}
👤 <b>Пасажир:</b> ${booking.name}

<i>Бажаємо приємної подорожі! 🚐</i>
    `.trim()
      : `
📋 <b>Заявку прийнято</b> (працюємо в технічному режимі)

🎫 <b>Номер:</b> #${booking.id}
🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}
👤 <b>Пасажир:</b> ${booking.name}
${booking.supportPhone ? `\n⚠️ Краще уточнити бронювання за телефоном: ${booking.supportPhone}\n` : ''}

<i>Бажаємо приємної подорожі! 🚐</i>
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram підтвердження надіслано клієнту (booking #${booking.id})`);
  } catch (error) {
    await handleTelegramBotBlockedFromOutboundSend(tgPrisma, error, {
      chatId,
      personId: booking.personId ?? null,
      normalizedPhone: booking.phone ? normalizePhone(booking.phone) : null,
    });
    console.error('❌ Помилка відправки Telegram підтвердження клієнту:', error);
  }
};

/**
 * Відправка нагадування про поїздку (можна викликати через cron job)
 */
export const sendTripReminder = async (
  chatId: string,
  booking: {
    route: string;
    date: Date;
    departureTime: string;
    name: string;
    driver?: { senderName: string | null; phone: string };
    personId?: number | null;
    phone?: string | null;
  }
) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }

  try {
    const schedule = await tgPrisma.schedule.findFirst({
      where: { route: booking.route, supportPhone: { not: null } },
      select: { supportPhone: true }
    });
    const supportPhone = schedule?.supportPhone ?? null;
    const supportPhoneLine = supportPhone
      ? `\n📞 <b>Перевірити бронювання за тел.:</b> ${supportPhone}\n`
      : '';
    const driverLine = booking.driver
      ? `\n🚗 <b>Водій:</b> ${booking.driver.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.driver.phone)}\n`
      : '';

    const message = `
⚠️❗ <b>Увага!</b> Якщо ви не перевірили бронювання за телефоном — воно не гарантоване!

🔔 <b>Нагадування про поїздку!</b>

👋 ${booking.name}, нагадуємо про вашу поїздку завтра:

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
${driverLine}${supportPhoneLine}
<i>Не спізніться! ⏰</i>
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram нагадування надіслано`);
  } catch (error) {
    await handleTelegramBotBlockedFromOutboundSend(tgPrisma, error, {
      chatId,
      personId: booking.personId ?? null,
      normalizedPhone: booking.phone ? normalizePhone(booking.phone) : null,
    });
    console.error('❌ Помилка відправки Telegram нагадування:', error);
  }
};

/**
 * Відправка нагадування в день поїздки (сьогодні)
 */
export const sendTripReminderToday = async (
  chatId: string,
  booking: {
    route: string;
    date: Date;
    departureTime: string;
    name: string;
    driver?: { senderName: string | null; phone: string };
    personId?: number | null;
    phone?: string | null;
  }
) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }

  try {
    const schedule = await tgPrisma.schedule.findFirst({
      where: { route: booking.route, supportPhone: { not: null } },
      select: { supportPhone: true }
    });
    const supportPhone = schedule?.supportPhone ?? null;
    const supportPhoneLine = supportPhone
      ? `\n📞 <b>Перевірити бронювання за тел.:</b> ${supportPhone}\n`
      : '';
    const driverLine = booking.driver
      ? `\n🚗 <b>Водій:</b> ${booking.driver.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.driver.phone)}\n`
      : '';

    const message = `
⚠️❗ <b>Увага!</b> Якщо ви не перевірили бронювання за телефоном — воно не гарантоване!

🔔 <b>Сьогодні у вас поїздка!</b>

👋 ${booking.name}, нагадуємо:

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
${driverLine}${supportPhoneLine}
<i>Не спізніться! ⏰</i>
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram нагадування (сьогодні) надіслано`);
  } catch (error) {
    await handleTelegramBotBlockedFromOutboundSend(tgPrisma, error, {
      chatId,
      personId: booking.personId ?? null,
      normalizedPhone: booking.phone ? normalizePhone(booking.phone) : null,
    });
    console.error('❌ Помилка відправки Telegram нагадування (сьогодні):', error);
  }
};

/**
 * Текст нагадування неактивним (з посиланнями на сценарії). Використовується ботом та відправкою від особистого акаунта.
 */
export function buildInactivityReminderMessage(): string {
  const links = getTelegramScenarioLinks();
  return `
👋 <b>Давно не бачилися!</b>

Ми помітили, що ви давно не користувалися сервісом поїздок Київ, Житомир, Коростень ↔️ Малин.

Якщо плануєте дорогу:
• як <b>водій</b> — створіть нову поїздку: ${links.driver}
• як <b>пасажир</b> — створіть запит на поїздку: ${links.passenger}

Вільний перегляд поїздок: ${links.poputkyWeb}

<i>Дякуємо, що користуєтесь нашим сервісом! 🚐</i>
  `.trim();
}

/**
 * Нагадування неактивним користувачам: просте повідомлення з посиланнями на сценарії.
 */
export const sendInactivityReminder = async (chatId: string) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }

  try {
    const message = buildInactivityReminderMessage();
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log('✅ Telegram inactivity reminder sent');
  } catch (error) {
    console.error('❌ Помилка відправки Telegram inactivity reminder:', error);
    throw error;
  }
};

/**
 * Перевірка чи бот налаштований
 */
export const isTelegramEnabled = (): boolean => {
  return bot !== null && token !== undefined;
};

/**
 * Реєстрація номера телефону: прив'язка Person до Telegram та синхронізація з бронюваннями.
 * telegramName — ім'я з профілю Telegram (first_name + last_name), зберігається в Person.fullName.
 */
async function registerUserPhone(chatId: string, userId: string, phoneInput: string, telegramName?: string | null) {
  if (!bot) return;

  try {
    const normalizedPhone = normalizePhone(phoneInput);

    // Чи цей Telegram ID вже був прив'язаний раніше (Person або Booking)
    const personByTelegram = await getPersonByTelegram(userId, chatId);
    const bookingByTelegram = await tgPrisma.booking.findFirst({
      where: { telegramUserId: userId },
      select: { id: true },
    });
    const hadAccountBefore = !!(personByTelegram || bookingByTelegram);

    const allBookings = await tgPrisma.booking.findMany({ orderBy: { createdAt: 'desc' } });
    const matchingBookings = allBookings.filter((b) => normalizePhone(b.phone) === normalizedPhone);
    const userIdBookings = await tgPrisma.booking.findMany({
      where: { telegramUserId: userId },
    });
    const totalBookings = matchingBookings.length + userIdBookings.length;

    if (totalBookings === 0) {
      // Додаємо людину в базу (Person), щоб після бронювання на сайті вона отримувала сповіщення
      await findOrCreatePersonByPhone(phoneInput, {
        fullName: telegramName ?? undefined,
        telegramChatId: chatId,
        telegramUserId: userId,
      });
      if (!hadAccountBefore) {
        const person = await getPersonByPhone(phoneInput);
        sendNewTelegramRegistrationNotificationToAdmin(userId, phoneInput, person?.fullName ?? telegramName ?? null);
      }
      await bot.sendMessage(
        chatId,
        `✅ <b>Номер додано в базу клієнтів!</b>\n\n` +
          `📱 ${formatPhoneTelLink(phoneInput)}\n\n` +
          `📋 <b>Повна інструкція</b>\n\n` +
          `1️⃣ <b>Забронювати квиток</b> можна двома способами:\n` +
          `   • На сайті: 🌐 https://malin.kiev.ua (вкажіть цей номер телефону)\n` +
          `   • У боті: кнопка «🎫 Бронювання» або команда /book\n\n` +
          `2️⃣ <b>Що ви будете отримувати автоматично:</b>\n` +
          `   • ✅ Підтвердження бронювання (на сайті чи в боті)\n` +
          `   • 🔔 Нагадування за день до поїздки\n\n` +
          `3️⃣ Нижче з\'явилися кнопки меню — користуйтеся ними або командами з довідки /help.`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
      );
      console.log(`✅ Додано Person (без бронювань) для ${userId}, номер ${normalizedPhone}`);
      return;
    }

    const phoneNumbers = [...new Set(matchingBookings.map((b) => b.phone))];
    for (const phone of phoneNumbers) {
      const person = await findOrCreatePersonByPhone(phone, {
        fullName: telegramName ?? undefined,
        telegramChatId: chatId,
        telegramUserId: userId,
      });
      await updatePersonAndBookingsTelegram(person.id, chatId, userId);
      const norm = normalizePhone(phone);
      const allWithPhone = await tgPrisma.booking.findMany({ where: {} });
      const toLink = allWithPhone.filter((b) => normalizePhone(b.phone) === norm);
      for (const b of toLink) {
        if (b.personId !== person.id) {
          await tgPrisma.booking.update({
            where: { id: b.id },
            data: { personId: person.id, telegramChatId: chatId, telegramUserId: userId },
          });
        }
      }
    }

    await tgPrisma.booking.updateMany({
      where: { telegramUserId: userId, telegramChatId: null },
      data: { telegramChatId: chatId },
    });

    if (!hadAccountBefore) {
      const person = await getPersonByPhone(phoneInput);
      sendNewTelegramRegistrationNotificationToAdmin(userId, phoneInput, person?.fullName ?? telegramName ?? null);
    }

    console.log(`✅ Оновлено Person та бронювання для користувача ${userId}, номер ${normalizedPhone}`);

    await bot.sendMessage(
      chatId,
      `✅ <b>Вітаємо! Ваш акаунт підключено!</b>\n\n` +
        `📱 Номер телефону: ${formatPhoneTelLink(phoneInput)}\n` +
        `🎫 Знайдено бронювань: ${totalBookings}\n\n` +
        `Тепер ви будете отримувати:\n` +
        `• ✅ Підтвердження при створенні бронювання\n` +
        `• 🔔 Нагадування за день до поїздки\n\n` +
        `📋 Нижче з\'явилися кнопки меню — можна користуватися ними замість команд.`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  } catch (error) {
    console.error('❌ Помилка реєстрації номера:', error);
    await bot.sendMessage(chatId, '❌ Помилка при реєстрації. Спробуйте пізніше.');
  }
}

/** Список команд для меню бота (кнопка "Menu" зліва від вводу). */
const CLIENT_BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'start', description: 'Головне меню' },
  { command: 'help', description: 'Довідка' },
  { command: 'book', description: 'Нове бронювання' },
  { command: 'mybookings', description: 'Мої бронювання' },
  { command: 'allrides', description: 'Всі попутки' },
  { command: 'cancel', description: 'Скасувати бронювання або оголошення попуток' },
  { command: 'mydriverrides', description: 'Мої поїздки (водій)' },
  { command: 'adddriverride', description: 'Додати поїздку' },
  { command: 'mypassengerrides', description: 'Мої запити (пасажир)' },
  { command: 'addpassengerride', description: 'Шукаю поїздку' },
  { command: 'poputky', description: 'Перегляд попуток' },
];

/** Відображувані назви кнопок головного меню (надсилаються як текст повідомлення). */
const MAIN_MENU_BUTTONS = {
  BOOK: '🎫 Бронювання',
  MY_BOOKINGS: '📋 Мої бронювання',
  ALL_RIDES: '🌐 Всі попутки',
  CANCEL: '🚫 Скасувати',
  MY_DRIVER_RIDES: '🚗 Мої поїздки',
  MY_PASSENGER_RIDES: '👤 Мої запити',
  ADD_DRIVER_RIDE: '🚗 Додати поїздку',
  ADD_PASSENGER_RIDE: '👤 Шукаю поїздку',
  HELP: '📚 Довідка',
} as const;

/** Відповідність текстів кнопок командам. */
const MENU_BUTTON_TO_COMMAND: Record<string, string> = {
  [MAIN_MENU_BUTTONS.BOOK]: '/book',
  [MAIN_MENU_BUTTONS.MY_BOOKINGS]: '/mybookings',
  [MAIN_MENU_BUTTONS.ALL_RIDES]: '/allrides',
  [MAIN_MENU_BUTTONS.CANCEL]: '/cancel',
  [MAIN_MENU_BUTTONS.MY_DRIVER_RIDES]: '/mydriverrides',
  [MAIN_MENU_BUTTONS.MY_PASSENGER_RIDES]: '/mypassengerrides',
  [MAIN_MENU_BUTTONS.ADD_DRIVER_RIDE]: '/adddriverride',
  [MAIN_MENU_BUTTONS.ADD_PASSENGER_RIDE]: '/addpassengerride',
  [MAIN_MENU_BUTTONS.HELP]: '/help',
};

/** Reply-клавіатура (кнопки під полем вводу), згруповані в підменю. */
function getMainMenuKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: MAIN_MENU_BUTTONS.BOOK }, { text: MAIN_MENU_BUTTONS.MY_BOOKINGS }],
      [{ text: MAIN_MENU_BUTTONS.ALL_RIDES }, { text: MAIN_MENU_BUTTONS.CANCEL }],
      [{ text: MAIN_MENU_BUTTONS.MY_DRIVER_RIDES }, { text: MAIN_MENU_BUTTONS.MY_PASSENGER_RIDES }],
      [{ text: MAIN_MENU_BUTTONS.ADD_DRIVER_RIDE }, { text: MAIN_MENU_BUTTONS.ADD_PASSENGER_RIDE }],
      [{ text: MAIN_MENU_BUTTONS.HELP }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

/** Клавіатура «Поділитися номером» — єдина дія для користувача без номера. */
function getSharePhoneKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Надіслати повідомлення «спочатку поділіться номером» і кнопку. Використовувати для будь-якої дії без реєстрації. */
async function sendSharePhoneOnly(chatId: string): Promise<void> {
  const text =
    '📱 <b>Спочатку поділіться номером телефону</b>\n\n' +
    'Щоб користуватися ботом (бронювання, попутки, сповіщення), надішліть номер:\n' +
    '• натисніть кнопку нижче або\n' +
    '• напишіть номер, наприклад 0501234567\n\n' +
    '🌐 Забронювати квиток на сайті: https://malin.kiev.ua';
  await bot?.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: getSharePhoneKeyboard(),
  });
}

/**
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
  if (!bot) return;

  // Меню команд (кнопка "Menu" зліва від вводу тексту)
  bot.setMyCommands(CLIENT_BOT_COMMANDS).catch((err) => console.error('❌ setMyCommands:', err));

  const parseStartScenario = (text?: string): 'driver' | 'passenger' | 'view' | null => {
    if (!text) return null;
    const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
    const raw = match?.[1]?.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'driver' || raw === 'adddriverride') return 'driver';
    if (raw === 'passenger' || raw === 'addpassengerride') return 'passenger';
    if (raw === 'view' || raw === 'poputky' || raw === 'rides') return 'view';
    return null;
  };

  const startDriverRideFlow = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    const routeKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
        [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
        [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
      ]
    };

    if (!userPhone) {
      driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'phone', since: Date.now() });
      const keyboard = {
        keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await bot?.sendMessage(
        chatId,
        '🚗 <b>Додати поїздку (водій)</b>\n\n' +
        'Спочатку вкажіть номер телефону для контакту:\n' +
        '• натисніть кнопку нижче або\n' +
        '• напишіть номер, наприклад 0501234567',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }

    driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'route', phone: userPhone, since: Date.now() });
    await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
  };

  const startPassengerRideFlow = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    const routeKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
        [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
        [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
      ]
    };

    if (!userPhone) {
      passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'phone', since: Date.now() });
      const keyboard = {
        keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await bot?.sendMessage(
        chatId,
        '👤 <b>Шукаю поїздку (пасажир)</b>\n\n' +
        'Спочатку вкажіть номер телефону для контакту:\n' +
        '• натисніть кнопку нижче або\n' +
        '• напишіть номер, наприклад 0501234567',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }

    passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'route', phone: userPhone, since: Date.now() });
    await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
  };

  const sendFreeViewInfo = async (chatId: string, replyMarkup?: TelegramBot.ReplyKeyboardMarkup) => {
    const links = getTelegramScenarioLinks();
    await bot?.sendMessage(
      chatId,
      '🌐 <b>Вільний перегляд попуток</b>\n\n' +
      'Без авторизації можна переглядати всі активні поїздки на сайті:\n' +
      `${links.poputkyWeb}\n\n` +
      'Швидкий старт у Telegram:\n' +
      `🚗 Водій: ${links.driver}\n` +
      `👤 Пасажир: ${links.passenger}`,
      { parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }
    );
  };

  // Команда /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const firstName = msg.from?.first_name || 'Друже';
    const rawStart = msg.text?.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i)?.[1]?.trim() ?? '';

    // Посилання з /allrides: забронювати у водія (book_viber_ID)
    if (rawStart.startsWith('book_viber_')) {
      const driverListingId = parseInt(rawStart.replace('book_viber_', ''), 10);
      if (!isNaN(driverListingId)) {
        const result = await executeBookViberRideShare(chatId, userId, driverListingId, msg.from?.first_name ?? undefined);
        if (result.ok) {
          await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' });
        } else {
          await sendSharePhoneOnly(chatId);
        }
        return;
      }
    }

    // Чернетка з сайту poputky: start=driver_TOKEN або passenger_TOKEN — дані вже заповнені, потрібен лише телефон (або публікація одразу)
    const draftMatch = rawStart.match(/^(driver|passenger)_([a-zA-Z0-9-]{4,32})$/);
    if (draftMatch) {
      const role = draftMatch[1] as 'driver' | 'passenger';
      const draftToken = draftMatch[2];
      const draft = getAnnounceDraft(draftToken);
      if (draft && draft.role === role) {
        const userPhone = await getPhoneByTelegramUser(userId, chatId);
        const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
        if (userPhone) {
          if (role === 'driver') {
            const state: DriverRideFlowState = { state: 'driver_ride_flow', step: 'notes', route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, seats: null, priceUah: draft.priceUah ?? null, phone: userPhone, since: Date.now() };
            await createDriverListingFromState(chatId, state, draft.notes ?? null, senderName);
          } else {
            const state: PassengerRideFlowState = { state: 'passenger_ride_flow', step: 'notes', route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, phone: userPhone, since: Date.now() };
            await createPassengerListingFromState(chatId, state, draft.notes ?? null, senderName);
          }
          await bot?.sendMessage(chatId, '✅ Дані з сайту прийнято. Оголошення опубліковано!', { parse_mode: 'HTML' });
          return;
        }
        if (role === 'driver') {
          driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'phone', draftToken, since: Date.now() });
          const keyboard = { keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
          await bot?.sendMessage(chatId, '📋 <b>Дані з сайту збережені</b> (маршрут, дата, час, примітки).\n\nЗалишилось лише вказати номер телефону для контактів:', { parse_mode: 'HTML', reply_markup: keyboard });
        } else {
          passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'phone', draftToken, since: Date.now() });
          const keyboard = { keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
          await bot?.sendMessage(chatId, '📋 <b>Дані з сайту збережені</b> (маршрут, дата, час, примітки).\n\nЗалишилось лише вказати номер телефону для контактів:', { parse_mode: 'HTML', reply_markup: keyboard });
        }
        return;
      }
    }

    const startScenario = parseStartScenario(msg.text);
    const person = await getPersonByTelegram(userId, chatId);
    const existingBooking = await tgPrisma.booking.findFirst({
      where: { telegramUserId: userId },
    });

    const buildRegisteredWelcome = (displayPhone: string) => `
👋 Привіт знову, ${firstName}!

Я бот для бронювання маршруток <b>Київ, Житомир, Коростень ↔ Малин</b>.

✅ Ваш акаунт підключено до номера: ${displayPhone}

🎫 <b>Що можна зробити:</b>
/book - 🎫 Створити нове бронювання
/mybookings - 📋 Переглянути мої бронювання
/allrides - 🌐 Всі активні попутки
/cancel - 🚫 Скасувати бронювання або оголошення попуток
🚗 <b>Водій:</b>
/mydriverrides - Мої поїздки (які я пропоную)
/adddriverride - Додати поїздку як водій
👤 <b>Пасажир:</b>
/mypassengerrides - Мої запити на поїздку
/addpassengerride - Шукаю поїздку (додати запит)
/help - 📚 Показати повну довідку

🌐 <b>Або забронюйте на сайті:</b>
https://malin.kiev.ua
    `.trim();

    /** Якщо передано contactKeyboard, при сценарії view зберігаємо кнопку «Поділитися контактом» під повідомленням. */
    const handleStartScenario = async (contactKeyboard?: TelegramBot.ReplyKeyboardMarkup): Promise<boolean> => {
      if (!startScenario) return false;
      if (startScenario === 'driver') {
        await bot?.sendMessage(chatId, '🚗 Запускаю сценарій: <b>Запит на поїздку як водій</b>', { parse_mode: 'HTML' });
        await startDriverRideFlow(chatId, userId);
        return true;
      }
      if (startScenario === 'passenger') {
        await bot?.sendMessage(chatId, '👤 Запускаю сценарій: <b>Запит на поїздку як пасажир</b>', { parse_mode: 'HTML' });
        await startPassengerRideFlow(chatId, userId);
        return true;
      }
      await sendFreeViewInfo(chatId, contactKeyboard);
      return true;
    };

    if (person) {
      await tgPrisma.person.updateMany({
        where: { id: person.id },
        data: { telegramChatId: chatId, telegramUserId: userId },
      });
      if (existingBooking) {
        await tgPrisma.booking.updateMany({
          where: { telegramUserId: userId, telegramChatId: null },
          data: { telegramChatId: chatId },
        });
        await updatePersonAndBookingsTelegram(person.id, chatId, userId);
        console.log(`✅ Оновлено Person/Booking для користувача ${userId} при /start`);
      }
      const displayPhone = person.phoneNormalized ? formatPhoneTelLink(person.phoneNormalized) : (existingBooking ? formatPhoneTelLink(existingBooking.phone) : '');
      await bot?.sendMessage(chatId, buildRegisteredWelcome(displayPhone), {
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(),
      });
      if (await handleStartScenario()) return;
    } else {
      if (existingBooking) {
        await tgPrisma.booking.updateMany({
          where: { telegramUserId: userId, telegramChatId: null },
          data: { telegramChatId: chatId },
        });
        const p = await findOrCreatePersonByPhone(existingBooking.phone, {
          fullName: existingBooking.name,
          telegramChatId: chatId,
          telegramUserId: userId,
        });
        await updatePersonAndBookingsTelegram(p.id, chatId, userId);
        console.log(`✅ Оновлено Person/Booking для користувача ${userId} при /start (з booking)`);
        const displayPhone = formatPhoneTelLink(p.phoneNormalized ?? existingBooking.phone);
        await bot?.sendMessage(chatId, buildRegisteredWelcome(displayPhone), {
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard(),
        });
        if (await handleStartScenario()) return;
        return;
      }
      // Новий користувач — показуємо тільки заклик поділитися номером (без інших команд і сценаріїв)
      const welcomeMessage = `
👋 Привіт, ${firstName}!

Я бот для бронювання маршруток <b>Київ, Житомир, Коростень ↔ Малин</b>.

📱 <b>Щоб продовжити, надішліть номер телефону:</b>
   • кнопкою нижче або
   • напишіть номер, наприклад 0501234567

Після цього зʼявиться меню бронювань, попуток та сповіщень.

🌐 Забронювати квиток на сайті: https://malin.kiev.ua
      `.trim();

      await bot?.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: getSharePhoneKeyboard(),
      });
    }
  });

  // Команда /help — зареєстрований = є в Person (номер уже надано), не тільки по Booking
  bot.onText(/\/help/, async (msg) => {
    await handleHelp(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  bot.onText(/\/poputky/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    await sendFreeViewInfo(chatId);
  });

  const parseAllridesDateArg = (raw: string): Date | null => {
    const value = raw.trim().toLowerCase();
    if (!value) return null;

    if (value === 'сьогодні' || value === 'сегодня' || value === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (value === 'завтра' || value === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }

    const dotMatch = value.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (dotMatch) {
      const day = Number(dotMatch[1]);
      const month = Number(dotMatch[2]);
      let year = dotMatch[3] ? Number(dotMatch[3]) : new Date().getFullYear();
      if (year < 100) year += 2000;
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }

    return null;
  };

  const getAllridesFilterKeyboard = () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return [
      [
        { text: '📅 Майбутні', callback_data: 'allrides_filter_future' },
        { text: '🗂 Усі', callback_data: 'allrides_filter_all' },
      ],
      [
        { text: `🗓 Сьогодні (${formatDate(today)})`, callback_data: 'allrides_filter_today' },
        { text: `🗓 Завтра (${formatDate(tomorrow)})`, callback_data: 'allrides_filter_tomorrow' },
      ],
      [
        { text: '✏️ Ввести дату', callback_data: 'allrides_filter_custom' },
      ],
    ] as Array<Array<{ text: string; callback_data: string }>>;
  };

  /** Ряд кнопок фільтра по часу для майбутніх попуток. */
  const getAllridesTimeFilterRow = (): Array<Array<{ text: string; callback_data: string }>> => [
    [
      { text: '🕐 Увесь день', callback_data: 'allrides_filter_future' },
      { text: '🌅 Ранок (до 12)', callback_data: 'allrides_filter_future_morning' },
      { text: '☀️ День (12–18)', callback_data: 'allrides_filter_future_afternoon' },
      { text: '🌙 Вечір (18+)', callback_data: 'allrides_filter_future_evening' },
    ],
  ];

  type AllridesTimeSlot = keyof typeof ALLRIDES_TIME_SLOTS;

  const sendAllrides = async (
    chatId: string,
    userId: string,
    filterRaw: string = '',
    timeSlot?: AllridesTimeSlot
  ): Promise<void> => {
    try {
      const userPhone = await getPhoneByTelegramUser(userId, chatId);
      if (!userPhone) {
        await sendSharePhoneOnly(chatId);
        return;
      }
      const normalizedFilter = filterRaw.trim().toLowerCase();
      const showAll =
        normalizedFilter === 'all' ||
        normalizedFilter === 'всі' ||
        normalizedFilter === 'усі' ||
        normalizedFilter === 'все';
      const selectedDate = !normalizedFilter || showAll ? null : parseAllridesDateArg(normalizedFilter);
      if (normalizedFilter && !showAll && !selectedDate) {
        await bot?.sendMessage(
          chatId,
          '❌ Невірний фільтр для /allrides.\n\n' +
            'Використайте один з варіантів:\n' +
            '• /allrides — майбутні попутки\n' +
            '• /allrides all — усі активні\n' +
            '• /allrides 21.02 або /allrides 2026-02-21 — попутки на дату',
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: getAllridesFilterKeyboard() } }
        );
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextDay = selectedDate ? new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000) : null;
      const where: { isActive: boolean; date?: { gte?: Date; lt?: Date } } = { isActive: true };
      if (!showAll && selectedDate) {
        where.date = { gte: selectedDate, lt: nextDay! };
      } else if (!showAll) {
        where.date = { gte: today };
      }

      let activeListings = await tgPrisma.viberListing.findMany({
        where,
        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }, { createdAt: 'desc' }],
        take: 80,
      });

      const isFutureView = !showAll && !selectedDate;
      if (isFutureView && timeSlot) {
        activeListings = activeListings.filter((l) => allridesListingMatchesTimeSlot(l.departureTime, timeSlot));
      }

      if (activeListings.length === 0) {
        await bot?.sendMessage(
          chatId,
          '📭 <b>Зараз немає активних попуток</b>\n\n' +
            'Спробуйте змінити фільтр кнопками нижче або створіть свою поїздку:\n' +
            '🚗 /adddriverride\n' +
            '👤 /addpassengerride\n' +
            '🌐 https://malin.kiev.ua/poputky',
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: getAllridesFilterKeyboard() } }
        );
        return;
      }

      const driverListings = activeListings.filter((l) => l.listingType === 'driver');
      const passengerListings = activeListings.filter((l) => l.listingType === 'passenger');
      const visibleDriverListings = driverListings.slice(0, 10);

      const formatListingRow = (listing: {
        id: number;
        route: string;
        date: Date;
        departureTime: string | null;
        seats: number | null;
        phone: string;
        senderName: string | null;
      }) => {
        const time = listing.departureTime ?? '—';
        const seats = listing.seats != null ? `${listing.seats} місць` : '—';
        const author = (listing.senderName ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `• <b>#${listing.id}</b> ${getRouteName(listing.route)}\n` +
          `   📅 ${formatDate(listing.date)} · 🕐 ${time}\n` +
          `   👤 ${author} · 🎫 ${seats}\n` +
          `   📞 ${formatPhoneTelLink(listing.phone)}`;
      };

      const timeSlotLabel =
        timeSlot === 'morning'
          ? 'ранок (до 12:00)'
          : timeSlot === 'afternoon'
            ? 'день (12:00–18:00)'
            : timeSlot === 'evening'
              ? 'вечір (після 18:00)'
              : null;
      const filterTitle = showAll
        ? 'усі активні'
        : selectedDate
          ? `дата: ${formatDate(selectedDate)}`
          : timeSlotLabel
            ? `майбутні · ${timeSlotLabel}`
            : 'майбутні';
      let message = `🌐 <b>Попутки (${filterTitle})</b>\n\n`;
      message += `🚗 Водії: ${driverListings.length} · 👤 Пасажири: ${passengerListings.length}\n`;
      message += '—\n\n';

      if (driverListings.length > 0) {
        message += '<b>🚗 Водії</b>\n\n';
        message += visibleDriverListings.map(formatListingRow).join('\n\n');
        if (driverListings.length > 10) {
          message += `\n\n… ще ${driverListings.length - 10}`;
        }
        message += '\n\n';
      }

      if (passengerListings.length > 0) {
        message += '<b>👤 Пасажири</b>\n\n';
        message += passengerListings.slice(0, 10).map(formatListingRow).join('\n\n');
        if (passengerListings.length > 10) {
          message += `\n\n… ще ${passengerListings.length - 10}`;
        }
      }

      const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

      // Водії, у яких можна забронювати (є Telegram): окремими повідомленнями з кнопкою під кожною пропозицією.
      const bookableDrivers: typeof visibleDriverListings = [];
      if (visibleDriverListings.length > 0) {
        const chatIds = await Promise.all(visibleDriverListings.map((d) => getChatIdForDriverListing(d)));
        const normalizedUserPhone = userPhone ? normalizePhone(userPhone) : null;
        for (let i = 0; i < visibleDriverListings.length; i++) {
          if (!chatIds[i]) continue;
          const d = visibleDriverListings[i];
          if (normalizedUserPhone && normalizePhone(d.phone) === normalizedUserPhone) continue;
          bookableDrivers.push(d);
        }
      }

      if (userPhone) {
        const normalizedPhone = normalizePhone(userPhone);
        const myDriverListings = driverListings.filter((l) => normalizePhone(l.phone) === normalizedPhone);
        const myPassengerListings = passengerListings.filter((l) => normalizePhone(l.phone) === normalizedPhone);

        const seenPassengerToDriver = new Set<string>();
        for (const myPassenger of myPassengerListings.slice(0, 5)) {
          const matches = await findMatchingDriversForPassenger({
            route: myPassenger.route,
            date: myPassenger.date,
            departureTime: myPassenger.departureTime,
          });
          for (const match of matches) {
            if (match.matchType !== 'exact') continue;
            if (normalizePhone(match.listing.phone) === normalizedPhone) continue;
            const key = `${myPassenger.id}_${match.listing.id}`;
            if (seenPassengerToDriver.has(key)) continue;
            seenPassengerToDriver.add(key);
            const driverName = truncateForButton(match.listing.senderName ?? 'Водій');
            const shortPhone = formatShortPhoneForButton(match.listing.phone);
            const timePart = match.listing.departureTime ?? '—';
            inlineKeyboard.push([{
              text: `🎫 ${driverName} · ${shortPhone} (${timePart})`,
              callback_data: `vibermatch_book_${myPassenger.id}_${match.listing.id}`,
            }]);
            if (inlineKeyboard.length >= 10) break;
          }
          if (inlineKeyboard.length >= 10) break;
        }

        const seenDriverToPassenger = new Set<string>();
        for (const myDriver of myDriverListings.slice(0, 5)) {
          const matches = await findMatchingPassengersForDriver({
            route: myDriver.route,
            date: myDriver.date,
            departureTime: myDriver.departureTime,
          });
          for (const match of matches) {
            if (match.matchType !== 'exact') continue;
            if (normalizePhone(match.listing.phone) === normalizedPhone) continue;
            const key = `${myDriver.id}_${match.listing.id}`;
            if (seenDriverToPassenger.has(key)) continue;
            seenDriverToPassenger.add(key);
            const passengerName = truncateForButton(match.listing.senderName ?? 'Пасажир');
            const shortPhone = formatShortPhoneForButton(match.listing.phone);
            inlineKeyboard.push([{
              text: `🤝 ${passengerName} · ${shortPhone}`,
              callback_data: `vibermatch_book_driver_${myDriver.id}_${match.listing.id}`,
            }]);
            if (inlineKeyboard.length >= 20) break;
          }
          if (inlineKeyboard.length >= 20) break;
        }

        if (inlineKeyboard.length === 0) {
          message += '\n\nℹ️ Для швидких дій потрібне точне співпадіння по маршруту, даті та часу (перетин із допуском ±45 хв).\n' +
            'Щоб з\'являлися кнопки швидких дій, додайте себе:\n' +
            '🚗 Як водій: /adddriverride\n' +
            '👤 Як пасажир: /addpassengerride';
        }
        // Якщо є точні співпадіння — їхні кнопки підуть окремим повідомленням нижче.
      } else {
        message += '\n\nℹ️ Щоб отримати персональні кнопки швидкого запиту, зареєструйте номер: /start';
      }

      // Перше повідомлення: тільки список і кнопки фільтрів (без кнопок бронювання — вони окремими повідомленнями).
      const filterKeyboard = [
        ...getAllridesFilterKeyboard(),
        ...(isFutureView ? getAllridesTimeFilterRow() : []),
      ];
      await bot?.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: filterKeyboard },
      });

      // Окреме повідомлення для кожного водія з Telegram: картка + посилання «Забронювати» (HTML, як інші лінки).
      const bookViberLink = (driverId: number) =>
        `https://t.me/${telegramBotUsername}?start=book_viber_${driverId}`;
      for (const d of bookableDrivers) {
        const card = formatListingRow(d);
        const linkHtml = `<a href="${bookViberLink(d.id)}">🎫 Забронювати у водія #${d.id}</a>`;
        await bot?.sendMessage(chatId, `${card}\n\n${linkHtml}`, {
          parse_mode: 'HTML',
        }).catch((err) => console.error('allrides: send driver card', err));
      }

      // Точні співпадіння — окремим повідомленням з кнопками.
      if (inlineKeyboard.length > 0) {
        await bot?.sendMessage(
          chatId,
          '🎯 <b>Точні співпадіння для вас:</b>\nНатисніть кнопку — запит буде надісланий другій стороні на підтвердження (1 година).',
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }
        ).catch((err) => console.error('allrides: send exact matches', err));
      }
    } catch (error) {
      console.error('❌ Помилка /allrides:', error);
      await bot?.sendMessage(chatId, '❌ Помилка при отриманні списку поїздок. Спробуйте пізніше.');
    }
  };

  const handleBook = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    const directionKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'book_dir_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'book_dir_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'book_dir_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'book_dir_Zhytomyr-Malyn' }],
        [{ text: '🚌 Коростень → Малин', callback_data: 'book_dir_Korosten-Malyn' }],
        [{ text: '🚌 Малин → Коростень', callback_data: 'book_dir_Malyn-Korosten' }]
      ]
    };
    await bot?.sendMessage(chatId, '🎫 <b>Нове бронювання</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: directionKeyboard });
  };

  const handleHelp = async (chatId: string, userId: string) => {
    const person = await getPersonByTelegram(userId, chatId);
    if (person) {
      const displayPhone = person.phoneNormalized ? formatPhoneTelLink(person.phoneNormalized) : '';
      const helpMessage = `📚 <b>Повна довідка по командах</b>

🎫 <b>Бронювання:</b>
/book - створити нове бронювання
/mybookings - переглянути мої бронювання
/allrides - всі активні попутки та швидкі дії
/cancel - скасувати бронювання або оголошення попуток

🚗 <b>Водій:</b>
/mydriverrides - мої поїздки (які я пропоную)
/adddriverride - додати поїздку як водій

👤 <b>Пасажир:</b>
/mypassengerrides - мої запити на поїздку
/addpassengerride - шукаю поїздку (додати запит)

📋 <b>Інше:</b>
/start - головне меню
/help - показати цю довідку
/allrides - показати всі активні попутки

✅ Ваш акаунт підключено до номера: ${displayPhone}

💡 <b>Що робить бот:</b>
• 🎫 Створює нові бронювання
• 📋 Показує тільки ваші бронювання
• 🚫 Дозволяє скасовувати бронювання
• 🚗 Додавати поїздки як водій та запити як пасажир
• ✅ Надсилає підтвердження після бронювання на сайті
• 🔔 Нагадує за день до поїздки

🌐 Сайт: https://malin.kiev.ua`.trim();
      await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    } else {
      await sendSharePhoneOnly(chatId);
    }
  };

  const handleCancel = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const normalizedPhone = normalizePhone(userPhone);
      const person = await getPersonByTelegram(userId, chatId);

      const [futureBookings, driverListings, passengerListings] = await Promise.all([
        tgPrisma.booking.findMany({
          where: { telegramUserId: userId, date: { gte: today } },
          orderBy: { date: 'asc' }
        }),
        tgPrisma.viberListing.findMany({
          where: {
            listingType: 'driver',
            isActive: true,
            date: { gte: today },
            ...(person ? { personId: person.id } : { phone: normalizedPhone })
          },
          orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
        }),
        tgPrisma.viberListing.findMany({
          where: {
            listingType: 'passenger',
            isActive: true,
            date: { gte: today },
            ...(person ? { personId: person.id } : { phone: normalizedPhone })
          },
          orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
        })
      ]);

      const myDriverListings = driverListings;
      const myPassengerListings = passengerListings;

      const hasBookings = futureBookings.length > 0;
      const hasDriver = myDriverListings.length > 0;
      const hasPassenger = myPassengerListings.length > 0;

      if (!hasBookings && !hasDriver && !hasPassenger) {
        await bot?.sendMessage(
          chatId,
          '❌ <b>Немає чого скасовувати</b>\n\n' +
            'У вас немає майбутніх бронювань та активних оголошень попуток.\n\n' +
            '🎫 /book — забронювати квиток\n' +
            '🚗 /adddriverride — додати поїздку як водій\n' +
            '👤 /addpassengerride — шукаю поїздку як пасажир\n' +
            '🌐 /allrides — всі активні попутки',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const parts: string[] = ['🚫 <b>Скасування</b>\n'];
      const rows: Array<Array<{ text: string; callback_data: string }>> = [];

      if (hasBookings) {
        parts.push('🎫 <b>Бронювання</b>\nОберіть бронювання для скасування:\n');
        futureBookings.forEach((b: { id: number; route: string; date: Date; departureTime: string | null }) => {
          rows.push([{ text: `🎫 #${b.id}: ${getRouteName(b.route)} — ${formatDate(b.date)} о ${b.departureTime ?? '—'}`, callback_data: `cancel_${b.id}` }]);
        });
      }
      if (hasDriver) {
        parts.push('\n🚗 <b>Попутки: я водій</b>\nВідмінити оголошення про поїздку:\n');
        myDriverListings.forEach((l: { id: number; route: string; date: Date; departureTime: string | null }) => {
          rows.push([{ text: `🚗 #${l.id}: ${getRouteName(l.route)} — ${formatDate(l.date)} о ${l.departureTime ?? '—'}`, callback_data: `cancel_driver_${l.id}` }]);
        });
      }
      if (hasPassenger) {
        parts.push('\n👤 <b>Попутки: я пасажир</b>\nВідмінити заявку на поїздку:\n');
        myPassengerListings.forEach((l: { id: number; route: string; date: Date; departureTime: string | null }) => {
          rows.push([{ text: `👤 #${l.id}: ${getRouteName(l.route)} — ${formatDate(l.date)} о ${l.departureTime ?? '—'}`, callback_data: `cancel_passenger_${l.id}` }]);
        });
      }

      const keyboard = { inline_keyboard: rows };
      await bot?.sendMessage(chatId, parts.join(''), { parse_mode: 'HTML', reply_markup: keyboard });
    } catch (error) {
      console.error('❌ Помилка при отриманні даних для скасування:', error);
      await bot?.sendMessage(chatId, '❌ Помилка. Спробуйте пізніше.');
    }
  };

  const handleMydriverrides = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    const normalized = normalizePhone(userPhone);
    const listings = await tgPrisma.viberListing.findMany({ where: { listingType: 'driver', isActive: true }, orderBy: [{ date: 'asc' }, { departureTime: 'asc' }] });
    const myListings = listings.filter((l: { phone: string | null }) => normalizePhone(l.phone ?? '') === normalized);
    if (myListings.length === 0) {
      await bot?.sendMessage(chatId, '🚗 <b>Мої поїздки (водій)</b>\n\nУ вас поки немає активних оголошень про поїздки.\n\nДодати поїздку: /adddriverride', { parse_mode: 'HTML' });
      return;
    }
    const lines = myListings.map((l: { route: string; date: Date; departureTime: string | null; seats: number | null }) => {
      const time = l.departureTime ?? '—';
      const seats = l.seats != null ? `, ${l.seats} місць` : '';
      return `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${time}${seats}`;
    });
    await bot?.sendMessage(chatId, '🚗 <b>Мої поїздки (водій)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /adddriverride', { parse_mode: 'HTML' });

    // Співпадіння пасажирів для кожної моєї поїздки (точні + приблизні + поїздки цього дня)
    for (const myDriver of myListings.slice(0, 5)) {
      const matches = await findMatchingPassengersForDriver({
        route: myDriver.route,
        date: myDriver.date,
        departureTime: myDriver.departureTime ?? null,
      });
      const matchesFiltered = matches.filter((m) => normalizePhone(m.listing.phone) !== normalized);
      const exactList = matchesFiltered.filter((m) => m.matchType === 'exact').map((m) => m.listing);
      const approxList = matchesFiltered.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
      const sameDayList = matchesFiltered.filter((m) => m.matchType === 'same_day').map((m) => m.listing);
      const routeDateLabel = `${getRouteName(myDriver.route)}, ${formatDate(myDriver.date)} о ${myDriver.departureTime ?? '—'}`;
      if (exactList.length > 0) {
        const linesExact = exactList.map((p) => {
          const time = p.departureTime ?? '—';
          return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
        }).join('\n');
        const buttons = exactList.map((p) => ([
          { text: `🤝 ${truncateForButton(p.senderName ?? 'Пасажир')} · ${formatShortPhoneForButton(p.phone)}`, callback_data: `vibermatch_book_driver_${myDriver.id}_${p.id}` }
        ]));
        await bot?.sendMessage(
          chatId,
          `🎯 <b>Пряме співпадіння (±45 хв) для поїздки:</b> ${routeDateLabel}\n\n` + linesExact +
          '\n\n_Натисніть кнопку — запит буде надісланий пасажиру на підтвердження (1 година)._',
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }
        ).catch((err) => console.error('mydriverrides: exact matches', err));
      }
      if (approxList.length > 0) {
        const linesApprox = approxList.map((p) => {
          const time = p.departureTime ?? '—';
          return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(
          chatId,
          `📌 <b>Приблизне співпадіння (±2 год)</b> (поїздка: ${routeDateLabel})\n\n` + linesApprox,
          { parse_mode: 'HTML' }
        ).catch((err) => console.error('mydriverrides: approx matches', err));
      }
      if (sameDayList.length > 0) {
        const linesSameDay = sameDayList.map((p) => {
          const time = p.departureTime ?? '—';
          return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(
          chatId,
          `🗓️ <b>Поїздки цього дня</b> (поїздка: ${routeDateLabel})\n\n` + linesSameDay,
          { parse_mode: 'HTML' }
        ).catch((err) => console.error('mydriverrides: same day matches', err));
      }
    }
  };

  const handleMypassengerrides = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    const normalized = normalizePhone(userPhone);
    const listings = await tgPrisma.viberListing.findMany({ where: { listingType: 'passenger', isActive: true }, orderBy: [{ date: 'asc' }, { departureTime: 'asc' }] });
    const myListings = listings.filter((l: { phone: string | null }) => normalizePhone(l.phone ?? '') === normalized);
    if (myListings.length === 0) {
      await bot?.sendMessage(chatId, '👤 <b>Мої запити (пасажир)</b>\n\nУ вас поки немає активних запитів на поїздку.\n\nДодати запит: /addpassengerride', { parse_mode: 'HTML' });
      return;
    }
    const lines = myListings.map((l: { route: string; date: Date; departureTime: string | null }) => `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${l.departureTime ?? '—'}`);
    await bot?.sendMessage(chatId, '👤 <b>Мої запити (пасажир)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /addpassengerride', { parse_mode: 'HTML' });

    // Співпадіння водіїв для кожного мого запиту (точні + приблизні + поїздки цього дня)
    for (const myPassenger of myListings.slice(0, 5)) {
      const matches = await findMatchingDriversForPassenger({
        route: myPassenger.route,
        date: myPassenger.date,
        departureTime: myPassenger.departureTime ?? null,
      });
      const matchesFiltered = matches.filter((m) => normalizePhone(m.listing.phone) !== normalized);
      const exactList = matchesFiltered.filter((m) => m.matchType === 'exact').map((m) => m.listing);
      const approxList = matchesFiltered.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
      const sameDayList = matchesFiltered.filter((m) => m.matchType === 'same_day').map((m) => m.listing);
      const routeDateLabel = `${getRouteName(myPassenger.route)}, ${formatDate(myPassenger.date)} о ${myPassenger.departureTime ?? '—'}`;
      if (exactList.length > 0) {
        const linesExact = exactList.map((d) => {
          const time = d.departureTime ?? '—';
          return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
        }).join('\n');
        const buttons = exactList.map((d) => ([
          { text: `🎫 ${truncateForButton(d.senderName ?? 'Водій')} · ${formatShortPhoneForButton(d.phone)} (${d.departureTime ?? '—'})`, callback_data: `vibermatch_book_${myPassenger.id}_${d.id}` }
        ]));
        await bot?.sendMessage(
          chatId,
          `🎯 <b>Пряме співпадіння (±45 хв) для вашого запиту:</b> ${routeDateLabel}\n\n` + linesExact +
          '\n\n_Натисніть кнопку — запит буде надісланий водію на підтвердження (1 година)._',
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }
        ).catch((err) => console.error('mypassengerrides: exact matches', err));
      }
      if (approxList.length > 0) {
        const linesApprox = approxList.map((d) => {
          const time = d.departureTime ?? '—';
          return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(
          chatId,
          `📌 <b>Приблизне співпадіння (±2 год)</b> (ваш запит: ${routeDateLabel})\n\n` + linesApprox,
          { parse_mode: 'HTML' }
        ).catch((err) => console.error('mypassengerrides: approx matches', err));
      }
      if (sameDayList.length > 0) {
        const linesSameDay = sameDayList.map((d) => {
          const time = d.departureTime ?? '—';
          return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(
          chatId,
          `🗓️ <b>Поїздки цього дня</b> (ваш запит: ${routeDateLabel})\n\n` + linesSameDay,
          { parse_mode: 'HTML' }
        ).catch((err) => console.error('mypassengerrides: same day matches', err));
      }
    }
  };

  const handleMybookings = async (chatId: string, userId: string) => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    try {
      await tgPrisma.booking.updateMany({ where: { telegramUserId: userId, telegramChatId: null }, data: { telegramChatId: chatId } });
      const allUserBookings = await tgPrisma.booking.findMany({ where: { telegramUserId: userId }, orderBy: { date: 'desc' } });
      if (allUserBookings.length > 0) {
        const userPhones = [...new Set(allUserBookings.map((b: { phone: string }) => b.phone))] as string[];
        for (const phone of userPhones) {
          const normalizedPhone = normalizePhone(phone);
          const allBookingsForPhone = await tgPrisma.booking.findMany({ where: { OR: [{ telegramUserId: null }, { telegramUserId: '0' }, { telegramUserId: '' }] } });
          const orphanedBookings = allBookingsForPhone.filter((b: { phone: string | null }) => normalizePhone(b.phone ?? '') === normalizedPhone);
          if (orphanedBookings.length > 0) {
            const person = await findOrCreatePersonByPhone(phone, { telegramChatId: chatId, telegramUserId: userId });
            for (const booking of orphanedBookings) {
              await tgPrisma.booking.update({ where: { id: booking.id }, data: { telegramUserId: userId, telegramChatId: chatId, personId: person.id } });
            }
          }
        }
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const futureBookings = await tgPrisma.booking.findMany({
        where: { telegramUserId: userId, date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 10,
        include: { viberListing: true }
      });
      const driverFutureBookings = await getDriverFutureBookingsForMybookings(userId, chatId, today);
      if (futureBookings.length === 0) {
        const finalAllBookings = await tgPrisma.booking.findMany({ where: { telegramUserId: userId }, orderBy: { date: 'desc' }, include: { viberListing: true } });
        if (finalAllBookings.length > 0) {
          const recentPast = finalAllBookings.slice(0, 3);
          let message = `📋 <b>Активних бронювань немає</b>\n\nАле знайдено ${finalAllBookings.length} минулих:\n\n`;
          recentPast.forEach((booking: { id: number; route: string; date: Date; departureTime: string | null; seats: number; name: string; viberListing?: { senderName: string | null; phone: string } | null }, index: number) => {
            const sourceLabel = (booking as { source?: string }).source === 'viber_match' ? ' · 🚗 Попутка' : '';
            message += `${index + 1}. 🎫 <b>#${booking.id}</b>${sourceLabel}\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 ${booking.name}\n`;
            if (booking.viberListing) message += `   🚗 Водій: ${booking.viberListing.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.viberListing.phone)}\n`;
            message += '\n';
          });
          if (driverFutureBookings.length > 0) {
            message += `\n\n🚗 <b>Забронювали у вас (як у водія):</b>\n\n`;
            driverFutureBookings.forEach((booking: { id: number; route: string; date: Date; departureTime: string | null; seats: number; name: string; phone: string }, index: number) => {
              message += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
            });
          }
          message += `\n💡 Створіть нове бронювання:\n🎫 /book - через бота\n🌐 /allrides - всі активні попутки\n🌐 https://malin.kiev.ua`;
          await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } else {
          let noBookingsMessage = `📋 <b>У вас поки немає бронювань</b>\n\n`;
          if (driverFutureBookings.length > 0) {
            driverFutureBookings.forEach((booking: { id: number; route: string; date: Date; departureTime: string | null; seats: number; name: string; phone: string }, index: number) => {
              noBookingsMessage += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
            });
            noBookingsMessage += '\n';
          }
          noBookingsMessage += `Створіть нове бронювання:\n🎫 /book - через бота\n🌐 /allrides - всі активні попутки\n🌐 https://malin.kiev.ua`;
          await bot?.sendMessage(chatId, noBookingsMessage, { parse_mode: 'HTML' });
        }
        return;
      }
      let message = `📋 <b>Ваші майбутні бронювання:</b>\n\n`;
      futureBookings.forEach((booking: { id: number; route: string; date: Date; departureTime: string | null; seats: number; name: string; viberListing?: { senderName: string | null; phone: string } | null }, index: number) => {
        const sourceLabel = (booking as { source?: string }).source === 'viber_match' ? ' · 🚗 Попутка' : '';
        message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>${sourceLabel}\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 ${booking.name}\n`;
        if (booking.viberListing) message += `   🚗 Водій: ${booking.viberListing.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.viberListing.phone)}\n`;
        message += '\n';
      });
      if (driverFutureBookings.length > 0) {
        message += `\n🚗 <b>Забронювали у вас (як у водія):</b>\n\n`;
        driverFutureBookings.forEach((booking: { id: number; route: string; date: Date; departureTime: string | null; seats: number; name: string; phone: string }, index: number) => {
          message += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
        });
      }
      message += `\n🔒 <i>Показано тільки ваші бронювання</i>`;
      await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('❌ Помилка отримання бронювань:', error);
      await bot?.sendMessage(chatId, '❌ Помилка при отриманні бронювань. Спробуйте пізніше.');
    }
  };

  /** Виконання команди з кнопки головного меню (прямий виклик, без emit). */
  const runMenuCommand = async (chatId: string, userId: string, command: string): Promise<void> => {
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await sendSharePhoneOnly(chatId);
      return;
    }
    switch (command) {
      case '/book':
        return handleBook(chatId, userId);
      case '/mybookings':
        return handleMybookings(chatId, userId);
      case '/allrides':
        return sendAllrides(chatId, userId, '');
      case '/cancel':
        return handleCancel(chatId, userId);
      case '/mydriverrides':
        return handleMydriverrides(chatId, userId);
      case '/mypassengerrides':
        return handleMypassengerrides(chatId, userId);
      case '/adddriverride':
        return startDriverRideFlow(chatId, userId);
      case '/addpassengerride':
        return startPassengerRideFlow(chatId, userId);
      case '/help':
        return handleHelp(chatId, userId);
      case '/poputky':
        return sendFreeViewInfo(chatId);
      default:
        return;
    }
  };

  // Команда /allrides — всі активні попутки + швидкі дії для зареєстрованого користувача
  // Підтримка фільтру: /allrides (майбутні), /allrides all (усі), /allrides DD.MM[.YYYY] або YYYY-MM-DD
  bot.onText(/^\/allrides(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const filterRaw = (match?.[1] ?? '').trim();
    await sendAllrides(chatId, userId, filterRaw);
  });

  // Команда /addviber — тільки для адміна в адмін-чаті: очікує наступне повідомлення з текстом з Вайберу (як «Додати оголошення» в адмінці)
  bot.onText(/\/addviber/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== adminChatId) return;
    addViberAwaitingMap.set(chatId, Date.now());
    await bot?.sendMessage(
      chatId,
      '📱 <b>Додати оголошення з Вайберу</b>\n\n' +
      'Надішліть текст оголошення — такий самий, як вставляєте в адмінці при кнопці «➕ Додати оголошення».\n\n' +
      'Можна одне повідомлення або кілька (скопіювати блок з чату). Через 10 хв очікування скасується.',
      { parse_mode: 'HTML' }
    );
  });

  // Команда /addtelegram — тільки для адміна: завантажити з групи або вставити текст вручну
  bot.onText(/\/addtelegram/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== adminChatId) return;
    const keyboard = {
      inline_keyboard: [
        [{ text: '📥 Завантажити нові', callback_data: 'addtelegram_fetch' }],
        [{ text: '📥 Завантажити всі (скинути)', callback_data: 'addtelegram_fetch_full' }],
        [{ text: '📋 Вставити текст вручну', callback_data: 'addtelegram_paste' }],
      ],
    };
    await bot?.sendMessage(
      chatId,
      '✈️ <b>Додати оголошення з Telegram (PoDoroguem)</b>\n\n' +
      '• <b>Завантажити нові</b> — тільки повідомлення, які ще не імпортували\n\n' +
      '• <b>Завантажити всі (скинути)</b> — завантажити всі знову (перший імпорт або скидання)\n\n' +
      '• <b>Вставити текст вручну</b> — переслати або вставити текст',
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Команда /checkclients — тільки для адміна: ті самі збіги, що й при новій поїздці (маршрут+дата, точне/приблизне/в цей день),
  // доставка через бот або ваш акаунт; пари вже сповічені раніше пропускаються (таблиця ViberMatchPairNotification).
  bot.onText(/^\/checkclients(?:@\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== adminChatId) return;
    const CHECKCLIENTS_PAIR_LINES_LIMIT = 30;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    await bot?.sendMessage(chatId, '⏳ Перевіряю співпадіння пасажирів та водіїв у майбутніх поїздках (як при автододаванні)…', {
      parse_mode: 'HTML',
    }).catch(() => {});

    const [drivers, passengers] = await Promise.all([
      tgPrisma.viberListing.findMany({
        where: { listingType: 'driver', isActive: true, date: { gte: now } },
        select: { id: true, route: true, date: true, departureTime: true, seats: true, phone: true, senderName: true, notes: true },
        orderBy: { date: 'asc' },
      }),
      tgPrisma.viberListing.findMany({
        where: { listingType: 'passenger', isActive: true, date: { gte: now } },
        select: { id: true, route: true, date: true, departureTime: true, phone: true, senderName: true, notes: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const passengersByKey = new Map<string, typeof passengers>();
    for (const p of passengers) {
      const key = `${p.route}__${toDateKey(p.date)}`;
      const arr = passengersByKey.get(key);
      if (arr) arr.push(p);
      else passengersByKey.set(key, [p]);
    }

    let pairCount = 0;
    let exactPairCount = 0;
    let approximatePairCount = 0;
    let sameDayPairCount = 0;
    let passengerSent = 0;
    let passengerSkipped = 0;
    let passengerFailed = 0;
    let driverSent = 0;
    let driverSkipped = 0;
    let driverFailed = 0;
    let sentViaUser = 0;
    let sentViaBot = 0;
    const pairLinesByType: Record<MatchType, string[]> = {
      exact: [],
      approximate: [],
      same_day: [],
    };

    for (const d of drivers) {
      const key = `${d.route}__${toDateKey(d.date)}`;
      const ps = passengersByKey.get(key);
      if (!ps || ps.length === 0) continue;
      for (const p of ps) {
        pairCount++;
        const matchType = resolveMatchType(d.departureTime, p.departureTime);
        if (pairLinesByType[matchType].length < CHECKCLIENTS_PAIR_LINES_LIMIT) {
          const driverTime = d.departureTime ?? '—';
          const passengerTime = p.departureTime ?? '—';
          const timeDelta =
            parseTimeRangeForMatch(d.departureTime) && parseTimeRangeForMatch(p.departureTime)
              ? (() => {
                  const dr = parseTimeRangeForMatch(d.departureTime)!;
                  const pr = parseTimeRangeForMatch(p.departureTime)!;
                  const overlapStart = Math.max(dr.start, pr.start);
                  const overlapEnd = Math.min(dr.end, pr.end);
                  if (overlapStart <= overlapEnd) return 'перетин';
                  const gap = Math.min(Math.abs(dr.start - pr.end), Math.abs(pr.start - dr.end));
                  return `Δ${gap}хв`;
                })()
              : 'час не вказано';
          pairLinesByType[matchType].push(
            `• #D${d.id}/#P${p.id} · ${getRouteName(d.route)} · ${formatDate(d.date)} · 🚗 ${driverTime} ↔ 👤 ${passengerTime} (${timeDelta})`
          );
        }
        if (matchType === 'exact') exactPairCount++;
        else if (matchType === 'approximate') approximatePairCount++;
        else sameDayPairCount++;

        const pOut = await notifyPassengerAboutDriverPair(d, { id: p.id, phone: p.phone }, matchType);
        if (pOut.kind === 'sent') {
          passengerSent++;
          if (pOut.via === 'user') sentViaUser++;
          else sentViaBot++;
        } else if (pOut.kind === 'skipped') passengerSkipped++;
        else passengerFailed++;

        const dOut = await notifyDriverAboutPassengerPair({ id: d.id, phone: d.phone }, p, matchType);
        if (dOut.kind === 'sent') {
          driverSent++;
          if (dOut.via === 'user') sentViaUser++;
          else sentViaBot++;
        } else if (dOut.kind === 'skipped') driverSkipped++;
        else driverFailed++;

        await sleepTelethonBatchDelay();
      }
    }

    const userSenderHint = isTelegramUserSenderEnabled()
      ? `\n• Усього відправок через ваш акаунт (Telethon): ${sentViaUser}`
      : `\n• Через ваш акаунт (Telethon): вимкнено (немає TELEGRAM_USER_SESSION_PATH / TELEGRAM_API_ID / TELEGRAM_API_HASH)`;

    await bot?.sendMessage(
      chatId,
      '✅ <b>/checkclients завершено</b>\n\n' +
        `• Пар (маршрут+дата): ${pairCount} (точний ±45 хв: ${exactPairCount}, приблизний ±2 год: ${approximatePairCount}, поїздки цього дня: ${sameDayPairCount})\n` +
        `• Пасажири: надіслано ${passengerSent}, пропущено (вже було): ${passengerSkipped}, не доставлено: ${passengerFailed}\n` +
        `• Водії: надіслано ${driverSent}, пропущено (вже було): ${driverSkipped}, не доставлено: ${driverFailed}\n` +
        `• Через бот: ${sentViaBot}` +
        userSenderHint,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    const sections: Array<{ type: MatchType; title: string }> = [
      { type: 'exact', title: `🎯 <b>Точні пари (±45 хв, до ${CHECKCLIENTS_PAIR_LINES_LIMIT})</b>` },
      { type: 'approximate', title: `📌 <b>Приблизні пари (±2 год, до ${CHECKCLIENTS_PAIR_LINES_LIMIT})</b>` },
      { type: 'same_day', title: `🗓️ <b>Поїздки цього дня (до ${CHECKCLIENTS_PAIR_LINES_LIMIT})</b>` },
    ];
    for (const section of sections) {
      const lines = pairLinesByType[section.type];
      if (lines.length === 0) continue;
      await bot?.sendMessage(chatId, `${section.title}\n\n${lines.join('\n')}`, {
        parse_mode: 'HTML',
      }).catch(() => {});
    }
  });

  // Обробка контакту (коли користувач ділиться номером через кнопку)
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const phoneNumber = msg.contact?.phone_number;
    
    if (!phoneNumber) {
      await bot?.sendMessage(chatId, '❌ Не вдалося отримати номер телефону.');
      return;
    }

    const driverState = driverRideStateMap.get(chatId);
    if (driverState?.state === 'driver_ride_flow' && driverState.step === 'phone') {
      const phone = normalizePhone(phoneNumber);
      if (driverState.draftToken) {
        const draft = getAnnounceDraft(driverState.draftToken);
        if (draft) {
          driverRideStateMap.set(chatId, { ...driverState, step: 'seats', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, priceUah: draft.priceUah ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
          const seatsKeyboard = { inline_keyboard: [
            [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
            [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
            [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ] };
          await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
          return;
        }
      }
      driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
      const routeKeyboard = {
        inline_keyboard: [
          [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
          [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
          [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
          [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
          [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
          [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
          [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
        ]
      };
      await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
      return;
    }

    const passengerState = passengerRideStateMap.get(chatId);
    if (passengerState?.state === 'passenger_ride_flow' && passengerState.step === 'phone') {
      const phone = normalizePhone(phoneNumber);
      if (passengerState.draftToken) {
        const draft = getAnnounceDraft(passengerState.draftToken);
        if (draft) {
          passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
          const notesKeyboard = { inline_keyboard: [[{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }], [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]] };
          const notesHint = draft.notes ? `\n\nПримітка з сайту: ${draft.notes}\nМожете залишити або змінити:` : '';
          await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.${notesHint}`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
          return;
        }
      }
      passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
      const routeKeyboard = {
        inline_keyboard: [
          [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
          [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
          [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
          [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
          [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
          [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
          [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
        ]
      };
      await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
      return;
    }
    
    const nameFromContact = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
    await registerUserPhone(chatId, userId, phoneNumber, nameFromContact);
  });

  // Обробка текстових повідомлень (номер телефону або текст поїздки водія)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const text = msg.text?.trim();
    // Кнопки головного меню: викликаємо обробник команди напряму (без emit — надійніше в node-telegram-bot-api)
    const command = text ? MENU_BUTTON_TO_COMMAND[text] : undefined;
    if (command && bot) {
      try {
        await runMenuCommand(chatId, userId, command);
      } catch (err) {
        console.error('❌ runMenuCommand:', err);
        await bot.sendMessage(chatId, '❌ Помилка виконання. Спробуйте ще раз або напишіть /help.');
      }
      return;
    }
    // Ігноруємо команди та контакти (вони обробляються окремо)
    if (msg.text?.startsWith('/') || msg.contact) {
      return;
    }

    if (!text) return;

    // Потік /addtelegram: адмін надіслав текст з Telegram групи PoDoroguem
    if (chatId === adminChatId && addTelegramAwaitingMap.has(chatId)) {
      const since = addTelegramAwaitingMap.get(chatId)!;
      addTelegramAwaitingMap.delete(chatId);
      if (Date.now() - since > ADDTELEGRAM_STATE_TTL_MS) {
        await bot?.sendMessage(chatId, '⏱ Час вийшов. Напишіть /addtelegram знову.');
        return;
      }
      try {
        const parsedMessages = parseTelegramMessages(text);
        if (parsedMessages.length === 0) {
          await bot?.sendMessage(chatId, '❌ Не вдалося розпарсити жодне повідомлення. Перевірте формат (маршрут, дата, телефон).');
          return;
        }
        let created = 0;
        for (let i = 0; i < parsedMessages.length; i++) {
          const { parsed, rawMessage: rawText, telegramUsername: tgUsername } = parsedMessages[i];
          try {
            const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
            let senderName = nameFromDb ?? parsed.senderName ?? null;
            if (parsed.phone?.trim()) {
              const phone = parsed.phone.trim();
              const personForChat = await getPersonByPhone(phone);
              const chatIdForPerson = personForChat?.telegramChatId ?? null;
              const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
                phone,
                chatIdForPerson,
              );
              const baseCurrentName = nameFromDb;
              const { newName } = pickBestNameFromCandidates(
                baseCurrentName,
                nameFromBot,
                nameFromUser,
                nameFromOpendatabot,
              );
              if (newName?.trim()) {
                senderName = newName.trim();
              } else if (!senderName || !String(senderName).trim()) {
                senderName = parsed.senderName ?? senderName;
              }
            }
            const person = parsed.phone
              ? await findOrCreatePersonByPhone(parsed.phone, {
                  fullName: senderName ?? undefined,
                  telegramUsername: tgUsername ?? undefined,
                })
              : null;
            const { listing, isNew } = await createOrMergeViberListing({
              rawMessage: rawText,
              source: 'telegram1',
              senderName: senderName ?? undefined,
              listingType: parsed.listingType,
              route: parsed.route,
              date: parsed.date,
              departureTime: parsed.departureTime,
              seats: parsed.seats,
              phone: parsed.phone,
              notes: parsed.notes,
              priceUah: parsed.price ?? undefined,
              isActive: true,
              personId: person?.id ?? undefined,
            });
            if (isNew) created++;
            if (isTelegramEnabled()) {
              await sendViberListingNotificationToAdmin({
                id: listing.id,
                listingType: listing.listingType,
                route: listing.route,
                date: listing.date,
                departureTime: listing.departureTime,
                seats: listing.seats,
                phone: listing.phone,
                senderName: listing.senderName,
                notes: listing.notes,
              }).catch((err) => console.error('Telegram notify:', err));
              if (listing.phone?.trim()) {
                sendViberListingConfirmationToUser(listing.phone, {
                  id: listing.id,
                  route: listing.route,
                  date: listing.date,
                  departureTime: listing.departureTime,
                  seats: listing.seats,
                  listingType: listing.listingType,
                }).catch((err) => console.error('Telegram user notify:', err));
                }
              const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
              if (listing.listingType === 'driver') {
                notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
              } else if (listing.listingType === 'passenger') {
                notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
              }
            }
          } catch (err) {
            console.error(`AddTelegram bulk item ${i} error:`, err);
          }
        }
        await bot?.sendMessage(chatId, `✅ Створено ${created} оголошень з Telegram (з ${parsedMessages.length}).`, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('AddTelegram error:', err);
        await bot?.sendMessage(chatId, '❌ Помилка створення оголошення. Спробуйте /addtelegram знову.');
      }
      return;
    }

    // Потік /addviber: адмін надіслав текст оголошення з Вайберу (та сама обробка, що в адмінці)
    if (chatId === adminChatId && addViberAwaitingMap.has(chatId)) {
      const since = addViberAwaitingMap.get(chatId)!;
      addViberAwaitingMap.delete(chatId);
      if (Date.now() - since > ADDVIBER_STATE_TTL_MS) {
        await bot?.sendMessage(chatId, '⏱ Час вийшов. Напишіть /addviber знову.');
        return;
      }
      try {
        const messageCount = (text.match(/\[.*?\]/g) || []).length;
        if (messageCount > 1) {
          const parsedMessages = parseViberMessages(text);
          if (parsedMessages.length === 0) {
            await bot?.sendMessage(chatId, '❌ Не вдалося розпарсити жодне повідомлення. Перевірте формат.');
            return;
          }
          let created = 0;
          for (let i = 0; i < parsedMessages.length; i++) {
            const { parsed, rawMessage: rawText } = parsedMessages[i];
            try {
              const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
              let senderName = nameFromDb ?? parsed.senderName ?? null;
              if (parsed.phone?.trim()) {
                const phone = parsed.phone.trim();
                const personForChat = await getPersonByPhone(phone);
                const chatIdForPerson = personForChat?.telegramChatId ?? null;
                const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
                  phone,
                  chatIdForPerson,
                );
                const baseCurrentName = nameFromDb;
                const { newName } = pickBestNameFromCandidates(
                  baseCurrentName,
                  nameFromBot,
                  nameFromUser,
                  nameFromOpendatabot,
                );
                if (newName?.trim()) {
                  senderName = newName.trim();
                } else if (!senderName || !String(senderName).trim()) {
                  senderName = parsed.senderName ?? senderName;
                }
              }
              const person = parsed.phone
                ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
                : null;
          const { listing, isNew } = await createOrMergeViberListing({
            rawMessage: rawText,
            source: 'Viber1',
            senderName: senderName ?? undefined,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone,
            notes: parsed.notes,
            priceUah: parsed.price ?? undefined,
            isActive: true,
            personId: person?.id ?? undefined,
          });
          if (isNew) {
            created++;
          }
              if (isTelegramEnabled()) {
                await sendViberListingNotificationToAdmin({
                  id: listing.id,
                  listingType: listing.listingType,
                  route: listing.route,
                  date: listing.date,
                  departureTime: listing.departureTime,
                  seats: listing.seats,
                  phone: listing.phone,
                  senderName: listing.senderName,
                  notes: listing.notes,
                }).catch((err) => console.error('Telegram Viber notify:', err));
                if (listing.phone?.trim()) {
                  sendViberListingConfirmationToUser(listing.phone, {
                    id: listing.id,
                    route: listing.route,
                    date: listing.date,
                    departureTime: listing.departureTime,
                    seats: listing.seats,
                    listingType: listing.listingType,
                  }                ).catch((err) => console.error('Telegram Viber user notify:', err));
                }
                const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
                if (listing.listingType === 'driver') {
                  notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
                } else if (listing.listingType === 'passenger') {
                  notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
                }
              }
            } catch (err) {
              console.error(`AddViber bulk item ${i} error:`, err);
            }
          }
          await bot?.sendMessage(chatId, `✅ Створено ${created} оголошень з ${parsedMessages.length}. Адміну надіслано сповіщення.`, { parse_mode: 'HTML' });
        } else {
          const parsed = parseViberMessage(text);
          if (!parsed) {
            await bot?.sendMessage(chatId, '❌ Не вдалося розпарсити повідомлення. Перевірте формат.');
            return;
          }
          const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
          let senderName = nameFromDb ?? parsed.senderName ?? null;
          if (parsed.phone?.trim()) {
            const phone = parsed.phone.trim();
            const personForChat = await getPersonByPhone(phone);
            const chatIdForPerson = personForChat?.telegramChatId ?? null;
            const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
              phone,
              chatIdForPerson,
            );
            const baseCurrentName = nameFromDb;
            const { newName } = pickBestNameFromCandidates(
              baseCurrentName,
              nameFromBot,
              nameFromUser,
              nameFromOpendatabot,
            );
            if (newName?.trim()) {
              senderName = newName.trim();
            } else if (!senderName || !String(senderName).trim()) {
              senderName = parsed.senderName ?? senderName;
            }
          }
          const person = parsed.phone
            ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
            : null;
          const { listing, isNew } = await createOrMergeViberListing({
            rawMessage: text,
            source: 'Viber1',
            senderName: senderName ?? undefined,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone,
            notes: parsed.notes,
            priceUah: parsed.price ?? undefined,
            isActive: true,
            personId: person?.id ?? undefined,
          });
          if (isTelegramEnabled()) {
            await sendViberListingNotificationToAdmin({
              id: listing.id,
              listingType: listing.listingType,
              route: listing.route,
              date: listing.date,
              departureTime: listing.departureTime,
              seats: listing.seats,
              phone: listing.phone,
              senderName: listing.senderName,
              notes: listing.notes,
            }).catch((err) => console.error('Telegram Viber notify:', err));
            if (listing.phone?.trim()) {
              sendViberListingConfirmationToUser(listing.phone, {
                id: listing.id,
                route: listing.route,
                date: listing.date,
                departureTime: listing.departureTime,
                seats: listing.seats,
                listingType: listing.listingType,
              }            ).catch((err) => console.error('Telegram Viber user notify:', err));
            }
            const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
            if (listing.listingType === 'driver') {
              notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
            } else if (listing.listingType === 'passenger') {
              notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
            }
          }
          const verb = isNew ? 'створено' : 'оновлено';
          await bot?.sendMessage(chatId, `✅ Оголошення #${listing.id} ${verb}. Адміну надіслано сповіщення.`, { parse_mode: 'HTML' });
        }
      } catch (err) {
        console.error('AddViber error:', err);
        await bot?.sendMessage(chatId, '❌ Помилка створення оголошення. Спробуйте /addviber знову.');
      }
      return;
    }

    // Потік /allrides: користувач обрав "Ввести дату" і надіслав дату текстом
    if (allridesAwaitingDateInputMap.has(chatId)) {
      const since = allridesAwaitingDateInputMap.get(chatId)!;
      if (Date.now() - since > ALLRIDES_FILTER_INPUT_TTL_MS) {
        allridesAwaitingDateInputMap.delete(chatId);
        await bot?.sendMessage(chatId, '⏱ Час на введення дати минув. Надішліть /allrides знову.');
        return;
      }

      const normalized = text.toLowerCase();
      if (normalized === 'скасувати' || normalized === 'cancel') {
        allridesAwaitingDateInputMap.delete(chatId);
        await bot?.sendMessage(chatId, '❌ Введення дати скасовано. Використайте /allrides для перегляду.');
        return;
      }

      const customDate = parseAllridesDateArg(text);
      if (!customDate) {
        await bot?.sendMessage(
          chatId,
          '❌ Не вдалося розпізнати дату.\n\n' +
            'Введіть, наприклад:\n' +
            '• 21.02\n' +
            '• 21.02.2026\n' +
            '• 2026-02-21\n\n' +
            'Або напишіть "скасувати".'
        );
        return;
      }

      allridesAwaitingDateInputMap.delete(chatId);
      await sendAllrides(chatId, userId, customDate.toISOString().slice(0, 10));
      return;
    }
    
    // Потік "додати поїздку (водій)" — введення дати, часу або примітки
    const driverState = driverRideStateMap.get(chatId);
    if (driverState?.state === 'driver_ride_flow') {
      if (Date.now() - driverState.since > DRIVER_RIDE_STATE_TTL_MS) {
        driverRideStateMap.delete(chatId);
        await bot?.sendMessage(chatId, '⏱ Час вийшов. /adddriverride — почати знову.');
        return;
      }
      const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
      if (driverState.step === 'date_custom') {
        const date = extractDate(text);
        const dateStr = date.toISOString().slice(0, 10);
        driverRideStateMap.set(chatId, { ...driverState, step: 'time', date: dateStr, since: Date.now() });
        const timeKeyboard = {
          inline_keyboard: [
            [{ text: '08:00', callback_data: 'adddriver_time_08:00' }, { text: '09:00', callback_data: 'adddriver_time_09:00' }, { text: '10:00', callback_data: 'adddriver_time_10:00' }],
            [{ text: '11:00', callback_data: 'adddriver_time_11:00' }, { text: '12:00', callback_data: 'adddriver_time_12:00' }, { text: '13:00', callback_data: 'adddriver_time_13:00' }],
            [{ text: '14:00', callback_data: 'adddriver_time_14:00' }, { text: '15:00', callback_data: 'adddriver_time_15:00' }, { text: '16:00', callback_data: 'adddriver_time_16:00' }],
            [{ text: '17:00', callback_data: 'adddriver_time_17:00' }, { text: '18:00', callback_data: 'adddriver_time_18:00' }, { text: '19:00', callback_data: 'adddriver_time_19:00' }],
            [{ text: '✏️ Свій час', callback_data: 'adddriver_time_custom' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, `📅 Дата: ${formatDate(date)}\n\n🕐 Оберіть час відправлення:`, { parse_mode: 'HTML', reply_markup: timeKeyboard });
        return;
      }
      if (driverState.step === 'time_custom') {
        const time = extractTime(text);
        if (!time) {
          await bot?.sendMessage(chatId, 'Не вдалося розпізнати час. Напишіть, наприклад: 18:00 або о 9:30');
          return;
        }
        driverRideStateMap.set(chatId, { ...driverState, step: 'seats', departureTime: time, since: Date.now() });
        const seatsKeyboard = {
          inline_keyboard: [
            [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
            [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
            [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, `🕐 Час: ${time}\n\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
        return;
      }
      if (driverState.step === 'price') {
        const num = parseInt(String(text).trim().replace(/\s/g, ''), 10);
        if (Number.isNaN(num) || num < 0) {
          await bot?.sendMessage(chatId, 'Введіть число (ціна в гривнях), наприклад: 150, або натисніть Пропустити.');
          return;
        }
        driverRideStateMap.set(chatId, { ...driverState, step: 'notes', priceUah: num, since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'adddriver_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.sendMessage(
          chatId,
          `💰 Ціна: ${num} грн\n\n6️⃣ Додати примітку (опціонально)?\nНапишіть текст або натисніть Пропустити.`,
          { parse_mode: 'HTML', reply_markup: notesKeyboard }
        );
        return;
      }
      if (driverState.step === 'notes') {
        driverRideStateMap.delete(chatId);
        try {
          await createDriverListingFromState(chatId, driverState, text || null, senderName);
        } catch (err) {
          console.error('Create driver listing error:', err);
          await bot?.sendMessage(chatId, '❌ Помилка збереження. /adddriverride — спробувати знову.');
        }
        return;
      }
      if (driverState.step === 'phone') {
        const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
        if (!phoneRegex.test(text)) {
          await bot?.sendMessage(chatId, 'Введіть коректний номер телефону, наприклад: 0501234567');
          return;
        }
        const phone = normalizePhone(text);
        if (driverState.draftToken) {
          const draft = getAnnounceDraft(driverState.draftToken);
          if (draft) {
            driverRideStateMap.set(chatId, { ...driverState, step: 'seats', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, priceUah: draft.priceUah ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
            const seatsKeyboard = { inline_keyboard: [
              [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
              [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
              [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
              [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
            ] };
            await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
            return;
          }
        }
        driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
        const routeKeyboard = {
          inline_keyboard: [
            [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
            [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
            [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
            [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
            [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
            [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
        return;
      }
    }

    // Потік "шукаю поїздку (пасажир)" — дата, час або примітка
    const passengerState = passengerRideStateMap.get(chatId);
    if (passengerState?.state === 'passenger_ride_flow') {
      if (Date.now() - passengerState.since > PASSENGER_RIDE_STATE_TTL_MS) {
        passengerRideStateMap.delete(chatId);
        await bot?.sendMessage(chatId, '⏱ Час вийшов. /addpassengerride — почати знову.');
        return;
      }
      const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
      if (passengerState.step === 'date_custom') {
        const date = extractDate(text);
        const dateStr = date.toISOString().slice(0, 10);
        passengerRideStateMap.set(chatId, { ...passengerState, step: 'time', date: dateStr, since: Date.now() });
        const timeKeyboard = {
          inline_keyboard: [
            [{ text: '08:00', callback_data: 'addpassenger_time_08:00' }, { text: '09:00', callback_data: 'addpassenger_time_09:00' }, { text: '10:00', callback_data: 'addpassenger_time_10:00' }],
            [{ text: '11:00', callback_data: 'addpassenger_time_11:00' }, { text: '12:00', callback_data: 'addpassenger_time_12:00' }, { text: '13:00', callback_data: 'addpassenger_time_13:00' }],
            [{ text: '14:00', callback_data: 'addpassenger_time_14:00' }, { text: '15:00', callback_data: 'addpassenger_time_15:00' }, { text: '16:00', callback_data: 'addpassenger_time_16:00' }],
            [{ text: '17:00', callback_data: 'addpassenger_time_17:00' }, { text: '18:00', callback_data: 'addpassenger_time_18:00' }, { text: '19:00', callback_data: 'addpassenger_time_19:00' }],
            [{ text: '✏️ Свій час', callback_data: 'addpassenger_time_custom' }, { text: 'Пропустити', callback_data: 'addpassenger_time_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, `📅 Дата: ${formatDate(date)}\n\n🕐 Оберіть час (або Пропустити):`, { parse_mode: 'HTML', reply_markup: timeKeyboard });
        return;
      }
      if (passengerState.step === 'time_custom') {
        const time = extractTime(text);
        if (!time) {
          await bot?.sendMessage(chatId, 'Не вдалося розпізнати час. Напишіть, наприклад: 18:00 або о 9:30');
          return;
        }
        passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', departureTime: time, since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, `🕐 Час: ${time}\n\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
        return;
      }
      if (passengerState.step === 'notes') {
        passengerRideStateMap.delete(chatId);
        try {
          await createPassengerListingFromState(chatId, passengerState, text || null, senderName);
        } catch (err) {
          console.error('Create passenger listing error:', err);
          await bot?.sendMessage(chatId, '❌ Помилка збереження. /addpassengerride — спробувати знову.');
        }
        return;
      }
      if (passengerState.step === 'phone') {
        const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
        if (!phoneRegex.test(text)) {
          await bot?.sendMessage(chatId, 'Введіть коректний номер телефону, наприклад: 0501234567');
          return;
        }
        const phone = normalizePhone(text);
        if (passengerState.draftToken) {
          const draft = getAnnounceDraft(passengerState.draftToken);
          if (draft) {
            passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
            const notesKeyboard = { inline_keyboard: [[{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }], [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]] };
            const notesHint = draft.notes ? `\n\nПримітка з сайту: ${draft.notes}\nМожете залишити або змінити:` : '';
            await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.${notesHint}`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
            return;
          }
        }
        passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
        const routeKeyboard = {
          inline_keyboard: [
            [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
            [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
            [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
            [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
            [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
            [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
        return;
      }
    }
    
    // Перевіряємо чи це схоже на номер телефону
    const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
    if (phoneRegex.test(text)) {
      const nameFromMessage = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
      await registerUserPhone(chatId, userId, text, nameFromMessage);
    } else {
      // Якщо користувач ще не зареєстрований, підказуємо
      const existingBooking = await tgPrisma.booking.findFirst({
        where: { telegramUserId: userId }
      });
      
      if (!existingBooking) {
        await bot?.sendMessage(
          chatId,
          '❓ Для початку роботи, будь ласка, надішліть свій номер телефону.\n\n' +
          'Використайте команду /start для інструкцій.'
        );
      }
    }
  });

  // Команда /mybookings - показує ТІЛЬКИ бронювання поточного користувача
  bot.onText(/\/mybookings/, async (msg) => {
    await handleMybookings(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  // Команда /cancel - скасування бронювання та оголошень попуток (водій/пасажир)
  bot.onText(/\/cancel/, async (msg) => {
    await handleCancel(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  // Команда /mydriverrides — мої поїздки як водій
  bot.onText(/\/mydriverrides/, async (msg) => {
    await handleMydriverrides(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  // Команда /mypassengerrides — мої запити як пасажир
  bot.onText(/\/mypassengerrides/, async (msg) => {
    await handleMypassengerrides(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  // Команда /adddriverride — додати поїздку як водій (меню)
  bot.onText(/\/adddriverride/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    await startDriverRideFlow(chatId, userId);
  });

  // Команда /addpassengerride — шукаю поїздку (пасажир)
  bot.onText(/\/addpassengerride/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    await startPassengerRideFlow(chatId, userId);
  });

  // Команда /book - створення нового бронювання
  bot.onText(/\/book/, async (msg) => {
    await handleBook(msg.chat.id.toString(), msg.from?.id.toString() || '');
  });

  // Обробка callback query (натискання inline кнопок)
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id.toString();
    const userId = query.from?.id.toString() || '';
    const data = query.data;
    const messageId = query.message?.message_id;
    
    if (!chatId || !data) return;
    if (chatId !== adminChatId && (data === 'addtelegram_fetch' || data === 'addtelegram_fetch_full' || data === 'addtelegram_paste')) return;

    try {
      // ---------- /addtelegram: завантажити з групи або вставити текст ----------
      if (data === 'addtelegram_fetch' || data === 'addtelegram_fetch_full') {
        const fullFetch = data === 'addtelegram_fetch_full';
        await bot?.answerCallbackQuery(query.id, { text: fullFetch ? 'Завантажую всі повідомлення...' : 'Завантажую нові повідомлення...' });
        const statusMsg = await bot?.sendMessage(chatId, fullFetch ? '⏳ Завантаження всіх повідомлень з PoDoroguem...' : '⏳ Завантаження нових повідомлень з PoDoroguem...');
        const rawText = await fetchTelegramGroupMessages({ limit: 50, fullFetch });
        if (rawText === null) {
          await bot?.editMessageText(
            '❌ Не вдалося завантажити повідомлення. Перевірте:\n' +
            '• Ваш акаунт додано в групу https://t.me/PoDoroguem\n' +
            '• TELEGRAM_USER_SESSION_PATH, TELEGRAM_API_ID, TELEGRAM_API_HASH налаштовані',
            { chat_id: chatId, message_id: statusMsg?.message_id }
          );
          return;
        }
        if (!rawText.trim()) {
          await bot?.editMessageText(
            '✅ Немає нових повідомлень для імпорту. Усі вже оброблені.',
            { chat_id: chatId, message_id: statusMsg?.message_id }
          );
          return;
        }
        const parsedMessages = parseTelegramMessages(rawText);
        if (parsedMessages.length === 0) {
          await bot?.editMessageText(
            '❌ Не вдалося розпарсити жодне повідомлення. Спробуйте /addtelegram → Вставити текст вручну.',
            { chat_id: chatId, message_id: statusMsg?.message_id }
          );
          return;
        }
        let created = 0;
        for (let i = 0; i < parsedMessages.length; i++) {
          const { parsed, rawMessage: rawTextItem, telegramUsername: tgUsername } = parsedMessages[i];
          try {
            const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
            let senderName = nameFromDb ?? parsed.senderName ?? null;
            if (parsed.phone?.trim()) {
              const phone = parsed.phone.trim();
              const personForChat = await getPersonByPhone(phone);
              const chatIdForPerson = personForChat?.telegramChatId ?? null;
              const { nameFromBot, nameFromUser, nameFromOpendatabot } = await getResolvedNameForPerson(
                phone,
                chatIdForPerson,
              );
              const baseCurrentName = nameFromDb;
              const { newName } = pickBestNameFromCandidates(
                baseCurrentName,
                nameFromBot,
                nameFromUser,
                nameFromOpendatabot,
              );
              if (newName?.trim()) senderName = newName.trim();
              else if (!senderName || !String(senderName).trim()) senderName = parsed.senderName ?? senderName;
            }
            const person = parsed.phone
              ? await findOrCreatePersonByPhone(parsed.phone, {
                  fullName: senderName ?? undefined,
                  telegramUsername: tgUsername ?? undefined,
                })
              : null;
            const { listing, isNew } = await createOrMergeViberListing({
              rawMessage: rawTextItem,
              source: 'telegram1',
              senderName: senderName ?? undefined,
              listingType: parsed.listingType,
              route: parsed.route,
              date: parsed.date,
              departureTime: parsed.departureTime,
              seats: parsed.seats,
              phone: parsed.phone,
              notes: parsed.notes,
              priceUah: parsed.price ?? undefined,
              isActive: true,
              personId: person?.id ?? undefined,
            });
            if (isNew) created++;
            if (isTelegramEnabled()) {
              await sendViberListingNotificationToAdmin({
                id: listing.id,
                listingType: listing.listingType,
                route: listing.route,
                date: listing.date,
                departureTime: listing.departureTime,
                seats: listing.seats,
                phone: listing.phone,
                senderName: listing.senderName,
                notes: listing.notes,
              }).catch((err) => console.error('Telegram notify:', err));
              if (listing.phone?.trim()) {
                sendViberListingConfirmationToUser(listing.phone, {
                  id: listing.id,
                  route: listing.route,
                  date: listing.date,
                  departureTime: listing.departureTime,
                  seats: listing.seats,
                  listingType: listing.listingType,
                }              ).catch((err) => console.error('Telegram user notify:', err));
              }
              const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
              if (listing.listingType === 'driver') {
                notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
              } else if (listing.listingType === 'passenger') {
                notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
              }
            }
          } catch (err) {
            console.error(`AddTelegram fetch item ${i} error:`, err);
          }
        }
        await bot?.editMessageText(
          `✅ Завантажено з групи: створено ${created} оголошень з ${parsedMessages.length}.`,
          { chat_id: chatId, message_id: statusMsg?.message_id }
        );
        return;
      }
      if (data === 'addtelegram_paste') {
        addTelegramAwaitingMap.set(chatId, Date.now());
        await bot?.sendMessage(
          chatId,
          '📋 Надішліть текст оголошення (переслати або вставити). Через 10 хв очікування скасується.',
          { parse_mode: 'HTML' }
        );
        await bot?.answerCallbackQuery(query.id, { text: 'Очікую текст від вас' });
        return;
      }

      // ---------- /allrides: фільтри списку ----------
      if (data === 'allrides_filter_future') {
        allridesAwaitingDateInputMap.delete(chatId);
        await sendAllrides(chatId, userId, '');
        await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки' });
        return;
      }
      if (data === 'allrides_filter_future_morning') {
        allridesAwaitingDateInputMap.delete(chatId);
        await sendAllrides(chatId, userId, '', 'morning');
        await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (ранок)' });
        return;
      }
      if (data === 'allrides_filter_future_afternoon') {
        allridesAwaitingDateInputMap.delete(chatId);
        await sendAllrides(chatId, userId, '', 'afternoon');
        await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (день)' });
        return;
      }
      if (data === 'allrides_filter_future_evening') {
        allridesAwaitingDateInputMap.delete(chatId);
        await sendAllrides(chatId, userId, '', 'evening');
        await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (вечір)' });
        return;
      }
      if (data === 'allrides_filter_all') {
        allridesAwaitingDateInputMap.delete(chatId);
        await sendAllrides(chatId, userId, 'all');
        await bot?.answerCallbackQuery(query.id, { text: 'Показано всі активні попутки' });
        return;
      }
      if (data === 'allrides_filter_today' || data === 'allrides_filter_tomorrow') {
        allridesAwaitingDateInputMap.delete(chatId);
        const d = data === 'allrides_filter_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
        d.setHours(0, 0, 0, 0);
        await sendAllrides(chatId, userId, d.toISOString().slice(0, 10));
        await bot?.answerCallbackQuery(query.id, { text: 'Фільтр за датою застосовано' });
        return;
      }
      if (data === 'allrides_filter_custom') {
        allridesAwaitingDateInputMap.set(chatId, Date.now());
        await bot?.sendMessage(
          chatId,
          '✏️ Введіть дату для /allrides, наприклад:\n' +
            '• 21.02\n' +
            '• 21.02.2026\n' +
            '• 2026-02-21\n\n' +
            'Або напишіть "скасувати".'
        );
        await bot?.answerCallbackQuery(query.id, { text: 'Очікую дату від вас' });
        return;
      }

      // ---------- Потік "додати поїздку (водій)" ----------
      if (data === 'adddriver_cancel') {
        driverRideStateMap.delete(chatId);
        await bot?.editMessageText('❌ Скасовано. Можете почати знову кнопкою «🚗 Додати поїздку» або /adddriverride.', { chat_id: chatId, message_id: messageId });
        await bot?.sendMessage(chatId, 'Головне меню:', { reply_markup: getMainMenuKeyboard() });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('adddriver_route_')) {
        const route = data.replace('adddriver_route_', '');
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'route') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.set(chatId, { ...state, step: 'date', route, since: Date.now() });
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateKeyboard = {
          inline_keyboard: [
            [{ text: `Сьогодні (${formatDate(today)})`, callback_data: 'adddriver_date_today' }],
            [{ text: `Завтра (${formatDate(tomorrow)})`, callback_data: 'adddriver_date_tomorrow' }],
            [{ text: '✏️ Інша дата', callback_data: 'adddriver_date_custom' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(`🛣 Напрямок: ${getRouteName(route)}\n\n2️⃣ Оберіть дату:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: dateKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'adddriver_date_today' || data === 'adddriver_date_tomorrow') {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'date') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        const d = data === 'adddriver_date_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
        const dateStr = d.toISOString().slice(0, 10);
        driverRideStateMap.set(chatId, { ...state, step: 'time', date: dateStr, since: Date.now() });
        const timeKeyboard = {
          inline_keyboard: [
            [{ text: '08:00', callback_data: 'adddriver_time_08:00' }, { text: '09:00', callback_data: 'adddriver_time_09:00' }, { text: '10:00', callback_data: 'adddriver_time_10:00' }],
            [{ text: '11:00', callback_data: 'adddriver_time_11:00' }, { text: '12:00', callback_data: 'adddriver_time_12:00' }, { text: '13:00', callback_data: 'adddriver_time_13:00' }],
            [{ text: '14:00', callback_data: 'adddriver_time_14:00' }, { text: '15:00', callback_data: 'adddriver_time_15:00' }, { text: '16:00', callback_data: 'adddriver_time_16:00' }],
            [{ text: '17:00', callback_data: 'adddriver_time_17:00' }, { text: '18:00', callback_data: 'adddriver_time_18:00' }, { text: '19:00', callback_data: 'adddriver_time_19:00' }],
            [{ text: '✏️ Свій час', callback_data: 'adddriver_time_custom' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(`📅 Дата: ${formatDate(d)}\n\n3️⃣ Оберіть час:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: timeKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'adddriver_date_custom') {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'date') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.set(chatId, { ...state, step: 'date_custom', since: Date.now() });
        await bot?.editMessageText('✏️ Напишіть дату, наприклад:\n• 15.02\n• завтра\n• сьогодні', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('adddriver_time_') && data !== 'adddriver_time_custom') {
        const time = data.replace('adddriver_time_', '');
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'time') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.set(chatId, { ...state, step: 'seats', departureTime: time, since: Date.now() });
        const seatsKeyboard = {
          inline_keyboard: [
            [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
            [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
            [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(`🕐 Час: ${time}\n\n4️⃣ Скільки вільних місць?`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: seatsKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'adddriver_time_custom') {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'time') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.set(chatId, { ...state, step: 'time_custom', since: Date.now() });
        await bot?.editMessageText('✏️ Напишіть час, наприклад: 18:00 або о 9:30', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('adddriver_seats_')) {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'seats') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        const seats = data === 'adddriver_seats_skip' ? null : parseInt(data.replace('adddriver_seats_', ''), 10);
        driverRideStateMap.set(chatId, { ...state, step: 'price', seats: seats ?? undefined, since: Date.now() });
        const priceKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'adddriver_price_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(
          (state.departureTime ? `🕐 Час: ${state.departureTime}\n` : '') +
          (seats != null ? `🎫 Місць: ${seats}\n\n` : '') +
          '5️⃣ Ціна в грн (опціонально)?\nНапишіть число або натисніть Пропустити.',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: priceKeyboard }
        );
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'adddriver_price_skip') {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'price') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.set(chatId, { ...state, step: 'notes', since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'adddriver_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(
          (state.departureTime ? `🕐 Час: ${state.departureTime}\n` : '') +
          (state.seats != null ? `🎫 Місць: ${state.seats}\n` : '') +
          '\n6️⃣ Додати примітку (опціонально)?\nНапишіть текст або натисніть Пропустити.',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: notesKeyboard }
        );
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'adddriver_notes_skip') {
        const state = driverRideStateMap.get(chatId);
        if (!state || state.state !== 'driver_ride_flow' || state.step !== 'notes') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        driverRideStateMap.delete(chatId);
        const senderName = query.from?.first_name ? [query.from.first_name, query.from?.last_name].filter(Boolean).join(' ') : null;
        const notes = state.notesFromDraft ?? null;
        try {
          await createDriverListingFromState(chatId, state, notes, senderName);
        } catch (err) {
          console.error('Create driver listing error:', err);
          await bot?.sendMessage(chatId, '❌ Помилка збереження. /adddriverride — спробувати знову.');
        }
        await bot?.editMessageText('✅ Готово! Оголошення створено.', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }

      // ---------- Потік "шукаю поїздку (пасажир)" ----------
      if (data === 'addpassenger_cancel') {
        passengerRideStateMap.delete(chatId);
        await bot?.editMessageText('❌ Скасовано. Можете почати знову кнопкою «👤 Шукаю поїздку» або /addpassengerride.', { chat_id: chatId, message_id: messageId });
        await bot?.sendMessage(chatId, 'Головне меню:', { reply_markup: getMainMenuKeyboard() });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('addpassenger_route_')) {
        const route = data.replace('addpassenger_route_', '');
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'route') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.set(chatId, { ...state, step: 'date', route, since: Date.now() });
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateKeyboard = {
          inline_keyboard: [
            [{ text: `Сьогодні (${formatDate(today)})`, callback_data: 'addpassenger_date_today' }],
            [{ text: `Завтра (${formatDate(tomorrow)})`, callback_data: 'addpassenger_date_tomorrow' }],
            [{ text: '✏️ Інша дата', callback_data: 'addpassenger_date_custom' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.editMessageText(`🛣 Напрямок: ${getRouteName(route)}\n\n2️⃣ Оберіть дату:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: dateKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'addpassenger_date_today' || data === 'addpassenger_date_tomorrow') {
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'date') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        const d = data === 'addpassenger_date_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
        const dateStr = d.toISOString().slice(0, 10);
        passengerRideStateMap.set(chatId, { ...state, step: 'time', date: dateStr, since: Date.now() });
        const timeKeyboard = {
          inline_keyboard: [
            [{ text: '08:00', callback_data: 'addpassenger_time_08:00' }, { text: '09:00', callback_data: 'addpassenger_time_09:00' }, { text: '10:00', callback_data: 'addpassenger_time_10:00' }],
            [{ text: '11:00', callback_data: 'addpassenger_time_11:00' }, { text: '12:00', callback_data: 'addpassenger_time_12:00' }, { text: '13:00', callback_data: 'addpassenger_time_13:00' }],
            [{ text: '14:00', callback_data: 'addpassenger_time_14:00' }, { text: '15:00', callback_data: 'addpassenger_time_15:00' }, { text: '16:00', callback_data: 'addpassenger_time_16:00' }],
            [{ text: '17:00', callback_data: 'addpassenger_time_17:00' }, { text: '18:00', callback_data: 'addpassenger_time_18:00' }, { text: '19:00', callback_data: 'addpassenger_time_19:00' }],
            [{ text: '✏️ Свій час', callback_data: 'addpassenger_time_custom' }, { text: 'Пропустити', callback_data: 'addpassenger_time_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.editMessageText(`📅 Дата: ${formatDate(d)}\n\n3️⃣ Оберіть час (або Пропустити):`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: timeKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'addpassenger_date_custom') {
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'date') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.set(chatId, { ...state, step: 'date_custom', since: Date.now() });
        await bot?.editMessageText('✏️ Напишіть дату, наприклад:\n• 15.02\n• завтра\n• сьогодні', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('addpassenger_time_') && data !== 'addpassenger_time_custom' && data !== 'addpassenger_time_skip') {
        const time = data.replace('addpassenger_time_', '');
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.set(chatId, { ...state, step: 'notes', departureTime: time, since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.editMessageText(`🕐 Час: ${time}\n\n4️⃣ Додати примітку (опціонально)? Напишіть текст або натисніть Пропустити.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: notesKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'addpassenger_time_skip') {
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.set(chatId, { ...state, step: 'notes', departureTime: null, since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
          ]
        };
        await bot?.editMessageText('4️⃣ Додати примітку (опціонально)? Напишіть текст або натисніть Пропустити.', { chat_id: chatId, message_id: messageId, reply_markup: notesKeyboard });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'addpassenger_time_custom') {
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.set(chatId, { ...state, step: 'time_custom', since: Date.now() });
        await bot?.editMessageText('✏️ Напишіть час, наприклад: 18:00 або о 9:30', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      if (data === 'addpassenger_notes_skip') {
        const state = passengerRideStateMap.get(chatId);
        if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'notes') {
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        passengerRideStateMap.delete(chatId);
        const senderName = query.from?.first_name ? [query.from.first_name, query.from?.last_name].filter(Boolean).join(' ') : null;
        const notes = state.notesFromDraft ?? null;
        try {
          await createPassengerListingFromState(chatId, state, notes, senderName);
        } catch (err) {
          console.error('Create passenger listing error:', err);
          await bot?.sendMessage(chatId, '❌ Помилка збереження. /addpassengerride — спробувати знову.');
        }
        await bot?.editMessageText('✅ Готово! Запит на поїздку створено.', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }

      // ---------- Попутка: водій надсилає запит пасажиру (реверс) ----------
      if (data.startsWith('vibermatch_book_driver_')) {
        const parts = data.replace('vibermatch_book_driver_', '').split('_');
        const driverListingId = parseInt(parts[0], 10);
        const passengerListingId = parseInt(parts[1], 10);
        if (isNaN(driverListingId) || isNaN(passengerListingId)) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
          return;
        }

        const [driverListing, passengerListing] = await Promise.all([
          tgPrisma.viberListing.findUnique({ where: { id: driverListingId } }),
          tgPrisma.viberListing.findUnique({ where: { id: passengerListingId } }),
        ]);

        if (!driverListing || !passengerListing || driverListing.listingType !== 'driver' || passengerListing.listingType !== 'passenger') {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено' });
          return;
        }

        const driverPerson = await getPersonByTelegram(userId, chatId);
        const isDriverOwner = !!driverPerson && normalizePhone(driverPerson.phoneNormalized) === normalizePhone(driverListing.phone);
        if (!isDriverOwner) {
          await bot?.answerCallbackQuery(query.id, { text: 'Ця дія доступна тільки водію цього оголошення' });
          return;
        }

        const passengerChatId = await getChatIdByPhone(passengerListing.phone);
        if (!passengerChatId) {
          await bot?.answerCallbackQuery(query.id, { text: 'Пасажир не підключений до Telegram' });
          return;
        }

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        const request = await tgPrisma.rideShareRequest.create({
          data: { passengerListingId, driverListingId, status: 'pending', expiresAt },
        });

        const confirmKeyboard = {
          inline_keyboard: [[{ text: '✅ Підтвердити поїздку (1 год)', callback_data: `vibermatch_confirm_passenger_${request.id}` }]],
        };

        await bot?.sendMessage(
          passengerChatId,
          `🎫 <b>Водій пропонує поїздку</b>\n\n` +
            `🚗 ${driverListing.senderName ?? 'Водій'} пропонує вам поїздку.\n\n` +
            `🛣 ${getRouteName(driverListing.route)}\n` +
            `📅 ${formatDate(driverListing.date)}\n` +
            (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
            `📞 ${formatPhoneTelLink(driverListing.phone)}` +
            (driverListing.notes ? `\n📝 ${driverListing.notes}` : '') +
            `\n\n_У вас є 1 година на підтвердження._`,
          { parse_mode: 'HTML', reply_markup: confirmKeyboard }
        ).catch(() => {});

        await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано пасажиру. Очікуйте підтвердження (1 год).' });
        await bot?.sendMessage(chatId, '✅ Запит надіслано пасажиру. Він отримає сповіщення і матиме 1 годину на підтвердження.', { parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      // ---------- Попутка: пасажир натиснув "Забронювати у водія" ----------
      if (data.startsWith('vibermatch_book_')) {
        const parts = data.replace('vibermatch_book_', '').split('_');
        const passengerListingId = parseInt(parts[0], 10);
        const driverListingId = parseInt(parts[1], 10);
        if (isNaN(passengerListingId) || isNaN(driverListingId)) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
          return;
        }
        const [passengerListing, driverListing] = await Promise.all([
          tgPrisma.viberListing.findUnique({ where: { id: passengerListingId } }),
          tgPrisma.viberListing.findUnique({ where: { id: driverListingId } })
        ]);
        if (!passengerListing || !driverListing || passengerListing.listingType !== 'passenger' || driverListing.listingType !== 'driver') {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено' });
          return;
        }
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 година
        const request = await tgPrisma.rideShareRequest.create({
          data: { passengerListingId, driverListingId, status: 'pending', expiresAt }
        });
        const driverChatId = await getChatIdByPhone(driverListing.phone);
        const passengerName = passengerListing.senderName ?? 'Пасажир';
        if (driverChatId) {
          const confirmKeyboard = {
            inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${request.id}` }]]
          };
          await bot?.sendMessage(
            driverChatId,
            `🎫 <b>Запит на попутку</b>\n\n` +
              `👤 ${passengerName} хоче поїхати з вами.\n\n` +
              `🛣 ${getRouteName(driverListing.route)}\n` +
              `📅 ${formatDate(driverListing.date)}\n` +
              (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
              `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
              (passengerListing.notes ? `\n📝 ${passengerListing.notes}` : '') +
              `\n\n_У вас є 1 година на підтвердження._`,
            { parse_mode: 'HTML', reply_markup: confirmKeyboard }
          ).catch(() => {});
        }
        await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано водію. Очікуйте підтвердження (1 год).' });
        await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      // ---------- /book: немає рейсів — пасажир натиснув "Забронювати у водія" (кнопка або посилання) ----------
      if (data.startsWith('book_viber_')) {
        const driverListingId = parseInt(data.replace('book_viber_', ''), 10);
        if (isNaN(driverListingId)) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
          return;
        }
        const result = await executeBookViberRideShare(chatId, userId, driverListingId, query.from?.first_name ?? undefined);
        if (result.ok) {
          await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано водію. Очікуйте підтвердження (1 год).' });
          await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' }).catch(() => {});
        } else {
          await bot?.answerCallbackQuery(query.id, { text: 'Спочатку поділіться номером телефону' });
          await sendSharePhoneOnly(chatId);
        }
        return;
      }

      // ---------- Попутка: водій натиснув "Підтвердити бронювання" ----------
      if (data.startsWith('vibermatch_confirm_') && !data.startsWith('vibermatch_confirm_passenger_')) {
        const requestId = parseInt(data.replace('vibermatch_confirm_', ''), 10);
        if (isNaN(requestId)) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
          return;
        }
        const request = await tgPrisma.rideShareRequest.findUnique({
          where: { id: requestId },
          include: { passengerListing: true, driverListing: true }
        });
        if (!request) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Запит не знайдено' });
          return;
        }
        if (request.status !== 'pending') {
          await bot?.answerCallbackQuery(query.id, { text: request.status === 'confirmed' ? '✅ Вже підтверджено' : 'Запит не активний' });
          return;
        }
        if (new Date() > request.expiresAt) {
          await tgPrisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'expired' } });
          await bot?.answerCallbackQuery(query.id, { text: '⏱ Час на підтвердження минув' });
          return;
        }
        const { passengerListing, driverListing } = request;
        await findOrCreatePersonByPhone(passengerListing.phone, { fullName: passengerListing.senderName ?? undefined });
        const passengerPerson = await getPersonByPhone(passengerListing.phone);
        const driverPerson = await getPersonByTelegram(userId, chatId);
        const isDriver = driverPerson && normalizePhone(driverPerson.phoneNormalized) === normalizePhone(driverListing.phone);
        if (!isDriver) {
          await bot?.answerCallbackQuery(query.id, { text: 'Це підтвердження лише для водія цієї поїздки' });
          return;
        }
        if (!passengerPerson) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка: пасажир не знайдений' });
          return;
        }
        const booking = await tgPrisma.booking.create({
          data: {
            route: driverListing.route,
            date: driverListing.date,
            departureTime: driverListing.departureTime ?? '—',
            seats: 1,
            name: passengerListing.senderName ?? 'Пасажир',
            phone: passengerListing.phone,
            personId: passengerPerson.id,
            telegramChatId: passengerPerson.telegramChatId,
            telegramUserId: passengerPerson.telegramUserId,
            source: 'viber_match',
            viberListingId: driverListing.id
          }
        });
        await tgPrisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'confirmed' } });
        const passengerChatId = passengerPerson.telegramChatId;
        if (passengerChatId) {
          await bot?.sendMessage(
            passengerChatId,
            `✅ <b>Водій підтвердив ваше бронювання!</b>\n\n` +
              `🎫 №${booking.id} · 🚗 Попутка\n` +
              `🛣 ${getRouteName(driverListing.route)}\n` +
              `📅 ${formatDate(driverListing.date)}\n` +
              (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
              `👤 Водій: ${driverListing.senderName ?? '—'}\n` +
              `📞 ${formatPhoneTelLink(driverListing.phone)}\n\n` +
              `Поїздка з\'явиться у /mybookings.`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        await bot?.answerCallbackQuery(query.id, { text: 'Бронювання підтверджено! Пасажир отримав сповіщення.' });
        await bot?.sendMessage(chatId, '✅ Ви підтвердили бронювання. Пасажир отримав сповіщення.', { parse_mode: 'HTML' }).catch(() => {});
        if (adminChatId) {
          await bot?.sendMessage(
            adminChatId,
            `🚗 <b>Попутка підтверджена</b>\n\n` +
              `Бронювання #${booking.id} (viber_match)\n` +
              `Пасажир: ${booking.name}, ${formatPhoneTelLink(booking.phone)}\n` +
              `Водій: ${driverListing.senderName ?? '—'}, ${formatPhoneTelLink(driverListing.phone)}\n` +
              `${getRouteName(driverListing.route)} · ${formatDate(driverListing.date)}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        return;
      }

      // ---------- Попутка: пасажир підтверджує запит від водія (реверс) ----------
      if (data.startsWith('vibermatch_confirm_passenger_')) {
        const requestId = parseInt(data.replace('vibermatch_confirm_passenger_', ''), 10);
        if (isNaN(requestId)) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
          return;
        }
        const request = await tgPrisma.rideShareRequest.findUnique({
          where: { id: requestId },
          include: { passengerListing: true, driverListing: true },
        });
        if (!request) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Запит не знайдено' });
          return;
        }
        if (request.status !== 'pending') {
          await bot?.answerCallbackQuery(query.id, { text: request.status === 'confirmed' ? '✅ Вже підтверджено' : 'Запит не активний' });
          return;
        }
        if (new Date() > request.expiresAt) {
          await tgPrisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'expired' } });
          await bot?.answerCallbackQuery(query.id, { text: '⏱ Час на підтвердження минув' });
          return;
        }

        const { passengerListing, driverListing } = request;
        await findOrCreatePersonByPhone(passengerListing.phone, { fullName: passengerListing.senderName ?? undefined });
        const passengerPerson = await getPersonByTelegram(userId, chatId);
        const isPassenger = !!passengerPerson && normalizePhone(passengerPerson.phoneNormalized) === normalizePhone(passengerListing.phone);
        if (!isPassenger) {
          await bot?.answerCallbackQuery(query.id, { text: 'Це підтвердження лише для пасажира цього запиту' });
          return;
        }

        const booking = await tgPrisma.booking.create({
          data: {
            route: driverListing.route,
            date: driverListing.date,
            departureTime: driverListing.departureTime ?? '—',
            seats: 1,
            name: passengerListing.senderName ?? passengerPerson.fullName?.trim() ?? 'Пасажир',
            phone: passengerListing.phone,
            personId: passengerPerson.id,
            telegramChatId: passengerPerson.telegramChatId,
            telegramUserId: passengerPerson.telegramUserId,
            source: 'viber_match',
            viberListingId: driverListing.id,
          },
        });

        await tgPrisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'confirmed' } });

        const driverChatId = await getChatIdByPhone(driverListing.phone);
        if (driverChatId) {
          await bot?.sendMessage(
            driverChatId,
            `✅ <b>Пасажир підтвердив вашу пропозицію!</b>\n\n` +
              `🎫 №${booking.id} · 🚗 Попутка\n` +
              `🛣 ${getRouteName(driverListing.route)}\n` +
              `📅 ${formatDate(driverListing.date)}\n` +
              (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
              `👤 Пасажир: ${booking.name}\n` +
              `📞 ${formatPhoneTelLink(booking.phone)}\n\n` +
              `Поїздка з'явиться у /mybookings.`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }

        await bot?.answerCallbackQuery(query.id, { text: 'Поїздку підтверджено! Водій отримав сповіщення.' });
        await bot?.sendMessage(chatId, '✅ Ви підтвердили поїздку. Водій отримав сповіщення.', { parse_mode: 'HTML' }).catch(() => {});

        if (adminChatId) {
          await bot?.sendMessage(
            adminChatId,
            `🚗 <b>Попутка підтверджена (реверс)</b>\n\n` +
              `Бронювання #${booking.id} (viber_match)\n` +
              `Пасажир: ${booking.name}, ${formatPhoneTelLink(booking.phone)}\n` +
              `Водій: ${driverListing.senderName ?? '—'}, ${formatPhoneTelLink(driverListing.phone)}\n` +
              `${getRouteName(driverListing.route)} · ${formatDate(driverListing.date)}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        return;
      }

      // Відміна оголошення попутки (водій) — підтвердження
      if (data.startsWith('cancel_driver_')) {
        const listingId = data.replace('cancel_driver_', '');
        const listing = await tgPrisma.viberListing.findFirst({
          where: { id: Number(listingId), listingType: 'driver', isActive: true }
        });
        if (!listing) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено або вже скасовано' });
          return;
        }
        const person = await getPersonByTelegram(userId, chatId);
        const personPhone = person ? normalizePhone((person as { phoneNormalized?: string }).phoneNormalized ?? '') : '';
        const listingPhoneNorm = normalizePhone(listing.phone);
        const isMine = person
          ? (listing.personId === person.id || listingPhoneNorm === personPhone)
          : (await getPhoneByTelegramUser(userId, chatId).then((p) => (p ? normalizePhone(p) : '')) === listingPhoneNorm);
        if (!isMine) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Це не ваше оголошення' });
          return;
        }
        const confirmKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Так, відмінити оголошення', callback_data: `confirm_cancel_driver_${listingId}` },
              { text: '❌ Ні, залишити', callback_data: 'cancel_abort' }
            ]
          ]
        };
        await bot?.editMessageText(
          '⚠️ <b>Відміна оголошення (водій)</b>\n\n' +
          `🚗 #${listing.id}: ${getRouteName(listing.route)} — ${formatDate(listing.date)} о ${listing.departureTime ?? '—'}\n\n` +
          'Ви впевнені, що хочете відмінити це оголошення? Воно зникне зі списку попуток.',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: confirmKeyboard }
        );
        await bot?.answerCallbackQuery(query.id);
        return;
      }

      // Відміна оголошення попутки (пасажир) — підтвердження
      if (data.startsWith('cancel_passenger_')) {
        const listingId = data.replace('cancel_passenger_', '');
        const listing = await tgPrisma.viberListing.findFirst({
          where: { id: Number(listingId), listingType: 'passenger', isActive: true }
        });
        if (!listing) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Заявку не знайдено або вже скасовано' });
          return;
        }
        const person = await getPersonByTelegram(userId, chatId);
        const personPhone = person ? normalizePhone((person as { phoneNormalized?: string }).phoneNormalized ?? '') : '';
        const listingPhoneNorm = normalizePhone(listing.phone);
        const isMine = person
          ? (listing.personId === person.id || listingPhoneNorm === personPhone)
          : (await getPhoneByTelegramUser(userId, chatId).then((p) => (p ? normalizePhone(p) : '')) === listingPhoneNorm);
        if (!isMine) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Це не ваша заявка' });
          return;
        }
        const confirmKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Так, відмінити заявку', callback_data: `confirm_cancel_passenger_${listingId}` },
              { text: '❌ Ні, залишити', callback_data: 'cancel_abort' }
            ]
          ]
        };
        await bot?.editMessageText(
          '⚠️ <b>Відміна заявки (пасажир)</b>\n\n' +
          `👤 #${listing.id}: ${getRouteName(listing.route)} — ${formatDate(listing.date)} о ${listing.departureTime ?? '—'}\n\n` +
          'Ви впевнені, що хочете відмінити цю заявку на поїздку?',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: confirmKeyboard }
        );
        await bot?.answerCallbackQuery(query.id);
        return;
      }

      // Підтвердження відміни оголошення (водій)
      if (data.startsWith('confirm_cancel_driver_')) {
        const listingId = data.replace('confirm_cancel_driver_', '');
        const listing = await tgPrisma.viberListing.findFirst({
          where: { id: Number(listingId), listingType: 'driver' }
        });
        if (!listing) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено' });
          return;
        }
        const person = await getPersonByTelegram(userId, chatId);
        const canCancel = person ? (listing.personId === person.id || normalizePhone(listing.phone) === normalizePhone((person as { phoneNormalized?: string }).phoneNormalized ?? '')) : (await getPhoneByTelegramUser(userId, chatId).then((p) => (p ? normalizePhone(p) : '')) === normalizePhone(listing.phone));
        if (!canCancel) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Це не ваше оголошення' });
          return;
        }
        await tgPrisma.viberListing.update({ where: { id: Number(listingId) }, data: { isActive: false } });
        await bot?.editMessageText(
          '✅ <b>Оголошення (водій) відмінено</b>\n\n' +
          `🚗 #${listingId}: ${getRouteName(listing.route)} — ${formatDate(listing.date)}\n\n` +
          '💡 /adddriverride — додати нову поїздку\n🚫 /cancel — скасувати бронювання або інші оголошення',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
        );
        await bot?.answerCallbackQuery(query.id, { text: '✅ Оголошення відмінено' });
        return;
      }

      // Підтвердження відміни заявки (пасажир)
      if (data.startsWith('confirm_cancel_passenger_')) {
        const listingId = data.replace('confirm_cancel_passenger_', '');
        const listing = await tgPrisma.viberListing.findFirst({
          where: { id: Number(listingId), listingType: 'passenger' }
        });
        if (!listing) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Заявку не знайдено' });
          return;
        }
        const person = await getPersonByTelegram(userId, chatId);
        const canCancel = person ? (listing.personId === person.id || normalizePhone(listing.phone) === normalizePhone((person as { phoneNormalized?: string }).phoneNormalized ?? '')) : (await getPhoneByTelegramUser(userId, chatId).then((p) => (p ? normalizePhone(p) : '')) === normalizePhone(listing.phone));
        if (!canCancel) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Це не ваша заявка' });
          return;
        }
        await tgPrisma.viberListing.update({ where: { id: Number(listingId) }, data: { isActive: false } });
        await bot?.editMessageText(
          '✅ <b>Заявку (пасажир) відмінено</b>\n\n' +
          `👤 #${listingId}: ${getRouteName(listing.route)} — ${formatDate(listing.date)}\n\n` +
          '💡 /addpassengerride — шукати поїздку\n🚫 /cancel — скасувати бронювання або інші оголошення',
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
        );
        await bot?.answerCallbackQuery(query.id, { text: '✅ Заявку відмінено' });
        return;
      }

      // Скасування бронювання - показати підтвердження (тільки cancel_<число>)
      if (/^cancel_\d+$/.test(data)) {
        const bookingId = data.replace('cancel_', '');
        
        // Отримати інформацію про бронювання
        const booking = await tgPrisma.booking.findUnique({
          where: { id: Number(bookingId) }
        });
        
        if (!booking) {
          await bot?.answerCallbackQuery(query.id, { text: '❌ Бронювання не знайдено' });
          return;
        }
        
        const confirmKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Так, скасувати', callback_data: `confirm_cancel_${bookingId}` },
              { text: '❌ Ні, залишити', callback_data: 'cancel_abort' }
            ]
          ]
        };
        
        await bot?.editMessageText(
          '⚠️ <b>Підтвердження скасування</b>\n\n' +
          `🎫 <b>Бронювання #${booking.id}</b>\n` +
          `📍 ${getRouteName(booking.route)}\n` +
          `📅 ${formatDate(booking.date)} о ${booking.departureTime}\n` +
          `🎫 Місць: ${booking.seats}\n` +
          `👤 ${booking.name}\n\n` +
          'Ви впевнені що хочете скасувати це бронювання?',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: confirmKeyboard
          }
        );
        
        await bot?.answerCallbackQuery(query.id);
      }
      
      // Підтвердження скасування
      if (data.startsWith('confirm_cancel_')) {
        const bookingId = data.replace('confirm_cancel_', '');
        
        try {
          const booking = await tgPrisma.booking.findUnique({
            where: { id: Number(bookingId) },
            include: { viberListing: true }
          });
          
          if (!booking) {
            throw new Error('Бронювання не знайдено');
          }
          
          if (booking.telegramUserId !== userId) {
            throw new Error('Це не ваше бронювання');
          }
          
          const bookingData = {
            id: booking.id,
            route: booking.route,
            date: booking.date
          };
          const isRideShare = (booking as { source?: string }).source === 'viber_match';
          const driverListing = (booking as { viberListing?: { phone: string; senderName: string | null } | null }).viberListing;
          
          await tgPrisma.booking.delete({
            where: { id: Number(bookingId) }
          });
          
          console.log(`✅ Користувач ${userId} скасував бронювання #${bookingId}`);
          
          // Сповістити водія про скасування попутки
          if (isRideShare && driverListing) {
            const driverChatId = await getChatIdByPhone(driverListing.phone);
            if (driverChatId) {
              await bot?.sendMessage(
                driverChatId,
                `🚫 <b>Пасажир скасував бронювання попутки</b>\n\n` +
                  `🎫 №${bookingData.id}\n` +
                  `👤 Пасажир: ${booking.name}\n` +
                  `📞 ${formatPhoneTelLink(booking.phone)}\n` +
                  `🛣 ${getRouteName(bookingData.route)}\n` +
                  `📅 ${formatDate(bookingData.date)}\n\n` +
                  `Місце знову вільне — можете запропонувати його іншим.`,
                { parse_mode: 'HTML' }
              ).catch((err) => console.error('Notify driver about cancel:', err));
            }
          }
          
          await bot?.editMessageText(
            '✅ <b>Бронювання успішно скасовано!</b>\n\n' +
            `🎫 Номер: #${bookingData.id}\n` +
            `📍 ${getRouteName(bookingData.route)}\n` +
            `📅 ${formatDate(bookingData.date)}\n\n` +
            '💡 Ви можете:\n' +
            '🎫 /book - Створити нове бронювання\n' +
            '🌐 /allrides - Переглянути всі активні попутки\n' +
            '📋 /mybookings - Переглянути інші бронювання',
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
          
          await bot?.answerCallbackQuery(query.id, { text: '✅ Бронювання скасовано' });
        } catch (error: any) {
          console.error('❌ Помилка скасування:', error);
          await bot?.editMessageText(
            '❌ <b>Помилка при скасуванні бронювання</b>\n\n' +
            `Деталі: ${error.message || 'Невідома помилка'}\n\n` +
            'Спробуйте команду /mybookings щоб переглянути актуальний список.',
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
          
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
        }
      }
      
      // Відміна скасування
      if (data === 'cancel_abort') {
        await bot?.editMessageText(
          '✅ <b>Скасування відмінено</b>\n\n' +
          'Ваше бронювання збережено.\n\n' +
          '📋 /mybookings - Переглянути всі бронювання\n' +
          '🌐 /allrides - Переглянути всі активні попутки',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
          }
        );
        
        await bot?.answerCallbackQuery(query.id, { text: '✅ Залишено' });
      }
      
      // Вибір напрямку для нового бронювання
      if (data.startsWith('book_dir_')) {
        const direction = data.replace('book_dir_', '');
        
        // Створити кнопки з датами (наступні 7 днів)
        const dates = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date();
          date.setDate(date.getDate() + i);
          const dateStr = date.toISOString().split('T')[0];
          const label = i === 0 ? ' (сьогодні)' : i === 1 ? ' (завтра)' : '';
          dates.push({
            text: formatDate(date) + label,
            callback_data: `book_date_${direction}_${dateStr.replace(/-/g, '_')}`
          });
        }
        
        const dateKeyboard = {
          inline_keyboard: dates.map(d => [d]).concat([[
            { text: '❌ Скасувати', callback_data: 'book_cancel' }
          ]])
        };
        
        await bot?.editMessageText(
          '🎫 <b>Нове бронювання</b>\n\n' +
          `✅ Напрямок: ${getRouteName(direction)}\n\n` +
          '2️⃣ Оберіть дату:',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: dateKeyboard
          }
        );
        
        await bot?.answerCallbackQuery(query.id);
      }
      
      // Вибір дати - показати доступні часи
      if (data.startsWith('book_date_')) {
        const parts = data.replace('book_date_', '').split('_');
        // Дата завжди остання (YYYY-MM-DD = 3 частини)
        const selectedDate = parts.slice(-3).join('-');
        // Direction - все що до дати
        const direction = parts.slice(0, -3).join('-');
        
        // Отримати графіки для обраного напрямку
        const schedules = await tgPrisma.schedule.findMany({
          where: { route: { startsWith: direction } },
          orderBy: { departureTime: 'asc' }
        });
        
        if (schedules.length === 0) {
          // Запропонувати поїздки з Viber, якщо є
          const startOfDay = new Date(selectedDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(selectedDate);
          endOfDay.setHours(23, 59, 59, 999);
          const viberListings = await tgPrisma.viberListing.findMany({
            where: {
              route: direction,
              date: { gte: startOfDay, lte: endOfDay },
              isActive: true
            },
            orderBy: [{ departureTime: 'asc' }]
          });
          const driverListings = viberListings.filter((l) => l.listingType === 'driver');
          const viberBlock =
            viberListings.length > 0
              ? '\n\n📱 <b>Поїздки з Viber</b> (можна замовити по телефону або натиснути кнопку):\n' +
                `🛣 ${getRouteName(direction)}\n\n` +
                viberListings
                  .map((l) => {
                    const type = l.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир';
                    const time = l.departureTime || '—';
                    const seats = l.seats != null ? `, ${l.seats} місць` : '';
                    const notes = l.notes != null ? `\n💡 ${l.notes}` : '';
                    const namePart = l.senderName ? ` — ${l.senderName}` : '';
                    return `${type} ${time}${seats}${notes}\n📞 ${formatPhoneTelLink(l.phone)}${namePart}`;
                  })
                  .join('\n\n')
              : '';
          const helpBlock =
            viberListings.length === 0
              ? '\n\n<b>Ви можете:</b>\n' +
                '🎫 /book - Почати заново\n' +
                '🌐 /allrides - Переглянути всі активні попутки\n' +
                '📋 /mybookings - Переглянути існуючі бронювання\n' +
                '🌐 https://malin.kiev.ua - Забронювати на сайті'
              : '';
          const bookViberButtons =
            driverListings.length > 0
              ? { inline_keyboard: driverListings.map((d) => [{ text: `🎫 Забронювати у ${d.senderName ?? 'водія'}`, callback_data: `book_viber_${d.id}` }]) }
              : undefined;
          await bot?.editMessageText(
            '❌ <b>Немає доступних рейсів</b> за розкладом.\n\n' +
              'Спробуйте інший напрямок або дату.' +
              viberBlock +
              helpBlock,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              ...(bookViberButtons && { reply_markup: bookViberButtons })
            }
          );
          await bot?.answerCallbackQuery(query.id);
          return;
        }
        
        // Перевірити доступність для кожного часу
        const timeButtons = await Promise.all(
          schedules.map(async (schedule) => {
            // Підрахувати зайняті місця
            const startOfDay = new Date(selectedDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(selectedDate);
            endOfDay.setHours(23, 59, 59, 999);
            
            const existingBookings = await tgPrisma.booking.findMany({
              where: {
                route: schedule.route,
                departureTime: schedule.departureTime,
                date: {
                  gte: startOfDay,
                  lte: endOfDay
                }
              }
            });
            
            const bookedSeats = existingBookings.reduce((sum, b) => sum + b.seats, 0);
            const availableSeats = schedule.maxSeats - bookedSeats;
            const isAvailable = availableSeats > 0;
            
            const emoji = isAvailable ? '✅' : '❌';
            const routeLabel = schedule.route.includes('Irpin') ? ' (Ірпінь)' :
                              schedule.route.includes('Bucha') ? ' (Буча)' : '';
            
            return {
              text: `${emoji} ${schedule.departureTime}${routeLabel} (${availableSeats}/${schedule.maxSeats})`,
              callback_data: isAvailable ? 
                `book_time_${schedule.route}_${schedule.departureTime}_${selectedDate.replace(/-/g, '_')}` : 
                'book_unavailable'
            };
          })
        );
        
        const timeKeyboard = {
          inline_keyboard: timeButtons.map(b => [b]).concat([[
            { text: '⬅️ Назад', callback_data: `book_dir_${direction}` },
            { text: '❌ Скасувати', callback_data: 'book_cancel' }
          ]])
        };
        
        await bot?.editMessageText(
          '🎫 <b>Нове бронювання</b>\n\n' +
          `✅ Напрямок: ${getRouteName(direction)}\n` +
          `✅ Дата: ${formatDate(new Date(selectedDate))}\n\n` +
          '3️⃣ Оберіть час відправлення:',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: timeKeyboard
          }
        );
        
        await bot?.answerCallbackQuery(query.id);
      }
      
      // Вибір часу - запитати кількість місць
      if (data.startsWith('book_time_') && data !== 'book_unavailable') {
        const parts = data.replace('book_time_', '').split('_');
        // Формат: route_time_YYYY_MM_DD (дата - останні 3 частини)
        const selectedDate = parts.slice(-3).join('-');
        const time = parts[parts.length - 4]; // час перед датою
        // Route - все що до часу
        const route = parts.slice(0, -4).join('-');
        
        const dateForCallback = selectedDate.replace(/-/g, '_');
        const seatsKeyboard = {
          inline_keyboard: [
            [{ text: '1 місце', callback_data: `book_seats_${route}_${time}_${dateForCallback}_1` }],
            [{ text: '2 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_2` }],
            [{ text: '3 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_3` }],
            [{ text: '4 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_4` }],
            [
              { text: '⬅️ Назад', callback_data: `book_date_${route}_${dateForCallback}` },
              { text: '❌ Скасувати', callback_data: 'book_cancel' }
            ]
          ]
        };
        
        await bot?.editMessageText(
          '🎫 <b>Нове бронювання</b>\n\n' +
          `✅ Напрямок: ${getRouteName(route)}\n` +
          `✅ Дата: ${formatDate(new Date(selectedDate))}\n` +
          `✅ Час: ${time}\n\n` +
          '4️⃣ Скільки місць забронювати?',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: seatsKeyboard
          }
        );
        
        await bot?.answerCallbackQuery(query.id);
      }
      
      // Вибір кількості місць - показати підтвердження
      if (data.startsWith('book_seats_')) {
        const parts = data.replace('book_seats_', '').split('_');
        // Формат: route_time_YYYY_MM_DD_seats (останній - seats, перед ним дата)
        const seats = parts[parts.length - 1];
        const selectedDate = parts.slice(-4, -1).join('-');
        const time = parts[parts.length - 5];
        const route = parts.slice(0, -5).join('-');
        const dateForCallback = selectedDate.replace(/-/g, '_');
        
        const confirmKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Підтвердити бронювання', callback_data: `book_confirm_${route}_${time}_${dateForCallback}_${seats}` }],
            [{ text: '❌ Скасувати', callback_data: 'book_cancel' }]
          ]
        };
        
        await bot?.editMessageText(
          '🎫 <b>Підтвердження бронювання</b>\n\n' +
          `📍 <b>Маршрут:</b> ${getRouteName(route)}\n` +
          `📅 <b>Дата:</b> ${formatDate(new Date(selectedDate))}\n` +
          `🕐 <b>Час:</b> ${time}\n` +
          `🎫 <b>Місць:</b> ${seats}\n\n` +
          '⚠️ Підтверджуєте бронювання?',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: confirmKeyboard
          }
        );
        
        await bot?.answerCallbackQuery(query.id);
      }
      
      // Підтвердження створення бронювання
      if (data.startsWith('book_confirm_')) {
        const parts = data.replace('book_confirm_', '').split('_');
        // Формат: route_time_YYYY_MM_DD_seats
        const seats = Number(parts[parts.length - 1]);
        const selectedDate = parts.slice(-4, -1).join('-');
        const time = parts[parts.length - 5];
        const route = parts.slice(0, -5).join('-');
        
        try {
          // Дані користувача: з останнього бронювання або з Person (якщо реєструвався тільки через бота)
          const userBooking = await tgPrisma.booking.findFirst({
            where: { telegramUserId: userId }
          });
          const person = await getPersonByTelegram(userId, chatId);
          const userName = userBooking?.name ?? person?.fullName?.trim() ?? 'Клієнт';
          const userPhone = userBooking?.phone ?? person?.phoneNormalized;
          const userPersonId = userBooking?.personId ?? person?.id;
          
          if (!userPhone) {
            throw new Error('Користувач не знайдений. Напишіть /start і надішліть номер телефону.');
          }
          
          // Перевірити доступність місць
          const startOfDay = new Date(selectedDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(selectedDate);
          endOfDay.setHours(23, 59, 59, 999);
          
          const schedule = await tgPrisma.schedule.findFirst({
            where: {
              route,
              departureTime: time
            }
          });
          
          if (!schedule) {
            throw new Error('Графік не знайдено');
          }
          
          const existingBookings = await tgPrisma.booking.findMany({
            where: {
              route,
              departureTime: time,
              date: {
                gte: startOfDay,
                lte: endOfDay
              }
            }
          });
          
          const bookedSeats = existingBookings.reduce((sum, b) => sum + b.seats, 0);
          const availableSeats = schedule.maxSeats - bookedSeats;
          
          if (availableSeats < seats) {
            throw new Error(`Недостатньо місць. Доступно: ${availableSeats}, запитано: ${seats}`);
          }
          
          // Створити бронювання (прив'язка до Person якщо є)
          const booking = await tgPrisma.booking.create({
            data: {
              route,
              date: new Date(selectedDate),
              departureTime: time,
              seats,
              name: userName,
              phone: userPhone,
              telegramChatId: chatId,
              telegramUserId: userId,
              personId: userPersonId ?? undefined,
            },
          });
          
          console.log(`✅ Створено бронювання #${booking.id} користувачем ${userId} через бот`);
          
          const supportPhoneLine = schedule.supportPhone
            ? `\n⚠️ Краще уточнити бронювання за телефоном: ${schedule.supportPhone}\n\n`
            : '\n\n';
          await bot?.editMessageText(
            '📋 <b>Заявку прийнято</b> (працюємо в технічному режимі)\n\n' +
            `🎫 <b>Номер:</b> #${booking.id}\n` +
            `📍 <b>Маршрут:</b> ${getRouteName(booking.route)}\n` +
            `📅 <b>Дата:</b> ${formatDate(booking.date)}\n` +
            `🕐 <b>Час:</b> ${booking.departureTime}\n` +
            `🎫 <b>Місць:</b> ${booking.seats}\n` +
            `👤 <b>Пасажир:</b> ${booking.name}` +
            supportPhoneLine +
            '💡 Корисні команди:\n' +
            '📋 /mybookings - Переглянути всі бронювання\n' +
            '🌐 /allrides - Переглянути всі активні попутки\n' +
            '🚫 /cancel - Скасувати бронювання або оголошення попуток\n' +
            '🎫 /book - Створити ще одне бронювання',
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
          
          await bot?.answerCallbackQuery(query.id, {
            text: schedule.supportPhone
              ? 'Заявку прийнято. Краще уточнити за тел. ' + schedule.supportPhone
              : '✅ Заявку прийнято!'
          });
          
          // Відправити сповіщення адміну (використовується TELEGRAM_ADMIN_CHAT_ID)
          await sendBookingNotificationToAdmin(booking).catch((err) => console.error('Telegram notify admin:', err));
        } catch (error: any) {
          console.error('❌ Помилка створення бронювання:', error);
          await bot?.editMessageText(
            '❌ <b>Помилка при створенні бронювання</b>\n\n' +
            `Деталі: ${error.message || 'Невідома помилка'}\n\n` +
            'Спробуйте:\n' +
            '🎫 /book - Почати заново\n' +
            '🌐 https://malin.kiev.ua - Забронювати на сайті',
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
          
          await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
        }
      }
      
      // Скасування процесу бронювання
      if (data === 'book_cancel') {
        await bot?.editMessageText(
          '❌ <b>Бронювання скасовано</b>\n\n' +
          'Ви можете:\n' +
          '🎫 /book - Почати заново\n' +
          '🌐 /allrides - Переглянути всі активні попутки\n' +
          '📋 /mybookings - Переглянути існуючі бронювання\n' +
          '🌐 https://malin.kiev.ua - Забронювати на сайті',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
          }
        );
        
        await bot?.answerCallbackQuery(query.id, { text: '❌ Скасовано' });
      }
      
      // Недоступний час
      if (data === 'book_unavailable') {
        await bot?.answerCallbackQuery(query.id, { 
          text: '❌ На цей час немає вільних місць', 
          show_alert: true 
        });
      }
      
    } catch (error) {
      console.error('❌ Помилка обробки callback:', error);
      await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
    }
  });

  console.log('✅ Bot commands налаштовано');
}

// Ініціалізація бота (якщо токен є); productionTelegramBot — базовий інстанс для resetTelegramBotForTests()
const productionTelegramBot: TelegramBot | null = token ? new TelegramBot(token, { polling: true }) : null;
bot = productionTelegramBot;

if (token) {
  console.log('✅ Telegram Bot ініціалізовано з polling');
  setupBotCommands();
} else {
  console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
}

/** Юніт-тести: підставити мок TelegramBot (sendMessage тощо). */
export function setTelegramBotForTests(instance: TelegramBot | null): void {
  bot = instance;
}

export function resetTelegramBotForTests(): void {
  bot = productionTelegramBot;
}

/**
 * Отримання chat_id по номеру телефону: спочатку Person, інакше Booking.
 */
export const getChatIdByPhone = async (phone: string): Promise<string | null> => {
  try {
    const person = await getPersonByPhone(phone);
    if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
      return person.telegramChatId;
    }
    const bookings = await tgPrisma.booking.findMany({
      where: {
        telegramChatId: { not: null },
        telegramUserId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    const normalizedPhone = normalizePhone(phone);
    const matching = bookings.find((b) => normalizePhone(b.phone) === normalizedPhone);
    return matching?.telegramChatId ?? null;
  } catch (error) {
    console.error('❌ Помилка отримання chat_id:', error);
    return null;
  }
};

/**
 * Chat_id водія для кнопки «Забронювати» в /allrides: по телефону, а якщо не знайдено — по personId оголошення.
 */
async function getChatIdForDriverListing(listing: { phone: string; personId: number | null }): Promise<string | null> {
  const byPhone = await getChatIdByPhone(listing.phone);
  if (byPhone) return byPhone;
  if (listing.personId) {
    const person = await tgPrisma.person.findUnique({
      where: { id: listing.personId },
      select: { telegramChatId: true },
    });
    if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
      return person.telegramChatId;
    }
  }
  return null;
}

/**
 * Виконати запит на попутку до водія (Viber-оголошення). Викликається з callback book_viber_ та з /start?start=book_viber_ID.
 */
export async function executeBookViberRideShare(
  chatId: string,
  userId: string,
  driverListingId: number,
  passengerDisplayName?: string
): Promise<{ ok: boolean; error?: string }> {
  const driverListing = await tgPrisma.viberListing.findUnique({ where: { id: driverListingId } });
  if (!driverListing || driverListing.listingType !== 'driver' || !driverListing.isActive) {
    return { ok: false, error: '❌ Оголошення водія не знайдено' };
  }
  const person = await getPersonByTelegram(userId, chatId);
  if (!person?.phoneNormalized) {
    return { ok: false, error: 'Спочатку надішліть номер телефону: /start' };
  }
  const { listing: passengerListing } = await createOrMergeViberListing({
    rawMessage: `[Бот] ${driverListing.route} ${driverListing.date.toISOString().slice(0, 10)} ${driverListing.departureTime ?? ''}`,
    senderName: person.fullName?.trim() ?? passengerDisplayName ?? 'Пасажир',
    listingType: 'passenger',
    route: driverListing.route,
    date: driverListing.date,
    departureTime: driverListing.departureTime,
    seats: null,
    phone: person.phoneNormalized,
    notes: null,
    isActive: true,
    personId: person.id,
  });
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const request = await tgPrisma.rideShareRequest.create({
    data: { passengerListingId: passengerListing.id, driverListingId: driverListing.id, status: 'pending', expiresAt },
  });
  const driverChatId = await getChatIdForDriverListing(driverListing);
  const passengerName = passengerListing.senderName ?? 'Пасажир';
  if (driverChatId) {
    const confirmKeyboard = {
      inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${request.id}` }]],
    };
    await bot?.sendMessage(
      driverChatId,
      `🎫 <b>Запит на попутку</b>\n\n` +
        `👤 ${passengerName} хоче поїхати з вами.\n\n` +
        `🛣 ${getRouteName(driverListing.route)}\n` +
        `📅 ${formatDate(driverListing.date)}\n` +
        (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
        `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
        `\n\n_У вас є 1 година на підтвердження._`,
      { parse_mode: 'HTML', reply_markup: confirmKeyboard }
    ).catch(() => {});
  }
  return { ok: true };
}

/**
 * Отримати ім'я з профілю Telegram по chat_id (бот має доступ до чату).
 * Для приватного чату повертає first_name + last_name.
 */
export async function getTelegramNameByChatId(chatId: string): Promise<string | null> {
  if (!bot || !chatId?.trim()) return null;
  try {
    const chat = await bot.getChat(chatId);
    if (!chat) return null;
    const first = (chat as { first_name?: string }).first_name ?? '';
    const last = (chat as { last_name?: string }).last_name ?? '';
    const name = `${first} ${last}`.trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Перевірка на наявність кирилиці в рядку */
export function hasCyrillic(str: string): boolean {
  return /[\u0400-\u04FF]/.test(str || '');
}

/**
 * Зібрати імена: спочатку з бота (по chatId), потім по номеру (ваш акаунт, send_message.py --resolve).
 */
export async function getResolvedNameForPerson(
  phone: string,
  chatId: string | null
): Promise<{ nameFromBot: string | null; nameFromUser: string | null; nameFromOpendatabot: string | null }> {
  const trimChatId = chatId && chatId !== '0' ? chatId.trim() : null;
  let nameFromBot: string | null = null;
  let nameFromUser: string | null = null;
  let nameFromOpendatabot: string | null = null;
  if (trimChatId) {
    const fromBot = await getTelegramNameByChatId(trimChatId);
    if (fromBot?.trim()) nameFromBot = fromBot.trim();
  }
  if (phone?.trim()) {
    const normalizedPhone = phone.trim();
    const fromUser = await resolveNameByPhoneFromTelegram(normalizedPhone);
    if (fromUser?.trim()) nameFromUser = fromUser.trim();
    const fromOpendatabot = await resolveNameByPhoneFromOpendatabot(normalizedPhone);
    if (fromOpendatabot?.trim()) nameFromOpendatabot = fromOpendatabot.trim();
  }
  return { nameFromBot, nameFromUser, nameFromOpendatabot };
}

/**
 * Вибрати найкраще ім'я: якщо у нас взагалі не було — заповнити будь-яким першим; далі серед усіх варіантів вибрати найдовше кириличне.
 */
export function pickBestNameFromCandidates(
  currentFullName: string | null,
  nameFromBot: string | null,
  nameFromUser: string | null,
  nameFromOpendatabot: string | null,
): { newName: string | null; source: 'bot' | 'user_account' | 'opendatabot' | null } {
  const cur = (currentFullName ?? '').trim() || null;
  const fromBot = (nameFromBot ?? '').trim() || null;
  const fromUser = (nameFromUser ?? '').trim() || null;
  const fromOpendatabot = (nameFromOpendatabot ?? '').trim() || null;
  const candidates: Array<{ name: string; source: 'bot' | 'user_account' | 'opendatabot' | null }> = [];
  if (cur) candidates.push({ name: cur, source: null });
  if (fromBot) candidates.push({ name: fromBot, source: 'bot' });
  if (fromUser) candidates.push({ name: fromUser, source: 'user_account' });
  if (fromOpendatabot) candidates.push({ name: fromOpendatabot, source: 'opendatabot' });
  const unique = Array.from(new Map(candidates.map((c) => [c.name, c])).values());
  if (unique.length === 0) return { newName: cur, source: null };
  const cyrillic = unique.filter((c) => hasCyrillic(c.name));
  const byLength = (a: { name: string }, b: { name: string }) => b.name.length - a.name.length;
  if (cyrillic.length > 0) {
    cyrillic.sort(byLength);
    const best = cyrillic[0];
    return { newName: best.name, source: best.source };
  }
  // Якщо поточного не було — заповнити будь-яким отриманим, навіть не кириличним (кирилиці може взагалі не бути).
  if (!cur) {
    unique.sort(byLength);
    const best = unique[0];
    return { newName: best.name, source: best.source };
  }
  return { newName: cur, source: null };
}

export default bot;
