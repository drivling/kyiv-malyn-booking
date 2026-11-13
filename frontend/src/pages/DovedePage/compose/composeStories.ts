/**
 * Складальник історій «Доведе» (Docs/dovede-roadmap.md, «Як це працює»): намір + розклад коридору + якорі +
 * міський планувальник → кілька історій. Чистий модуль: дані й планувальник передають ззовні.
 *
 * Правила:
 *  - пересадку з маршрутки на міський автобус плануємо від найпізнішого прибуття (затор), показуємо звичайне,
 *    а раніший автобус — як «якщо приїдете раніше»;
 *  - на маршрутку / електричку в Київ — бути на зупинці щонайменше за bufferBeforeBoard хв;
 *  - після останнього автобуса — «пішки», з відстанню.
 */
import { haversineDistance } from '@/pages/LocalTransportPage/geo';
import type { Journey, Place } from '@/pages/LocalTransportPage/journey';
import type { Schedule } from '@/types';
import { routeNo } from '@/utils/routeNames';
import { anchorFor, type AnchorStop, type IntercityMode } from '../data/anchors';
import { KYIV_POINTS, TRAIN_POS, kyivStopText, mapsTransitUrl, metroHint } from '../data/kyiv';
import { placeById, placeLabel, type GazetteerPlace } from '../nlu/gazetteer';
import { resolvePlace } from '../nlu/places';
import { landmarkById } from '../nlu/landmarks';
import { streetPrecision } from '../nlu/streets';
import { addDays, partEndMins, partStartMins } from '../nlu/parseLocal';
import type { KyivNow, TripIntent, TripMode } from '../nlu/types';
import { intercityTrips, type IntercityTrip } from './intercity';
import { clock, leadFor } from './narrate';
import type { RouteLike } from '../nlu/routes';
import type { Endpoint } from '@/pages/LocalTransportPage/journey';
import type { ComposeOutcome, LocalPlanner, RouteBoard, RouteInfoItem, Story, StoryLeg } from './types';

// ─── Форма поїздки ────────────────────────────────────────────────────────────────────────────

export type TripShape =
  | { kind: 'to_malyn'; kyivPoint: string | null; dest: GazetteerPlace }
  | { kind: 'from_malyn'; origin: GazetteerPlace; kyivPoint: string | null }
  | { kind: 'intra'; origin: GazetteerPlace; dest: GazetteerPlace }
  | { kind: 'ask_from'; dest: GazetteerPlace }
  | { kind: 'ask_to' }
  | { kind: 'unknown_place'; words: string[] }
  | { kind: 'outside'; city: string | null }
  | { kind: 'poputka_soon' }
  | { kind: 'route_info'; routeIds: string[]; stop: GazetteerPlace | null }
  | { kind: 'not_trip'; intent: 'schedule' | 'price' | 'contact' | 'other' };

const MALYN = placeById('city.Malyn')!;
const CENTRE = placeById('malyn.tsentr')!;

export function classify(intent: TripIntent): TripShape {
  // «коли їде маршрутка Малин — Київ завтра» (schedule) — та сама відповідь, що й «як доїхати»: історії з часом
  const from = intent.from ? resolvePlace(intent.from.id) ?? null : null;
  const to = intent.to ? resolvePlace(intent.to.id) ?? null : null;
  // «куди їде №5», «коли 9-ка з Царського села» — картка маршруту; з парою «звідки — куди» це звичайна поїздка
  const routeIds = intent.routes ?? [];
  if (routeIds.length && (intent.intent === 'route' || !(from && to))) {
    const stop = [from, to].find((p) => p && p.city === 'Malyn' && !p.isCity) ?? null;
    return { kind: 'route_info', routeIds, stop };
  }
  if (intent.intent !== 'trip' && intent.intent !== 'schedule' && intent.intent !== 'route') return { kind: 'not_trip', intent: intent.intent };
  if (intent.unknown.length && (!from || !to)) return { kind: 'unknown_place', words: intent.unknown };
  if (!to) return { kind: 'ask_to' };
  if (intent.modes.length === 1 && intent.modes[0] === 'poputka') return { kind: 'poputka_soon' };
  if (to.city === 'Kyiv') {
    // рідне місто сайту — Малин: «мені в Київ» = з Малина
    if (!from || from.city === 'Malyn') return { kind: 'from_malyn', origin: from ?? MALYN, kyivPoint: to.isCity ? null : to.id };
    return { kind: 'outside', city: from.city };
  }
  if (to.city === 'Malyn') {
    if (from?.city === 'Kyiv') return { kind: 'to_malyn', kyivPoint: from.isCity ? null : from.id, dest: to };
    if (from?.city === 'Malyn') return { kind: 'intra', origin: from.isCity ? CENTRE : from, dest: to.isCity ? CENTRE : to };
    if (from) return { kind: 'outside', city: from.city };
    return { kind: 'ask_from', dest: to };
  }
  return { kind: 'outside', city: to.city };
}

