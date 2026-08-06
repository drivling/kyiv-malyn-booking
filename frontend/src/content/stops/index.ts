import type { StopArticle } from './types';
import { article as st_0019 } from './st_0019';
import { article as st_0072 } from './st_0072';
import { article as st_0062 } from './st_0062';
import { article as st_0056 } from './st_0056';
import { article as st_0054 } from './st_0054';
import { article as st_0089 } from './st_0089';
import { article as st_0070 } from './st_0070';
import { article as st_0063 } from './st_0063';
import { article as st_0060 } from './st_0060';
import { article as st_0034 } from './st_0034';
import { article as st_0033 } from './st_0033';
import { article as st_0080 } from './st_0080';
import { article as st_0023 } from './st_0023';
import { article as st_0020 } from './st_0020';

const STOP_ARTICLES: Record<string, StopArticle> = {
  [st_0019.id]: st_0019,
  [st_0072.id]: st_0072,
  [st_0062.id]: st_0062,
  [st_0056.id]: st_0056,
  [st_0054.id]: st_0054,
  [st_0089.id]: st_0089,
  [st_0070.id]: st_0070,
  [st_0063.id]: st_0063,
  [st_0060.id]: st_0060,
  [st_0034.id]: st_0034,
  [st_0033.id]: st_0033,
  [st_0080.id]: st_0080,
  [st_0023.id]: st_0023,
  [st_0020.id]: st_0020,
};

export function getStopArticle(stopId: string | undefined | null): StopArticle | undefined {
  if (!stopId) return undefined;
  return STOP_ARTICLES[stopId];
}

export function listStopArticles(): StopArticle[] {
  return Object.values(STOP_ARTICLES).sort((a, b) => a.id.localeCompare(b.id));
}

export type { StopArticle } from './types';
