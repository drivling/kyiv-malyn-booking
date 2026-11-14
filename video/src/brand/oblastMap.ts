import { WIDTH } from './tokens';

/**
 * Схематична мапа Житомирщини для сцени G: справжні координати міст, лінійна проєкція у прямокутник кадру
 * (без контуру області). Ту саму точку Малина бере G1 — схема Малина стискається саме туди.
 */
const LON0 = 27.4;
const LON1 = 30.7;
const LAT0 = 49.8;
const LAT1 = 51.45;
const LEFT = 90;
const MAP_W = WIDTH - 180;
const TOP = 560;
/** Висота з урахуванням того, що градус довготи на цій широті коротший за градус широти */
const MAP_H = (MAP_W * (LAT1 - LAT0)) / ((LON1 - LON0) * Math.cos((50.6 * Math.PI) / 180));

export const project = (lat: number, lon: number) => ({
  x: LEFT + ((lon - LON0) / (LON1 - LON0)) * MAP_W,
  y: TOP + ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_H,
});

export type Town = { name: string; lat: number; lon: number; tier: 'here' | 'next' | 'later' };

export const TOWNS: Town[] = [
  { name: 'Малин', lat: 50.77, lon: 29.24, tier: 'here' },
  { name: 'Коростень', lat: 50.95, lon: 28.64, tier: 'next' },
  { name: 'Житомир', lat: 50.25, lon: 28.66, tier: 'later' },
  { name: 'Овруч', lat: 51.32, lon: 28.81, tier: 'later' },
  { name: 'Радомишль', lat: 50.5, lon: 29.23, tier: 'later' },
  { name: 'Коростишів', lat: 50.32, lon: 29.06, tier: 'later' },
  { name: 'Звягель', lat: 50.59, lon: 27.62, tier: 'later' },
  { name: 'Олевськ', lat: 51.21, lon: 27.65, tier: 'later' },
  { name: 'Бердичів', lat: 49.9, lon: 28.6, tier: 'later' },
  { name: 'Баранівка', lat: 50.3, lon: 27.67, tier: 'later' },
  { name: 'Чуднів', lat: 50.05, lon: 28.11, tier: 'later' },
  { name: 'Андрушівка', lat: 50.02, lon: 29.02, tier: 'later' },
];

export const KYIV = { name: 'Київ', lat: 50.45, lon: 30.52 };
export const MALYN_POINT = project(50.77, 29.24);