/** Яку пару міст питати в /poputky/search */
export function corridorCities(shape: TripShape): { from: string; to: string } | null {
  if (shape.kind === 'to_malyn') return { from: 'Kyiv', to: 'Malyn' };
  if (shape.kind === 'from_malyn') return { from: 'Malyn', to: 'Kyiv' };
  return null;
}

export function resolveDate(day: string, now: KyivNow): string {
  if (day === 'today') return now.date;
  if (day === 'tomorrow') return addDays(now.date, 1);
  return day;
}

interface SearchWindow {
  kind: 'depart' | 'arrive';
  /** не раніше (хв) */
  start: number;
  /** бажаний кінець частини дня */
  end: number | null;
  /** «щоб бути до» */
  deadline: number | null;
}

export function searchWindow(intent: TripIntent, date: string, now: KyivNow): SearchWindow {
  const w = intent.when;
  const time = w.time ? Number(w.time.slice(0, 2)) * 60 + Number(w.time.slice(3, 5)) : null;
  const floor = date === now.date ? now.mins : 0;
  if (w.kind === 'arrive' && time != null) return { kind: 'arrive', start: floor, end: null, deadline: time };
  const start = Math.max(time ?? partStartMins(w.part) ?? 0, floor);
  return { kind: 'depart', start, end: time == null ? partEndMins(w.part) : null, deadline: null };
}

// ─── Міські відрізки ──────────────────────────────────────────────────────────────────────────

interface LocalPick {
  legs: StoryLeg[];
  departMins: number;
  arriveMins: number;
  /** час прибуття залежить від «≈» міжміського рейсу */
  approx: boolean;
  /** найпізніше прибуття (для вибору й «щоб бути до») */
  worst: number;
  transfers: number;
}

/**
 * Кінець міської ділянки: зупинка або точка (вулиця, будинок — Docs/dovede-roadmap.md, фаза 4). Планувальник
 * уміє обидва; від точки до найближчих зупинок він сам рахує пішу ділянку.
 */
interface Spot {
  ep: Endpoint;
  label: string;
  coords: [number, number] | null;
}

function spotOf(planner: LocalPlanner | null, place: GazetteerPlace): Spot | null {
  const stopId = place.stopIds?.[0];
  if (stopId) return { ep: { kind: 'stop', stopId }, label: planner?.stopName(stopId) ?? place.label, coords: planner?.stopCoords(stopId) ?? null };
  if (place.latLng) return { ep: { kind: 'point', lat: place.latLng[0], lng: place.latLng[1] }, label: place.label, coords: place.latLng };
  return null;
}

function stopSpot(planner: LocalPlanner, stopId: string): Spot {
  return { ep: { kind: 'stop', stopId }, label: planner.stopName(stopId), coords: planner.stopCoords(stopId) };
}

/** Примітка під відповіддю, коли адреса приблизна: будинку немає в даних, точка — середина вулиці чи сусідній номер */
function approxNote(place: GazetteerPlace): string | null {
  const lm = landmarkById(place.id);
  if (lm) {
    if (!lm.twins) return null;
    const where = lm.address ? ` (${lm.address})` : '';
    return `У місті кілька місць із назвою «${lm.name}» — показую це: ${lm.label}${where}. Якщо потрібне інше, назвіть вулицю чи зупинку поруч.`;
  }
  switch (streetPrecision(place.id)) {
    case 'near':
      return 'Цей будинок я знайшов за розташуванням біля вулиці — місце може бути трохи неточним.';
    case 'neighbour':
      return 'Точного будинку в моїх даних немає — показую найближче відоме місце на цій вулиці.';
    case 'street':
      return place.id.includes(':')
        ? 'Цього будинку в моїх даних немає — показую до середини вулиці. Назвіть зупинку поруч, і буде точніше.'
        : 'Номер будинку не названо — показую до середини вулиці. Назвіть будинок або зупинку поруч, і буде точніше.';
    default:
      return null;
  }
}

