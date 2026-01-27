import TelegramBot from 'node-telegram-bot-api';

// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

let bot: TelegramBot | null = null;

// Ініціалізація бота (якщо токен є)
if (token) {
  bot = new TelegramBot(token, { polling: false });
  console.log('✅ Telegram Bot ініціалізовано');
} else {
  console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
}

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
📞 <b>Телефон:</b> ${booking.phone}

✅ <i>Бронювання підтверджено</i>
    `.trim();

    await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram повідомлення надіслано адміну (booking #${booking.id})`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram повідомлення адміну:', error);
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

export default bot;
