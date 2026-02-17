import { Route, Direction } from '@/types';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Нормалізація номера до цифр 380XXXXXXXXX */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '38' + cleaned;
  return cleaned;
}

/** Формат номера для відображення: +380(67)4476844 (38 + 0 + XX оператор + 7 цифр) */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const normalized = normalizePhone(phone.trim());
  if (normalized.length === 12 && normalized.startsWith('38')) {
    return `+380(${normalized.slice(3, 5)})${normalized.slice(5)}`;
  }
  if (normalized.length >= 10) return '+' + normalized;
  return phone.trim();
}

/** З номера отримати посилання tel: (тільки цифри) */
export function supportPhoneToTelLink(phone: string | null | undefined): string {
  if (!phone) return '';
  return 'tel:' + normalizePhone(phone);
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