/** Пішки по прямій × 1,5 (як у планувальнику), 72 м/хв */
function longWalk(from: Spot, to: Spot): { meters: number; minutes: number } | null {
  const a = from.coords;
  const b = to.coords;
  if (!a || !b) return null;
  const meters = Math.round((haversineDistance(a[0], a[1], b[0], b[1]) * 1.5) / 10) * 10;
  return { meters, minutes: Math.max(1, Math.round(meters / 72)) };
}

function placeName(planner: LocalPlanner, p: Place): string | null {
  return 'stopId' in p ? planner.stopName(p.stopId) : null;
}

/** `pointLabel` — як назвати кінець пішої ділянки, що веде до точки (адреси), а не до зупинки */
function journeyLegs(j: Journey, planner: LocalPlanner, pointLabel: string | null = null): StoryLeg[] {
  const legs: StoryLeg[] = [];
  for (const l of j.legs) {
    if (l.kind === 'walk') {
      if (l.meters < 40) continue;
      legs.push({ kind: 'walk', meters: Math.round(l.meters / 10) * 10, minutes: Math.max(1, Math.round(l.arrMins - l.depMins)), toLabel: placeName(planner, l.to) ?? pointLabel, late: false });
    } else {
      legs.push({
        kind: 'bus',
        routeId: l.routeId,
        fromStopId: l.boardStopId,
        toStopId: l.alightStopId,
        direction: l.direction,
        depMins: l.depMins,
        arrMins: l.arrMins,
        stops: l.stopIds.length - 1,
        note: null,
      });
    }
  }
  return legs;
}

function firstBus(j: Journey) {
  return j.legs.find((l) => l.kind === 'transit');
}

/** Після висадки з маршрутки / електрички — до місця призначення */
function afterAlight(
  planner: LocalPlanner,
  stopId: string,
  dest: Spot,
  at: number,
  atMax: number,
  buffer: number,
  approx: boolean,
): LocalPick | null {
  const plan = planner.plan({ kind: 'stop', stopId }, dest.ep);
  const destPoint = dest.ep.kind === 'point' ? dest.label : null;
  const readyMax = atMax + buffer;
  const readyTyp = at + buffer;
  const j = plan.journeys.find((x) => x.departMins >= readyMax) ?? null;
  const walk = plan.directWalk;
  if (walk && (!j || at + walk.minutes <= j.arriveMins + 2)) {
    return {
      legs: [{ kind: 'walk', meters: Math.round(walk.meters / 10) * 10, minutes: walk.minutes, toLabel: dest.label, late: false }],
      departMins: at,
      arriveMins: at + walk.minutes,
      approx,
      worst: atMax + walk.minutes,
      transfers: 0,
    };
  }
  if (j) {
    const legs = journeyLegs(j, planner, destPoint);
    const earlier = plan.journeys.find((x) => x.departMins >= readyTyp && x.departMins < readyMax && x.arriveMins < j.arriveMins);
    const eb = earlier ? firstBus(earlier) : undefined;
    const bus = legs.find((l): l is Extract<StoryLeg, { kind: 'bus' }> => l.kind === 'bus');
    if (earlier && eb && eb.kind === 'transit' && bus) {
      bus.note = `Якщо приїдете раніше — №${routeNo(eb.routeId)} о ${clock(eb.depMins)}, на місці о ${clock(earlier.arriveMins)}.`;
    }
    return { legs, departMins: j.departMins, arriveMins: j.arriveMins, approx: false, worst: j.arriveMins, transfers: j.transfers };
  }
  const lw = longWalk(stopSpot(planner, stopId), dest);
  if (!lw) return null;
  return {
    legs: [{ kind: 'walk', meters: lw.meters, minutes: lw.minutes, toLabel: dest.label, late: true }],
    departMins: at,
    arriveMins: at + lw.minutes,
    approx,
    worst: atMax + lw.minutes,
    transfers: 0,
  };
}

