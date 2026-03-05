"use strict";
/**
 * Парсер для повідомлень з Telegram групи PoDoroguem (https://t.me/PoDoroguem)
 * Потоки: Малин-Київ (2), Малин-Коростень (108), Малин-Житомир (6)
 *
 * Формат Telegram відрізняється від Viber — немає [ дата ] ⁨Ім'я⁩:.
 * Можливі варіанти:
 * - "Ім'я Прізвище: текст оголошення"
 * - "Forwarded from X: текст"
 * - Просто "текст оголошення" (без префіксу)
 *
 * Логіка витягування маршруту, дати, часу, телефону — та сама що в viber-parser.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSenderNameTelegram = extractSenderNameTelegram;
exports.extractTelegramUserId = extractTelegramUserId;
exports.extractMessageBodyTelegram = extractMessageBodyTelegram;
exports.parseTelegramMessage = parseTelegramMessage;
exports.parseTelegramMessages = parseTelegramMessages;
const viber_parser_1 = require("./viber-parser");
/**
 * Витягує ім'я відправника з Telegram повідомлення
 * Формати: "Ім'я: текст", "Ім'я|tgUserId: текст", "Forwarded from Channel Name: текст"
 */
function extractSenderNameTelegram(text) {
    // "Name|userId: " або "FirstName LastName: " або "Ім'я: " на початку
    const withTgId = text.match(/^([А-Яа-яІіЇїЄєA-Za-z\s\-']+)\|(\d+):\s*(.*)/s);
    if (withTgId) {
        const name = withTgId[1].trim();
        if (name.length > 1 && name.length < 80 && !/^\d+$/.test(name)) {
            return name;
        }
    }
    const namePrefixMatch = text.match(/^([А-Яа-яІіЇїЄєA-Za-z\s\-']+):\s*(.*)/s);
    if (namePrefixMatch) {
        const name = namePrefixMatch[1].trim();
        if (name.length > 1 && name.length < 80 && !/^\d+$/.test(name)) {
            return name;
        }
    }
    const forwardedMatch = text.match(/^Forwarded\s+from\s+(.+?):\s*(.*)/is);
    if (forwardedMatch) {
        return forwardedMatch[1].trim();
    }
    return null;
}
/**
 * Витягує Telegram user ID з повідомлення (формат "Name|userId: текст" з fetch_telegram_messages.py)
 */
function extractTelegramUserId(rawMessage) {
    const match = rawMessage.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-']+\|(\d+):\s*/s);
    return match ? match[1] : null;
}
/**
 * Витягує тіло повідомлення (без префіксу "Ім'я: " або "Ім'я|userId: " або "Forwarded from X: ")
 */
function extractMessageBodyTelegram(text) {
    const withTgId = text.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-']+\|\d+:\s*(.*)/s);
    if (withTgId) {
        return withTgId[1].trim();
    }
    const namePrefixMatch = text.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-']+:\s*(.*)/s);
    if (namePrefixMatch) {
        return namePrefixMatch[1].trim();
    }
    const forwardedMatch = text.match(/^Forwarded\s+from\s+.+?:\s*(.*)/is);
    if (forwardedMatch) {
        return forwardedMatch[1].trim();
    }
    return text.trim();
}
/**
 * Парсить одне повідомлення з Telegram групи
 */
function parseTelegramMessage(rawMessage) {
    try {
        const senderName = extractSenderNameTelegram(rawMessage);
        const messageBody = extractMessageBodyTelegram(rawMessage);
        let phone = (0, viber_parser_1.extractPhone)(messageBody);
        if (!phone) {
            console.warn('⚠️ Номер телефону не знайдено у Telegram повідомленні');
            phone = '';
        }
        const route = (0, viber_parser_1.extractRoute)(messageBody);
        if (route === 'Unknown') {
            console.warn('⚠️ Маршрут не визначено в Telegram повідомленні');
            return null;
        }
        const listingType = (0, viber_parser_1.extractListingType)(messageBody);
        const date = (0, viber_parser_1.extractDate)(messageBody);
        const departureTime = (0, viber_parser_1.extractTime)(messageBody);
        const price = (0, viber_parser_1.extractPrice)(messageBody);
        const seats = (0, viber_parser_1.extractSeats)(messageBody);
        let notes = null;
        const notesPatterns = [/від\s+м\s+\w+/i, /біля\s+\w+/i, /є\s+місця/i];
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
        console.error('❌ Помилка парсингу Telegram повідомлення:', error);
        return null;
    }
}
/**
 * Розділяє блок тексту на окремі повідомлення.
 * Роздільники: "---" (з fetch_telegram_messages.py), подвійний перенос рядка, або "Ім'я: " на початку рядка.
 */
function splitTelegramMessages(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed)
        return [];
    // Роздільник "---" з fetch_telegram_messages.py
    const byDash = trimmed.split(/\n---\n|\n---\s*\n/);
    if (byDash.length > 1) {
        const msgs = byDash.map((s) => s.trim()).filter((s) => s.length >= 10);
        if (msgs.length > 0)
            return msgs;
    }
    // Подвійний перенос — окремі повідомлення
    const byDoubleNewline = trimmed.split(/\n\s*\n/);
    if (byDoubleNewline.length > 1) {
        return byDoubleNewline.map((s) => s.trim()).filter((s) => s.length >= 10);
    }
    // Один блок — перевіряємо чи є кілька повідомлень з "Name: " на початку рядка
    const lines = trimmed.split('\n');
    const messages = [];
    let current = [];
    for (const line of lines) {
        const isNewMessage = /^[А-Яа-яІіЇїЄєA-Za-z\s\-']+(?:\|\d+)?:\s*/.test(line.trim());
        if (isNewMessage && current.length > 0) {
            const joined = current.join('\n').trim();
            if (joined.length >= 10)
                messages.push(joined);
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) {
        const joined = current.join('\n').trim();
        if (joined.length >= 10)
            messages.push(joined);
    }
    return messages.length > 0 ? messages : [trimmed];
}
/**
 * Парсить кілька Telegram повідомлень одночасно
 */
function parseTelegramMessages(rawText) {
    const messages = splitTelegramMessages(rawText);
    const result = [];
    for (const msg of messages) {
        const parsed = parseTelegramMessage(msg);
        if (parsed) {
            const telegramUserId = extractTelegramUserId(msg);
            result.push({ parsed, rawMessage: msg, telegramUserId: telegramUserId ?? undefined });
        }
    }
    return result;
}
