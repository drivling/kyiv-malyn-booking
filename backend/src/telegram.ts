import TelegramBot from 'node-telegram-bot-api';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
📞 <b>Телефон:</b> ${listing.phone}
${listing.senderName ? `👤 <b>Відправник:</b> ${listing.senderName}\n` : ''}${listing.notes ? `📝 <b>Примітки:</b> ${listing.notes}` : ''}
    `.trim();

    await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    console.log(`✅ Telegram: адміну надіслано сповіщення про Viber оголошення #${listing.id}`);
  } catch (error) {
    console.error('❌ Помилка відправки Telegram сповіщення про Viber оголошення:', error);
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
 * Реєстрація номера телефону користувача
 */
async function registerUserPhone(chatId: string, userId: string, phoneInput: string) {
  if (!bot) return;
  
  try {
    // Нормалізуємо номер
    const normalizedPhone = normalizePhone(phoneInput);
    
    // Перевіряємо чи вже є бронювання з цим номером
    const allBookings = await prisma.booking.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    const matchingBookings = allBookings.filter(b => 
      normalizePhone(b.phone) === normalizedPhone
    );
    
    // Також шукаємо бронювання з таким же telegramUserId (створені через Telegram Login)
    const userIdBookings = await prisma.booking.findMany({
      where: { telegramUserId: userId }
    });
    
    const totalBookings = matchingBookings.length + userIdBookings.length;
    
    if (totalBookings === 0) {
      await bot.sendMessage(
        chatId,
        `❌ Бронювання з номером ${phoneInput} не знайдено.\n\n` +
        `Спочатку створіть бронювання на сайті:\n` +
        `https://malin.kiev.ua\n\n` +
        `Після цього поверніться сюди і надішліть цей же номер телефону.`
      );
      return;
    }
    
    // 1. Оновлюємо всі бронювання з цим номером, додаючи telegramUserId та chatId
    const phoneNumbers = [...new Set(matchingBookings.map(b => b.phone))];
    
    for (const phone of phoneNumbers) {
      await prisma.booking.updateMany({
        where: { phone },
        data: { 
          telegramChatId: chatId,
          telegramUserId: userId
        }
      });
    }
    
    // 2. Оновлюємо всі бронювання з цим telegramUserId, додаючи chatId
    // (це для тих що були створені через Telegram Login на сайті)
    await prisma.booking.updateMany({
      where: { 
        telegramUserId: userId,
        telegramChatId: null // Оновлюємо тільки ті що ще не мають chatId
      },
      data: { 
        telegramChatId: chatId
      }
    });
    
    console.log(`✅ Оновлено telegramChatId для ${totalBookings} бронювань користувача ${userId}`);
    
    await bot.sendMessage(
      chatId,
      `✅ <b>Вітаємо! Ваш акаунт підключено!</b>\n\n` +
      `📱 Номер телефону: ${phoneInput}\n` +
      `🎫 Знайдено бронювань: ${totalBookings}\n\n` +
      `Тепер ви будете отримувати:\n` +
      `• ✅ Підтвердження при створенні бронювання\n` +
      `• 🔔 Нагадування за день до поїздки\n\n` +
      `📋 Використайте /mybookings щоб переглянути свої бронювання`,
      { parse_mode: 'HTML' }
    );
    
    console.log(`✅ Користувач ${userId} зареєстрував номер ${normalizedPhone}`);
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
    
    // Перевіряємо чи користувач вже зареєстрований
    const existingBooking = await prisma.booking.findFirst({
      where: { telegramUserId: userId }
    });
    
    if (existingBooking) {
      // Користувач вже зареєстрований - оновлюємо telegramChatId якщо потрібно
      await prisma.booking.updateMany({
        where: { 
          telegramUserId: userId,
          telegramChatId: null // Оновлюємо тільки ті що ще не мають chatId
        },
        data: { 
          telegramChatId: chatId
        }
      });
      
      console.log(`✅ Оновлено telegramChatId для користувача ${userId} при /start`);
      
      const welcomeMessage = `
👋 Привіт знову, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

✅ Ваш акаунт вже підключено до номера: ${existingBooking.phone}

🎫 <b>Що можна зробити:</b>
/book - 🎫 Створити нове бронювання
/mybookings - 📋 Переглянути мої бронювання
/cancel - 🚫 Скасувати бронювання
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

📋 <b>Інше:</b>
/start - головне меню
/help - показати цю довідку

✅ Ваш акаунт підключено до номера: ${existingBooking.phone}

💡 <b>Що я вмію:</b>
• 🎫 Створювати нові бронювання
• 📋 Показувати тільки ваші бронювання
• 🚫 Скасовувати бронювання
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
    
    await registerUserPhone(chatId, userId, phoneNumber);
  });

  // Обробка текстових повідомлень (номер телефону)
  bot.on('message', async (msg) => {
    // Ігноруємо команди та контакти (вони обробляються окремо)
    if (msg.text?.startsWith('/') || msg.contact) {
      return;
    }
    
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString() || '';
    const text = msg.text?.trim();
    
    if (!text) return;
    
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
            
            // Оновлюємо кожне бронювання
            for (const booking of orphanedBookings) {
              await prisma.booking.update({
                where: { id: booking.id },
                data: { 
                  telegramUserId: userId,
                  telegramChatId: chatId
                }
              });
              console.log(`  ✅ Бронювання #${booking.id} оновлено: userId=${userId}, chatId=${chatId}`);
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
              ? '\n\n📱 <b>Поїздки з Viber</b> (можна замовити по телефону):\n\n' +
                viberListings
                  .map((l) => {
                    const type = l.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир';
                    const time = l.departureTime || '—';
                    const seats = l.seats != null ? `, ${l.seats} місць` : '';
                    const notes = l.notes != null ? `\n💡 ${l.notes}` : '';
                    return `${type} ${time}${seats}${notes}\n📞 <a href="tel:${l.phone}">${l.phone}</a>`;
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
          
          // Створити бронювання
          const booking = await prisma.booking.create({
            data: {
              route,
              date: new Date(selectedDate),
              departureTime: time,
              seats,
              name: userBooking.name,
              phone: userBooking.phone,
              telegramChatId: chatId,
              telegramUserId: userId
            }
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
 * Отримання chat_id по номеру телефону (з нормалізацією)
 */
export const getChatIdByPhone = async (phone: string): Promise<string | null> => {
  try {
    const normalizedPhone = normalizePhone(phone);
    
    // Отримуємо всі бронювання з chat_id та userId
    const bookings = await prisma.booking.findMany({
      where: { 
        telegramChatId: { not: null },
        telegramUserId: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Шукаємо по нормалізованому номеру
    const matchingBooking = bookings.find(b => 
      normalizePhone(b.phone) === normalizedPhone
    );
    
    return matchingBooking?.telegramChatId || null;
  } catch (error) {
    console.error('❌ Помилка отримання chat_id:', error);
    return null;
  }
};

export default bot;
