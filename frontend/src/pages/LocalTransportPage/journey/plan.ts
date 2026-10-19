/**
 * Пошук поїздок на цілий день (профільний запит, як rRAPTOR у MOTIS): RAPTOR запускається для кожного
 * можливого відправлення, результати зводяться до Парето-множини за (відправлення ↑, прибуття ↓, пересадки ↓).
 * У мережі з ~250 рейсів це одиниці мілісекунд, тому «відправлення о…» і «прибуття о…» — просто різні зрізи
 * одного й того самого списку, без окремого зворотного пошуку.
 */
import { haversineDistance } from '../geo';
import { searchAtDeparture, type Offset } from './raptor';
import { walkMetersForDistance, walkMinutesForDistance } from './timetable';
import type {
  DayPlan,
  DirectWalk,
  Endpoint,
  Journey,
  LegAlternative,
  Place,
  Timetable,
  TransitLeg,
  TimetableStop,
} from './types';

function stopPos(s: TimetableStop): { lat: number; lng: number } | null {
  return typeof s.lat === 'number' && typeof s.lng === 'number' ? { lat: s.lat, lng: s.lng } : null;
}

function endpointPos(tt: Timetable, ep: Endpoint): { lat: number; lng: number } | null {
  if (ep.kind === 'point') return { lat: ep.lat, lng: ep.lng };
  const i = tt.stopIndex.get(ep.stopId);
  return i === undefined ? null : stopPos(tt.stops[i]);
}

function endpointPlace(ep: Endpoint): Place {
  return ep.kind === 'stop' ? { stopId: ep.stopId } : { lat: ep.lat, lng: ep.lng };
}

/** Звідки/куди ми можемо почати/закінчити рейсову частину: сама зупинка або найближчі до точки зупинки */
export function offsetsFor(tt: Timetable, ep: Endpoint): Offset[] {
  if (ep.kind === 'stop') {
    const i = tt.stopIndex.get(ep.stopId);
    return i === undefined ? [] : [{ stop: i, minutes: 0, meters: 0 }];
  }
  const opts = tt.options;
  const near: Offset[] = [];
  tt.stops.forEach((s, i) => {
    const pos = stopPos(s);
    if (!pos) return;
    const d = haversineDistance(ep.lat, ep.lng, pos.lat, pos.lng);
    const minutes = walkMinutesForDistance(d, opts);
    if (minutes <= opts.maxAccessWalkMin) near.push({ stop: i, minutes, meters: walkMetersForDistance(d, opts) });
  });
  near.sort((a, b) => a.minutes - b.minutes || a.meters - b.meters);
  return near.slice(0, opts.maxAccessStops);
}

function directWalkFor(tt: Timetable, from: Endpoint, to: Endpoint): DirectWalk | null {
  const a = endpointPos(tt, from);
  const b = endpointPos(tt, to);
  if (!a || !b) return null;
  if (from.kind === 'stop' && to.kind === 'stop' && from.stopId === to.stopId) return null;
  const d = haversineDistance(a.lat, a.lng, b.lat, b.lng);
  const minutes = walkMinutesForDistance(d, tt.options);
  return minutes <= tt.options.maxDirectWalkMin ? { meters: walkMetersForDistance(d, tt.options), minutes } : null;
}

/** Усі моменти, коли людина може вирушити так, щоб встигнути на якийсь рейс (від найпізнішого до найранішого) */
function collectCandidates(tt: Timetable, sources: Offset[], footFromSources: boolean): number[] {
  const reach = new Map<number, number>();
  const put = (stop: number, minutes: number) => {
    const cur = reach.get(stop);
    if (cur === undefined || minutes < cur) reach.set(stop, minutes);
  };
  for (const o of sources) put(o.stop, o.minutes);
  if (footFromSources) for (const o of sources) for (const fp of tt.footpaths[o.stop]) put(fp.to, o.minutes + fp.minutes);

  const set = new Set<number>();
  for (const [stop, minutes] of reach) {
    for (const { pattern, pos } of tt.patternsAtStop[stop]) {
      const pat = tt.patterns[pattern];
      if (pos >= pat.stops.length - 1) continue;
      for (const trip of pat.trips) {
        const d = trip.times[pos] - minutes;
        if (d >= 0) set.add(d);
      }
    }
  }
  return [...set].sort((a, b) => b - a);
}

