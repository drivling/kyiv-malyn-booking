/**
 * Метро Києва для «Доведе»: станція як місце («з Малина на Позняки», примітка водія «м. Лівобережна») і шлях
 * між станціями з пересадками. Київського транспорту в даних сайту немає — це лише підказка «скільки станцій»
 * і чесний приблизний час (2 хв на перегін, 5 хв на пересадку, 5 хв на вхід і вихід).
 */
import type { GazetteerPlace } from './gazetteer';
import { METRO_STATIONS, METRO_TRANSFERS, type MetroLine, type MetroStation } from './kyivMetroData';
import { tokenize, type Token } from './normalize';
import { wordMatchesName } from './stopPlaces';

export const METRO_HOP_MIN = 2;
export const METRO_TRANSFER_MIN = 5;
export const METRO_ACCESS_MIN = 5;

const BY_ID = new Map(METRO_STATIONS.map((st) => [st.id, st]));

export function metroStation(id: string): MetroStation | undefined {
  return BY_ID.get(id);
}

/** Станція як місце словника: «Київ · м. Позняки» */
export function metroPlace(id: string): GazetteerPlace | undefined {
  const st = BY_ID.get(id);
  return st ? { id: st.id, city: 'Kyiv', label: `м. ${st.name}`, stems: [] } : undefined;
}

/** Слово перед назвою, яке каже «це станція»: «метро», «м.», «ст.», «станція» */
const MARKERS = new Set(['метро', 'м', 'ст', 'станція', 'станції', 'станцію', 'станция', 'станции', 'станцию']);

interface NameVariant {
  station: MetroStation;
  words: string[];
}

/** Усі назви всіх станцій; довші — першими («Героїв Дніпра» раніше за «Дніпро») */
const VARIANTS: NameVariant[] = METRO_STATIONS.flatMap((station) => [station.name, ...station.said].map((n) => ({ station, words: tokenize(n).map((t) => t.n) }))).sort(
  (a, b) => b.words.length - a.words.length,
);

/** Коротке слово назви (до 4 літер) у назві з кількох слів теж відмінюється: «Палацу спорту» */
export function wordFits(word: string, token: string, multi: boolean): boolean {
  if (multi && word.length === 4) return token.startsWith(word.slice(0, 3)) && token.length <= 6;
  return wordMatchesName(word, token);
}

export interface MetroMatch {
  station: MetroStation;
  /** індекс останнього слова, що належить назві */
  end: number;
  /** перед назвою стояло «метро / м. / ст.» */
  marked: boolean;
}

/**
 * Станція, назва якої починається зі слова `i`. Назви з `strict` («Дніпро», «Університет», «Харківська»)
 * рахуються лише після слова «метро / м. / ст.»: без нього це місто, виш чи траса.
 */
export function matchMetro(toks: Token[], i: number): MetroMatch | null {
  const marked = i > 0 && MARKERS.has(toks[i - 1].n);
  let best: NameVariant | null = null;
  for (const v of VARIANTS) {
    if (best && v.words.length < best.words.length) break;
    if (!v.words.every((w, k) => toks[i + k] && wordFits(w, toks[i + k].n, v.words.length > 1))) continue;
    if (v.station.strict && !marked) continue;
    // серед назв однакової довжини — та, що сказана дослівно
    if (v.words.every((w, k) => toks[i + k].n === w)) return { station: v.station, end: i + v.words.length - 1, marked };
    best ??= v;
  }
  return best ? { station: best.station, end: i + best.words.length - 1, marked } : null;
}

/** Після назви-прикметника це вже не станція: «Харківська траса», «Чернігівська область» */
const NOT_STATION_NEXT = /^(трас|шосе|област|вулиц|напрям|дорог)/;

/**
 * Перша станція, названа в примітці водія; null — жодної. У примітці про дорогу до Києва «Харківська» чи «Лісова»
 * в називному відмінку — це станція й без слова «метро» (так пишуть водії); «по Харківській трасі» — ні.
 * «Дніпро» й «Університет» і тут лишаються станціями лише зі словом «метро».
 */
export function findMetroIn(text: string): MetroStation | null {
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const m = matchMetro(toks, i);
    if (m) return m.station;
    const bare = METRO_STATIONS.find((st) => st.strict && st.name.endsWith('а') && toks[i].n === st.name.toLowerCase());
    if (bare && bare.id !== 'kyiv.pas' && !(toks[i + 1] && NOT_STATION_NEXT.test(toks[i + 1].n))) return bare;
  }
  return null;
}

