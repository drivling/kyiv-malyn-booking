import { Route, Direction } from '@/types';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

export const getRouteLabel = (route: Route): string => {
  return ROUTES[route] || route;
};

export const getRouteBadgeClass = (route: Route): string => {
  if (route.includes('Kyiv-Malyn')) return 'badge-kyiv-malyn';
  if (route.includes('Malyn-Kyiv')) return 'badge-malyn-kyiv';
  if (route.includes('Malyn-Zhytomyr')) return 'badge-malyn-zhytomyr';
  if (route.includes('Zhytomyr-Malyn')) return 'badge-zhytomyr-malyn';
  if (route.includes('Korosten-Malyn')) return 'badge-korosten-malyn';
  if (route.includes('Malyn-Korosten')) return 'badge-malyn-korosten';
  return 'badge-kyiv-malyn';
};
