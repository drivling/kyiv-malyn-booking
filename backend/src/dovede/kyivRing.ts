/**
 * Міська електричка Києва (Kyiv City Express) для «Доведе»: станція кільця як місце («з Малина на Караваєві Дачі»,
 * «вокзал Дарниця»). Станції біля метро лишаються місцями метро — їх розбирає `kyivMetro.ts`; тут лише ті, де
 * метро немає. Розклад і пошук рейсу — `data/kyivRing.ts`.
 */
import type { GazetteerPlace } from './gazetteer';
import { wordFits } from './kyivMetro';
import { RING_STATIONS, type RingStation } from './kyivRingData';
import { tokenize, type Token } from './normalize';

const BY_ID = new Map(RING_STATIONS.map((st) => [st.id, st]));
const BY_METRO = new Map(RING_STATIONS.filter((st) => st.metro).map((st) => [st.metro!, st]));

export function ringStation(id: string): RingStation | undefined {
  return BY_ID.get(id);
}

/** Станція кільця для точки Києва: вона сама або та, що біля цієї станції метро */
export function ringStationOf(pointId: string): RingStation | undefined {
  return BY_ID.get(pointId) ?? BY_METRO.get(pointId);
}

/** Станція як місце словника: «Київ · ст. Куренівка» */
export function ringPlace(id: string): GazetteerPlace | undefined {
  const st = BY_ID.get(id);
  return st ? { id: st.id, city: 'Kyiv', label: `ст. ${st.name}`, stems: [] } : undefined;
}

interface NameVariant {
  station: RingStation;
  words: string[];
}

/** Назви станцій без метро; довші — першими. Сама назва `strict`-станції не рахується — лише її форми з `said` */
const VARIANTS: NameVariant[] = RING_STATIONS.filter((st) => !st.metro)
  .flatMap((station) => [...(station.strict ? [] : [station.name]), ...station.said].map((n) => ({ station, words: tokenize(n).map((t) => t.n) })))
  .sort((a, b) => b.words.length - a.words.length);

export interface RingMatch {
  station: RingStation;
  /** індекс останнього слова, що належить назві */
  end: number;
  /** для спільного коду з метро: слова-позначки («метро») перед назвою тут не буває */
  marked: false;
}

/** Станція кільця, назва якої починається зі слова `i` («Київ-Волинський» — два слова: дефіс ділить) */
export function matchRing(toks: Token[], i: number): RingMatch | null {
  let best: NameVariant | null = null;
  for (const v of VARIANTS) {
    if (best && v.words.length < best.words.length) break;
    if (!v.words.every((w, k) => toks[i + k] && wordFits(w, toks[i + k].n, v.words.length > 1))) continue;
    if (v.words.every((w, k) => toks[i + k].n === w)) return { station: v.station, end: i + v.words.length - 1, marked: false };
    best ??= v;
  }
  return best ? { station: best.station, end: i + best.words.length - 1, marked: false } : null;
}
