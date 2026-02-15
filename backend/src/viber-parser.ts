/**
 * Парсер для повідомлень з Viber чату
 * Розбирає повідомлення формату:
 * [ 9 лютого 2026 р. 12:55 ] ⁨Ім'я⁩: текст повідомлення
 */

export interface ParsedViberMessage {
  senderName: string | null;
  listingType: 'driver' | 'passenger';
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
}

/**
 * Нормалізує номер телефону - видаляє пробіли, дефіси
 */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, '');
}

/**
 * Витягує номер телефону з тексту
 */
export function extractPhone(text: string): string | null {
  // Шукаємо різні формати номерів: 0501234567, +380501234567, 050-123-45-67
  const phonePatterns = [
    /\+?380\s?(\d{2})\s?(\d{3})\s?(\d{2})\s?(\d{2})/,  // +380 50 123 45 67
    /0(\d{2})\s?(\d{3})\s?(\d{2})\s?(\d{2})/,          // 050 123 45 67
    /0(\d{9})/,                                         // 0501234567
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
 * Підтримує формати: "09.02", "9.02", "сьогодні", "завтра"
 */
export function extractDate(text: string, messageDate?: Date): Date {
  const now = messageDate || new Date();
  const currentYear = now.getFullYear();
  
  // "сьогодні"
  if (/сьогодні/i.test(text)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  
  // "завтра"
  if (/завтра/i.test(text)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  }
  
  // Дата у форматі DD.MM або DD.MM.YY або DD.MM.YYYY
  const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
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
  
  // Якщо дата не знайдена - повертаємо сьогодні
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Витягує час з тексту
 * Формати: "18:00", "18:00-18:30", "о 18:30", "20-45" (дефіс замість двокрапки)
 */
export function extractTime(text: string): string | null {
  // Спочатку шукаємо час у форматі HH:MM або HH:MM-HH:MM
  let timeMatch = text.match(/(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/);
  if (timeMatch) {
    if (timeMatch[3]) {
      // Діапазон часу
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}-${timeMatch[3].padStart(2, '0')}:${timeMatch[4]}`;
    } else {
      // Один час
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
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
export function extractSeats(text: string): number | null {
  // "2 пасажира", "3 особи", "є місця", "4 місця"
  const seatsMatch = text.match(/(\d+)\s*(пасажир|особ|місц)/i);
  if (seatsMatch) {
    return parseInt(seatsMatch[1], 10);
  }
  
  return null;
}

/**
 * Визначає маршрут
 */
export function extractRoute(text: string): string {
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
export function extractListingType(text: string): 'driver' | 'passenger' {
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
export function extractSenderName(text: string): string | null {
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
export function extractMessageDate(text: string): Date | null {
  const dateMatch = text.match(/\[\s*(\d{1,2})\s+([а-яії]+)\s+(\d{4})\s+р\./i);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2].toLowerCase();
    const year = parseInt(dateMatch[3], 10);
    
    const months: { [key: string]: number } = {
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
export function extractMessageBody(text: string): string {
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
export function parseViberMessage(rawMessage: string): ParsedViberMessage | null {
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
    const seats = extractSeats(messageBody);
    
    // Додаткові примітки (все що не розпарсилось)
    let notes: string | null = null;
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
      seats,
      phone,
      notes,
    };
  } catch (error) {
    console.error('❌ Помилка парсингу повідомлення:', error);
    return null;
  }
}

/**
 * Результат парсингу одного повідомлення з оригінальним текстом (для збереження в rawMessage)
 */
export interface ParsedViberMessageWithRaw {
  parsed: ParsedViberMessage;
  rawMessage: string;
}

/**
 * Парсить багато повідомлень одночасно (з копіювання чату)
 */
export function parseViberMessages(rawMessages: string): ParsedViberMessageWithRaw[] {
  const messages = rawMessages.split(/\n(?=\[)/); // Розділяємо по новим повідомленням
  const result: ParsedViberMessageWithRaw[] = [];
  
  for (const message of messages) {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length < 10) continue;
    
    const parsed = parseViberMessage(trimmed);
    if (parsed) {
      result.push({ parsed, rawMessage: trimmed });
    }
  }
  
  return result;
}
