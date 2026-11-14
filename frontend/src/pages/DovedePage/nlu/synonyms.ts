/**
 * Синоніми з адмінки (Docs/dovede-roadmap.md): «епіцентр» → місце словника. Власник додає їх на вкладці журналу,
 * сторінка читає з GET /dovede/synonyms і розбирає з ними питання одразу, без деплою. Список «поточний», як
 * зупинки міста (`places.ts`): сторінка викликає `setSynonyms`, розбір питає `matchSynonym`.
 */
import type { GazetteerPlace } from './gazetteer';
import { tokenize, type Token } from './normalize';
import { resolvePlace } from './places';
import { wordMatchesName } from './stopPlaces';

export interface Synonym {
  phrase: string;
  placeId: string;
}

interface Variant {
  placeId: string;
  words: string[];
}

let variants: Variant[] = [];

/** Довші фрази — першими: «нова пошта на бамі» сильніша за «нова пошта» */
export function setSynonyms(list: Synonym[]): void {
  variants = list
    .map((s) => ({ placeId: s.placeId, words: tokenize(s.phrase).map((t) => t.n) }))
    .filter((v) => v.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length || a.words.join(' ').localeCompare(b.words.join(' ')));
}

const NUMBER_RE = /^\d+$/;

/** Слово фрази проти слова питання; у фразі з кількох слів коротке слово теж відмінюється («нової пошти») */
function fits(word: string, token: string, multi: boolean): boolean {
  if (multi && word.length === 4 && !NUMBER_RE.test(word)) return token.startsWith(word.slice(0, 3)) && token.length <= 6;
  return wordMatchesName(word, token);
}

export interface SynonymMatch {
  place: GazetteerPlace;
  /** індекс останнього слова питання, що належить фразі */
  end: number;
}

/** Синонім, що починається зі слова `i` (усі слова фрази поспіль, у будь-якому відмінку); місце має існувати */
export function matchSynonym(toks: Token[], i: number): SynonymMatch | null {
  for (const v of variants) {
    if (!v.words.every((w, k) => toks[i + k] && fits(w, toks[i + k].n, v.words.length > 1))) continue;
    const place = resolvePlace(v.placeId);
    if (place) return { place, end: i + v.words.length - 1 };
  }
  return null;
}
