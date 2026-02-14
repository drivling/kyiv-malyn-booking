import TelegramBot from 'node-telegram-bot-api';
import { PrismaClient } from '@prisma/client';
import { extractDate, extractTime } from './viber-parser';

const prisma = new PrismaClient();

/** Кроки потоку "додати поїздку (водій)" */
type DriverRideStep = 'route' | 'date' | 'time' | 'seats' | 'phone' | 'notes' | 'date_custom' | 'time_custom';
interface DriverRideFlowState {
  state: 'driver_ride_flow';
  step: DriverRideStep;
  route?: string;
  date?: string;
  departureTime?: string;
  seats?: number | null;
  phone?: string;
  since: number;
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
}
const passengerRideStateMap = new Map<string, PassengerRideFlowState>();
const PASSENGER_RIDE_STATE_TTL_MS = 15 * 60 * 1000; // 15 хв

// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '5072659044';

let bot: TelegramBot | null = null;

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
  const listing = await prisma.viberListing.create({
    data: {
      rawMessage: `[Бот] ${state.route} ${state.date} ${state.departureTime ?? ''} ${state.seats ?? ''} місць`,
      senderName: resolvedSenderName,
      listingType: 'driver',
      route: state.route,
      date,
      departureTime: state.departureTime ?? null,
      seats: state.seats ?? null,
      phone,
      notes,
      isActive: true,
      personId: person.id,
    },
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
    notes: listing.notes
  }).catch((err) => console.error('Telegram Viber notify:', err));
  await bot?.sendMessage(
    chatId,
    '✅ <b>Поїздку додано!</b>\n\n' +
    `🛣 ${getRouteName(state.route)}\n` +
    `📅 ${formatDate(date)}\n` +
    (state.departureTime ? `🕐 ${state.departureTime}\n` : '') +
    (state.seats != null ? `🎫 ${state.seats} місць\n` : '') +
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
  const listing = await prisma.viberListing.create({
    data: {
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
    },
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

/** Нормалізує час для порівняння: "18:00" або "18:00-18:30" -> "18:00" */
function normalizeTimeForMatch(t: string | null): string | null {
  if (!t || !t.trim()) return null;
  const part = t.trim().split(/-|\s/)[0];
  const m = part.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = m[1].padStart(2, '0');
  const min = m[2];
  return `${h}:${min}`;
}

/** Чи збігається час: обидва задані і однакові (нормалізовані). */
function isExactTimeMatch(timeA: string | null, timeB: string | null): boolean {
  const a = normalizeTimeForMatch(timeA);
  const b = normalizeTimeForMatch(timeB);
  if (!a || !b) return false;
  return a === b;
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
}): Promise<Array<{ listing: { id: number; route: string; date: Date; departureTime: string | null; phone: string; senderName: string | null; notes: string | null }; matchType: 'exact' | 'approximate' }>> {
  const dateKey = toDateKey(driverListing.date);
  const passengers = await prisma.viberListing.findMany({
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
    const exact = !!driverTime && !!p.departureTime && isExactTimeMatch(driverTime, p.departureTime);
    return { listing: p, matchType: exact ? 'exact' : 'approximate' };
  });
}

/** Знайти активні оголошення водіїв, що збігаються по маршруту та даті з оголошенням пасажира. */
async function findMatchingDriversForPassenger(passengerListing: {
  route: string;
  date: Date;
  departureTime: string | null;
}): Promise<Array<{ listing: { id: number; route: string; date: Date; departureTime: string | null; seats: number | null; phone: string; senderName: string | null; notes: string | null }; matchType: 'exact' | 'approximate' }>> {
  const dateKey = toDateKey(passengerListing.date);
  const drivers = await prisma.viberListing.findMany({
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
    const exact = !!passengerTime && !!d.departureTime && isExactTimeMatch(passengerTime, d.departureTime);
    return { listing: d, matchType: exact ? 'exact' : 'approximate' };
  });
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

  if (driverChatId && exactList.length > 0) {
    const lines = exactList.map((p) => {
      const time = p.departureTime ?? '—';
      return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      driverChatId,
      '🎯 <b>Пряме співпадіння: знайшли пасажирів на вашу дату та маршрут</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
  if (driverChatId && approxList.length > 0) {
    const lines = approxList.map((p) => {
      const time = p.departureTime ?? '—';
      return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      driverChatId,
      '📌 <b>Приблизне співпадіння (інший час або без часу)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  for (const { listing: p, matchType } of matches) {
    const passengerChatId = await getChatIdByPhone(p.phone);
    if (!passengerChatId) continue;
    const label = matchType === 'exact' ? '🎯 Пряме співпадіння' : '📌 Приблизне співпадіння';
    const msg = `${label}: з\'явився водій на ваш маршрут і дату.\n\n` +
      `🛣 ${getRouteName(driverListing.route)}\n` +
      `📅 ${formatDate(driverListing.date)}\n` +
      (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
      (driverListing.seats != null ? `🎫 ${driverListing.seats} місць\n` : '') +
      `👤 ${driverListing.senderName ?? 'Водій'}\n` +
      `📞 ${formatPhoneTelLink(driverListing.phone)}` +
      (driverListing.notes ? `\n📝 ${driverListing.notes}` : '');
    await bot?.sendMessage(passengerChatId, msg, { parse_mode: 'HTML' }).catch(() => {});
  }
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

  if (passengerChatId && exactList.length > 0) {
    const lines = exactList.map((d) => {
      const time = d.departureTime ?? '—';
      return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      passengerChatId,
      '🎯 <b>Пряме співпадіння: знайшли водіїв на вашу дату та маршрут</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
  if (passengerChatId && approxList.length > 0) {
    const lines = approxList.map((d) => {
      const time = d.departureTime ?? '—';
      return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
    }).join('\n');
    await bot?.sendMessage(
      passengerChatId,
      '📌 <b>Приблизне співпадіння (інший час або без часу)</b>\n\n' + lines,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  for (const { listing: d, matchType } of matches) {
    const driverChatId = await getChatIdByPhone(d.phone);
    if (!driverChatId) continue;
    const label = matchType === 'exact' ? '🎯 Пряме співпадіння' : '📌 Приблизне співпадіння';
    const msg = `${label}: новий запит пасажира на ваш маршрут і дату.\n\n` +
      `🛣 ${getRouteName(passengerListing.route)}\n` +
      `📅 ${formatDate(passengerListing.date)}\n` +
      (passengerListing.departureTime ? `🕐 ${passengerListing.departureTime}\n` : '') +
      `👤 ${passengerListing.senderName ?? 'Пасажир'}\n` +
      `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
      (passengerListing.notes ? `\n📝 ${passengerListing.notes}` : '');
    await bot?.sendMessage(driverChatId, msg, { parse_mode: 'HTML' }).catch(() => {});
  }
}

// --- Робота з Person (єдина база людей) ---

/** Знайти людину за нормалізованим номером телефону */
export const getPersonByPhone = async (phone: string) => {
  const normalized = normalizePhone(phone);
  return prisma.person.findUnique({
    where: { phoneNormalized: normalized }
  });
};

/** Знайти людину за Telegram userId або chatId */
export const getPersonByTelegram = async (userId: string, chatId: string) => {
  const or: Array<{ telegramUserId: string } | { telegramChatId: string }> = [];
  if (userId && userId !== '0' && userId.trim() !== '') or.push({ telegramUserId: userId });
  if (chatId && chatId !== '0' && chatId.trim() !== '') or.push({ telegramChatId: chatId });
  if (or.length === 0) return null;
  return prisma.person.findFirst({ where: { OR: or } });
};

/**
 * Знайти або створити Person за номером; опційно оновити fullName та Telegram.
 * Повертає Person (phoneNormalized для відображення можна форматувати окремо).
 */
export const findOrCreatePersonByPhone = async (
  phone: string,
  options?: { fullName?: string | null; telegramChatId?: string | null; telegramUserId?: string | null }
): Promise<{ id: number; phoneNormalized: string; fullName: string | null }> => {
  const normalized = normalizePhone(phone);
  const fullName = options?.fullName != null && String(options.fullName).trim() !== ''
    ? String(options.fullName).trim()
    : null;
  const person = await prisma.person.upsert({
    where: { phoneNormalized: normalized },
    create: {
      phoneNormalized: normalized,
      fullName,
      telegramChatId: options?.telegramChatId ?? null,
      telegramUserId: options?.telegramUserId ?? null,
    },
    update: {
      ...(fullName != null && { fullName }),
      ...(options?.telegramChatId != null && { telegramChatId: options.telegramChatId }),
      ...(options?.telegramUserId != null && { telegramUserId: options.telegramUserId }),
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
  await prisma.person.update({
    where: { id: personId },
    data: { telegramChatId: chatId, telegramUserId: userId },
  });
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { phoneNormalized: true } });
  if (!person) return;
  const allBookings = await prisma.booking.findMany({ select: { id: true, phone: true, personId: true } });
  const samePhone = allBookings.filter((b) => normalizePhone(b.phone) === person.phoneNormalized);
  for (const b of samePhone) {
    await prisma.booking.update({
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
  const bookings = await prisma.booking.findMany({
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
  const booking = await prisma.booking.findFirst({
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
 * Клікабельний номер телефону для Telegram (HTML): <a href="tel:+38...">...</a>
 */
function formatPhoneTelLink(phone: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (!p) return '—';
  const digits = '+' + normalizePhone(p);
  const display = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href="tel:${digits}">${display}</a>`;
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
  return route;
};

/**
 * Відправка повідомлення про нове бронювання адміністратору
 */
export const sendBookingNotificationToAdmin = async (booking: {
  id: number;
  route: string;
  date: Date;
  departureTime: string;
  seats: number;
  name: string;
  phone: string;
}) => {
  if (!bot || !adminChatId) {
    console.log('⚠️ Telegram bot або admin chat ID не налаштовано');
    return;
  }

  try {
    const message = `
🎫 <b>Нове бронювання #${booking.id}</b>

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}

👤 <b>Клієнт:</b> ${booking.name}
📞 <b>Телефон:</b> ${formatPhoneTelLink(booking.phone)}

✅ <i>Бронювання підтверджено</i>
    `.trim();

    await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram повідомлення надіслано адміну (booking #${booking.id})`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram повідомлення адміну:', error);
  }
};

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
${listing.seats != null ? `🎫 <b>Місця:</b> ${listing.seats}\n` : ''}
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
 */
export const sendViberListingConfirmationToUser = async (
  phone: string,
  listing: {
    id: number;
    route: string;
    date: Date | string;
    departureTime: string | null;
    seats: number | null;
    listingType: string;
  }
) => {
  if (!bot) return;
  const trimmed = phone?.trim();
  if (!trimmed) return;

  try {
    const chatId = await getChatIdByPhone(trimmed);
    if (!chatId) {
      console.log(`ℹ️ Viber оголошення #${listing.id}: по телефону ${trimmed} Telegram не знайдено, пропускаємо сповіщення`);
      return;
    }

    const dateStr = listing.date instanceof Date
      ? formatDate(listing.date)
      : (listing.date && String(listing.date).slice(0, 10))
        ? formatDate(new Date(listing.date))
        : '—';
    const routeName = getRouteName(listing.route);

    const message = `
📱 <b>Ваше оголошення опубліковано на платформі Поїздки Київ, Житомир, Коростень ↔️ Малин</b>

🛣 <b>Маршрут:</b> ${routeName}
📅 <b>Дата:</b> ${dateStr}
${listing.departureTime ? `🕐 <b>Час:</b> ${listing.departureTime}\n` : ''}${listing.seats != null ? `🎫 <b>Місць:</b> ${listing.seats}\n` : ''}
Інші користувачі зможуть бачити це оголошення та зв’язатися з вами за телефоном.

<i>Дякуємо, що користуєтесь нашою платформою! 🚐</i>
Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram: автору Viber оголошення #${listing.id} надіслано сповіщення про публікацію`);
  } catch (error) {
    console.error('❌ Помилка відправки сповіщення автору Viber оголошення:', error);
  }
};

/**
 * Відправка підтвердження бронювання клієнту
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
  }
) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }

  try {
    const message = `
✅ <b>Ваше бронювання підтверджено!</b>

🎫 <b>Номер:</b> #${booking.id}
🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}
👤 <b>Пасажир:</b> ${booking.name}

<i>Бажаємо приємної подорожі! 🚐</i>

❓ Якщо у вас є питання, зв'яжіться з нами.
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram підтвердження надіслано клієнту (booking #${booking.id})`);
  } catch (error) {
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
  }
) => {
  if (!bot) {
    console.log('⚠️ Telegram bot не налаштовано');
    return;
  }

  try {
    const message = `
🔔 <b>Нагадування про поїздку!</b>

👋 ${booking.name}, нагадуємо про вашу поїздку завтра:

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}

<i>Не спізніться! ⏰</i>
    `.trim();

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram нагадування надіслано`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram нагадування:', error);
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
 */
async function registerUserPhone(chatId: string, userId: string, phoneInput: string) {
  if (!bot) return;

  try {
    const normalizedPhone = normalizePhone(phoneInput);

    const allBookings = await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } });
    const matchingBookings = allBookings.filter((b) => normalizePhone(b.phone) === normalizedPhone);
    const userIdBookings = await prisma.booking.findMany({
      where: { telegramUserId: userId },
    });
    const totalBookings = matchingBookings.length + userIdBookings.length;

    if (totalBookings === 0) {
      // Додаємо людину в базу (Person), щоб після бронювання на сайті вона отримувала сповіщення
      await findOrCreatePersonByPhone(phoneInput, {
        telegramChatId: chatId,
        telegramUserId: userId,
      });
      await bot.sendMessage(
        chatId,
        `✅ <b>Номер додано в базу клієнтів!</b>\n\n` +
          `📱 ${formatPhoneTelLink(phoneInput)}\n\n` +
          `Коли ви створите бронювання на сайті з цим номером:\n` +
          `🌐 https://malin.kiev.ua\n\n` +
          `ви автоматично будете отримувати:\n` +
          `• ✅ Підтвердження бронювання\n` +
          `• 🔔 Нагадування за день до поїздки\n\n` +
          `Нічого більше робити не потрібно — просто забронюйте квиток на сайті.`,
        { parse_mode: 'HTML' }
      );
      console.log(`✅ Додано Person (без бронювань) для ${userId}, номер ${normalizedPhone}`);
      return;
    }

    const phoneNumbers = [...new Set(matchingBookings.map((b) => b.phone))];
    for (const phone of phoneNumbers) {
      const person = await findOrCreatePersonByPhone(phone, {
        telegramChatId: chatId,
        telegramUserId: userId,
      });
      await updatePersonAndBookingsTelegram(person.id, chatId, userId);
      const norm = normalizePhone(phone);
      const allWithPhone = await prisma.booking.findMany({ where: {} });
      const toLink = allWithPhone.filter((b) => normalizePhone(b.phone) === norm);
      for (const b of toLink) {
        if (b.personId !== person.id) {
          await prisma.booking.update({
            where: { id: b.id },
            data: { personId: person.id, telegramChatId: chatId, telegramUserId: userId },
          });
        }
      }
    }

    await prisma.booking.updateMany({
      where: { telegramUserId: userId, telegramChatId: null },
      data: { telegramChatId: chatId },
    });

    console.log(`✅ Оновлено Person та бронювання для користувача ${userId}, номер ${normalizedPhone}`);

    await bot.sendMessage(
      chatId,
      `✅ <b>Вітаємо! Ваш акаунт підключено!</b>\n\n` +
        `📱 Номер телефону: ${formatPhoneTelLink(phoneInput)}\n` +
        `🎫 Знайдено бронювань: ${totalBookings}\n\n` +
        `Тепер ви будете отримувати:\n` +
        `• ✅ Підтвердження при створенні бронювання\n` +
        `• 🔔 Нагадування за день до поїздки\n\n` +
        `📋 Використайте /mybookings щоб переглянути свої бронювання`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Помилка реєстрації номера:', error);
    await bot.sendMessage(chatId, '❌ Помилка при реєстрації. Спробуйте пізніше.');
  }
}

/**
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
  if (!bot) return;

  // Команда /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const firstName = msg.from?.first_name || 'Друже';

    const person = await getPersonByTelegram(userId, chatId);
    const existingBooking = await prisma.booking.findFirst({
      where: { telegramUserId: userId },
    });

    if (person) {
      await prisma.person.updateMany({
        where: { id: person.id },
        data: { telegramChatId: chatId, telegramUserId: userId },
      });
    }
    if (existingBooking) {
      await prisma.booking.updateMany({
        where: {
          telegramUserId: userId,
          telegramChatId: null,
        },
        data: { telegramChatId: chatId },
      });
      if (person) {
        await updatePersonAndBookingsTelegram(person.id, chatId, userId);
      } else {
        const p = await findOrCreatePersonByPhone(existingBooking.phone, {
          fullName: existingBooking.name,
          telegramChatId: chatId,
          telegramUserId: userId,
        });
        await updatePersonAndBookingsTelegram(p.id, chatId, userId);
      }
      console.log(`✅ Оновлено Person/Booking для користувача ${userId} при /start`);

      const displayPhone = existingBooking.phone;
      const welcomeMessage = `
👋 Привіт знову, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

✅ Ваш акаунт вже підключено до номера: ${formatPhoneTelLink(displayPhone)}

🎫 <b>Що можна зробити:</b>
/book - 🎫 Створити нове бронювання
/mybookings - 📋 Переглянути мої бронювання
/cancel - 🚫 Скасувати бронювання
🚗 <b>Водій:</b>
/mydriverrides - Мої поїздки (які я пропоную)
/adddriverride - Додати поїздку як водій
👤 <b>Пасажир:</b>
/mypassengerrides - Мої запити на поїздку
/addpassengerride - Шукаю поїздку (додати запит)
/help - 📚 Показати довідку

🌐 <b>Або забронюйте на сайті:</b>
https://malin.kiev.ua
      `.trim();
      
      await bot?.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    } else {
      // Новий користувач - пропонуємо зареєструватися
      const welcomeMessage = `
👋 Привіт, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

🎫 <b>Для отримання нотифікацій та перегляду своїх бронювань:</b>

📱 Надішліть мені свій номер телефону одним з способів:
   • Використайте кнопку "Поділитися контактом" нижче
   • Або просто напишіть номер у форматі: +380501234567

📋 <b>Доступні команди:</b>
/mybookings - переглянути мої бронювання
/help - показати довідку

🌐 <b>Забронювати квиток:</b>
https://malin.kiev.ua
      `.trim();
      
      // Додаємо кнопку для швидкого надсилання контакту
      const keyboard = {
        keyboard: [
          [{ text: '📱 Поділитися номером телефону', request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      
      await bot?.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }
  });

  // Команда /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    
    // Перевіряємо чи користувач зареєстрований
    const existingBooking = await prisma.booking.findFirst({
      where: { telegramUserId: userId }
    });
    
    if (existingBooking) {
      const helpMessage = `
📚 <b>Довідка по командах:</b>

🎫 <b>Бронювання:</b>
/book - створити нове бронювання
/mybookings - переглянути мої бронювання
/cancel - скасувати бронювання

🚗 <b>Водій:</b>
/mydriverrides - мої поїздки (які я пропоную)
/adddriverride - додати поїздку як водій

👤 <b>Пасажир:</b>
/mypassengerrides - мої запити на поїздку
/addpassengerride - шукаю поїздку (додати запит)

📋 <b>Інше:</b>
/start - головне меню
/help - показати цю довідку

✅ Ваш акаунт підключено до номера: ${formatPhoneTelLink(existingBooking.phone)}

💡 <b>Що я вмію:</b>
• 🎫 Створювати нові бронювання
• 📋 Показувати тільки ваші бронювання
• 🚫 Скасовувати бронювання
• 🚗 Показувати та додавати ваші поїздки як водій
• 👤 Додавати запити як пасажир (шукаю поїздку) — сповіщення при збігу з водіями
• ✅ Надсилати підтвердження
• 🔔 Нагадувати за день до поїздки

🌐 Сайт: https://malin.kiev.ua
      `.trim();
      
      await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    } else {
      const helpMessage = `
📚 <b>Довідка:</b>

/start - почати роботу з ботом
/mybookings - переглянути мої бронювання
/help - показати цю довідку

📱 <b>Як підключитися:</b>
1. Напишіть /start
2. Надішліть свій номер телефону (кнопкою або текстом)
3. Готово! Тепер можете бронювати через бота

💡 <b>Формати номера:</b>
• +380501234567
• 380501234567
• 0501234567

🌐 Сайт: https://malin.kiev.ua
      `.trim();
      
      await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
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
      driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
      const routeKeyboard = {
        inline_keyboard: [
          [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
          [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
          [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
          [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
          [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
        ]
      };
      await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
      return;
    }

    const passengerState = passengerRideStateMap.get(chatId);
    if (passengerState?.state === 'passenger_ride_flow' && passengerState.step === 'phone') {
      const phone = normalizePhone(phoneNumber);
      passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
      const routeKeyboard = {
        inline_keyboard: [
          [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
          [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
          [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
          [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
          [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
        ]
      };
      await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
      return;
    }
    
    await registerUserPhone(chatId, userId, phoneNumber);
  });

  // Обробка текстових повідомлень (номер телефону або текст поїздки водія)
  bot.on('message', async (msg) => {
    // Ігноруємо команди та контакти (вони обробляються окремо)
    if (msg.text?.startsWith('/') || msg.contact) {
      return;
    }
    
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const text = msg.text?.trim();
    
    if (!text) return;
    
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
        driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
        const routeKeyboard = {
          inline_keyboard: [
            [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
            [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
            [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
            [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
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
        passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
        const routeKeyboard = {
          inline_keyboard: [
            [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
            [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
            [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
            [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
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
      await registerUserPhone(chatId, userId, text);
    } else {
      // Якщо користувач ще не зареєстрований, підказуємо
      const existingBooking = await prisma.booking.findFirst({
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
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    
    try {
      // Оновлюємо telegramChatId для користувача (якщо потрібно)
      await prisma.booking.updateMany({
        where: { 
          telegramUserId: userId,
          telegramChatId: null
        },
        data: { 
          telegramChatId: chatId
        }
      });
      
      // Спочатку шукаємо ВСІ бронювання користувача (для діагностики)
      const allUserBookings = await prisma.booking.findMany({
        where: {
          telegramUserId: userId
        },
        orderBy: { date: 'desc' }
      });
      
      console.log(`🔍 Користувач ${userId} має ${allUserBookings.length} бронювань (всього)`);
      
      if (allUserBookings.length > 0) {
        allUserBookings.forEach(b => {
          console.log(`  - Booking #${b.id}: ${b.date.toISOString().split('T')[0]} (telegramChatId: ${b.telegramChatId})`);
        });
        
        // 🔧 ЗАПЛАТКА: Якщо знайдено бронювання - шукаємо інші з таким же номером але без telegramUserId
        console.log(`🔧 Перевіряємо чи є інші бронювання з таким же номером без telegramUserId...`);
        
        // Отримуємо всі унікальні номери телефонів користувача
        const userPhones = [...new Set(allUserBookings.map(b => b.phone))];
        console.log(`📱 Номери телефонів користувача: ${userPhones.join(', ')}`);
        
        // Для кожного номера шукаємо бронювання без telegramUserId
        for (const phone of userPhones) {
          const normalizedPhone = normalizePhone(phone);
          
          // Знаходимо всі бронювання і фільтруємо по нормалізованому номеру
          const allBookingsForPhone = await prisma.booking.findMany({
            where: {
              OR: [
                { telegramUserId: null },
                { telegramUserId: '0' },
                { telegramUserId: '' }
              ]
            }
          });
          
          const orphanedBookings = allBookingsForPhone.filter(b => 
            normalizePhone(b.phone) === normalizedPhone
          );
          
          if (orphanedBookings.length > 0) {
            console.log(`🔧 Знайдено ${orphanedBookings.length} бронювань з номером ${phone} без telegramUserId`);
            const person = await findOrCreatePersonByPhone(phone, {
              telegramChatId: chatId,
              telegramUserId: userId,
            });
            for (const booking of orphanedBookings) {
              await prisma.booking.update({
                where: { id: booking.id },
                data: {
                  telegramUserId: userId,
                  telegramChatId: chatId,
                  personId: person.id,
                },
              });
              console.log(`  ✅ Бронювання #${booking.id} оновлено: userId=${userId}, chatId=${chatId}, personId=${person.id}`);
            }
            console.log(`✅ Автоматично прив'язано ${orphanedBookings.length} старих бронювань до користувача ${userId}`);
          }
        }
        
        // Перезавантажуємо всі бронювання після оновлення
        const updatedAllBookings = await prisma.booking.findMany({
          where: {
            telegramUserId: userId
          },
          orderBy: { date: 'desc' }
        });
        
        if (updatedAllBookings.length > allUserBookings.length) {
          console.log(`📊 Після заплатки: ${updatedAllBookings.length} бронювань (+${updatedAllBookings.length - allUserBookings.length})`);
        }
      }
      
      // Тепер фільтруємо тільки майбутні бронювання (після можливих оновлень)
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Початок дня
      
      const futureBookings = await prisma.booking.findMany({
        where: {
          telegramUserId: userId,
          date: { gte: today }
        },
        orderBy: { date: 'asc' },
        take: 10
      });
      
      console.log(`📅 Майбутніх бронювань: ${futureBookings.length} (від ${today.toISOString().split('T')[0]})`);
      
      if (futureBookings.length === 0) {
        // Перезавантажуємо allUserBookings після можливих оновлень
        const finalAllBookings = await prisma.booking.findMany({
          where: { telegramUserId: userId },
          orderBy: { date: 'desc' }
        });
        
        // Якщо немає майбутніх - покажемо останні 3 минулих для діагностики
        if (finalAllBookings.length > 0) {
          const recentPast = finalAllBookings.slice(0, 3);
          let message = `📋 <b>Активних бронювань немає</b>\n\n`;
          message += `Але знайдено ${finalAllBookings.length} минулих:\n\n`;
          
          recentPast.forEach((booking, index) => {
            message += `${index + 1}. 🎫 <b>#${booking.id}</b>\n`;
            message += `   🚌 ${getRouteName(booking.route)}\n`;
            message += `   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n`;
            message += `   🎫 Місць: ${booking.seats}\n`;
            message += `   👤 ${booking.name}\n\n`;
          });
          
          message += `\n💡 Створіть нове бронювання:\n🎫 /book - через бота\n🌐 https://malin.kiev.ua - на сайті`;
          
          await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } else {
          await bot?.sendMessage(
            chatId,
            `📋 <b>У вас поки немає бронювань</b>\n\n` +
            `Створіть нове бронювання:\n` +
            `🎫 /book - через бота\n` +
            `🌐 https://malin.kiev.ua - на сайті`,
            { parse_mode: 'HTML' }
          );
        }
        return;
      }
      
      let message = `📋 <b>Ваші майбутні бронювання:</b>\n\n`;
      
      futureBookings.forEach((booking, index) => {
        message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>\n`;
        message += `   🚌 ${getRouteName(booking.route)}\n`;
        message += `   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n`;
        message += `   🎫 Місць: ${booking.seats}\n`;
        message += `   👤 ${booking.name}\n\n`;
      });
      
      message += `\n🔒 <i>Показано тільки ваші бронювання</i>`;
      
      await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
      console.log(`✅ Користувач ${userId} переглянув свої бронювання (майбутніх: ${futureBookings.length})`);
    } catch (error) {
      console.error('❌ Помилка отримання бронювань:', error);
      await bot?.sendMessage(chatId, '❌ Помилка при отриманні бронювань. Спробуйте пізніше.');
    }
  });

  // Команда /cancel - скасування бронювання
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    
    try {
      // Знайти майбутні бронювання користувача
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const futureBookings = await prisma.booking.findMany({
        where: {
          telegramUserId: userId,
          date: { gte: today }
        },
        orderBy: { date: 'asc' }
      });
      
      if (futureBookings.length === 0) {
        await bot?.sendMessage(
          chatId,
          '❌ <b>У вас немає майбутніх бронювань для скасування</b>\n\n' +
          'Створіть нове бронювання:\n' +
          '🎫 /book - Забронювати квиток\n' +
          '🌐 https://malin.kiev.ua',
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Створити inline кнопки для кожного бронювання
      const keyboard = {
        inline_keyboard: futureBookings.map(b => [{
          text: `🎫 #${b.id}: ${getRouteName(b.route)} - ${formatDate(b.date)} о ${b.departureTime}`,
          callback_data: `cancel_${b.id}`
        }])
      };
      
      await bot?.sendMessage(
        chatId,
        '🚫 <b>Скасування бронювання</b>\n\n' +
        'Оберіть бронювання для скасування:',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } catch (error) {
      console.error('❌ Помилка при отриманні бронювань:', error);
      await bot?.sendMessage(chatId, '❌ Помилка. Спробуйте пізніше.');
    }
  });

  // Команда /mydriverrides — мої поїздки як водій
  bot.onText(/\/mydriverrides/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await bot?.sendMessage(
        chatId,
        '❌ <b>Спочатку підключіть номер телефону</b>\n\n' +
        'Напишіть /start і надішліть свій номер — тоді зможете переглядати свої поїздки як водій.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const normalized = normalizePhone(userPhone);
    const listings = await prisma.viberListing.findMany({
      where: {
        listingType: 'driver',
        isActive: true
      },
      orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
    });
    const myListings = listings.filter((l) => normalizePhone(l.phone) === normalized);
    if (myListings.length === 0) {
      await bot?.sendMessage(
        chatId,
        '🚗 <b>Мої поїздки (водій)</b>\n\n' +
        'У вас поки немає активних оголошень про поїздки.\n\n' +
        'Додати поїздку: /adddriverride',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const lines = myListings.map((l) => {
      const time = l.departureTime ?? '—';
      const seats = l.seats != null ? `, ${l.seats} місць` : '';
      return `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${time}${seats}`;
    });
    await bot?.sendMessage(
      chatId,
      '🚗 <b>Мої поїздки (водій)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /adddriverride',
      { parse_mode: 'HTML' }
    );
  });

  // Команда /mypassengerrides — мої запити як пасажир
  bot.onText(/\/mypassengerrides/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    if (!userPhone) {
      await bot?.sendMessage(
        chatId,
        '❌ <b>Спочатку підключіть номер телефону</b>\n\n' +
        'Напишіть /start і надішліть свій номер — тоді зможете переглядати свої запити як пасажир.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const normalized = normalizePhone(userPhone);
    const listings = await prisma.viberListing.findMany({
      where: {
        listingType: 'passenger',
        isActive: true
      },
      orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
    });
    const myListings = listings.filter((l) => normalizePhone(l.phone) === normalized);
    if (myListings.length === 0) {
      await bot?.sendMessage(
        chatId,
        '👤 <b>Мої запити (пасажир)</b>\n\n' +
        'У вас поки немає активних запитів на поїздку.\n\n' +
        'Додати запит: /addpassengerride',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const lines = myListings.map((l) => {
      const time = l.departureTime ?? '—';
      return `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${time}`;
    });
    await bot?.sendMessage(
      chatId,
      '👤 <b>Мої запити (пасажир)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /addpassengerride',
      { parse_mode: 'HTML' }
    );
  });

  // Команда /adddriverride — додати поїздку як водій (меню)
  bot.onText(/\/adddriverride/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    const routeKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
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
  });

  // Команда /addpassengerride — шукаю поїздку (пасажир)
  bot.onText(/\/addpassengerride/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const userPhone = await getPhoneByTelegramUser(userId, chatId);
    const routeKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
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
  });

  // Команда /book - створення нового бронювання
  bot.onText(/\/book/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    
    // Перевірка чи є у користувача зареєстрований номер
    const userBooking = await prisma.booking.findFirst({
      where: { telegramUserId: userId }
    });
    
    if (!userBooking) {
      await bot?.sendMessage(
        chatId,
        '❌ <b>Спочатку зареєструйте свій номер телефону</b>\n\n' +
        'Використайте команду /start і надішліть свій номер телефону.\n\n' +
        'Або створіть бронювання на сайті:\n' +
        'https://malin.kiev.ua',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    // Крок 1: Вибір напрямку
    const directionKeyboard = {
      inline_keyboard: [
        [{ text: '🚌 Київ → Малин', callback_data: 'book_dir_Kyiv-Malyn' }],
        [{ text: '🚌 Малин → Київ', callback_data: 'book_dir_Malyn-Kyiv' }],
        [{ text: '🚌 Малин → Житомир', callback_data: 'book_dir_Malyn-Zhytomyr' }],
        [{ text: '🚌 Житомир → Малин', callback_data: 'book_dir_Zhytomyr-Malyn' }]
      ]
    };
    
    await bot?.sendMessage(
      chatId,
      '🎫 <b>Нове бронювання</b>\n\n' +
      '1️⃣ Оберіть напрямок:',
      { parse_mode: 'HTML', reply_markup: directionKeyboard }
    );
  });

  // Обробка callback query (натискання inline кнопок)
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id.toString();
    const userId = query.from?.id.toString() || '';
    const data = query.data;
    const messageId = query.message?.message_id;
    
    if (!chatId || !data) return;
    
    try {
      // ---------- Потік "додати поїздку (водій)" ----------
      if (data === 'adddriver_cancel') {
        driverRideStateMap.delete(chatId);
        await bot?.editMessageText('❌ Скасовано. /adddriverride — почати знову.', { chat_id: chatId, message_id: messageId });
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
        driverRideStateMap.set(chatId, { ...state, step: 'notes', seats: seats ?? undefined, since: Date.now() });
        const notesKeyboard = {
          inline_keyboard: [
            [{ text: 'Пропустити', callback_data: 'adddriver_notes_skip' }],
            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
          ]
        };
        await bot?.editMessageText(
          (state.departureTime ? `🕐 Час: ${state.departureTime}\n` : '') +
          (seats != null ? `🎫 Місць: ${seats}\n\n` : '') +
          '5️⃣ Додати примітку (опціонально)?\nНапишіть текст або натисніть Пропустити.',
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
        try {
          await createDriverListingFromState(chatId, state, null, senderName);
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
        await bot?.editMessageText('❌ Скасовано. /addpassengerride — почати знову.', { chat_id: chatId, message_id: messageId });
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
        try {
          await createPassengerListingFromState(chatId, state, null, senderName);
        } catch (err) {
          console.error('Create passenger listing error:', err);
          await bot?.sendMessage(chatId, '❌ Помилка збереження. /addpassengerride — спробувати знову.');
        }
        await bot?.editMessageText('✅ Готово! Запит на поїздку створено.', { chat_id: chatId, message_id: messageId });
        await bot?.answerCallbackQuery(query.id);
        return;
      }

      // Скасування бронювання - показати підтвердження
      if (data.startsWith('cancel_')) {
        const bookingId = data.replace('cancel_', '');
        
        // Отримати інформацію про бронювання
        const booking = await prisma.booking.findUnique({
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
          // Видалити бронювання безпосередньо через Prisma
          const booking = await prisma.booking.findUnique({
            where: { id: Number(bookingId) }
          });
          
          if (!booking) {
            throw new Error('Бронювання не знайдено');
          }
          
          if (booking.telegramUserId !== userId) {
            throw new Error('Це не ваше бронювання');
          }
          
          // Зберегти дані для відображення
          const bookingData = {
            id: booking.id,
            route: booking.route,
            date: booking.date
          };
          
          // Видалити бронювання
          await prisma.booking.delete({
            where: { id: Number(bookingId) }
          });
          
          console.log(`✅ Користувач ${userId} скасував бронювання #${bookingId}`);
          
          await bot?.editMessageText(
            '✅ <b>Бронювання успішно скасовано!</b>\n\n' +
            `🎫 Номер: #${bookingData.id}\n` +
            `📍 ${getRouteName(bookingData.route)}\n` +
            `📅 ${formatDate(bookingData.date)}\n\n` +
            '💡 Ви можете:\n' +
            '🎫 /book - Створити нове бронювання\n' +
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
          '📋 /mybookings - Переглянути всі бронювання',
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
        const schedules = await prisma.schedule.findMany({
          where: { route: { startsWith: direction } },
          orderBy: { departureTime: 'asc' }
        });
        
        if (schedules.length === 0) {
          // Запропонувати поїздки з Viber, якщо є
          const startOfDay = new Date(selectedDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(selectedDate);
          endOfDay.setHours(23, 59, 59, 999);
          const viberListings = await prisma.viberListing.findMany({
            where: {
              route: direction,
              date: { gte: startOfDay, lte: endOfDay },
              isActive: true
            },
            orderBy: [{ departureTime: 'asc' }]
          });
          const viberBlock =
            viberListings.length > 0
              ? '\n\n📱 <b>Поїздки з Viber</b> (можна замовити по телефону):\n' +
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
                '📋 /mybookings - Переглянути існуючі бронювання\n' +
                '🌐 https://malin.kiev.ua - Забронювати на сайті'
              : '';
          await bot?.editMessageText(
            '❌ <b>Немає доступних рейсів</b> за розкладом.\n\n' +
              'Спробуйте інший напрямок або дату.' +
              viberBlock +
              helpBlock,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
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
            
            const existingBookings = await prisma.booking.findMany({
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
          // Отримати інформацію про користувача
          const userBooking = await prisma.booking.findFirst({
            where: { telegramUserId: userId }
          });
          
          if (!userBooking) {
            throw new Error('Користувач не знайдений');
          }
          
          // Перевірити доступність місць
          const startOfDay = new Date(selectedDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(selectedDate);
          endOfDay.setHours(23, 59, 59, 999);
          
          const schedule = await prisma.schedule.findFirst({
            where: {
              route,
              departureTime: time
            }
          });
          
          if (!schedule) {
            throw new Error('Графік не знайдено');
          }
          
          const existingBookings = await prisma.booking.findMany({
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
          const booking = await prisma.booking.create({
            data: {
              route,
              date: new Date(selectedDate),
              departureTime: time,
              seats,
              name: userBooking.name,
              phone: userBooking.phone,
              telegramChatId: chatId,
              telegramUserId: userId,
              personId: userBooking.personId ?? undefined,
            },
          });
          
          console.log(`✅ Створено бронювання #${booking.id} користувачем ${userId} через бот`);
          
          await bot?.editMessageText(
            '✅ <b>Бронювання створено!</b>\n\n' +
            `🎫 <b>Номер:</b> #${booking.id}\n` +
            `📍 <b>Маршрут:</b> ${getRouteName(booking.route)}\n` +
            `📅 <b>Дата:</b> ${formatDate(booking.date)}\n` +
            `🕐 <b>Час:</b> ${booking.departureTime}\n` +
            `🎫 <b>Місць:</b> ${booking.seats}\n` +
            `👤 <b>Пасажир:</b> ${booking.name}\n\n` +
            '💡 Корисні команди:\n' +
            '📋 /mybookings - Переглянути всі бронювання\n' +
            '🚫 /cancel - Скасувати бронювання\n' +
            '🎫 /book - Створити ще одне бронювання',
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
          
          await bot?.answerCallbackQuery(query.id, { text: '✅ Бронювання створено!' });
          
          // Відправити підтвердження адміну якщо налаштовано
          if (process.env.ADMIN_TELEGRAM_ID) {
            await sendBookingNotificationToAdmin(booking);
          }
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

// Ініціалізація бота (якщо токен є)
if (token) {
  bot = new TelegramBot(token, { polling: true });
  console.log('✅ Telegram Bot ініціалізовано з polling');
  
  // Обробка команд
  setupBotCommands();
} else {
  console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
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
    const bookings = await prisma.booking.findMany({
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

export default bot;
