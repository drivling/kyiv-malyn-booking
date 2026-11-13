/** Типи для scripts/stop-page-copy.mjs (плоский ESM, спільний із prerender-transport-stops.mjs). */
export type StopFaqItem = { q: string; a: string };
export type StopArticleLike = { name: string; place?: string; lead?: string; routeIds?: string[] };
/** Місто сторінки: родовий і місцевий відмінки назви, домен */
export type StopCopyCity = { genitive: string; locative: string; domain: string };
export declare const MALYN_COPY_CITY: StopCopyCity;
export declare function stopPageTitle(name: string, city?: StopCopyCity): string;
export declare function stopArticleDescription(article: StopArticleLike): string;
export declare function stopFallbackDescription(name: string, routeIds: string[], city?: StopCopyCity): string;
export declare function stopHubFaq(city?: StopCopyCity): StopFaqItem[];
export declare const STOP_HUB_FAQ: StopFaqItem[];
export declare function stopRoutesFaq(name: string, routeIds: string[], stopId: string, city?: StopCopyCity): StopFaqItem;
