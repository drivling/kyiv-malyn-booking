"use strict";
/**
 * Домени сервісу на стороні бекенда — щоб сповіщення вели на «свій» сайт.
 *
 * Оголошення з коростенських груп (Korosten_Kyiv тощо) не мають відправляти людину
 * на malin.kiev.ua: у повідомленні показуємо домен того міста, якого стосується поїздка.
 *
 * Дзеркало фронтового `frontend/scripts/site-hosts.mjs` — при зміні мапи правити обидва місця.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIMARY_SITE = exports.SITES = void 0;
exports.siteForCityCode = siteForCityCode;
exports.siteForRoute = siteForRoute;
exports.siteUrl = siteUrl;
exports.siteDomainForRoute = siteDomainForRoute;
exports.siteUrlForRoute = siteUrlForRoute;
exports.SITES = {
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
exports.PRIMARY_SITE = exports.SITES.malyn;
/** Активні сайти, крім головного (перевіряються першими) */
function secondarySites() {
    return Object.values(exports.SITES).filter((s) => s.active && !s.isPrimary);
}
/** Місто (TripPoint.code) → сайт. Міста без власного домену живуть на головному. */
function siteForCityCode(cityCode) {
    const code = (cityCode || '').trim().toLowerCase();
    if (!code)
        return exports.PRIMARY_SITE;
    return secondarySites().find((s) => s.cityCode.toLowerCase() === code) ?? exports.PRIMARY_SITE;
}
/**
 * Маршрут-слаг («Korosten-Kyiv», «Kyiv-Malyn-Irpin») → сайт поїздки.
 * Беремо перше місто маршруту, яке має власний домен; інакше головний сайт.
 */
function siteForRoute(route) {
    const parts = (route || '')
        .split('-')
        .map((p) => p.trim())
        .filter(Boolean);
    for (const part of parts) {
        const site = siteForCityCode(part);
        if (!site.isPrimary)
            return site;
    }
    return exports.PRIMARY_SITE;
}
/** Абсолютне посилання на сайт поїздки: siteUrl(siteForRoute(route), '/mizhgorodski') */
function siteUrl(site, path = '') {
    const suffix = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
    return `https://${site.domain}${suffix}`;
}
/** Домен сайту поїздки без протоколу — для коротких SMS */
function siteDomainForRoute(route) {
    return siteForRoute(route).domain;
}
/** Повне посилання на сайт поїздки */
function siteUrlForRoute(route, path = '') {
    return siteUrl(siteForRoute(route), path);
}
