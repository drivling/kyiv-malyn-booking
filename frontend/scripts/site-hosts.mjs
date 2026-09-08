/**
 * Мапа «домен → сайт» — єдине джерело правди про два публічні домени сервісу.
 *
 * Файл навмисно plain-ESM без залежностей: його імпортують і Node-хост
 * (scripts/serve-dist.mjs), і фронтенд (src/site/siteConfig.ts).
 */

/** @typedef {'malyn' | 'korosten'} SiteKey */

export const SITES = {
  malyn: {
    key: 'malyn',
    domain: 'malin.kiev.ua',
    cityCode: 'Malyn',
    cityNameUk: 'Малин',
    /** Родовий відмінок для заголовків: «Транспорт Малина» */
    cityNameUkGenitive: 'Малина',
    /** Головний сайт: адмінка, Telegram-логін, індексація в пошуку */
    isPrimary: true,
  },
  korosten: {
    key: 'korosten',
    domain: 'korosten.kiev.ua',
    cityCode: 'Korosten',
    cityNameUk: 'Коростень',
    cityNameUkGenitive: 'Коростеня',
    isPrimary: false,
  },
};

export const PRIMARY_SITE = SITES.malyn;
export const PRIMARY_ORIGIN = `https://${PRIMARY_SITE.domain}`;

/** Шляхи, які живуть тільки на головному домені (віджет Telegram Login прив'язаний до одного домену бота) */
export const PRIMARY_ONLY_PATHS = ['/admin', '/login', '/user'];

/** Host-заголовок або hostname → нормалізований хост без порту, www і крапки в кінці */
export function normalizeHost(host) {
  if (!host) return '';
  let value = String(host).trim().toLowerCase();
  // IPv6 у Host: [::1]:4173
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    value = close > 0 ? value.slice(1, close) : value;
  } else {
    const colon = value.indexOf(':');
    if (colon >= 0) value = value.slice(0, colon);
  }
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (value.startsWith('www.')) value = value.slice(4);
  return value;
}

/**
 * @param {string} host hostname або Host-заголовок
 * @returns {SiteKey} усе, крім коростенського домену (вкл. localhost і Railway preview), — головний сайт
 */
export function resolveSiteKey(host) {
  const value = normalizeHost(host);
  if (!value) return PRIMARY_SITE.key;
  if (value === 'korosten' || value === SITES.korosten.domain) return SITES.korosten.key;
  // korosten.localhost, korosten.kiev.ua, будь-який korosten.* для локальної розробки
  if (value.startsWith('korosten.')) return SITES.korosten.key;
  return PRIMARY_SITE.key;
}

/** @returns {typeof SITES.malyn} */
export function resolveSite(host) {
  return SITES[resolveSiteKey(host)];
}

/** Чи веде цей шлях на сторінку, яка існує тільки на головному домені */
export function isPrimaryOnlyPath(pathname) {
  if (!pathname) return false;
  const clean = pathname.split('?')[0].split('#')[0];
  return PRIMARY_ONLY_PATHS.some((p) => clean === p || clean.startsWith(`${p}/`));
}

/** Абсолютний URL тієї ж сторінки на головному домені */
export function primaryUrl(pathname, search = '') {
  const path = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return `${PRIMARY_ORIGIN}${path}${search || ''}`;
}
