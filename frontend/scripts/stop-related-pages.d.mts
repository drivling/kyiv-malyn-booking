/** Типи для scripts/stop-related-pages.mjs (плоский ESM, спільний із prerender-transport-stops.mjs). */
export type StopRelatedPage = { label: string; to: string };
export declare const STOP_RELATED_PAGES: Record<string, StopRelatedPage[]>;
export declare function relatedPagesForStop(stopId: string): StopRelatedPage[];
