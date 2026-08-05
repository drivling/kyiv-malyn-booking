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
  price: number | null;
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
  // Розділювачі між групами цифр: пробіли, дужки, дефіси (050-123-45-67, +380-50-123-45-67)
  const sep = '[\\s()\\-]*';
  // Порядок важливий: (1) міжнародний +380…; (2) суцільні 10 цифр 0XXXXXXXXX — раніше за
  // «0 + пробіли + групи», інакше «0 0938901865» дає хибне 0093890186 (втрата останньої цифри).
  const phonePatterns = [
    new RegExp(`\\+?380${sep}(\\d{2})${sep}(\\d{3})${sep}(\\d{2})${sep}(\\d{2})`),
    /0(\d{9})/, // 0501234567, 0938901865
    new RegExp(`0${sep}(\\d{2})${sep}(\\d{3})${sep}(\\d{2})${sep}(\\d{2})`), // 050-123-45-67
    // "096 97 27 437" (групи 2-2-3 після коду оператора)
    new RegExp(`0(\\d{2})${sep}(\\d{2})${sep}(\\d{2})${sep}(\\d{3})`),
  ];

  for (const pattern of phonePatterns) {
    const match = text.match(pattern);
    if (match) {
      return normalizePhoneNumber(match[0]);
    }
  }

  return null;
}

