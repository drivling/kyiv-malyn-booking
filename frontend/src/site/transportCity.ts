/**
 * Місто міського транспорту для поточного сайту (Docs/korosten-transport-2026-11.md, фаза 5;
 * бекенд — Docs/transport-tenancy-2026-11.md). Без параметра бекенд віддає Малин, тому для Малина
 * адреси запитів лишаються такими, як були; інше місто йде з ?city=<TripPoint.code>.
 */
import { isPrerendering } from '@/utils/prerender';
import { SITES, getCurrentSite } from './siteConfig';

export const DEFAULT_TRANSPORT_CITY = 'Malyn';

/**
 * Параметр міста транспорту: в адмінці — яке місто редагуємо (/admin/route-schedule?transportCity=Korosten),
 * на /transport — перегляд сторінок міста адміном до запуску. Не `city`: той з'їдає перемикання рідного міста.
 */
export const TRANSPORT_CITY_PARAM = 'transportCity';
const PREVIEW_STORAGE_KEY = 'transport-preview-city';
/** Той самий ключ, під яким apiClient тримає адмін-токен */
const ADMIN_TOKEN_KEY = 'adminToken';

/** Код міста з активного сайту (без урахування регістру) → TripPoint.code; null — такого міста нема */
export function canonicalTransportCity(raw: string | null | undefined): string | null {
  const wanted = (raw ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const site = Object.values(SITES).find((s) => s.active && s.cityCode.toLowerCase() === wanted);
  return site ? site.cityCode : null;
}

/** Міста, між якими перемикається адмінка: активні сайти, головний першим */
export function transportCityOptions(): Array<{ cityCode: string; name: string }> {
  return Object.values(SITES)
    .filter((s) => s.active)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((s) => ({ cityCode: s.cityCode, name: s.cityNameUk }));
}

function hasAdminToken(): boolean {
  try {
    return Boolean(localStorage.getItem(ADMIN_TOKEN_KEY));
  } catch {
    return false;
  }
}

function storedPreview(): string | null {
  try {
    return sessionStorage.getItem(PREVIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Місто, чиї сторінки транспорту адмін переглядає до запуску (null — перегляду нема). Береться з
 * ?transportCity= в адресі, далі тримається в sessionStorage цієї вкладки, тож переходи всередині
 * /transport* його не гублять. Без адмін-токена в браузері й під пререндером — завжди null: відвідувачу
 * параметр нічого не змінює, а бекенд і так віддає неопубліковане місто лише з токеном.
 */
export function transportPreviewCity(): string | null {
  if (typeof window === 'undefined' || isPrerendering() || !hasAdminToken()) return null;
  const fromUrl = new URLSearchParams(window.location.search).get(TRANSPORT_CITY_PARAM);
  const city = canonicalTransportCity(fromUrl ?? storedPreview());
  if (!city || city === getCurrentSite().cityCode) return null;
  return city;
}

/** Запам'ятати місто перегляду з адреси для цієї вкладки (або забути, коли в адресі місто сайту) */
export function rememberTransportPreview(): void {
  if (typeof window === 'undefined') return;
  const fromUrl = new URLSearchParams(window.location.search).get(TRANSPORT_CITY_PARAM);
  if (fromUrl === null) return;
  try {
    const city = transportPreviewCity();
    if (city) sessionStorage.setItem(PREVIEW_STORAGE_KEY, city);
    else sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    /* без sessionStorage перегляд живе, поки параметр в адресі */
  }
}

export function exitTransportPreview(): void {
  try {
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    /* нічого */
  }
}

/**
 * Місто, чий транспорт показує цей сайт: malin.kiev.ua → Malyn, korosten.kiev.ua → Korosten;
 * в адміна в режимі перегляду — місто перегляду.
 */
export function siteTransportCity(): string {
  return transportPreviewCity() ?? (getCurrentSite().cityCode || DEFAULT_TRANSPORT_CITY);
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

/** Центри міст без власного профілю — для порожньої карти, поки в датасеті нема meta.center */
const CITY_CENTERS: Record<string, [number, number]> = {
  Korosten: [50.9506, 28.6384],
};

/** Що в транспорті прив'язане до конкретного міста. Тексти й SEO міста — окрема фаза. */
export function transportProfile(city: string = siteTransportCity()): TransportProfile {
  if (isDefaultTransportCity(city)) return MALYN_PROFILE;
  return { cityCode: city, center: CITY_CENTERS[city] ?? null, hasScheme: false, hasStopArticles: false, legacyStopNames: [] };
}
