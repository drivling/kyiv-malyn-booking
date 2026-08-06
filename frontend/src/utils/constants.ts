import { Route, Direction } from '@/types';

/** Міста для бронювання (тільки маршрути через Малин) */
export type BookingCity = 'Kyiv' | 'Malyn' | 'Zhytomyr' | 'Korosten';

export const BOOKING_CITY_LABELS: Record<BookingCity, string> = {
  Kyiv: 'Київ',
  Malyn: 'Малин',
  Zhytomyr: 'Житомир',
  Korosten: 'Коростень',
};

/** Валідні пари «звідки → куди»: лише маршрути через Малин (немає Київ–Коростень тощо) */
export const BOOKING_FROM_TO: { from: BookingCity; to: BookingCity; direction: Direction }[] = [
  { from: 'Kyiv', to: 'Malyn', direction: 'Kyiv-Malyn' },
  { from: 'Malyn', to: 'Kyiv', direction: 'Malyn-Kyiv' },
  { from: 'Malyn', to: 'Zhytomyr', direction: 'Malyn-Zhytomyr' },
  { from: 'Zhytomyr', to: 'Malyn', direction: 'Zhytomyr-Malyn' },
  { from: 'Korosten', to: 'Malyn', direction: 'Korosten-Malyn' },
  { from: 'Malyn', to: 'Korosten', direction: 'Malyn-Korosten' },
];

/** За пари (from, to) повернути direction або null */
export function getDirectionFromCities(from: BookingCity, to: BookingCity): Direction | null {
  const pair = BOOKING_FROM_TO.find((p) => p.from === from && p.to === to);
  return pair ? pair.direction : null;
}

/** Популярні маршрути для швидких кнопок на сторінці бронювання */
export const BOOKING_POPULAR_ROUTES: { from: BookingCity; to: BookingCity; label: string }[] = [
  { from: 'Kyiv', to: 'Malyn', label: 'Київ → Малин' },
  { from: 'Malyn', to: 'Kyiv', label: 'Малин → Київ' },
  { from: 'Malyn', to: 'Zhytomyr', label: 'Малин → Житомир' },
  { from: 'Zhytomyr', to: 'Malyn', label: 'Житомир → Малин' },
  { from: 'Korosten', to: 'Malyn', label: 'Коростень → Малин' },
  { from: 'Malyn', to: 'Korosten', label: 'Малин → Коростень' },
];

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Нормалізація номера до цифр 380XXXXXXXXX */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '38' + cleaned;
  return cleaned;
}

/**
 * Розбирає поле з 1+ UA-номерами: через кому/пробіл або склеєні
 * (напр. 073…068… чи 38073…38068…).
 */
export function splitSupportPhones(phone: string | null | undefined): string[] {
  if (!phone?.trim()) return [];
  const raw = phone.trim();
  if (/[,;/|]/.test(raw)) {
    return raw
      .split(/[,;/|]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => splitSupportPhones(p));
  }

  const digits = raw.replace(/\D/g, '');
  const chunks: string[] = [];

  if (digits.length >= 24 && digits.startsWith('38') && digits.length % 12 === 0) {
    for (let i = 0; i < digits.length; i += 12) {
      const chunk = digits.slice(i, i + 12);
      if (chunk.startsWith('38') && chunk.length === 12) chunks.push(chunk);
    }
    if (chunks.length > 0) return chunks;
  }

  if (digits.length >= 20 && digits.startsWith('0') && digits.length % 10 === 0) {
    for (let i = 0; i < digits.length; i += 10) {
      chunks.push('38' + digits.slice(i, i + 10));
    }
    if (chunks.length > 0) return chunks;
  }

  // 380XXXXXXXXX0XXXXXXXXX (другий з провідним 0 після першої дюжини)
  if (digits.length >= 22 && digits.startsWith('38') && digits[12] === '0') {
    chunks.push(digits.slice(0, 12));
    chunks.push('38' + digits.slice(12, 22));
    return chunks;
  }

  let single = digits;
  if (single.startsWith('0')) single = '38' + single;
  if (single.length >= 10) return [single.startsWith('38') ? single : single];
  return [raw];
}

function formatOneUaPhoneDigits(normalized: string): string {
  if (normalized.length === 12 && normalized.startsWith('38')) {
    return `+380(${normalized.slice(3, 5)})${normalized.slice(5)}`;
  }
  if (normalized.length >= 10) return '+' + normalized;
  return normalized;
}

/** Формат номера для відображення; кілька номерів — через кому */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const parts = splitSupportPhones(phone);
  if (parts.length === 0) return phone.trim();
  return parts.map(formatOneUaPhoneDigits).join(', ');
}

/** З номера або @username отримати посилання для кнопки «Зателефонувати». */
export function listingContactHref(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const trimmed = phone.trim();
  if (trimmed.startsWith('@')) {
    const username = trimmed.replace(/^@/, '');
    return username ? `https://t.me/${username}` : '';
  }
  return supportPhoneToTelLink(phone);
}

