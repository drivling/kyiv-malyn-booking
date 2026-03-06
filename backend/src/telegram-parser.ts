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

import {
  extractDate,
  extractTime,
  extractPhone,
  extractSeats,
  extractPrice,
  extractRoute,
  extractListingType,
  type ParsedViberMessage,
} from './viber-parser';

/**
 * Витягує ім'я відправника з Telegram повідомлення
 * Формати: "Ім'я: текст", "Ім'я|@username: текст", "Forwarded from Channel Name: текст"
 */
export function extractSenderNameTelegram(text: string): string | null {
  // "Name|@username: " або "FirstName LastName: " або "Ім'я: " або "@username: " на початку
  const withUsername = text.match(/^([А-Яа-яІіЇїЄєA-Za-z\s\-'@]+)\|(@[a-zA-Z0-9_]+):\s*(.*)/s);
  if (withUsername) {
    const name = withUsername[1].trim();
    if (name.length > 1 && name.length < 80 && !/^\d+$/.test(name)) {
      return name;
    }
  }

  const namePrefixMatch = text.match(/^([А-Яа-яІіЇїЄєA-Za-z\s\-'@]+):\s*(.*)/s);
  if (namePrefixMatch) {
    const name = namePrefixMatch[1].trim();
    if (name.length > 1 && name.length < 80 && !/^\d+$/.test(name)) {
      return name;
    }
  }

  // "Forwarded from X: текст"
  const forwardedMatch = text.match(/^Forwarded\s+from\s+(.+?):\s*(.*)/is);
  if (forwardedMatch) {
    return forwardedMatch[1].trim();
  }

  return null;
}

/**
 * Витягує @username з повідомлення (формат "Name|@username: текст" з fetch_telegram_messages.py)
 */
export function extractTelegramUsername(rawMessage: string): string | null {
  const match = rawMessage.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-'@]+\|(@[a-zA-Z0-9_]+):\s*/s);
  return match ? match[1] : null;
}

/**
 * Витягує тіло повідомлення (без префіксу "Ім'я: " або "Ім'я|@username: " або "Forwarded from X: ")
 */
export function extractMessageBodyTelegram(text: string): string {
  const withUsername = text.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-'@]+\|@[a-zA-Z0-9_]+:\s*(.*)/s);
  if (withUsername) {
    return withUsername[1].trim();
  }

  const namePrefixMatch = text.match(/^[А-Яа-яІіЇїЄєA-Za-z\s\-'@]+:\s*(.*)/s);
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
export function parseTelegramMessage(rawMessage: string): ParsedViberMessage | null {
  try {
    const senderName = extractSenderNameTelegram(rawMessage);
    const messageBody = extractMessageBodyTelegram(rawMessage);

    let phone = extractPhone(messageBody);
    if (!phone) {
      console.warn('⚠️ Номер телефону не знайдено у Telegram повідомленні');
      phone = '';
    }

    const route = extractRoute(messageBody);
    if (route === 'Unknown') {
      console.warn('⚠️ Маршрут не визначено в Telegram повідомленні');
      return null;
    }

    const listingType = extractListingType(messageBody);
    const date = extractDate(messageBody);
    const departureTime = extractTime(messageBody);
    const price = extractPrice(messageBody);
    const seats = extractSeats(messageBody);

    let notes: string | null = null;
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
  } catch (error) {
    console.error('❌ Помилка парсингу Telegram повідомлення:', error);
    return null;
  }
}

export interface ParsedTelegramMessageWithRaw {
  parsed: ParsedViberMessage;
  rawMessage: string;
  /** @username автора повідомлення (для прив'язки до Person) */
  telegramUsername?: string | null;
}

/**
 * Розділяє блок тексту на окремі повідомлення.
 * Роздільники: "---" (з fetch_telegram_messages.py), подвійний перенос рядка, або "Ім'я: " на початку рядка.
 */
function splitTelegramMessages(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Роздільник "---" з fetch_telegram_messages.py
  const byDash = trimmed.split(/\n---\n|\n---\s*\n/);
  if (byDash.length > 1) {
    const msgs = byDash.map((s) => s.trim()).filter((s) => s.length >= 10);
    if (msgs.length > 0) return msgs;
  }

  // Подвійний перенос — окремі повідомлення
  const byDoubleNewline = trimmed.split(/\n\s*\n/);
  if (byDoubleNewline.length > 1) {
    return byDoubleNewline.map((s) => s.trim()).filter((s) => s.length >= 10);
  }

  // Один блок — перевіряємо чи є кілька повідомлень з "Name: " на початку рядка
  const lines = trimmed.split('\n');
  const messages: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isNewMessage = /^[А-Яа-яІіЇїЄєA-Za-z\s\-'@]+(?:\|@[a-zA-Z0-9_]+)?:\s*/.test(line.trim());
    if (isNewMessage && current.length > 0) {
      const joined = current.join('\n').trim();
      if (joined.length >= 10) messages.push(joined);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    const joined = current.join('\n').trim();
    if (joined.length >= 10) messages.push(joined);
  }

  return messages.length > 0 ? messages : [trimmed];
}

/**
 * Парсить кілька Telegram повідомлень одночасно
 */
export function parseTelegramMessages(rawText: string): ParsedTelegramMessageWithRaw[] {
  const messages = splitTelegramMessages(rawText);
  const result: ParsedTelegramMessageWithRaw[] = [];

  for (const msg of messages) {
    const parsed = parseTelegramMessage(msg);
    if (parsed) {
      const telegramUsername = extractTelegramUsername(msg);
      result.push({ parsed, rawMessage: msg, telegramUsername: telegramUsername ?? undefined });
    }
  }

  return result;
}