function placeKey(p: Place): string {
  return 'stopId' in p ? p.stopId : `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

function journeyKey(j: Journey): string {
  return j.legs
    .map((l) =>
      l.kind === 'transit'
        ? `t${l.patternIndex}.${l.tripIndex}.${l.boardPos}.${l.alightPos}`
        : `w${placeKey(l.from)}>${placeKey(l.to)}`
    )
    .join('|');
}

function dominates(a: Journey, b: Journey): boolean {
  if (a.departMins < b.departMins || a.arriveMins > b.arriveMins || a.transfers > b.transfers) return false;
  return a.departMins > b.departMins || a.arriveMins < b.arriveMins || a.transfers < b.transfers;
}

function paretoFilter(all: Journey[]): Journey[] {
  const unique = new Map<string, Journey>();
  for (const j of all) if (!unique.has(journeyKey(j))) unique.set(journeyKey(j), j);
  const list = [...unique.values()];
  const kept = list.filter((j) => !list.some((o) => o !== j && dominates(o, j)));
  // однакові за трьома критеріями, але різні за шляхом — лишаємо той, де менше пішки
  const byTriple = new Map<string, Journey>();
  for (const j of kept) {
    const key = `${j.departMins}|${j.arriveMins}|${j.transfers}`;
    const cur = byTriple.get(key);
    if (!cur || j.walkMeters < cur.walkMeters) byTriple.set(key, j);
  }
  return [...byTriple.values()].sort(
    (a, b) => a.departMins - b.departMins || a.arriveMins - b.arriveMins || a.transfers - b.transfers
  );
}

/** Усі недоміновані поїздки дня між двома кінцями. Розклад уже відфільтровано під потрібну дату. */
export function planDay(tt: Timetable, from: Endpoint, to: Endpoint): DayPlan {
  const directWalk = directWalkFor(tt, from, to);
  const sources = offsetsFor(tt, from);
  const egress = offsetsFor(tt, to);
  if (!sources.length || !egress.length) return { journeys: [], directWalk };
  if (from.kind === 'stop' && to.kind === 'stop' && from.stopId === to.stopId) return { journeys: [], directWalk: null };

  const footFromSources = from.kind === 'stop';
  const candidates = collectCandidates(tt, sources, footFromSources);
  const originPlace = endpointPlace(from);
  const destPlace = endpointPlace(to);

  const run = (maxWaitMin: number): Journey[] => {
    const found: Journey[] = [];
    for (const departMins of candidates) {
      found.push(
        ...searchAtDeparture({ tt, sources, egress, originPlace, destPlace, departMins, footFromSources, maxWaitMin })
      );
    }
    return paretoFilter(found);
  };

  // Скупі інтервали (40–65 хв) інколи дають лише поїздки з довгим очікуванням — краще їх показати, ніж «нічого немає»
  let journeys = run(tt.options.maxTransferWaitMin);
  if (journeys.length === 0) journeys = run(Infinity);
  return { journeys, directWalk };
}

export type SearchMode = 'depart' | 'arrive';

export interface JourneyWindow {
  items: Journey[];
  /** Скільки поїздок лишилось «раніше» / «пізніше» за показані */
  hiddenEarlier: number;
  hiddenLater: number;
}

/**
 * Зріз денного списку навколо моменту. «Відправлення о mins»: поїздки з departMins ≥ mins — «далі», решта — «раніше».
 * «Прибуття о mins»: поїздки з arriveMins ≤ mins — основні (останні за відправленням — найкращі), решта — «пізніше».
 * before/after — скільки поїздок показати з кожного боку (за замовчуванням 0/5 для відправлення і 5/0 для прибуття).
 */
export function journeyWindow(
  journeys: Journey[],
  opts: { mode: SearchMode; mins: number; before?: number; after?: number }
): JourneyWindow {
  const { mode, mins } = opts;
  const before = opts.before ?? (mode === 'arrive' ? 5 : 0);
  const after = opts.after ?? (mode === 'arrive' ? 0 : 5);
  // journeys вже за відправленням; обидва режими однаково ділять список на «до моменту» і «після»
  const lead = journeys.filter((j) => (mode === 'depart' ? j.departMins < mins : j.arriveMins <= mins));
  const tail = journeys.filter((j) => (mode === 'depart' ? j.departMins >= mins : j.arriveMins > mins));
  const shownLead = before > 0 ? lead.slice(Math.max(0, lead.length - before)) : [];
  const shownTail = tail.slice(0, after);
  return {
    items: [...shownLead, ...shownTail],
    hiddenEarlier: lead.length - shownLead.length,
    hiddenLater: tail.length - shownTail.length,
  };
}

/** Наступні рейси того самого патерна з тієї ж посадки до тієї ж висадки (аналог numLegAlternatives у MOTIS) */
export function legAlternatives(tt: Timetable, leg: TransitLeg, count = 3): LegAlternative[] {
  const pattern = tt.patterns[leg.patternIndex];
  const out: LegAlternative[] = [];
  for (let i = leg.tripIndex + 1; i < pattern.trips.length && out.length < count; i++) {
    const trip = pattern.trips[i];
    out.push({ tripId: trip.tripId, depMins: trip.times[leg.boardPos], arrMins: trip.times[leg.alightPos] });
  }
  return out;
}
