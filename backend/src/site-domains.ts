/**
 * Домени сервісу на стороні бекенда — щоб сповіщення вели на «свій» сайт.
 *
 * Оголошення з коростенських груп (Korosten_Kyiv тощо) не мають відправляти людину
 * на malin.kiev.ua: у повідомленні показуємо домен того міста, якого стосується поїздка.
 *
 * Дзеркало фронтового `frontend/scripts/site-hosts.mjs` — при зміні мапи правити обидва місця.
 */

export type SiteKey = 'malyn' | 'korosten' | 'zhytomyr';

export interface SiteDomainConfig {
  key: SiteKey;
  domain: string;
  /** TripPoint.code міста, якому належить домен */
  cityCode: string;
  cityNameUk: string;
  /** Назва платформи в шапці сповіщення */
  platformLabel: string;
  isPrimary: boolean;
  /** Домен підключено; неактивні міста лишаються на головному сайті */
  active: boolean;
}

export const SITES: Record<SiteKey, SiteDomainConfig> = {
  malyn: {
    key: 'malyn',
    domain: 'malin.kiev.ua',
    cityCode: 'Malyn',
    cityNameUk: 'Малин',
    platformLabel: 'Поїздки Київ, Житомир, Коростень ↔️ Малин',
    isPrimary: true,
    active: true,
  },
  korosten: {
    key: 'korosten',
    domain: 'korosten.kiev.ua',
    cityCode: 'Korosten',
    cityNameUk: 'Коростень',
    platformLabel: 'Поїздки Коростень ↔️ Київ, Житомир, Малин',
    isPrimary: false,
    active: true,
  },
  zhytomyr: {
    key: 'zhytomyr',
    domain: 'zhytomyr.kiev.ua',
    cityCode: 'Zhytomyr',
    cityNameUk: 'Житомир',
    platformLabel: 'Поїздки Житомир ↔️ Київ, Коростень, Малин',
    isPrimary: false,
    // Домен ще не підключено — Житомир поки живе на головному сайті
    active: false,
  },
};

export const PRIMARY_SITE = SITES.malyn;

/** Активні сайти, крім головного (перевіряються першими) */
function secondarySites(): SiteDomainConfig[] {
  return Object.values(SITES).filter((s) => s.active && !s.isPrimary);
}

/** Місто (TripPoint.code) → сайт. Міста без власного домену живуть на головному. */
export function siteForCityCode(cityCode: string | null | undefined): SiteDomainConfig {
  const code = (cityCode || '').trim().toLowerCase();
  if (!code) return PRIMARY_SITE;
  return secondarySites().find((s) => s.cityCode.toLowerCase() === code) ?? PRIMARY_SITE;
}

/**
 * Маршрут-слаг («Korosten-Kyiv», «Kyiv-Malyn-Irpin») → сайт поїздки.
 * Беремо перше місто маршруту, яке має власний домен; інакше головний сайт.
 */
export function siteForRoute(route: string | null | undefined): SiteDomainConfig {
  const parts = (route || '')
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const site = siteForCityCode(part);
    if (!site.isPrimary) return site;
  }
  return PRIMARY_SITE;
}

/** Абсолютне посилання на сайт поїздки: siteUrl(siteForRoute(route), '/mizhgorodski') */
export function siteUrl(site: SiteDomainConfig, path = ''): string {
  const suffix = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `https://${site.domain}${suffix}`;
}

/** Домен сайту поїздки без протоколу — для коротких SMS */
export function siteDomainForRoute(route: string | null | undefined): string {
  return siteForRoute(route).domain;
}

/** Повне посилання на сайт поїздки */
export function siteUrlForRoute(route: string | null | undefined, path = ''): string {
  return siteUrl(siteForRoute(route), path);
}
