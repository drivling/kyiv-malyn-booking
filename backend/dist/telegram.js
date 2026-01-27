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
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
    if (!bot)
        return;
    // Команда /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const firstName = msg.from?.first_name || 'Друже';
        const welcomeMessage = `
👋 Привіт, ${firstName}!

Я бот для бронювання маршруток <b>Київ ↔ Малин</b>.

🎫 <b>Як отримувати нотифікації:</b>
1. При бронюванні на сайті вкажіть свій номер телефону
2. Напишіть мені команду з будь-яким форматом номера:
   <code>/subscribe +380501234567</code>
   <code>/subscribe 380501234567</code>
   <code>/subscribe 0501234567</code>
3. Після цього ви отримуватимете:
   ✅ Підтвердження бронювання
   🔔 Нагадування за день до поїздки

📋 <b>Доступні команди:</b>
/subscribe НОМЕР - підписатися на нотифікації
/booking НОМЕР - перевірити свої бронювання
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
/subscribe НОМЕР - підписатися на нотифікації
/booking НОМЕР - переглянути свої бронювання
/help - показати цю довідку

📱 <b>Формати номера:</b>
Можна використати будь-який:
• <code>/subscribe +380501234567</code>
• <code>/subscribe 380501234567</code>
• <code>/subscribe 0501234567</code>

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
        const phoneInput = match?.[1]?.trim();
        if (!phoneInput) {
            await bot?.sendMessage(chatId, '❌ Будь ласка, вкажіть номер телефону:\n\n' +
                'Можна використати будь-який формат:\n' +
                '<code>/subscribe +380501234567</code>\n' +
                '<code>/subscribe 380501234567</code>\n' +
                '<code>/subscribe 0501234567</code>', { parse_mode: 'HTML' });
            return;
        }
        try {
            // Нормалізуємо номер який ввів користувач
            const normalizedInputPhone = normalizePhone(phoneInput);
            // Знаходимо всі бронювання і перевіряємо нормалізовані номери
            const allBookings = await prisma.booking.findMany({
                orderBy: { createdAt: 'desc' }
            });
            // Шукаємо бронювання з відповідним номером (після нормалізації)
            const matchingBookings = allBookings.filter(b => normalizePhone(b.phone) === normalizedInputPhone);
            if (matchingBookings.length === 0) {
                await bot?.sendMessage(chatId, `❌ Бронювання з номером ${phoneInput} не знайдено.\n\n` +
                    `Спробуйте інший формат:\n` +
                    `• <code>/subscribe +380${phoneInput.replace(/\D/g, '').slice(-9)}</code>\n` +
                    `• <code>/subscribe 0${phoneInput.replace(/\D/g, '').slice(-9)}</code>\n\n` +
                    `Або створіть бронювання на сайті:\nhttps://kyiv-malyn-booking.up.railway.app`, { parse_mode: 'HTML' });
                return;
            }
            // Оновлюємо всі знайдені бронювання
            const phoneNumbers = [...new Set(matchingBookings.map(b => b.phone))];
            for (const phone of phoneNumbers) {
                await prisma.booking.updateMany({
                    where: { phone },
                    data: { telegramChatId: chatId }
                });
            }
            await bot?.sendMessage(chatId, `✅ <b>Підписка активована!</b>\n\n` +
                `Знайдено бронювань: ${matchingBookings.length}\n` +
                `Ви отримуватимете повідомлення про всі бронювання на номер ${phoneInput}.\n\n` +
                `🔔 Ви також отримаєте нагадування за день до поїздки.`, { parse_mode: 'HTML' });
            console.log(`✅ Клієнт ${phoneInput} (normalized: ${normalizedInputPhone}) підписався на нотифікації (chat_id: ${chatId})`);
        }
        catch (error) {
            console.error('❌ Помилка підписки:', error);
            await bot?.sendMessage(chatId, '❌ Помилка при підписці. Спробуйте пізніше.');
        }
    });
    // Команда /booking +380XXXXXXXXX
    bot.onText(/\/booking (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        const phoneInput = match?.[1]?.trim();
        if (!phoneInput) {
            await bot?.sendMessage(chatId, '❌ Будь ласка, вкажіть номер телефону:\n\n' +
                'Можна використати будь-який формат:\n' +
                '<code>/booking +380501234567</code>\n' +
                '<code>/booking 380501234567</code>\n' +
                '<code>/booking 0501234567</code>', { parse_mode: 'HTML' });
            return;
        }
        try {
            // Нормалізуємо введений номер
            const normalizedInputPhone = normalizePhone(phoneInput);
            // Отримуємо всі майбутні бронювання
            const allBookings = await prisma.booking.findMany({
                where: {
                    date: { gte: new Date() }
                },
                orderBy: { date: 'asc' }
            });
            // Фільтруємо по нормалізованому номеру
            const matchingBookings = allBookings
                .filter(b => normalizePhone(b.phone) === normalizedInputPhone)
                .slice(0, 5);
            if (matchingBookings.length === 0) {
                await bot?.sendMessage(chatId, `❌ Активних бронювань для номера ${phoneInput} не знайдено.\n\n` +
                    `Спробуйте інший формат або створіть бронювання на сайті:\nhttps://kyiv-malyn-booking.up.railway.app`);
                return;
            }
            let message = `📋 <b>Ваші бронювання (${phoneInput}):</b>\n\n`;
            matchingBookings.forEach((booking, index) => {
                message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>\n`;
                message += `   🚌 ${getRouteName(booking.route)}\n`;
                message += `   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n`;
                message += `   🎫 Місць: ${booking.seats}\n`;
                message += `   👤 ${booking.name}\n\n`;
            });
            await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
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
        // Отримуємо всі бронювання з chat_id
        const bookings = await prisma.booking.findMany({
            where: {
                telegramChatId: { not: null }
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
