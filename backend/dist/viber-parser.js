"use strict";
/**
 * Парсер для повідомлень з Viber чату
 * Розбирає повідомлення формату:
 * [ 9 лютого 2026 р. 12:55 ] ⁨Ім'я⁩: текст повідомлення
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneNumber = normalizePhoneNumber;
exports.extractPhone = extractPhone;
exports.extractDate = extractDate;
exports.extractTime = extractTime;
exports.extractSeats = extractSeats;
exports.extractPrice = extractPrice;
exports.extractRoute = extractRoute;
exports.extractListingType = extractListingType;
exports.extractSenderName = extractSenderName;
exports.extractMessageDate = extractMessageDate;
exports.extractMessageBody = extractMessageBody;
exports.parseViberMessage = parseViberMessage;
exports.parseViberMessages = parseViberMessages;
/**
 * Нормалізує номер телефону - видаляє пробіли, дефіси
 */
function normalizePhoneNumber(phone) {
    return phone.replace(/[\s\-\(\)]/g, '');
}
/**
 * Витягує номер телефону з тексту
 */
function extractPhone(text) {
    // Шукаємо різні формати номерів: 0501234567, +380501234567, 050-123-45-67
    // Розділювачі між групами цифр: пробіли, дужки, дефіси (050-123-45-67, +380-50-123-45-67)
    const sep = '[\\s()\\-]*';
    const phonePatterns = [
        new RegExp(`\\+?380${sep}(\\d{2})${sep}(\\d{3})${sep}(\\d{2})${sep}(\\d{2})`),
        new RegExp(`0${sep}(\\d{2})${sep}(\\d{3})${sep}(\\d{2})${sep}(\\d{2})`),
        /0(\d{9})/, // 0501234567
    ];
    for (const pattern of phonePatterns) {
        const match = text.match(pattern);
        if (match) {
            return normalizePhoneNumber(match[0]);
        }
    }
    return null;
}
/**
 * Витягує дату з тексту
 * Підтримує формати: "09.02", "9.02", "01.03.2026", "Завтра 23.02.", "сьогодні", "завтра"
 * Явна дата (DD.MM) має пріоритет над "сьогодні"/"завтра" — "Завтра 23.02." → 23 лютого
 */
function extractDate(text, messageDate) {
    const now = messageDate || new Date();
    const currentYear = now.getFullYear();
    // Спочатку шукаємо явну дату DD.MM або DD.MM.YY або DD.MM.YYYY (пріоритет над "сьогодні"/"завтра")
    // Дозволяємо крапку в кінці: "23.02." або "23.02.26"
    const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\.?/);
    if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // Місяці в JS з 0
        let year = currentYear;
        if (dateMatch[3]) {
            year = parseInt(dateMatch[3], 10);
            if (year < 100) {
                year += 2000; // 26 -> 2026
            }
        }
        return new Date(year, month, day);
    }
    // Дата з назвою місяця: "18 лютого", "1 березня", "5 квітня 2026"
    const monthsGenitive = {
        січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5,
        липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
    };
    const monthNameMatch = text.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+(\d{2,4}))?/i);
    if (monthNameMatch) {
        const day = parseInt(monthNameMatch[1], 10);
        const month = monthsGenitive[monthNameMatch[2].toLowerCase()];
        let year = currentYear;
        if (monthNameMatch[3]) {
            year = parseInt(monthNameMatch[3], 10);
            if (year < 100)
                year += 2000;
        }
        if (month !== undefined) {
            return new Date(year, month, day);
        }
    }
    // "сьогодні" — тільки якщо немає явної дати
    if (/сьогодні/i.test(text)) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    // "завтра"
    if (/завтра/i.test(text)) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    }
    // Якщо дата не знайдена - повертаємо сьогодні
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
/**
 * Витягує час з тексту
 * Формати: "18:00", "18:00-18:30", "о 18:30", "20-45" (дефіс замість двокрапки), "в 8.40-8.50" (крапка замість двокрапки)
 */