// ─── Шлях ─────────────────────────────────────────────────────────────────────────────────────

/** Відрізок однією лінією без пересадок */
export interface MetroSegment {
  line: MetroLine;
  from: MetroStation;
  to: MetroStation;
  /** кінцева, у бік якої їхати: так написано на табличках платформи */
  towards: MetroStation;
  /** скільки перегонів проїхати */
  hops: number;
  /** усі станції відрізка від посадки до виходу включно */
  stations: MetroStation[];
}

export interface MetroPath {
  /** скільки перегонів проїхати разом */
  hops: number;
  /** пересадки: з якої станції на яку */
  transfers: Array<{ from: MetroStation; to: MetroStation }>;
  segments: MetroSegment[];
  /** груба оцінка без розкладу: 2 хв на перегін, 5 на пересадку, 5 на вхід і вихід (точніше — `metroTrip`) */
  minutes: number;
}

const NEIGHBOURS = new Map<string, Array<{ id: string; ride: boolean }>>();
const link = (a: string, b: string, ride: boolean) => {
  NEIGHBOURS.set(a, [...(NEIGHBOURS.get(a) ?? []), { id: b, ride }]);
  NEIGHBOURS.set(b, [...(NEIGHBOURS.get(b) ?? []), { id: a, ride }]);
};
METRO_STATIONS.forEach((st, i) => {
  const next = METRO_STATIONS[i + 1];
  if (next && next.line === st.line) link(st.id, next.id, true);
});
METRO_TRANSFERS.forEach(([a, b]) => link(a, b, false));

const INDEX = new Map(METRO_STATIONS.map((st, i) => [st.id, i]));
/** перша й остання станція кожної лінії — у порядку файла даних */
const TERMINI = new Map<MetroLine, [MetroStation, MetroStation]>();
for (const st of METRO_STATIONS) {
  const cur = TERMINI.get(st.line);
  TERMINI.set(st.line, cur ? [cur[0], st] : [st, st]);
}

function segmentOf(ids: string[]): MetroSegment {
  const stations = ids.map((id) => BY_ID.get(id)!);
  const from = stations[0];
  const to = stations[stations.length - 1];
  const [first, last] = TERMINI.get(from.line)!;
  return { line: from.line, from, to, towards: INDEX.get(to.id)! > INDEX.get(from.id)! ? last : first, hops: stations.length - 1, stations };
}

/** Найшвидший шлях між двома станціями (52 вершини — простий перебір за часом) */
export function metroPath(fromId: string, toId: string): MetroPath | null {
  if (!BY_ID.has(fromId) || !BY_ID.has(toId) || fromId === toId) return null;
  const cost = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, { id: string; ride: boolean }>();
  const open = new Set([fromId]);
  while (open.size) {
    let cur = '';
    for (const id of open) if (!cur || cost.get(id)! < cost.get(cur)!) cur = id;
    open.delete(cur);
    if (cur === toId) break;
    for (const n of NEIGHBOURS.get(cur) ?? []) {
      const c = cost.get(cur)! + (n.ride ? METRO_HOP_MIN : METRO_TRANSFER_MIN);
      if (c < (cost.get(n.id) ?? Infinity)) {
        cost.set(n.id, c);
        prev.set(n.id, { id: cur, ride: n.ride });
        open.add(n.id);
      }
    }
  }
  if (!prev.has(toId)) return null;
  // шлях від кінця до початку, потім — відрізки між пересадками
  const chain: Array<{ id: string; rideIn: boolean }> = [];
  for (let at = toId; at !== fromId; ) {
    const p = prev.get(at)!;
    chain.unshift({ id: at, rideIn: p.ride });
    at = p.id;
  }
  const transfers: MetroPath['transfers'] = [];
  const segments: MetroSegment[] = [];
  let run = [fromId];
  for (const step of chain) {
    if (step.rideIn) {
      run.push(step.id);
      continue;
    }
    transfers.push({ from: BY_ID.get(run[run.length - 1])!, to: BY_ID.get(step.id)! });
    if (run.length > 1) segments.push(segmentOf(run));
    run = [step.id];
  }
  if (run.length > 1) segments.push(segmentOf(run));
  const hops = segments.reduce((n, sg) => n + sg.hops, 0);
  return { hops, transfers, segments, minutes: hops * METRO_HOP_MIN + transfers.length * METRO_TRANSFER_MIN + METRO_ACCESS_MIN };
}