/** До посадки на маршрутку / електричку: виїхати якомога пізніше, але бути на зупинці до deadline */
function beforeBoard(planner: LocalPlanner, origin: Spot, stopId: string, deadline: number): LocalPick | null {
  const plan = planner.plan(origin.ep, { kind: 'stop', stopId });
  const fit = plan.journeys.filter((x) => x.arriveMins <= deadline);
  const j = fit.reduce<Journey | null>((best, x) => (!best || x.departMins > best.departMins ? x : best), null);
  const walk = plan.directWalk;
  if (walk && (!j || deadline - walk.minutes >= j.departMins - 2)) {
    return {
      legs: [{ kind: 'walk', meters: Math.round(walk.meters / 10) * 10, minutes: walk.minutes, toLabel: planner.stopName(stopId), late: false }],
      departMins: deadline - walk.minutes,
      arriveMins: deadline,
      approx: false,
      worst: deadline,
      transfers: 0,
    };
  }
  if (j) return { legs: journeyLegs(j, planner), departMins: j.departMins, arriveMins: j.arriveMins, approx: false, worst: j.arriveMins, transfers: j.transfers };
  const lw = longWalk(origin, stopSpot(planner, stopId));
  if (!lw || lw.minutes > 50) return null;
  return {
    legs: [{ kind: 'walk', meters: lw.meters, minutes: lw.minutes, toLabel: planner.stopName(stopId), late: false }],
    departMins: deadline - lw.minutes,
    arriveMins: deadline,
    approx: false,
    worst: deadline,
    transfers: 0,
  };
}

// ─── Варіанти ─────────────────────────────────────────────────────────────────────────────────

interface Option {
  story: Story;
  mode: IntercityMode;
  /** коли людина вирушає (посадка в Києві або вихід з дому в Малині) */
  leave: number;
  worst: number;
  confirmed: boolean;
}

/** Де вийти в Малині (to_malyn) */
interface MalynPick {
  a: AnchorStop;
  legs: StoryLeg[];
  arrive: number;
  approx: boolean;
  worst: number;
}

/** Де сісти в Малині (from_malyn) */
interface BoardPick {
  a: AnchorStop;
  legs: StoryLeg[];
  leave: number;
  board: number;
}

function modeAllowed(mode: IntercityMode, modes: TripMode[]): boolean {
  const intercity = modes.filter((m) => m === 'marshrutka' || m === 'elektrichka');
  return intercity.length === 0 || intercity.includes(mode);
}

function intercityLeg(
  trip: IntercityTrip,
  board: { mins: number; approx: boolean; label: string },
  alight: { mins: number; approx: boolean; label: string },
  usual: boolean,
): Extract<StoryLeg, { kind: 'intercity' }> {
  const s = trip.schedule;
  return {
    kind: 'intercity',
    mode: trip.mode,
    schedule: s,
    boardLabel: board.label,
    boardMins: board.mins,
    boardApprox: board.approx,
    alightLabel: alight.label,
    alightMins: alight.mins,
    alightApprox: alight.approx,
    usual,
    via: trip.via,
    priceUah: s.priceUah ?? null,
    phoneOnly: trip.phoneOnly,
    ticketUrl: trip.mode === 'elektrichka' ? s.ticketPurchaseUrl ?? null : null,
    tripNumber: s.tripNumber ?? null,
    later: [],
  };
}

function busTransfers(legs: StoryLeg[]): number {
  return legs.filter((l) => l.kind === 'bus' || l.kind === 'intercity').length - 1;
}

function makeStory(id: string, mode: Story['mode'], date: string, fromLabel: string, toLabel: string, legs: StoryLeg[], o: {
  leave: number;
  arrive: number;
  approx: boolean;
  endLabel: string;
  endNote: string | null;
  price: number | null;
}): Story {
  const base = { legs, arriveMins: o.arrive, arriveApprox: o.approx, endLabel: o.endLabel };
  return {
    id,
    mode,
    date,
    leaveMins: o.leave,
    arriveMins: o.arrive,
    arriveApprox: o.approx,
    fromLabel,
    toLabel,
    legs,
    endLabel: o.endLabel,
    endNote: o.endNote,
    priceUah: o.price,
    transfers: Math.max(0, busTransfers(legs)),
    lead: leadFor(base),
  };
}

