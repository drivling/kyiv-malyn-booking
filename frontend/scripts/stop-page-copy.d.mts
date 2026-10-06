/** Типи для scripts/stop-page-copy.mjs (плоский ESM, спільний із prerender-transport-stops.mjs). */
export type StopFaqItem = { q: string; a: string };
export type StopArticleLike = { name: string; place?: string; lead?: string; routeIds?: string[] };
export declare function stopPageTitle(name: string): string;
export declare function stopArticleDescription(article: StopArticleLike): string;
export declare function stopFallbackDescription(name: string, routeIds: string[]): string;
export declare const STOP_HUB_FAQ: StopFaqItem[];
export declare function stopRoutesFaq(name: string, routeIds: string[], stopId: string): StopFaqItem;
