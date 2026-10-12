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
  extractNotes,
  type ParsedViberMessage,
} from './viber-parser';

/**
 * Префікс "Ім'я|@username: " формуємо ми самі (fetch_telegram_messages.py, telegram-dzhura-source.ts), тож
 * ім'я може бути ЧИМОСЬ ЗАВГОДНО: "Дима .", "Олена (Київ)", "Max 🚗", цифри, крапки. Якір — перше "|@username:",
 * а не перелік дозволених символів (раніше крапка в імені губила і ім'я, і @username, і Person).
 */
const WITH_USERNAME_RE = /^([^\n|]{1,80}?)\|(@[a-zA-Z0-9_]+):\s*(.*)/s;

/** Префікс без @username ("Ім'я: текст"): символи обмежені, інакше "Київ-Малин 15:00" вважалось би іменем. */
const PLAIN_PREFIX_RE = /^([А-Яа-яІіЇїЄєҐґA-Za-z\s\-'’ʼ.@&]+):\s*(.*)/s;

/** Ім'я для відображення: без службових символів по краях; без жодної літери ("🔥", ".") → null. */
function cleanSenderName(raw: string): string | null {
  const name = raw.trim().replace(/^[\s.,_\-|]+|[\s.,_\-|]+$/g, '').trim();
  if (name.length < 2 || name.length >= 80 || !/\p{L}/u.test(name)) return null;
  return name;
}

/**
 * Витягує ім'я відправника з Telegram повідомлення
 * Формати: "Ім'я: текст", "Ім'я|@username: текст", "Forwarded from Channel Name: текст"
 */
export function extractSenderNameTelegram(text: string): string | null {
  const withUsername = text.match(WITH_USERNAME_RE);
  if (withUsername) return cleanSenderName(withUsername[1]);

  const namePrefixMatch = text.match(PLAIN_PREFIX_RE);
  if (namePrefixMatch) {
    const name = cleanSenderName(namePrefixMatch[1]);
    if (name && !/^\d+$/.test(name)) return name;
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
  const match = rawMessage.match(WITH_USERNAME_RE);
  return match ? match[2] : null;
}

/**
 * Витягує тіло повідомлення (без префіксу "Ім'я: " або "Ім'я|@username: " або "Forwarded from X: ")
 */
export function extractMessageBodyTelegram(text: string): string {
  const withUsername = text.match(WITH_USERNAME_RE);
  if (withUsername) {
    return withUsername[3].trim();
  }

  const namePrefixMatch = text.match(PLAIN_PREFIX_RE);
  if (namePrefixMatch) {
    return namePrefixMatch[2].trim();
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
      console.warn('⚠️ Номер телефону не знайдено у Telegram повідомленні', {
        messageBody: messageBody.slice(0, 500),
        rawMessage: rawMessage.slice(0, 500),
      });
      phone = '';
    }

    const route = extractRoute(messageBody);
    if (route === 'Unknown') {
      console.warn('⚠️ Маршрут не визначено в Telegram повідомленні', {
        messageBody: messageBody.slice(0, 500),
        rawMessage: rawMessage.slice(0, 500),
      });
      return null;
    }

    const listingType = extractListingType(messageBody);
    const date = extractDate(messageBody);
    const departureTime = extractTime(messageBody);
    const price = extractPrice(messageBody);
    const seats = extractSeats(messageBody);
    let notes = extractNotes(messageBody);

    // Якщо телефону немає, а є @username — посилання на Telegram у notes.
    // phone лишаємо порожнім: resolveTelegramImportPerson знайде/створить Person
    // через findOrCreatePersonByTelegramUsername і поставить listing.phone = @user.
    const username = extractTelegramUsername(rawMessage);
    if (username && (!phone || phone === '')) {
      const tme = `https://t.me/${username.replace(/^@/, '')}`;
      notes = notes ? `${notes}; ${tme}` : tme;
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
  // Хвостовий "---" останнього повідомлення не є роздільником (після trim поруч нема \n) — прибираємо,
  // інакше він лишався в rawMessage й тілі
  const trimmed = rawText.trim().replace(/\n?---\s*$/, '').trim();
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