function toMalynOptions(input: ComposeInput, shape: Extract<TripShape, { kind: 'to_malyn' }>): Option[] {
  const { planner, date } = input;
  const out: Option[] = [];
  const dest = shape.dest;
  const destSpot = spotOf(planner, dest);
  const fromLabel = shape.kyivPoint ? placeLabel(placeById(shape.kyivPoint)!) : 'Київ';
  for (const trip of intercityTrips(input.schedules, 'to_malyn', date)) {
    if (!modeAllowed(trip.mode, input.intent.modes)) continue;
    const anchor = anchorFor('to_malyn', trip.mode);
    // Київ: де сідати людині
    const bp = trip.kyivPoint;
    const user = shape.kyivPoint;
    const boardText = kyivStopText(bp, trip.mode, trip.schedule.boardingPlace ?? 'Київ');
    let board = { mins: trip.depMins, approx: false, label: boardText.from };
    let kyivLeg: StoryLeg | null = null;
    if (user && bp && user !== bp) {
      const passes = trip.mode === 'elektrichka' && TRAIN_POS[user] != null && TRAIN_POS[bp] != null && TRAIN_POS[user] > TRAIN_POS[bp];
      if (passes) {
        board = { mins: trip.depMins + TRAIN_POS[user] - TRAIN_POS[bp], approx: true, label: kyivStopText(user, 'elektrichka', '').from };
      } else {
        const hint = metroHint(user, bp) ?? `Доїдьте: ${boardText.name}`;
        kyivLeg = { kind: 'kyiv', text: hint, mapsUrl: mapsTransitUrl(KYIV_POINTS[user]?.mapsQuery ?? null, KYIV_POINTS[bp]?.mapsQuery ?? null) };
      }
    }
    // Малин: найкраща точка виходу
    let best: MalynPick | null = null;
    for (const a of anchor.stops) {
      const at = trip.arrMins + a.offsetMin;
      const atMax = trip.arrMaxMins + a.offsetMin;
      const approx = !trip.exact;
      let cand: MalynPick | null = null;
      if (!destSpot || dest.isCity) {
        if (a.offsetMin !== 0) continue; // «у Малин» — до головної зупинки
        cand = { a, legs: [], arrive: at, approx, worst: atMax };
      } else if (dest.id === a.placeId || dest.stopIds?.includes(a.stopId)) {
        cand = { a, legs: [], arrive: at, approx, worst: atMax };
      } else if (planner) {
        const pick = afterAlight(planner, a.stopId, destSpot, at, atMax, anchor.bufferAfterAlight, approx);
        if (!pick) continue;
        const wait: StoryLeg = {
          kind: 'wait',
          text: `Вийдіть ${a.label} (${clock(at, approx)}) і ${pick.legs[0]?.kind === 'walk' ? 'йдіть пішки' : 'пересядьте на міський автобус'}.`,
        };
        cand = { a, legs: [wait, ...pick.legs], arrive: pick.arriveMins, approx: pick.approx, worst: pick.worst };
      }
      if (!cand) continue;
      const better =
        !best ||
        cand.worst < best.worst - 2 ||
        (Math.abs(cand.worst - best.worst) <= 2 && cand.a.confirmed && !best.a.confirmed) ||
        (Math.abs(cand.worst - best.worst) <= 2 && cand.a.confirmed === best.a.confirmed && cand.legs.length < best.legs.length);
      if (better) best = cand;
    }
    if (!best) continue;
    const ic = intercityLeg(trip, board, { mins: trip.arrMins + best.a.offsetMin, approx: !trip.exact, label: best.a.label }, !best.a.confirmed);
    const legs: StoryLeg[] = [...(kyivLeg ? [kyivLeg] : []), ic, ...best.legs];
    const late = best.legs.some((l) => l.kind === 'walk' && l.late);
    const endLabel = dest.isCity ? `Малин, ${best.a.name}` : placeLabel(dest);
    const story = makeStory(`to-${trip.schedule.id}`, trip.mode, date, fromLabel, placeLabel(dest), legs, {
      leave: board.mins,
      arrive: best.arrive,
      approx: best.approx,
      endLabel,
      endNote: late ? 'міські автобуси вже не ходять' : approxNote(dest),
      price: trip.schedule.priceUah ?? null,
    });
    out.push({ story, mode: trip.mode, leave: board.mins, worst: best.worst, confirmed: best.a.confirmed });
  }
  return out;
}

