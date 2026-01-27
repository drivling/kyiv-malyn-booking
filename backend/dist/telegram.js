"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTelegramEnabled = exports.sendTripReminder = exports.sendBookingConfirmationToCustomer = exports.sendBookingNotificationToAdmin = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
let bot = null;
// Ініціалізація бота (якщо токен є)
if (token) {
    bot = new node_telegram_bot_api_1.default(token, { polling: false });
    console.log('✅ Telegram Bot ініціалізовано');
}
else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
}
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
exports.default = bot;