export function isTelegramUsernameContact(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value.trim());
}

/** Текст контакту для відображення (@username або телефон). */
export function formatListingContactDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  if (isTelegramUsernameContact(phone)) return phone.trim();
  return formatPhoneDisplay(phone);
}

/** З номера отримати посилання tel: (перший номер, якщо їх кілька) */
export function supportPhoneToTelLink(phone: string | null | undefined): string {
  if (!phone) return '';
  const parts = splitSupportPhones(phone);
  const first = parts[0] ?? normalizePhone(phone);
  return 'tel:' + first;
}

export const ROUTES: Record<Route, string> = {
  'Kyiv-Malyn-Irpin': 'Київ → Малин (через Ірпінь)',
  'Malyn-Kyiv-Irpin': 'Малин → Київ (через Ірпінь)',
  'Kyiv-Malyn-Bucha': 'Київ → Малин (через Бучу)',
  'Malyn-Kyiv-Bucha': 'Малин → Київ (через Бучу)',
  'Malyn-Zhytomyr': 'Малин → Житомир',
  'Zhytomyr-Malyn': 'Житомир → Малин',
  'Korosten-Malyn': 'Коростень → Малин',
  'Malyn-Korosten': 'Малин → Коростень',
};

// Спрощені напрямки для UI бронювання
export const DIRECTIONS: Record<Direction, string> = {
  'Kyiv-Malyn': 'Київ → Малин',
  'Malyn-Kyiv': 'Малин → Київ',
  'Malyn-Zhytomyr': 'Малин → Житомир',
  'Zhytomyr-Malyn': 'Житомир → Малин',
  'Korosten-Malyn': 'Коростень → Малин',
  'Malyn-Korosten': 'Малин → Коростень',
};

// Маршрути для кожного напрямку
export const DIRECTION_ROUTES: Record<Direction, Route[]> = {
  'Kyiv-Malyn': ['Kyiv-Malyn-Irpin', 'Kyiv-Malyn-Bucha'],
  'Malyn-Kyiv': ['Malyn-Kyiv-Irpin', 'Malyn-Kyiv-Bucha'],
  'Malyn-Zhytomyr': ['Malyn-Zhytomyr'],
  'Zhytomyr-Malyn': ['Zhytomyr-Malyn'],
  'Korosten-Malyn': ['Korosten-Malyn'],
  'Malyn-Korosten': ['Malyn-Korosten'],
};

// Отримати суфікс маршруту (через Ірпінь/Бучу)
export const getRouteSuffix = (route: Route): string => {
  if (route.includes('Irpin')) return '(через Ірпінь)';
  if (route.includes('Bucha')) return '(через Бучу)';
  if (route.includes('Zhytomyr') || route.includes('Korosten')) return '';
  return '';
};

/** Назва напрямку без суфікса (через Ірпінь/Бучу). Підтримує і повний route, і direction (наприклад Kyiv-Malyn). */
export const getDirectionLabel = (route: string): string => {
  if (route.includes('Kyiv-Malyn')) return 'Київ → Малин';
  if (route.includes('Malyn-Kyiv')) return 'Малин → Київ';
  if (route.includes('Malyn-Zhytomyr')) return 'Малин → Житомир';
  if (route.includes('Zhytomyr-Malyn')) return 'Житомир → Малин';
  if (route.includes('Korosten-Malyn')) return 'Коростень → Малин';
  if (route.includes('Malyn-Korosten')) return 'Малин → Коростень';
  return route;
};

export const getRouteLabel = (route: Route | string): string => {
  return ROUTES[route as Route] || getDirectionLabel(route) || route;
};

/** Одна назва для адмінки: маршрутка — «Київ → Малин (через Ірпінь)», попутка — «Київ → Малин (🚗 Попутка)». */
export const getBookingRouteDisplayLabel = (
  route: string,
  source?: 'schedule' | 'viber_match'
): string => {
  if (source === 'viber_match') {
    return `${getDirectionLabel(route)} (🚗 Попутка)`;
  }
  return getRouteLabel(route);
};

export const getRouteBadgeClass = (route: Route | string): string => {
  if (route.includes('Kyiv-Malyn')) return 'badge-kyiv-malyn';
  if (route.includes('Malyn-Kyiv')) return 'badge-malyn-kyiv';
  if (route.includes('Malyn-Zhytomyr')) return 'badge-malyn-zhytomyr';
  if (route.includes('Zhytomyr-Malyn')) return 'badge-zhytomyr-malyn';
  if (route.includes('Korosten-Malyn')) return 'badge-korosten-malyn';
  if (route.includes('Malyn-Korosten')) return 'badge-malyn-korosten';
  return 'badge-kyiv-malyn';
};