function fromMalynOptions(input: ComposeInput, shape: Extract<TripShape, { kind: 'from_malyn' }>): Option[] {
  const { planner, date } = input;
  const out: Option[] = [];
  const origin = shape.origin;
  const originSpot = origin.isCity ? null : spotOf(planner, origin);
  const toLabel = shape.kyivPoint ? placeLabel(placeById(shape.kyivPoint)!) : 'Київ';
  for (const trip of intercityTrips(input.schedules, 'from_malyn', date)) {
    if (!modeAllowed(trip.mode, input.intent.modes)) continue;
    const anchor = anchorFor('from_malyn', trip.mode);
    let best: BoardPick | null = null;
    for (const a of anchor.stops) {
      const boardAt = trip.depMins + a.offsetMin;
      const deadline = boardAt - anchor.bufferBeforeBoard;
      let cand: BoardPick | null = null;
      if (!originSpot) {
        if (a.offsetMin !== 0) continue;
        cand = { a, legs: [], leave: deadline, board: boardAt };
      } else if (origin.id === a.placeId || origin.stopIds?.includes(a.stopId)) {
        cand = { a, legs: [], leave: deadline, board: boardAt };
      } else if (planner) {
        const pick = beforeBoard(planner, originSpot, a.stopId, deadline);
        if (!pick) continue;
        const spare = boardAt - pick.arriveMins;
        const wait: StoryLeg = { kind: 'wait', text: `Чекайте ${a.label}: до відправлення ${spare} хв.` };
        cand = { a, legs: [...pick.legs, wait], leave: pick.departMins, board: boardAt };
      }
      if (!cand) continue;
      const better = !best || cand.leave > best.leave + 2 || (Math.abs(cand.leave - best.leave) <= 2 && cand.a.confirmed && !best.a.confirmed);
      if (better) best = cand;
    }
    if (!best) continue;
    // Київ: де виходити і як далі
    const alightText = kyivStopText(trip.kyivPoint, trip.mode, trip.schedule.alightingPlace ?? 'Київ');
    let arrive = trip.arrMins;
    let approx = !trip.exact;
    let endLabel = alightText.name;
    let kyivLeg: StoryLeg | null = null;
    const target = shape.kyivPoint;
    const ap = trip.kyivPoint;
    if (target && ap && target !== ap) {
      const passes = trip.mode === 'elektrichka' && TRAIN_POS[target] != null && TRAIN_POS[ap] != null && TRAIN_POS[target] > TRAIN_POS[ap];
      if (passes) {
        arrive = trip.arrMins - (TRAIN_POS[target] - TRAIN_POS[ap]);
        approx = true;
        endLabel = kyivStopText(target, 'elektrichka', '').name;
      } else {
        kyivLeg = { kind: 'kyiv', text: metroHint(ap, target) ?? `Далі до: ${KYIV_POINTS[target]?.label ?? 'місця'}`, mapsUrl: mapsTransitUrl(KYIV_POINTS[ap]?.mapsQuery ?? null, KYIV_POINTS[target]?.mapsQuery ?? null) };
      }
    } else if (!target && ap) {
      kyivLeg = { kind: 'kyiv', text: 'Далі по Києву', mapsUrl: mapsTransitUrl(KYIV_POINTS[ap]?.mapsQuery ?? null, null) };
    }
    const boardApprox = best.a.offsetMin !== 0;
    const ic = intercityLeg(
      trip,
      { mins: best.board, approx: boardApprox, label: best.a.from },
      { mins: arrive, approx, label: alightText.at },
      !best.a.confirmed,
    );
    const legs: StoryLeg[] = [...best.legs, ic, ...(kyivLeg ? [kyivLeg] : [])];
    const story = makeStory(`from-${trip.schedule.id}`, trip.mode, date, placeLabel(origin), toLabel, legs, {
      leave: best.leave,
      arrive,
      approx,
      endLabel: `Київ, ${endLabel}`,
      endNote: null,
      price: trip.schedule.priceUah ?? null,
    });
    out.push({ story, mode: trip.mode, leave: best.leave, worst: approx ? arrive + 7 : arrive, confirmed: best.a.confirmed });
  }
  return out;
}

/** Найкращий варіант на кожен вид транспорту + «інші рейси» */
function pickPerMode(options: Option[], win: SearchWindow): { stories: Story[]; notice: string | null } {
  let notice: string | null = null;
  const stories: Story[] = [];
  for (const mode of ['marshrutka', 'elektrichka'] as const) {
    const list = options.filter((o) => o.mode === mode && o.leave >= win.start);
    if (!list.length) continue;
    let pick: Option | undefined;
    if (win.kind === 'arrive' && win.deadline != null) {
      pick = [...list].filter((o) => o.worst <= win.deadline!).sort((a, b) => b.leave - a.leave)[0];
      if (!pick) {
        notice = `До ${clock(win.deadline)} не встигнути — найближчі варіанти пізніше.`;
        pick = [...list].sort((a, b) => a.worst - b.worst)[0];
      }
    } else {
      const inPart = win.end != null ? list.filter((o) => o.leave <= win.end!) : list;
      pick = [...(inPart.length ? inPart : list)].sort((a, b) => a.worst - b.worst || a.leave - b.leave)[0];
    }
    if (!pick) continue;
    const ic = pick.story.legs.find((l): l is Extract<StoryLeg, { kind: 'intercity' }> => l.kind === 'intercity');
    if (ic) {
      ic.later = list
        .filter((o) => o.leave > pick!.leave)
        .sort((a, b) => a.leave - b.leave)
        .slice(0, 3)
        .map((o) => {
          const l = o.story.legs.find((x): x is Extract<StoryLeg, { kind: 'intercity' }> => x.kind === 'intercity');
          return l ? `${clock(l.boardMins, l.boardApprox)} ${l.boardLabel}` : clock(o.leave);
        });
    }
    stories.push(pick.story);
  }
  stories.sort((a, b) => a.arriveMins - b.arriveMins);
  return { stories, notice };
}

