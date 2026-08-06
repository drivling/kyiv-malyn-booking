import type { StopArticle } from './types';
import { article as st_0019 } from './st_0019';

const STOP_ARTICLES: Record<string, StopArticle> = {
  [st_0019.id]: st_0019,
};

export function getStopArticle(stopId: string | undefined | null): StopArticle | undefined {
  if (!stopId) return undefined;
  return STOP_ARTICLES[stopId];
}

export function listStopArticles(): StopArticle[] {
  return Object.values(STOP_ARTICLES).sort((a, b) => a.id.localeCompare(b.id));
}

export type { StopArticle } from './types';
