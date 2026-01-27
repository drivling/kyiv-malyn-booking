import { Route, Direction } from '@/types';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const ROUTES: Record<Route, string> = {
  'Kyiv-Malyn-Irpin': 'Київ → Малин (через Ірпінь)',
  'Malyn-Kyiv-Irpin': 'Малин → Київ (через Ірпінь)',
  'Kyiv-Malyn-Bucha': 'Київ → Малин (через Бучу)',
  'Malyn-Kyiv-Bucha': 'Малин → Київ (через Бучу)',
};

// Спрощені напрямки для UI бронювання
export const DIRECTIONS: Record<Direction, string> = {
  'Kyiv-Malyn': 'Київ → Малин',
  'Malyn-Kyiv': 'Малин → Київ',
};

// Маршрути для кожного напрямку
export const DIRECTION_ROUTES: Record<Direction, Route[]> = {
  'Kyiv-Malyn': ['Kyiv-Malyn-Irpin', 'Kyiv-Malyn-Bucha'],
  'Malyn-Kyiv': ['Malyn-Kyiv-Irpin', 'Malyn-Kyiv-Bucha'],
};

// Отримати суфікс маршруту (через Ірпінь/Бучу)
export const getRouteSuffix = (route: Route): string => {
  if (route.includes('Irpin')) return '(через Ірпінь)';
  if (route.includes('Bucha')) return '(через Бучу)';
  return '';
};

export const getRouteLabel = (route: Route): string => {
  return ROUTES[route] || route;
};

export const getRouteBadgeClass = (route: Route): string => {
  if (route.includes('Kyiv-Malyn')) {
    return 'badge-kyiv-malyn';
  } else if (route.includes('Malyn-Kyiv')) {
    return 'badge-malyn-kyiv';
  }
  return 'badge-kyiv-malyn';
};
