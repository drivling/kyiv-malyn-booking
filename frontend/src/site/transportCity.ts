/**
 * Місто міського транспорту для поточного сайту (Docs/korosten-transport-2026-11.md, фаза 5;
 * бекенд — Docs/transport-tenancy-2026-11.md). Без параметра бекенд віддає Малин, тому для Малина
 * адреси запитів лишаються такими, як були; інше місто йде з ?city=<TripPoint.code>.
 */
import { getCurrentSite } from './siteConfig';

export const DEFAULT_TRANSPORT_CITY = 'Malyn';

/** Місто, чий транспорт показує цей сайт: malin.kiev.ua → Malyn, korosten.kiev.ua → Korosten */
export function siteTransportCity(): string {
  return getCurrentSite().cityCode || DEFAULT_TRANSPORT_CITY;
}

export const isDefaultTransportCity = (city: string | null | undefined): boolean => !city || city === DEFAULT_TRANSPORT_CITY;

/** '' для Малина, '?city=Korosten' (або '&city=…', коли в адресі вже є запит) для іншого міста */
export function cityQuery(city: string | null | undefined, separator: '?' | '&' = '?'): string {
  return isDefaultTransportCity(city) ? '' : `${separator}city=${encodeURIComponent(city as string)}`;
}

/** Поле city для тіла POST: нічого для Малина */
export function cityField(city: string | null | undefined): { city?: string } {
  return isDefaultTransportCity(city) ? {} : { city: city as string };
}

export interface TransportProfile {
  cityCode: string;
  /** Центр карти, поки датасет не дав свого (meta.center) */
  center: [number, number] | null;
  /** Є намальована схема маршрутів (сторінка /transport/scheme, кольори ліній з її легенди) */
  hasScheme: boolean;
  /** Є статті зупинок у src/content/stops */
  hasStopArticles: boolean;
  /** Старі народні назви зупинок, які пошук має знати завжди */
  legacyStopNames: readonly string[];
}

const MALYN_PROFILE: TransportProfile = {
  cityCode: DEFAULT_TRANSPORT_CITY,
  center: [50.768, 29.242],
  hasScheme: true,
  hasStopArticles: true,
  legacyStopNames: ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'],
};

/** Що в транспорті прив'язане до конкретного міста. Тексти й SEO міста — окрема фаза. */
export function transportProfile(city: string = siteTransportCity()): TransportProfile {
  if (isDefaultTransportCity(city)) return MALYN_PROFILE;
  return { cityCode: city, center: null, hasScheme: false, hasStopArticles: false, legacyStopNames: [] };
}