function intraOutcome(input: ComposeInput, shape: Extract<TripShape, { kind: 'intra' }>, win: SearchWindow): ComposeOutcome {
  const { planner } = input;
  const a = spotOf(planner, shape.origin);
  const b = spotOf(planner, shape.dest);
  if (!planner || !a || !b) return { kind: 'empty', reason: 'no_trips' };
  const fromLabel = placeLabel(shape.origin);
  const toLabel = placeLabel(shape.dest);
  const plan = planner.plan(a.ep, b.ep);
  const destPoint = b.ep.kind === 'point' ? shape.dest.label : null;
  const endNote = approxNote(shape.dest) ?? approxNote(shape.origin)?.replace('показую до середини', 'рахую від середини').replace('показую найближче відоме місце', 'рахую від найближчого відомого місця') ?? null;
  // Людина назвала маршрут («пʼятіркою до вокзалу») — спершу поїздки ним; якщо ним не доїхати, чесно кажемо й показуємо інші
  const wanted = input.intent.routes ?? [];
  const usesWanted = (j: Journey) => j.legs.some((l) => l.kind === 'transit' && wanted.includes(l.routeId));
  // «крім сімки» — поїздки без цього автобуса; якщо без нього ніяк, чесно кажемо й показуємо з ним
  const avoided = input.intent.avoidRoutes ?? [];
  const usesAvoided = (j: Journey) => j.legs.some((l) => l.kind === 'transit' && avoided.includes(l.routeId));
  const allowed = avoided.length ? plan.journeys.filter((j) => !usesAvoided(j)) : plan.journeys;
  const byRoute = wanted.length ? allowed.filter(usesWanted) : allowed;
  const inWindow = (pool: Journey[]): Journey[] =>
    win.kind === 'arrive' && win.deadline != null
      ? pool.filter((j) => j.arriveMins <= win.deadline! && j.departMins >= win.start).slice(-2).reverse()
      : pool.filter((j) => j.departMins >= win.start).slice(0, 2);
  let picks = inWindow(byRoute);
  // названим маршрутом не доїхати взагалі або вже не сьогодні — показуємо інші, а не «нічого не їде»
  const routeMissed = wanted.length > 0 && picks.length === 0;
  if (routeMissed) picks = inWindow(allowed);
  const avoidMissed = avoided.length > 0 && picks.length === 0;
  if (avoidMissed) picks = inWindow(plan.journeys);
  const stories = picks.map((j, i) =>
    makeStory(`city-${i}-${j.departMins}`, 'city_bus', input.date, fromLabel, toLabel, journeyLegs(j, planner, destPoint), {
      leave: j.departMins,
      arrive: j.arriveMins,
      approx: false,
      endLabel: toLabel,
      endNote,
      price: null,
    }),
  );
  if (!stories.length && plan.directWalk) {
    const w = plan.directWalk;
    const leave = win.start;
    stories.push(
      makeStory('city-walk', 'city_bus', input.date, fromLabel, toLabel, [{ kind: 'walk', meters: Math.round(w.meters / 10) * 10, minutes: w.minutes, toLabel, late: false }], {
        leave,
        arrive: leave + w.minutes,
        approx: false,
        endLabel: toLabel,
        endNote,
        price: null,
      }),
    );
  }
  if (!stories.length) return { kind: 'empty', reason: 'no_trips' };
  const no = (id: string) => input.routes?.find((r) => r.id === id)?.no ?? id;
  const notice = avoidMissed
    ? `Без автобуса №${avoided.map(no).join(', №')} ${allowed.length ? 'у цей час уже не доїхати' : 'туди не доїхати'} — показую варіанти з ним.`
    : routeMissed
      ? `Автобусом №${wanted.map(no).join(', №')} ${byRoute.length ? 'у цей час уже не доїхати' : 'туди не доїхати'} — ось інші варіанти.`
      : null;
  return { kind: 'stories', stories, askMode: false, notice };
}

