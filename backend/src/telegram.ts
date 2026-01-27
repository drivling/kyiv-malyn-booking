import TelegramBot from 'node-telegram-bot-api';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

let bot: TelegramBot | null = null;

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

/**
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
  if (!bot) return;

  // Команда /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const firstName = msg.from?.first_name || 'Друже';
    
    const welcomeMessage = `
👋 Привіт, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

🎫 <b>Як отримувати нотифікації:</b>
1. При бронюванні на сайті вкажіть свій номер телефону
2. Напишіть мені команду:
   <code>/subscribe +380XXXXXXXXX</code>
3. Після цього ви отримуватимете:
   ✅ Підтвердження бронювання
   🔔 Нагадування за день до поїздки

📋 <b>Доступні команди:</b>
/subscribe +380XXXXXXXXX - підписатися на нотифікації
/booking +380XXXXXXXXX - перевірити свої бронювання
/help - показати цю довідку

🌐 <b>Забронювати квиток:</b>
https://kyiv-malyn-booking.up.railway.app
    `.trim();
    
    await bot?.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
  });

  // Команда /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id.toString();
    
    const helpMessage = `
📚 <b>Довідка по командах:</b>

/start - почати роботу з ботом
/subscribe +380XXXXXXXXX - підписатися на нотифікації
/booking +380XXXXXXXXX - переглянути свої бронювання
/help - показати цю довідку

💡 <b>Як це працює:</b>
1. Зайдіть на сайт та створіть бронювання
2. Підпишіться на нотифікації командою /subscribe
3. Отримуйте автоматичні повідомлення!

🌐 Сайт: https://kyiv-malyn-booking.up.railway.app
    `.trim();
    
    await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
  });

  // Команда /subscribe +380XXXXXXXXX
  bot.onText(/\/subscribe (.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const phone = match?.[1]?.trim();
    
    if (!phone) {
      await bot?.sendMessage(chatId, '❌ Будь ласка, вкажіть номер телефону:\n<code>/subscribe +380501234567</code>', { parse_mode: 'HTML' });
      return;
    }
    
    try {
      // Знаходимо останнє бронювання по телефону
      const booking = await prisma.booking.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' }
      });
      
      if (!booking) {
        await bot?.sendMessage(
          chatId,
          `❌ Бронювання з номером ${phone} не знайдено.\n\n` +
          `Спочатку створіть бронювання на сайті:\nhttps://kyiv-malyn-booking.up.railway.app`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Оновлюємо всі бронювання цього клієнта
      await prisma.booking.updateMany({
        where: { phone },
        data: { telegramChatId: chatId }
      });
      
      await bot?.sendMessage(
        chatId,
        `✅ <b>Підписка активована!</b>\n\n` +
        `Ви отримуватимете повідомлення про бронювання на номер ${phone}.\n\n` +
        `🔔 Ви також отримаєте нагадування за день до поїздки.`,
        { parse_mode: 'HTML' }
      );
      
      console.log(`✅ Клієнт ${phone} підписався на нотифікації (chat_id: ${chatId})`);
    } catch (error) {
      console.error('❌ Помилка підписки:', error);
      await bot?.sendMessage(chatId, '❌ Помилка при підписці. Спробуйте пізніше.');
    }
  });

  // Команда /booking +380XXXXXXXXX
  bot.onText(/\/booking (.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const phone = match?.[1]?.trim();
    
    if (!phone) {
      await bot?.sendMessage(chatId, '❌ Будь ласка, вкажіть номер телефону:\n<code>/booking +380501234567</code>', { parse_mode: 'HTML' });
      return;
    }
    
    try {
      const bookings = await prisma.booking.findMany({
        where: {
          phone,
          date: { gte: new Date() } // Тільки майбутні бронювання
        },
        orderBy: { date: 'asc' },
        take: 5
      });
      
      if (bookings.length === 0) {
        await bot?.sendMessage(
          chatId,
          `❌ Активних бронювань для номера ${phone} не знайдено.\n\n` +
          `Створіть бронювання на сайті:\nhttps://kyiv-malyn-booking.up.railway.app`
        );
        return;
      }
      
      let message = `📋 <b>Ваші бронювання (${phone}):</b>\n\n`;
      
      bookings.forEach((booking, index) => {
        message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>\n`;
        message += `   🚌 ${getRouteName(booking.route)}\n`;
        message += `   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n`;
        message += `   🎫 Місць: ${booking.seats}\n`;
        message += `   👤 ${booking.name}\n\n`;
      });
      
      await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('❌ Помилка отримання бронювань:', error);
      await bot?.sendMessage(chatId, '❌ Помилка при отриманні бронювань. Спробуйте пізніше.');
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
 * Отримання chat_id по номеру телефону
 */
export const getChatIdByPhone = async (phone: string): Promise<string | null> => {
  try {
    const booking = await prisma.booking.findFirst({
      where: { 
        phone,
        telegramChatId: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return booking?.telegramChatId || null;
  } catch (error) {
    console.error('❌ Помилка отримання chat_id:', error);
    return null;
  }
};

export default bot;
