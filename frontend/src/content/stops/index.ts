import type { StopArticle } from './types';

/**
 * Editorial stop articles. Each pilot file exports `article` and is imported here.
 * Lookup: getStopArticle(st_id)
 */
const STOP_ARTICLES: Record<string, StopArticle> = {
  // populated by side-effect imports below / explicit entries
};

export function getStopArticle(stopId: string | undefined | null): StopArticle | undefined {
  if (!stopId) return undefined;
  return STOP_ARTICLES[stopId];
}

export function listStopArticles(): StopArticle[] {
  return Object.values(STOP_ARTICLES).sort((a, b) => a.id.localeCompare(b.id));
}

/** Used by individual st_XXXX.ts modules */
export function registerStopArticle(article: StopArticle): StopArticle {
  STOP_ARTICLES[article.id] = article;
  return article;
}

export type { StopArticle } from './types';
