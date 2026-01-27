"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatIdByPhone = exports.isTelegramEnabled = exports.sendTripReminder = exports.sendBookingConfirmationToCustomer = exports.sendBookingNotificationToAdmin = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
let bot = null;
/**
 * Нормалізація номера телефону
 * Перетворює всі формати в 380XXXXXXXXX
 */
const normalizePhone = (phone) => {
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
const formatDate = (date) => {
    return new Intl.DateTimeFormat('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(date);
};
/**
 * Отримання назви маршруту
 */
const getRouteName = (route) => {
    if (route.includes('Kyiv-Malyn')) {
        if (route.includes('Irpin'))
            return 'Київ → Малин (через Ірпінь)';
        if (route.includes('Bucha'))
            return 'Київ → Малин (через Бучу)';
        return 'Київ → Малин';
    }
    if (route.includes('Malyn-Kyiv')) {
        if (route.includes('Irpin'))
            return 'Малин → Київ (через Ірпінь)';
        if (route.includes('Bucha'))
            return 'Малин → Київ (через Бучу)';
        return 'Малин → Київ';
    }
    return route;
};
/**
 * Відправка повідомлення про нове бронювання адміністратору
 */
const sendBookingNotificationToAdmin = async (booking) => {
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
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram повідомлення адміну:', error);
    }
};
exports.sendBookingNotificationToAdmin = sendBookingNotificationToAdmin;
/**
 * Відправка підтвердження бронювання клієнту
 */
const sendBookingConfirmationToCustomer = async (chatId, booking) => {
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
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram підтвердження клієнту:', error);
    }
};
exports.sendBookingConfirmationToCustomer = sendBookingConfirmationToCustomer;
/**
 * Відправка нагадування про поїздку (можна викликати через cron job)
 */
const sendTripReminder = async (chatId, booking) => {
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
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram нагадування:', error);
    }
};
exports.sendTripReminder = sendTripReminder;
/**
 * Перевірка чи бот налаштований
 */
const isTelegramEnabled = () => {
    return bot !== null && token !== undefined;
};
exports.isTelegramEnabled = isTelegramEnabled;
/**
 * Реєстрація номера телефону користувача
 */