function extractTime(text) {
    // Спочатку шукаємо час у форматі HH:MM або HH:MM-HH:MM
    let timeMatch = text.match(/(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/);
    if (timeMatch) {
        if (timeMatch[3]) {
            // Діапазон часу
            return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}-${timeMatch[3].padStart(2, '0')}:${timeMatch[4]}`;
        }
        else {
            // Один час
            return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        }
    }
    // Час з крапкою замість двокрапки: "в 8.40-8.50" або "в 8.40" (контекст "в/о" щоб не плутати з датою)
    // Перевіряємо валідність часу (год 0–23, хв 0–59), щоб не сприймати дату "в 27.02" як час
    const isValidTime = (h, m) => h >= 0 && h <= 23 && m >= 0 && m <= 59;
    const dotRangeMatch = text.match(/(?:в|о|виїзд)\s+(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})/i);
    if (dotRangeMatch) {
        const h1 = parseInt(dotRangeMatch[1], 10);
        const m1 = parseInt(dotRangeMatch[2], 10);
        const h2 = parseInt(dotRangeMatch[3], 10);
        const m2 = parseInt(dotRangeMatch[4], 10);
        if (isValidTime(h1, m1) && isValidTime(h2, m2)) {
            return `${dotRangeMatch[1].padStart(2, '0')}:${dotRangeMatch[2]}-${dotRangeMatch[3].padStart(2, '0')}:${dotRangeMatch[4]}`;
        }
    }
    const dotTimeMatch = text.match(/(?:в|о|виїзд)\s+(\d{1,2})\.(\d{2})(?=\s|$|,|\.)/i);
    if (dotTimeMatch) {
        const h = parseInt(dotTimeMatch[1], 10);
        const m = parseInt(dotTimeMatch[2], 10);
        if (isValidTime(h, m)) {
            return `${dotTimeMatch[1].padStart(2, '0')}:${dotTimeMatch[2]}`;
        }
    }
    // Діапазон з крапкою без обов'язкового "в/о/виїзд": "5.10-5.20"
    const genericDotRangeMatch = text.match(/(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})/);
    if (genericDotRangeMatch) {
        const h1 = parseInt(genericDotRangeMatch[1], 10);
        const m1 = parseInt(genericDotRangeMatch[2], 10);
        const h2 = parseInt(genericDotRangeMatch[3], 10);
        const m2 = parseInt(genericDotRangeMatch[4], 10);
        if (isValidTime(h1, m1) && isValidTime(h2, m2)) {
            return `${genericDotRangeMatch[1].padStart(2, '0')}:${genericDotRangeMatch[2]}-${genericDotRangeMatch[3].padStart(2, '0')}:${genericDotRangeMatch[4]}`;
        }
    }
    // Також шукаємо формат з дефісом замість двокрапки: "20-45"
    const dashTimeMatch = text.match(/(?:виїзд|о|в)\s+(\d{1,2})-(\d{2})/i);
    if (dashTimeMatch) {
        return `${dashTimeMatch[1].padStart(2, '0')}:${dashTimeMatch[2]}`;
    }
    return null;
}
/**
 * Витягує кількість місць
 */
function extractSeats(text) {
    // "2 пасажира", "3 особи", "є місця", "4 місця"
    const seatsMatch = text.match(/(\d+)\s*(пасажир|особ|місц)/i);
    if (seatsMatch) {
        return parseInt(seatsMatch[1], 10);
    }
    return null;
}
/**
 * Витягує ціну поїздки
 * Підтримує формати: "150 грн", "150грн.", "ціна 200 грн"
 */
function extractPrice(text) {
    const priceMatch = text.match(/(\d{2,4})\s*(?:грн|uah)/i);
    if (priceMatch) {
        const value = parseInt(priceMatch[1], 10);
        if (!Number.isNaN(value) && value > 0) {
            return value;
        }
    }
    return null;
}
/**
 * Визначає маршрут
 */
function extractRoute(text) {
    const normalizedText = text.toLowerCase();
    // Київ → Малин (враховуємо різні відмінки: Київ, Києва, Києві, Києвом, Києву)
    if (/ки[їєи][вї][а-я]*.*малин|киев.*малин|академ.*малин/i.test(normalizedText)) {
        return 'Kyiv-Malyn';
    }
    // Малин → Київ (враховуємо різні відмінки)
    if (/малин.*ки[їєи][вї][а-я]*|малин.*киев|малин.*академ/i.test(normalizedText)) {
        return 'Malyn-Kyiv';
    }
    // Малин → Житомир
    if (/малин.*житомир/i.test(normalizedText)) {
        return 'Malyn-Zhytomyr';
    }
    // Житомир → Малин
    if (/житомир.*малин/i.test(normalizedText)) {
        return 'Zhytomyr-Malyn';
    }
    // Коростень → Малин (враховуємо варіанти написання)
    if (/коростен[ья].*малин|коростень.*малин/i.test(normalizedText)) {
        return 'Korosten-Malyn';
    }
    // Малин → Коростень
    if (/малин.*коростен[ья]|малин.*коростень/i.test(normalizedText)) {
        return 'Malyn-Korosten';
    }
    return 'Unknown';
}
/**
 * Визначає тип оголошення (водій чи пасажир)
 */
function extractListingType(text) {
    if (/водій/i.test(text)) {
        return 'driver';
    }
    if (/пасажир/i.test(text)) {
        return 'passenger';
    }
    // За замовчуванням - водій (бо вони частіше пишуть)
    return 'driver';
}
/**
 * Витягує ім'я відправника з заголовка повідомлення
 */
function extractSenderName(text) {
    // Формат: [ дата ] ⁨Ім'я⁩: повідомлення
    const nameMatch = text.match(/\]\s*⁨([^⁩]+)⁩:/);
    if (nameMatch) {
        return nameMatch[1].trim();
    }
    return null;
}
/**
 * Витягує дату з заголовка повідомлення
 * Формат: [ 9 лютого 2026 р. 12:55 ]
 */
function extractMessageDate(text) {
    const dateMatch = text.match(/\[\s*(\d{1,2})\s+([а-яії]+)\s+(\d{4})\s+р\./i);
    if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const monthName = dateMatch[2].toLowerCase();
        const year = parseInt(dateMatch[3], 10);
        const months = {
            'січня': 0, 'лютого': 1, 'березня': 2, 'квітня': 3,
            'травня': 4, 'червня': 5, 'липня': 6, 'серпня': 7,
            'вересня': 8, 'жовтня': 9, 'листопада': 10, 'грудня': 11
        };
        const month = months[monthName];
        if (month !== undefined) {
            return new Date(year, month, day);
        }
    }
    return null;
}
/**
 * Витягує текст повідомлення (без заголовка)
 */
function extractMessageBody(text) {
    // Видаляємо заголовок [ дата ] ⁨Ім'я⁩:
    const bodyMatch = text.match(/\]\s*⁨[^⁩]+⁩:\s*(.+)/s);
    if (bodyMatch) {
        return bodyMatch[1].trim();
    }
    return text.trim();
}
/**
 * Основна функція парсингу
 */
function parseViberMessage(rawMessage) {
    try {
        const senderName = extractSenderName(rawMessage);
        const messageDate = extractMessageDate(rawMessage);
        const messageBody = extractMessageBody(rawMessage);
        // Телефон може бути відсутній в повідомленні
        let phone = extractPhone(messageBody);
        if (!phone) {
            console.warn('⚠️ Номер телефону не знайдено у повідомленні – буде використано посилання на Viber групу');
            // Зберігаємо порожній рядок, щоб не ламати типи та Prisma-схему
            phone = '';
        }
        const route = extractRoute(messageBody);
        if (route === 'Unknown') {
            console.warn('⚠️ Маршрут не визначено');
            return null;
        }
        const listingType = extractListingType(messageBody);
        const date = extractDate(messageBody, messageDate || undefined);
        const departureTime = extractTime(messageBody);
        const price = extractPrice(messageBody);
        const seats = extractSeats(messageBody);
        // Додаткові примітки (все що не розпарсилось)
        let notes = null;
        const notesPatterns = [
            /від\s+м\s+\w+/i,
            /біля\s+\w+/i,
            /є\s+місця/i,
        ];
        for (const pattern of notesPatterns) {
            const match = messageBody.match(pattern);
            if (match) {
                notes = notes ? `${notes}; ${match[0]}` : match[0];
            }
        }
        return {
            senderName,
            listingType,
            route,
            date,
            departureTime,
            price,
            seats,
            phone,
            notes,
        };
    }
    catch (error) {
        console.error('❌ Помилка парсингу повідомлення:', error);
        return null;
    }
}
/**
 * Парсить багато повідомлень одночасно (з копіювання чату)
 */
function parseViberMessages(rawMessages) {
    const messages = rawMessages.split(/\n(?=\[)/); // Розділяємо по новим повідомленням
    const result = [];
    for (const message of messages) {
        const trimmed = message.trim();
        if (!trimmed || trimmed.length < 10)
            continue;
        const parsed = parseViberMessage(trimmed);
        if (parsed) {
            result.push({ parsed, rawMessage: trimmed });
        }
    }
    return result;
}
