/**
 * Доменна конфігурація фронтенду: два публічні домени на одному Railway-сервісі.
 *
 * malin.kiev.ua   — головний сайт (адмінка, Telegram-логін, індексація)
 * korosten.kiev.ua — сайт Коростеня (рідне місто пінниться доменом, noindex)
 *
 * Мапа доменів живе в scripts/site-hosts.mjs, бо її ж читає Node-хост (serve-dist.mjs).
 */
import {
  SITES as SITE_MAP,
  ACTIVE_SITES as ACTIVE,
  ACTIVE_SITE_DOMAINS as ACTIVE_DOMAINS,
  PRIMARY_SITE as PRIMARY,
  isPrimaryOnlyPath as isPrimaryOnlyPathRaw,
  primaryUrl as primaryUrlRaw,
  resolveSiteKey as resolveSiteKeyRaw,
} from '../../scripts/site-hosts.mjs';

export type SiteKey = 'malyn' | 'korosten' | 'zhytomyr';

export interface SiteConfig {
  key: SiteKey;
  /** Домен без протоколу: malin.kiev.ua */
  domain: string;
  /** TripPoint.code рідного міста цього домену */
  cityCode: string;
  cityNameUk: string;
  /** Родовий відмінок: «Транспорт Малина» */
  cityNameUkGenitive: string;
  isPrimary: boolean;
  /** Домен підключено і він обслуговує трафік (неактивні міста живуть на головному сайті) */
  active: boolean;
}

export const SITES: Record<SiteKey, SiteConfig> = SITE_MAP as Record<SiteKey, SiteConfig>;
export const PRIMARY_SITE: SiteConfig = PRIMARY as SiteConfig;
/** Сайти з підключеним доменом (Житомир поки неактивний — чекає на власний домен) */
export const ACTIVE_SITES: SiteConfig[] = ACTIVE as SiteConfig[];
/** Домени сервісу — для юридичних текстів («політика діє для доменів …») */
export const SITE_DOMAINS: string[] = ACTIVE_DOMAINS;

/** Параметр, яким рідне місто переїжджає між доменами (куки не ходять між доменами) */
export const CITY_HANDOFF_PARAM = 'city';
/** Дебаг-override для локальної розробки: ?site=korosten */
const SITE_OVERRIDE_PARAM = 'site';

export function resolveSite(hostname: string): SiteConfig {
  return SITES[resolveSiteKeyRaw(hostname) as SiteKey];
}

/** Сайт поточного вікна (SSR/тести без window → головний) */
export function getCurrentSite(): SiteConfig {
  if (typeof window === 'undefined') return PRIMARY_SITE;
  const override = new URLSearchParams(window.location.search).get(SITE_OVERRIDE_PARAM) as SiteKey | null;
  if (override && SITES[override]) return SITES[override];
  return resolveSite(window.location.hostname);
}

/** Місто → його домен. Власний домен поки лише в Коростеня, решта міст живе на головному сайті. */
export function siteForCityCode(cityCode: string): SiteConfig {
  const code = (cityCode || '').trim();
  if (!code) return PRIMARY_SITE;
  return ACTIVE_SITES.find((s) => !s.isPrimary && s.cityCode === code) ?? PRIMARY_SITE;
}

export function siteOrigin(site: SiteConfig): string {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('localhost')) {
    // Локальна розробка: <місто>.localhost:5173 ↔ localhost:5173
    const host = site.isPrimary ? 'localhost' : `${site.domain.split('.')[0]}.localhost`;
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${host}${port}`;
  }
  return `https://${site.domain}`;
}

/**
 * Куди йти після зміни рідного міста.
 * @returns null — місто лишається на поточному домені; інакше абсолютний URL з тим самим шляхом і query.
 */
export function buildCitySwitchUrl(
  current: SiteConfig,
  cityCode: string,
  pathname: string,
  search: string,
): string | null {
  const target = siteForCityCode(cityCode);
  if (target.key === current.key) return null;
  const params = new URLSearchParams(search || '');
  params.delete(SITE_OVERRIDE_PARAM);
  params.set(CITY_HANDOFF_PARAM, cityCode);
  const path = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return `${siteOrigin(target)}${path}?${params.toString()}`;
}

/** Сторінки, які існують тільки на головному домені (адмінка, логін, кабінет) */
export function isPrimaryOnlyPath(pathname: string): boolean {
  return Boolean(isPrimaryOnlyPathRaw(pathname));
}

/**
 * Той самий шлях на головному домені. Локально (localhost) веде на localhost,
 * щоб перевірка редиректів не викидала розробника на прод.
 */
export function primaryUrl(pathname: string, search = ''): string {
  if (typeof window === 'undefined') return String(primaryUrlRaw(pathname, search));
  const path = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return `${siteOrigin(PRIMARY_SITE)}${path}${search || ''}`;
}