const MONTHS_GENITIVE: { [key: string]: number } = {
  // UK
  січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5,
  липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
  // RU (Viber UI)
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function isValidCalendarDate(day: number, monthIndex: number): boolean {
  return day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11;
}

/**
 * Витягує дату з тексту
 * Підтримує формати: "09.02", "9.02", "01.03.2026", "14..07.26", "Завтра 23.02.", "сьогодні", "завтра"
 * Явна дата (DD.MM) має пріоритет над "сьогодні"/"завтра" — "Завтра 23.02." → 23 лютого
 * Не сприймає час "о 14.10" / "18.40-20.00" як дату (валідація місяця 1–12 + контекст часу).
 */
export function extractDate(text: string, messageDate?: Date): Date {
  const now = messageDate || new Date();
  const currentYear = now.getFullYear();

  // ISO в bot-повідомленнях: "2026-07-17"
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    if (isValidCalendarDate(day, month)) {
      return new Date(year, month, day);
    }
  }

  // Явна дата DD.MM[.YY|YYYY], також "14..07.26" (зайві крапки)
  // Не беремо збіг одразу після "о/в/виїзд/на" — це майже завжди час (о 14.10, о 18.15)
  // Явна дата DD.MM[.YY|YYYY], також "14..07.26" (зайві крапки)
  // Рік без пробілу після місяця: "20.07.26", не "20.07. 17.10"
  const dateRe = /(\d{1,2})\.+\s*(\d{1,2})(?:\.(\d{2,4}))?\.?/g;
  let dateMatch: RegExpExecArray | null;
  while ((dateMatch = dateRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, dateMatch.index - 12), dateMatch.index);
    if (/(?:^|[\s,;:(])(?:в|о|виїзд|на)\s*$/i.test(before)) {
      continue;
    }
    // Діапазон часу з крапками: "18.40-20.00" — не дата
    const after = text.slice(dateMatch.index + dateMatch[0].length, dateMatch.index + dateMatch[0].length + 8);
    if (/^\s*-\s*\d{1,2}[.:]\d{2}/.test(after)) {
      continue;
    }

    const day = parseInt(dateMatch[1], 10);
    const monthNum = parseInt(dateMatch[2], 10);
    const month = monthNum - 1;
    if (!isValidCalendarDate(day, month)) {
      continue;
    }

    let year = currentYear;
    if (dateMatch[3]) {
      const rawYear = parseInt(dateMatch[3], 10);
      if (dateMatch[3].length >= 4) {
        year = rawYear;
      } else if (rawYear >= 20 && rawYear <= 39) {
        // 2-значний рік лише 20–39 (2020–2039); "20.07. 17.10" не бере 17 як рік
        year = 2000 + rawYear;
      }
      // інакше ігноруємо «рік» — це майже завжди година (17.10, 15:40)
    }
    return new Date(year, month, day);
  }

  // "26 07" / "26 07 Малин" (день і місяць через пробіл, без крапки)
  const spaceDateMatch = text.match(/(?:^|[^\d])(\d{1,2})\s+(\d{1,2})(?!\d)(?:\s|\.|$)/);
  if (spaceDateMatch) {
    const day = parseInt(spaceDateMatch[1], 10);
    const month = parseInt(spaceDateMatch[2], 10) - 1;
    if (isValidCalendarDate(day, month)) {
      return new Date(currentYear, month, day);
    }
  }

  // Дата з назвою місяця: "18 лютого", "5 августа", "24 липня"
  const monthNames = Object.keys(MONTHS_GENITIVE).join('|');
  const monthNameMatch = text.match(
    new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{2,4}))?`, 'i')
  );
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1], 10);
    const month = MONTHS_GENITIVE[monthNameMatch[2].toLowerCase()];
    let year = currentYear;
    if (monthNameMatch[3]) {
      year = parseInt(monthNameMatch[3], 10);
      if (year < 100) year += 2000;
    }
    if (month !== undefined && isValidCalendarDate(day, month)) {
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

  // Якщо дата не знайдена - повертаємо сьогодні (або дату з шапки повідомлення)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Витягує час з тексту
 * Формати: "18:00", "18:00-18:30", "о 18:30", "20-45", "в 8.40-8.50",
 * "16.00", "11-00", "19-30-20-00", "о 5 30", "18-20год", "8-9", "13 - 13:30"
 */
export function extractTime(text: string): string | null {
  const isValidTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;
  const fmt = (h: number | string, m: number | string) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const fmtRange = (h1: string | number, m1: string | number, h2: string | number, m2: string | number) =>
    `${fmt(h1, m1)}-${fmt(h2, m2)}`;

  // Нормалізуємо рідкісні символи (¹²⁰⁰ → 00) та ";" як роздільник часу
  const normalized = text
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => {
      const map: Record<string, string> = {
        '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
      };
      return map[ch] ?? ch;
    })
    .replace(/(\d{1,2});(\d{2})/g, '$1:$2');

  // "19-30-20-00" (дефіси замість двокрапок у діапазоні)
  const quadDash = normalized.match(/(\d{1,2})-(\d{2})-(\d{1,2})-(\d{2})/);
  if (quadDash) {
    const h1 = parseInt(quadDash[1], 10);
    const m1 = parseInt(quadDash[2], 10);
    const h2 = parseInt(quadDash[3], 10);
    const m2 = parseInt(quadDash[4], 10);
    if (isValidTime(h1, m1) && isValidTime(h2, m2)) {
      return fmtRange(h1, m1, h2, m2);
    }
  }

  // HH:MM-HH:MM повний діапазон
  const colonRange = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (colonRange) {
    return fmtRange(colonRange[1], colonRange[2], colonRange[3], colonRange[4]);
  }

  // "13 - 13:30" до одиночного HH:MM
  const mixedRange = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (mixedRange) {
    const h1 = parseInt(mixedRange[1], 10);
    const h2 = parseInt(mixedRange[2], 10);
    const m2 = parseInt(mixedRange[3], 10);
    if (isValidTime(h1, 0) && isValidTime(h2, m2)) {
      return fmtRange(h1, 0, h2, m2);
    }
  }

  // Один HH:MM
  const timeMatch = normalized.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return fmt(timeMatch[1], timeMatch[2]);
  }

  // "18-20год" / "18-21 год" — до bare dash-time (інакше 18-20 → 18:20)
  const hourRangeWithGod = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:год|години)(?!\d)/i);
  if (hourRangeWithGod) {
    const h1 = parseInt(hourRangeWithGod[1], 10);
    const h2 = parseInt(hourRangeWithGod[2], 10);
    if (isValidTime(h1, 0) && isValidTime(h2, 0)) {
      return fmtRange(h1, 0, h2, 0);
    }
  }

  // "о 5 30" / "в 5 30" (пробіл замість двокрапки)
  const spaceTime = normalized.match(/(?:в|о|виїзд)\s+(\d{1,2})\s+(\d{2})(?!\d)/i);
  if (spaceTime) {
    const h = parseInt(spaceTime[1], 10);
    const m = parseInt(spaceTime[2], 10);
    if (isValidTime(h, m)) return fmt(h, m);
  }

  // "в 8.40-8.50" / "о 7.15" / "6.30- 7.00"
  const dotRangePrefixed = normalized.match(
    /(?:в|о|виїзд)\s+(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/i
  );
  if (dotRangePrefixed) {
    const h1 = parseInt(dotRangePrefixed[1], 10);
    const m1 = parseInt(dotRangePrefixed[2], 10);
    const h2 = parseInt(dotRangePrefixed[3], 10);
    const m2 = parseInt(dotRangePrefixed[4], 10);
    if (isValidTime(h1, m1) && isValidTime(h2, m2)) {
      return fmtRange(h1, m1, h2, m2);
    }
  }
  const dotTimePrefixed = normalized.match(/(?:в|о|виїзд)\s*\.?(\d{1,2})\.(\d{2})(?=\s|$|,|\.|\)|г)/i);
  if (dotTimePrefixed) {
    const h = parseInt(dotTimePrefixed[1], 10);
    const m = parseInt(dotTimePrefixed[2], 10);
    if (isValidTime(h, m)) return fmt(h, m);
  }

  // Діапазон з крапкою без префікса: "5.10-5.20", "9.15 - 12.00"
  const genericDotRange = normalized.match(/(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/);
  if (genericDotRange) {
    const h1 = parseInt(genericDotRange[1], 10);
    const m1 = parseInt(genericDotRange[2], 10);
    const h2 = parseInt(genericDotRange[3], 10);
    const m2 = parseInt(genericDotRange[4], 10);
    if (isValidTime(h1, m1) && isValidTime(h2, m2)) {
      return fmtRange(h1, m1, h2, m2);
    }
  }

  // Один час з крапкою: "16.00", "18.30", "6.30" — не частина DD.MM.YY (07.2026)
  const clockMinutes = new Set([0, 15, 20, 30, 40, 45, 50]);
  const bareDotTimes = [...normalized.matchAll(/(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g)];
  for (const m of bareDotTimes) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!isValidTime(h, min)) continue;
    // Типові хвилини годинника, або >12 (не місяць)
    if (min === 0 || min > 12 || clockMinutes.has(min)) {
      return fmt(h, min);
    }
  }

  // "виїзд 20-45" / "на 9-00" / "о 17-30"
  const dashPrefixed = normalized.match(/(?:виїзд|о|в|на)\s+(\d{1,2})-(\d{2})(?!\d)/i);
  if (dashPrefixed) {
    const h = parseInt(dashPrefixed[1], 10);
    const m = parseInt(dashPrefixed[2], 10);
    if (isValidTime(h, m)) return fmt(h, m);
  }
  // "11-00", "08-30", "21-20" (не фрагмент ISO 2026-07-30 — перед числом не '-' і не цифра)
  const bareDashTime = normalized.match(/(?<![-\d])(\d{1,2})-(\d{2})(?!\d)(?!\s*год)/i);
  if (bareDashTime) {
    const h = parseInt(bareDashTime[1], 10);
    const m = parseInt(bareDashTime[2], 10);
    if (isValidTime(h, m) && (m === 0 || m > 12 || clockMinutes.has(m))) {
      return fmt(h, m);
    }
  }

  // "8-9" (лише години)
  const hourRangeBare = normalized.match(/(?:^|[\s,;])(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$|,|;)/m);
  if (hourRangeBare) {
    const h1 = parseInt(hourRangeBare[1], 10);
    const h2 = parseInt(hourRangeBare[2], 10);
    if (isValidTime(h1, 0) && isValidTime(h2, 0) && h1 < h2 && h2 - h1 <= 8) {
      return fmtRange(h1, 0, h2, 0);
    }
  }

  // "о 17-ій год" / "о 17 год"
  const verbalHour = normalized.match(/(?:о|в)\s+(\d{1,2})(?:-ій|-й|-а)?\s*год/i);
  if (verbalHour) {
    const h = parseInt(verbalHour[1], 10);
    if (isValidTime(h, 0)) return fmt(h, 0);
  }

  return null;
}

/**
 * Витягує кількість місць
 */
export function extractSeats(text: string): number | null {
  // "2 пасажира", "3 особи", "є місця", "4 місця", "2 місць"
  const seatsMatch = text.match(/(\d+)\s*(пасажир|особ|місц|людин)/i);
  if (seatsMatch) {
    return parseInt(seatsMatch[1], 10);
  }

  // Словесні: "два/двоє/три місця", "двоє позаду"
  const wordMap: { [key: string]: number } = {
    одне: 1, один: 1, одна: 1,
    два: 2, двоє: 2, двох: 2,
    три: 3, трьох: 3,
    чотири: 4,
  };
  const wordMatch = text.match(/(одне|один|одна|два|двоє|двох|три|трьох|чотири)\s*(?:вільн\w*\s+)?(?:місц|пасажир|позаду|людин)/i);
  if (wordMatch) {
    return wordMap[wordMatch[1].toLowerCase()] ?? null;
  }

  return null;
}

/**
 * Витягує ціну поїздки
 * Підтримує формати: "150 грн", "150грн.", "ціна 200 грн"
 */
export function extractPrice(text: string): number | null {
  const priceMatch = text.match(/(\d{2,4})\s*(?:грн|uah)/i);
  if (priceMatch) {
    const value = parseInt(priceMatch[1], 10);
    if (!Number.isNaN(value) && value > 0) {
      return value;
    }
  }

  return null;
}

const WEEKDAY_PREFIX =
  /^(понеділок|вівторок|середа|четвер|п['ʼ]?ятниц|субот|неділ|пн|вт|ср|чт|пт|сб|нд)/i;

/**
 * Витягує коментар до поїздки з тексту оголошення.
 * Патерни з живих правок: «є місця», орієнтири (м. Житомирська, вокзал, Цирк),
 * «позаду», «заберу по місту», дужкові прохання, «через Ірпінь» тощо.
 */
export function extractNotes(text: string): string | null {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    if (parts.some((p) => p.toLowerCase() === normalized.toLowerCase())) return;
    parts.push(normalized);
  };

  // 1. Наявність місць («є місця» / «є вільні місця» / «маю вільні місця»).
  // Не плутати з «є 3 місця» — це seats. \b / \w не працюють з кирилицею.
  const hasExactYeMitsya = /(?:^|[^\p{L}])є\s+місця(?=[^\p{L}]|$)/iu.test(text);
  const hasVilni =
    /(?:^|[^\p{L}])є\s+вільн\p{L}*\s+місц/iu.test(text) ||
    /(?:^|[^\p{L}])маю\s+(?:\d+\s+)?вільн\p{L}*\s+місц/iu.test(text);
  if (hasExactYeMitsya || hasVilni) {
    const upper =
      /(?:^|[^\p{L}])Є\s+(?:місця|вільн)/u.test(text) || /(?:^|[^\p{L}])Маю\s+вільн/u.test(text);
    push(upper ? 'Є місця' : 'є місця');
  }

  // 2. Розсадка «позаду» (\b не працює з кирилицею)
  const rear =
    text.match(/(?:^|[^\p{L}])((?:двоє|два|одне|один|[123])\s+позаду)(?=[^\p{L}]|$)/iu) ||
    text.match(/(?:^|[^\p{L}])(позаду\s+(?:двоє|два|одне|один|\d+))(?=[^\p{L}]|$)/iu);
  if (rear) {
    const r = rear[1].toLowerCase().replace(/\s+/g, ' ').trim();
    if (/^(?:двоє|два|2)\s+позаду$/.test(r) || /^позаду\s+(?:двоє|два|2)$/.test(r)) {
      push('Двоє позаду');
    } else if (/^(?:одне|один|1)\s+позаду$/.test(r) || /^позаду\s+(?:одне|один|1)$/.test(r)) {
      push('Одне позаду');
    } else {
      push(r.charAt(0).toUpperCase() + r.slice(1));
    }
  }

  // 3. Заберу по місту
  if (/заберу\s+по\s+місту/i.test(text)) {
    push('Заберу по місту');
  }

  // 4. від + орієнтир
  const fromMatch = text.match(
    /від\s+((?:південного\s+)?(?:залізничного\s+)?вокзалу|м\.?\s*[\p{L}'ʼ-]{2,30}|ст\.?\s*м\.?\s*[\p{L}'ʼ.\s-]{2,30}|[\p{L}][\p{L}'ʼ-]{2,40})/iu
  );
  if (fromMatch) {
    push(`від ${fromMatch[1].trim()}`);
  }

  // 5. біля + місце (кирилиця + латиниця)
  const nearMatch = text.match(/біля\s+([\p{L}A-Za-z][\p{L}A-Za-z'ʼ-]{1,40})/iu);
  if (nearMatch) {
    push(`біля ${nearMatch[1]}`);
  }

  // 6. до Цирку / до вокзалу / до метро …
  if (/(?:^|[^\p{L}])до\s+цирку(?=[^\p{L}]|$)/iu.test(text)) {
    push('до Цирку');
  } else {
    const toMatch = text.match(
      /(?:^|[^\p{L}])до\s+((?:південного\s+)?(?:залізничного\s+)?вокзалу|метро\s+[\p{L}.\s-]{2,25}|м\.?\s*[\p{L}'ʼ.-]{2,25})(?=[^\p{L}]|$)/iu
    );
    if (toMatch) {
      push(`до ${toMatch[1].trim()}`);
    }
  }

  // 7. м. Житомирська / мЖитомирська (+ «дзвоніть або пишіть»)
  if (/(?:ст\.?\s*)?м\.?\s*Житомирська|мЖитомирська/i.test(text)) {
    if (/дзвоніть|пишіть/i.test(text)) {
      push('м. Житомирська (дзвоніть або пишіть у Viber).');
    } else {
      push('м. Житомирська');
    }
  }

  // 8. Академмістечко як старт маршруту / у дужках біля Києва
  if (/академмістечко\s*[-–—]\s*малин|малин\s*[-–—]\s*академмістечко/i.test(text)) {
    push('Академмістечко');
  } else {
    const akadInKyiv = text.match(
      /ки[їєи][вї][а-я]*\s*\(\s*(Акад\.?|Академ\.?|Академмістечко)\s*\)/i
    );
    if (akadInKyiv) {
      const inner = akadInKyiv[1].trim();
      // «Акад» → «м Академмістечко»; інакше повна назва
      push(/^акад\.?$/i.test(inner) ? 'м Академмістечко' : 'Академмістечко');
    } else if (/\(\s*(Академ\.?|Академмістечко)\s*\)/i.test(text)) {
      push('Академмістечко');
    }
  }

  const districtParen = text.match(
    /\(\s*(Шулявка|Оболонь|Почайна|Чайки|Лук['ʼ]?янівська(?:\s*\/\s*Академ)?|(?:південн\p{L}*\s+)?(?:залізничн\p{L}*\s+)?вокзал)\s*\)/iu
  );
  if (districtParen) {
    const inner = districtParen[1].trim();
    if (/вокзал/i.test(inner)) {
      // GT: «До Південний залізничний вокзал» (без відмінювання)
      const title = inner.charAt(0).toUpperCase() + inner.slice(1);
      push(`До ${title}`);
    } else {
      push(inner);
    }
  }

  // Малин - Київ (південний залізничний вокзал)
  const stationInRoute = text.match(
    /(?:ки[їєи][вї][а-я]*|малин)\s*[–\-—(]\s*\(?\s*((?:південн\p{L}*\s+)?(?:залізничн\p{L}*\s+)?вокзал)\s*\)?/iu
  );
  if (stationInRoute && !parts.some((p) => /вокзал/i.test(p))) {
    const title = stationInRoute[1].trim();
    push(`До ${title.charAt(0).toUpperCase() + title.slice(1)}`);
  }

  // 9. через Ірпінь / *Ірпінь Малин*
  const via = text.match(/через\s+(Ірпінь|Бучу|Буча|Коростень|Житомир)/i);
  if (via) {
    push(`через ${via[1]}`);
  }
  if (
    (/\*ірпінь\s+малин\*/i.test(text) || /київ\s+\*?ірпінь(?=[^\p{L}]|$)/iu.test(text)) &&
    !parts.some((p) => /ірпінь/i.test(p))
  ) {
    push('Ірпінь -> Малин');
  }

  // 10. Вільний текст у дужках (прохання писати у вайбер…)
  for (const m of text.matchAll(/\(([^)]{8,120})\)/g)) {
    const inner = m[1].trim();
    if (/^\+?\d[\d\s()-]{7,}$/.test(inner)) continue;
    if (WEEKDAY_PREFIX.test(inner) && /\d/.test(inner)) continue;
    if (/^\d{1,2}[./]\d{1,2}/.test(inner)) continue;
    if (/позаду|вокзал|шулявк|оболонь|академ|лукъ?янів|почайн|чайки|житомирськ/i.test(inner)) {
      continue;
    }
    if (/дзвоніть|пишіть/i.test(inner) && parts.some((p) => /житомирськ/i.test(p))) continue;
    push(`(${inner})`);
  }

  if (parts.length === 0) return null;
  return parts.join('; ');
}

/**
 * Визначає маршрут
 */
export function extractRoute(text: string): string {
  const normalizedText = text.toLowerCase();

  // Структуровані bot-повідомлення: "[Бот] Kyiv-Malyn 2026-07-24 ..."
  const botRoute = normalizedText.match(
    /\b(kyiv-malyn|malyn-kyiv|malyn-zhytomyr|zhytomyr-malyn|malyn-korosten|korosten-malyn)\b/i
  );
  if (botRoute) {
    const map: Record<string, string> = {
      'kyiv-malyn': 'Kyiv-Malyn',
      'malyn-kyiv': 'Malyn-Kyiv',
      'malyn-zhytomyr': 'Malyn-Zhytomyr',
      'zhytomyr-malyn': 'Zhytomyr-Malyn',
      'malyn-korosten': 'Malyn-Korosten',
      'korosten-malyn': 'Korosten-Malyn',
    };
    return map[botRoute[1].toLowerCase()] || 'Unknown';
  }
  
  // Київ → Малин (враховуємо різні відмінки: Київ, Києва, Києві, Києвом, Києву)
  // "мЖитомирська" / "м Житомирська" / "м.Житомирська" — станція метро Житомирська в Києві
  if (/ки[їєи][вї][а-я]*.*малин|киев.*малин|академ.*малин|м\.?\s*житомирська.*малин/i.test(normalizedText)) {
    return 'Kyiv-Malyn';
  }
  
  // Малин → Київ (враховуємо різні відмінки)
  if (/малин.*ки[їєи][вї][а-я]*|малин.*киев|малин.*академ|малин.*м\.?\s*житомирська/i.test(normalizedText)) {
    return 'Malyn-Kyiv';
  }
  
  // Малин → Житомир (місто, не станція метро Житомирська)
  if (/малин.*житомир(?!ська)/i.test(normalizedText)) {
    return 'Malyn-Zhytomyr';
  }
  
  // Житомир → Малин (місто, не станція метро Житомирська)
  if (/житомир(?!ська).*малин/i.test(normalizedText)) {
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
  if (/\[?\s*бот-пасажир\s*\]?/i.test(text)) {
    return 'passenger';
  }
  if (/пасажир/i.test(text)) {
    return 'passenger';
  }
  // Неявний пасажир: "хтось їде", "можливо хтось їде", "шукаємо"
  if (/(?:хтось\s+їде|шукаю|шукаємо|потрібно\s+(?:місце|місц)|їде\s+хтось)/i.test(text)) {
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
 * Формати:
 *   [ 9 лютого 2026 р. 12:55 ]
 *   [ вівторок, 21 липня 2026 р. 07:22 ]
 *   [ 28 июля 2026 г. 10:01 ]
 */
export function extractMessageDate(text: string): Date | null {
  const monthNames = Object.keys(MONTHS_GENITIVE).join('|');
  // Опційний день тижня перед датою; "р." або "г."
  const dateMatch = text.match(
    new RegExp(
      `\\[\\s*(?:[\\p{L}]+\\s*,\\s*)?(\\d{1,2})\\s+(${monthNames})\\s+(\\d{4})\\s+[рг]\\.`,
      'iu'
    )
  );
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2].toLowerCase();
    const year = parseInt(dateMatch[3], 10);
    const month = MONTHS_GENITIVE[monthName];
    if (month !== undefined && isValidCalendarDate(day, month)) {
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
    const price = extractPrice(messageBody);
    const seats = extractSeats(messageBody);
    const notes = extractNotes(messageBody);

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