async function registerUserPhone(chatId, userId, phoneInput) {
    if (!bot)
        return;
    try {
        // Нормалізуємо номер
        const normalizedPhone = normalizePhone(phoneInput);
        // Перевіряємо чи вже є бронювання з цим номером
        const allBookings = await prisma.booking.findMany({
            orderBy: { createdAt: 'desc' }
        });
        const matchingBookings = allBookings.filter(b => normalizePhone(b.phone) === normalizedPhone);
        if (matchingBookings.length === 0) {
            await bot.sendMessage(chatId, `❌ Бронювання з номером ${phoneInput} не знайдено.\n\n` +
                `Спочатку створіть бронювання на сайті:\n` +
                `https://frontend-production-34cd.up.railway.app\n\n` +
                `Після цього поверніться сюди і надішліть цей же номер телефону.`);
            return;
        }
        // Оновлюємо всі бронювання з цим номером, додаючи telegramUserId та chatId
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
        await bot.sendMessage(chatId, `✅ <b>Вітаємо! Ваш акаунт підключено!</b>\n\n` +
            `📱 Номер телефону: ${phoneInput}\n` +
            `🎫 Знайдено бронювань: ${matchingBookings.length}\n\n` +
            `Тепер ви будете отримувати:\n` +
            `• ✅ Підтвердження при створенні бронювання\n` +
            `• 🔔 Нагадування за день до поїздки\n\n` +
            `📋 Використайте /mybookings щоб переглянути свої бронювання`, { parse_mode: 'HTML' });
        console.log(`✅ Користувач ${userId} зареєстрував номер ${normalizedPhone}`);
    }
    catch (error) {
        console.error('❌ Помилка реєстрації номера:', error);
        await bot.sendMessage(chatId, '❌ Помилка при реєстрації. Спробуйте пізніше.');
    }
}
/**
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
    if (!bot)
        return;
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
            // Користувач вже зареєстрований
            const welcomeMessage = `
👋 Привіт знову, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

✅ Ваш акаунт вже підключено до номера: ${existingBooking.phone}

📋 <b>Доступні команди:</b>
/mybookings - переглянути ТІЛЬКИ мої бронювання
/help - показати довідку

🌐 <b>Забронювати новий квиток:</b>
https://frontend-production-34cd.up.railway.app
      `.trim();
            await bot?.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
        }
        else {
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
https://frontend-production-34cd.up.railway.app
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

/start - головне меню
/mybookings - переглянути ТІЛЬКИ мої бронювання
/help - показати цю довідку

✅ Ваш акаунт підключено до номера: ${existingBooking.phone}

💡 <b>Що я вмію:</b>
• Показую тільки ваші бронювання (безпечно!)
• Надсилаю підтвердження після бронювання
• Нагадую за день до поїздки

🌐 Сайт: https://frontend-production-34cd.up.railway.app
      `.trim();
            await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
        }
        else {
            const helpMessage = `
📚 <b>Довідка:</b>

/start - почати роботу з ботом
/mybookings - переглянути мої бронювання
/help - показати цю довідку

📱 <b>Як підключитися:</b>
1. Напишіть /start
2. Надішліть свій номер телефону (кнопкою або текстом)
3. Готово! Тепер ви отримуватимете нотифікації

💡 <b>Формати номера:</b>
• +380501234567
• 380501234567
• 0501234567

🌐 Сайт: https://frontend-production-34cd.up.railway.app
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
        if (!text)
            return;
        // Перевіряємо чи це схоже на номер телефону
        const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
        if (phoneRegex.test(text)) {
            await registerUserPhone(chatId, userId, text);
        }
        else {
            // Якщо користувач ще не зареєстрований, підказуємо
            const existingBooking = await prisma.booking.findFirst({
                where: { telegramUserId: userId }
            });
            if (!existingBooking) {
                await bot?.sendMessage(chatId, '❓ Для початку роботи, будь ласка, надішліть свій номер телефону.\n\n' +
                    'Використайте команду /start для інструкцій.');
            }
        }
    });
    // Команда /mybookings - показує ТІЛЬКИ бронювання поточного користувача
    bot.onText(/\/mybookings/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        try {
            // Шукаємо бронювання по Telegram User ID (безпечно!)
            const myBookings = await prisma.booking.findMany({
                where: {
                    telegramUserId: userId,
                    date: { gte: new Date() }
                },
                orderBy: { date: 'asc' },
                take: 10
            });
            if (myBookings.length === 0) {
                await bot?.sendMessage(chatId, `📋 <b>У вас поки немає активних бронювань</b>\n\n` +
                    `Створіть бронювання на сайті:\n` +
                    `https://frontend-production-34cd.up.railway.app`, { parse_mode: 'HTML' });
                return;
            }
            let message = `📋 <b>Ваші бронювання:</b>\n\n`;
            myBookings.forEach((booking, index) => {
                message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>\n`;
                message += `   🚌 ${getRouteName(booking.route)}\n`;
                message += `   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n`;
                message += `   🎫 Місць: ${booking.seats}\n`;
                message += `   👤 ${booking.name}\n\n`;
            });
            message += `\n🔒 <i>Показано тільки ваші бронювання</i>`;
            await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
            console.log(`✅ Користувач ${userId} переглянув свої бронювання (${myBookings.length})`);
        }
        catch (error) {
            console.error('❌ Помилка отримання бронювань:', error);
            await bot?.sendMessage(chatId, '❌ Помилка при отриманні бронювань. Спробуйте пізніше.');
        }
    });
    console.log('✅ Bot commands налаштовано');
}
// Ініціалізація бота (якщо токен є)
if (token) {
    bot = new node_telegram_bot_api_1.default(token, { polling: true });
    console.log('✅ Telegram Bot ініціалізовано з polling');
    // Обробка команд
    setupBotCommands();
}
else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
}
/**
 * Отримання chat_id по номеру телефону (з нормалізацією)
 */
const getChatIdByPhone = async (phone) => {
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
        const matchingBooking = bookings.find(b => normalizePhone(b.phone) === normalizedPhone);
        return matchingBooking?.telegramChatId || null;
    }
    catch (error) {
        console.error('❌ Помилка отримання chat_id:', error);
        return null;
    }
};
exports.getChatIdByPhone = getChatIdByPhone;
exports.default = bot;