/** Картка маршруту: кінцеві й найближчі відправлення — з названої зупинки або з обох кінцевих */
function routeInfoOutcome(input: ComposeInput, shape: Extract<TripShape, { kind: 'route_info' }>): ComposeOutcome {
  const { planner } = input;
  if (!planner?.routeDepartures) return { kind: 'empty', reason: 'no_trips' };
  const stopIds = shape.stop?.stopIds ?? [];
  // кілька маршрутів («коли їдуть 5 і 7 з лікарні») — одна картка; першим той, що їде раніше
  const items = shape.routeIds.map((id) => routeInfoItem(input, id, stopIds));
  if (items.length > 1) items.sort((a, b) => (a.boards[0]?.next[0] ?? Infinity) - (b.boards[0]?.next[0] ?? Infinity));
  return {
    kind: 'route_info',
    // зупинку назвали, але маршрут через неї не ходить — картка скаже про це
    atStopId: shape.stop ? stopIds[0] ?? null : null,
    atStopLabel: shape.stop ? placeLabel(shape.stop) : null,
    items,
  };
}

function routeInfoItem(input: ComposeInput, routeId: string, stopIds: string[]): RouteInfoItem {
  const { now, date } = input;
  const planner = input.planner!;
  const route = input.routes?.find((r) => r.id === routeId);
  // місце може мати кілька зупинок (обидва боки дороги) — беремо ті, через які маршрут справді ходить
  const groups = stopIds.length ? stopIds.flatMap((id) => planner.routeDepartures!(routeId, id)) : planner.routeDepartures!(routeId, null);
  const from = date === now.date ? now.mins : 0;
  const boards: RouteBoard[] = groups
    .filter((g) => g.mins.length)
    .map((g) => ({ fromStopId: g.fromStopId, towardStopId: g.towardStopId, next: g.mins.filter((m) => m >= from).slice(0, 6), first: g.mins[0], last: g.mins[g.mins.length - 1] }))
    .sort((a, b) => (a.next[0] ?? Infinity) - (b.next[0] ?? Infinity));
  // поодинокі рейси іншим шляхом, які сьогодні вже пройшли, лише засмічують картку, якщо є що показати
  const upcoming = boards.filter((b) => b.next.length);
  const shown = (upcoming.length ? upcoming : boards).slice(0, 4);
  return { routeId, no: route?.no ?? routeId, fromName: route?.fromName ?? '', toName: route?.toName ?? '', boards: shown };
}

// ─── Вхід ─────────────────────────────────────────────────────────────────────────────────────

export interface ComposeInput {
  intent: TripIntent;
  now: KyivNow;
  /** 'YYYY-MM-DD' — дата пошуку */
  date: string;
  /** розклад коридору на цю дату (GET /poputky/search); [] для поїздок містом */
  schedules: Schedule[];
  planner: LocalPlanner | null;
  /** маршрути міста (номер для показу, кінцеві) — для картки маршруту */
  routes?: RouteLike[];
}

export function composeStories(input: ComposeInput, shape: TripShape = classify(input.intent)): ComposeOutcome {
  switch (shape.kind) {
    case 'ask_from':
      return { kind: 'ask_from', destId: shape.dest.id };
    case 'ask_to':
      return { kind: 'ask_to' };
    case 'unknown_place':
      return { kind: 'unknown_place', words: shape.words };
    case 'outside':
      return { kind: 'outside', city: shape.city };
    case 'poputka_soon':
      return { kind: 'poputka_soon' };
    case 'not_trip':
      return { kind: 'not_trip', intent: shape.intent };
    case 'route_info':
      return routeInfoOutcome(input, shape);
    default:
      break;
  }
  const win = searchWindow(input.intent, input.date, input.now);
  if (shape.kind === 'intra') return intraOutcome(input, shape, win);
  const options = shape.kind === 'to_malyn' ? toMalynOptions(input, shape) : fromMalynOptions(input, shape);
  const { stories, notice } = pickPerMode(options, win);
  if (!stories.length) return { kind: 'empty', reason: input.date === input.now.date ? 'too_late' : 'no_trips' };
  const askMode = input.intent.modes.length === 0 && new Set(stories.map((s) => s.mode)).size > 1;
  return { kind: 'stories', stories, askMode, notice };
}
