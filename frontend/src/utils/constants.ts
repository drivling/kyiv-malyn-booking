import { Route } from '@/types';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const ROUTES: Record<Route, string> = {
  'Kyiv-Malyn-Irpin': 'Київ → Малин (через Ірпінь)',
  'Malyn-Kyiv-Irpin': 'Малин → Київ (через Ірпінь)',
  'Kyiv-Malyn-Bucha': 'Київ → Малин (через Бучу)',
  'Malyn-Kyiv-Bucha': 'Малин → Київ (через Бучу)',
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
