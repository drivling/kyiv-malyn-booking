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
import type { Schedule, ViberListing } from '@/types';
import { routeNo } from '@/utils/routeNames';
import { anchorFor, type AnchorStop, type FarCity, type IntercityMode } from '../data/anchors';
import { KYIV_POINTS, TRAIN_POS, kyivStopText, mapsTransitUrl, metroTrip } from '../data/kyiv';
import { CITY_LABEL, placeById, placeLabel, type GazetteerPlace, type PlaceCity } from '../nlu/gazetteer';
import { resolvePlace } from '../nlu/places';
import { landmarkById } from '../nlu/landmarks';
import { streetPrecision } from '../nlu/streets';
import { addDays, partEndMins, partStartMins } from '../nlu/parseLocal';
import type { KyivNow, TripIntent, TripMode } from '../nlu/types';
import { intercityTrips, type IntercityTrip } from './intercity';
import { clock, leadFor } from './narrate';
import type { RouteLike } from '../nlu/routes';
import type { Endpoint } from '@/pages/LocalTransportPage/journey';
import type { NoteDir, NotePlaces } from '../nlu/notePlaces';
import { cityAskKey, type CityAsk, type CityRoute, type ComposeOutcome, type LocalPlanner, type PoputkaRide, type PriceLine, type RouteBoard, type RouteInfoItem, type Story, type StoryLeg } from './types';

// ─── Форма поїздки ────────────────────────────────────────────────────────────────────────────

export type TripShape =
  | { kind: 'to_malyn'; far: FarCity; kyivPoint: string | null; dest: GazetteerPlace; detail?: string | null }
  | { kind: 'from_malyn'; far: FarCity; origin: GazetteerPlace; kyivPoint: string | null; detail?: string | null }
  | { kind: 'intra'; origin: GazetteerPlace; dest: GazetteerPlace }
  | { kind: 'ask_from'; dest: GazetteerPlace }
  | { kind: 'ask_to' }
  | { kind: 'unknown_place'; words: string[] }
  | { kind: 'outside'; city: string | null }
  | { kind: 'poputky'; fromCity: PlaceCity; toCity: PlaceCity }
  | { kind: 'price'; city: boolean; corridor: boolean; far: FarCity }
  | { kind: 'contact' }
  | { kind: 'route_info'; routeIds: string[]; stop: GazetteerPlace | null }
  | { kind: 'not_trip'; intent: 'schedule' | 'other' };

const MALYN = placeById('city.Malyn')!;
const CENTRE = placeById('malyn.tsentr')!;
/** Якір попуток у Малині, коли водій місця не назвав: центр — ті самі зупинки, що в маршруток */
const centreOf = (corridor: 'to_malyn' | 'from_malyn') => anchorFor(corridor, 'marshrutka').stops.find((s) => s.placeId === 'malyn.tsentr')!;
/** висадка з Києва — біля РБК; посадка на Київ — від «Промінь» (як у маршруток) */
const RIDE_DROP = centreOf('to_malyn');
const RIDE_PICKUP = centreOf('from_malyn');

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
  if (intent.intent === 'contact') return { kind: 'contact' };
  if (intent.intent === 'price') {
    // у межах Малина — тариф міського автобуса; між містами — маршрутка й електричка; не сказано — усе
    const inCity = intent.modes.includes('city_bus') || (from?.city === 'Malyn' && to?.city === 'Malyn');
    const between = intent.modes.some((m) => m !== 'city_bus') || (from != null && to != null && from.city !== to.city) || [from, to].some((p) => p && p.city !== 'Malyn');
    return { kind: 'price', city: inCity || !between, corridor: between || !inCity, far: [from, to].some((p) => p?.city === 'Zhytomyr') ? 'Zhytomyr' : 'Kyiv' };
  }
  if (intent.intent !== 'trip' && intent.intent !== 'schedule' && intent.intent !== 'route') return { kind: 'not_trip', intent: intent.intent };
  if (intent.unknown.length && (!from || !to)) return { kind: 'unknown_place', words: intent.unknown };
  if (!to) return { kind: 'ask_to' };
  if (intent.modes.length === 1 && intent.modes[0] === 'poputka') {
    // рідне місто сайту — Малин: «попутка в Київ» = з Малина, «попутка в Малин» = з Києва
    const toCity = to.city;
    const fromCity = from?.city ?? (toCity === 'Malyn' ? 'Kyiv' : 'Malyn');
    return fromCity === toCity ? { kind: 'outside', city: toCity } : { kind: 'poputky', fromCity, toCity };
  }
  if (to.city === 'Kyiv') {
    // рідне місто сайту — Малин: «мені в Київ» = з Малина
    if (!from || from.city === 'Malyn') return { kind: 'from_malyn', far: 'Kyiv', origin: from ?? MALYN, kyivPoint: to.isCity ? null : to.id, detail: to.isCity ? intent.to?.detail ?? null : null };
    return { kind: 'outside', city: from.city };
  }
  // Житомир ↔ Малин: між містами — до автовокзалу Житомира й з нього; далі містом — крок `city`
  if (to.city === 'Zhytomyr') {
    if (!from || from.city === 'Malyn') return { kind: 'from_malyn', far: 'Zhytomyr', origin: from ?? MALYN, kyivPoint: null, detail: intent.to?.detail ?? null };
    return { kind: 'outside', city: from.city };
  }
  if (to.city === 'Malyn') {
    if (from?.city === 'Kyiv') return { kind: 'to_malyn', far: 'Kyiv', kyivPoint: from.isCity ? null : from.id, dest: to, detail: from.isCity ? intent.from?.detail ?? null : null };
    if (from?.city === 'Zhytomyr') return { kind: 'to_malyn', far: 'Zhytomyr', kyivPoint: null, dest: to, detail: intent.from?.detail ?? null };
    if (from?.city === 'Malyn') return { kind: 'intra', origin: from.isCity ? CENTRE : from, dest: to.isCity ? CENTRE : to };
    if (from) return { kind: 'outside', city: from.city };
    return { kind: 'ask_from', dest: to };
  }
  return { kind: 'outside', city: to.city };
}

/** Яку пару міст питати в /poputky/search */
export function corridorCities(shape: TripShape): { from: string; to: string } | null {
  if (shape.kind === 'to_malyn') return { from: shape.far, to: 'Malyn' };
  if (shape.kind === 'from_malyn') return { from: 'Malyn', to: shape.far };
  if (shape.kind === 'poputky') return { from: shape.fromCity, to: shape.toCity };
  // ціни однакові в обидва боки — досить одного напрямку
  // на Житомир ціни в розкладі є лише в рейсів з Житомира
  if (shape.kind === 'price' && shape.corridor) return shape.far === 'Zhytomyr' ? { from: 'Zhytomyr', to: 'Malyn' } : { from: 'Malyn', to: 'Kyiv' };
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

/**
 * Крок Києвом між двома точками: метро зі своїх даних, а коли точка не на метро — стара підказка з Google Maps.
 * `anchor` — час, до якого привʼязаний крок: 'from' — людина заходить у метро о `mins` (після висадки),
 * 'until' — має вийти з метро до `mins` (перед посадкою). `minutes` — на стільки зсувається час історії
 * (0, коли метро о цій порі не працює чи його там немає).
 */
function kyivStep(fromId: string, toId: string, anchor: 'from' | 'until', mins: number, date: string, fallback: string): { leg: StoryLeg; minutes: number; closed: boolean; metro: boolean } {
  const mapsUrl = mapsTransitUrl(KYIV_POINTS[fromId]?.mapsQuery ?? null, KYIV_POINTS[toId]?.mapsQuery ?? null);
  const rough = metroTrip(fromId, toId);
  if (!rough) return { leg: { kind: 'kyiv', text: fallback, mapsUrl }, minutes: 0, closed: false, metro: false };
  // інтервал поїздів залежить від години входу: для «until» спершу прикидаємо, коли людина зайде
  const enter = anchor === 'from' ? mins : mins - rough.minutes;
  const trip = metroTrip(fromId, toId, { mins: enter, date })!;
  const dep = anchor === 'from' ? mins : mins - trip.minutes;
  const minutes = trip.closed ? 0 : trip.minutes;
  return {
    leg: { kind: 'metro', segments: trip.segments, transfers: trip.transfers, minutes: trip.minutes, depMins: dep, arrMins: dep + trip.minutes, headwayMin: trip.headwayMin, priceUah: trip.priceUah, closed: trip.closed, mapsUrl },
    minutes,
    closed: trip.closed,
    metro: true,
  };
}

/** Запас перед посадкою на міжміський рейс після дороги містом, хв */
const CITY_BOARD_BUFFER = 7;
/** Для «встигнути до» ще не знаємо, скільки їхати містом, — питаємо дорогу на цей час раніше */
const CITY_LOOKBACK = 40;

/** Точка далекого міста, куди привозить (і звідки забирає) міжміський рейс: id для сервера, назва, запит для Google Maps */
function farPoint(far: FarCity, kyivPoint: string | null): { id: string; label: string; maps: string | null } | null {
  if (far === 'Zhytomyr') return { id: 'zhytomyr.avtovokzal', label: ZHYTOMYR_STATION.name, maps: ZHYTOMYR_STATION.maps };
  const p = kyivPoint ? KYIV_POINTS[kyivPoint] : null;
  return p && kyivPoint ? { id: kyivPoint, label: p.label, maps: p.mapsQuery ?? null } : null;
}

/**
 * Крок містом до місця, названого словами. Кроки дає сервер: складальник лише каже, що спитати (`ask`), і
 * підставляє відповідь, коли сторінка її принесла (`cityRoutes`). Без відповіді — кнопка Google Maps, час 0.
 */
function cityStep(
  input: Pick<ComposeInput, 'date' | 'cityRoutes'>,
  far: FarCity,
  point: { id: string; label: string; maps: string | null },
  detail: string,
  anchor: 'from' | 'until',
  mins: number,
): { leg: StoryLeg; minutes: number } {
  const cityName = CITY_LABEL[far];
  const there = `${detail}, ${cityName}`;
  const at = Math.floor((((anchor === 'from' ? mins : mins - CITY_LOOKBACK) % 1440) + 1440) % 1440 / 10) * 10;
  const ask: CityAsk = { city: far, from: anchor === 'from' ? point.id : detail, to: anchor === 'from' ? detail : point.id, date: input.date, time: clock(at) };
  const route: CityRoute | null = input.cityRoutes?.get(cityAskKey(ask)) ?? null;
  const minutes = route ? route.minutes : 0;
  const dep = anchor === 'from' ? mins : mins - minutes;
  return {
    leg: {
      kind: 'city',
      city: far,
      cityName,
      ask,
      fromLabel: anchor === 'from' ? point.label : detail,
      toLabel: anchor === 'from' ? detail : point.label,
      route,
      depMins: route ? dep : null,
      arrMins: route ? dep + minutes : null,
      mapsUrl: anchor === 'from' ? mapsTransitUrl(point.maps, there) : mapsTransitUrl(there, point.maps),
    },
    minutes,
  };
}

const METRO_CLOSED_NOTE = 'метро о цій порі не працює (05:30–23:00)';

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

/** Автовокзал Житомира: звідси й сюди їдуть усі рейси на Малин у розкладі сайту */
const ZHYTOMYR_STATION = { name: 'автовокзал Житомир-1', from: 'від автовокзалу Житомир-1', at: 'на автовокзалі Житомир-1', maps: 'Автовокзал Житомир-1, вул. Київська 93, Житомир' };

/** Як назвати місце посадки / висадки в іншому місті: київські точки — з `data/kyiv`, у Житомирі — автовокзал */
function farStopText(trip: IntercityTrip, place: string | null | undefined): { name: string; from: string; at: string } {
  if (trip.far === 'Zhytomyr') return ZHYTOMYR_STATION;
  return kyivStopText(trip.kyivPoint, trip.mode, place ?? 'Київ');
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
    transit: trip.transit,
    routeLabel: trip.corridor === 'to_malyn' ? `${CITY_LABEL[trip.far]} — Малин` : `Малин — ${CITY_LABEL[trip.far]}`,
    priceUah: s.priceUah ?? null,
    phoneOnly: trip.phoneOnly,
    ticketUrl: trip.mode === 'elektrichka' ? s.ticketPurchaseUrl ?? null : null,
    tripNumber: s.tripNumber ?? null,
    later: [],
  };
}

function busTransfers(legs: StoryLeg[]): number {
  return legs.filter((l) => l.kind === 'bus' || l.kind === 'intercity' || l.kind === 'ride' || l.kind === 'metro').length + legs.reduce((n, l) => n + (l.kind === 'city' && l.route ? l.route.steps.filter((x) => x.kind === 'transit').length : 0), 0) - 1;
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
  const fromLabel = shape.detail ? `${CITY_LABEL[shape.far]}, ${shape.detail}` : shape.kyivPoint ? placeLabel(resolvePlace(shape.kyivPoint)!) : CITY_LABEL[shape.far];
  for (const trip of intercityTrips(input.schedules, 'to_malyn', date, shape.far)) {
    if (!modeAllowed(trip.mode, input.intent.modes)) continue;
    const anchor = anchorFor('to_malyn', trip.mode, shape.far);
    // Київ: де сідати людині
    const bp = trip.kyivPoint;
    const user = shape.kyivPoint;
    const boardText = farStopText(trip, trip.schedule.boardingPlace);
    let board = { mins: trip.depMins, approx: false, label: boardText.from };
    let kyivLeg: StoryLeg | null = null;
    let kyivLead = 0;
    if (user && bp && user !== bp) {
      const passes = trip.mode === 'elektrichka' && TRAIN_POS[user] != null && TRAIN_POS[bp] != null && TRAIN_POS[user] > TRAIN_POS[bp];
      if (passes) {
        board = { mins: trip.depMins + TRAIN_POS[user] - TRAIN_POS[bp], approx: true, label: kyivStopText(user, 'elektrichka', '').from };
      } else {
        // людина стартує з іншої точки Києва: історія починається з метро, а не з посадки
        const step = kyivStep(user, bp, 'until', trip.depMins, date, `Доїдьте: ${boardText.name}`);
        kyivLead = step.minutes;
        kyivLeg = step.leg;
      }
    }
    // місце в далекому місті словами: спершу містом до посадки
    const boardPoint = shape.detail ? farPoint(shape.far, bp) : null;
    if (shape.detail && boardPoint) {
      const step = cityStep(input, shape.far, boardPoint, shape.detail, 'until', trip.depMins - CITY_BOARD_BUFFER);
      kyivLeg = step.leg;
      kyivLead = step.minutes ? step.minutes + CITY_BOARD_BUFFER : 0;
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
      // За однакового часу прибуття — де менше пересадок міськими автобусами (вийти раніше й сісти одразу на
      // потрібний), далі — підтверджена зупинка, далі — менше кроків
      const rides = (m: MalynPick) => m.legs.filter((l) => l.kind === 'bus').length;
      const tie = best != null && Math.abs(cand.worst - best.worst) <= 2;
      const better =
        !best ||
        cand.worst < best.worst - 2 ||
        (tie && rides(cand) < rides(best)) ||
        (tie && rides(cand) === rides(best) && cand.a.confirmed && !best.a.confirmed) ||
        (tie && rides(cand) === rides(best) && cand.a.confirmed === best.a.confirmed && cand.legs.length < best.legs.length);
      if (better) best = cand;
    }
    if (!best) continue;
    const ic = intercityLeg(trip, board, { mins: trip.arrMins + best.a.offsetMin, approx: !trip.exact, label: best.a.label }, !best.a.confirmed);
    const legs: StoryLeg[] = [...(kyivLeg ? [kyivLeg] : []), ic, ...best.legs];
    const late = best.legs.some((l) => l.kind === 'walk' && l.late);
    const endLabel = dest.isCity ? `Малин, ${best.a.name}` : placeLabel(dest);
    const story = makeStory(`to-${trip.schedule.id}`, trip.mode, date, fromLabel, placeLabel(dest), legs, {
      leave: board.mins - kyivLead,
      arrive: best.arrive,
      approx: best.approx,
      endLabel,
      endNote: late ? 'міські автобуси вже не ходять' : approxNote(dest),
      price: trip.schedule.priceUah ?? null,
    });
    out.push({ story, mode: trip.mode, leave: board.mins - kyivLead, worst: best.worst, confirmed: best.a.confirmed });
  }
  return out;
}

function fromMalynOptions(input: ComposeInput, shape: Extract<TripShape, { kind: 'from_malyn' }>): Option[] {
  const { planner, date } = input;
  const out: Option[] = [];
  const origin = shape.origin;
  const originSpot = origin.isCity ? null : spotOf(planner, origin);
  const toLabel = shape.detail ? `${CITY_LABEL[shape.far]}, ${shape.detail}` : shape.kyivPoint ? placeLabel(resolvePlace(shape.kyivPoint)!) : CITY_LABEL[shape.far];
  for (const trip of intercityTrips(input.schedules, 'from_malyn', date, shape.far)) {
    if (!modeAllowed(trip.mode, input.intent.modes)) continue;
    const anchor = anchorFor('from_malyn', trip.mode, shape.far);
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
    const alightText = farStopText(trip, trip.schedule.alightingPlace);
    let arrive = trip.arrMins;
    let approx = !trip.exact;
    let endLabel = alightText.name;
    let endNote: string | null = null;
    // де й коли людина виходить із маршрутки / електрички — рядок рейсу; кінець історії може бути далі, після метро
    let alight = { mins: arrive, approx };
    let kyivLeg: StoryLeg | null = null;
    const target = shape.kyivPoint;
    const ap = trip.kyivPoint;
    const alightPoint = shape.detail ? farPoint(shape.far, ap) : null;
    if (shape.detail && alightPoint) {
      // місце в далекому місті словами: кінець історії — воно; без відповіді сервера час лишається до висадки
      const step = cityStep(input, shape.far, alightPoint, shape.detail, 'from', arrive);
      kyivLeg = step.leg;
      endLabel = shape.detail;
      if (step.minutes) {
        arrive += step.minutes;
        approx = true;
      } else {
        endNote = `час — до висадки ${alightText.at}`;
      }
    } else if (target && ap && target !== ap) {
      const passes = trip.mode === 'elektrichka' && TRAIN_POS[target] != null && TRAIN_POS[ap] != null && TRAIN_POS[target] > TRAIN_POS[ap];
      if (passes) {
        arrive = trip.arrMins - (TRAIN_POS[target] - TRAIN_POS[ap]);
        approx = true;
        alight = { mins: arrive, approx };
        endLabel = kyivStopText(target, 'elektrichka', '').name;
      } else {
        // просили іншу точку Києва: кінець історії — вона, з часом на метро; без метро час лишається до висадки
        const step = kyivStep(ap, target, 'from', arrive, date, `Далі до: ${KYIV_POINTS[target]?.label ?? 'місця'}`);
        kyivLeg = step.leg;
        endLabel = KYIV_POINTS[target]?.label ?? endLabel;
        if (step.minutes) {
          arrive += step.minutes;
          approx = true;
        } else {
          endNote = step.closed ? `${METRO_CLOSED_NOTE}; час — до висадки ${alightText.at}` : `час — до висадки ${alightText.at}`;
        }
      }
    } else if (!target && ap) {
      kyivLeg = { kind: 'kyiv', text: 'Далі по Києву', mapsUrl: mapsTransitUrl(KYIV_POINTS[ap]?.mapsQuery ?? null, null) };
    } else if (shape.far === 'Zhytomyr') {
      // місто Житомир ще не в наших даних — далі веде Google Maps
      kyivLeg = { kind: 'kyiv', city: 'Житомир', text: 'Далі по Житомиру', mapsUrl: mapsTransitUrl(ZHYTOMYR_STATION.maps, null) };
    }
    const boardApprox = best.a.offsetMin !== 0;
    const ic = intercityLeg(
      trip,
      { mins: best.board, approx: boardApprox, label: best.a.from },
      { mins: alight.mins, approx: alight.approx, label: alightText.at },
      !best.a.confirmed,
    );
    const legs: StoryLeg[] = [...best.legs, ic, ...(kyivLeg ? [kyivLeg] : [])];
    const story = makeStory(`from-${trip.schedule.id}`, trip.mode, date, placeLabel(origin), toLabel, legs, {
      leave: best.leave,
      arrive,
      approx,
      endLabel: `${CITY_LABEL[shape.far]}, ${endLabel}`,
      endNote,
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

// ─── Попутки серед варіантів ──────────────────────────────────────────────────────────────────

/** Сталий час авто Київ ↔ Малин, коли сервер не сказав свого (TripRoute.carDurationMinutes) */
export const DEFAULT_CAR_MINUTES = 95;
/** Те саме за парою міст: Житомир ↔ Малин авто їде ≈ 1,5 год (Google Routes, 2026-11-17: 88 хв) */
export function defaultCarMinutes(far: FarCity): number {
  return far === 'Zhytomyr' ? 90 : DEFAULT_CAR_MINUTES;
}
/**
 * Водій київської точки не назвав: за архівом приміток (2026-11-16) серед названих 73 % — «Академмістечко».
 * Це підказка, а не факт: поруч завжди «уточніть у водія», підказку метро на ній не будуємо.
 */
const USUAL_KYIV = { from: 'з Києва, зазвичай від метро «Академмістечко»', at: 'у Києві, зазвичай біля метро «Академмістечко»' };
/** Скільки попуток стає варіантами; решта — рядком «ще N на дошці» */
const RIDES_SHOWN = 3;
/** За скільки хвилин до виїзду водія бути на місці посадки */
const RIDE_BOARD_BUFFER = 5;
/** Запас на запізнення водія: для пересадки на міський автобус і для «щоб бути до» */
const RIDE_LATE = 10;
/** Скільки годин виїзду питаємо в сервісу заторів за раз (стільки ж приймає сервер) */
const RIDE_TIMES_ASKED = 6;

export interface DriveEstimate {
  minutes: number;
  /** із заторами (Google) чи сталий час з адмінки */
  traffic: boolean;
}

/**
 * Попутки йдуть у загальну відповідь, коли транспорт не названо або «попутку» названо разом з іншим.
 * Сама «попутка» — це дошка оголошень (poputkyOutcome).
 */
export function ridesWanted(modes: TripMode[]): boolean {
  return modes.length === 0 || (modes.includes('poputka') && modes.length > 1);
}

function listingStart(l: ViberListing): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(l.departureTime ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function rideOf(l: ViberListing): PoputkaRide {
  return { id: l.id, time: l.departureTime, seats: l.seats, priceUah: l.priceUah ?? null, notes: l.notes, name: l.senderName };
}

function activeDrivers(listings: ViberListing[] | undefined): ViberListing[] {
  return (listings ?? []).filter((l) => l.isActive !== false && l.listingType === 'driver');
}

/** Оголошення з часом у вікні пошуку, у порядку, в якому їх варто показувати */
function ridesInWindow(listings: ViberListing[] | undefined, win: SearchWindow): Array<{ l: ViberListing; dep: number }> {
  const timed = activeDrivers(listings)
    .map((l) => ({ l, dep: listingStart(l) }))
    .filter((x): x is { l: ViberListing; dep: number } => x.dep != null && x.dep >= win.start);
  if (win.kind === 'arrive' && win.deadline != null) {
    // «бути до»: найпізніші з тих, що ще можуть встигнути
    return timed.filter((x) => x.dep < win.deadline!).sort((a, b) => b.dep - a.dep || a.l.id - b.l.id);
  }
  return timed.filter((x) => win.end == null || x.dep <= win.end).sort((a, b) => a.dep - b.dep || a.l.id - b.l.id);
}

/** Години виїзду («HH:MM»), для яких сторінка питає час у дорозі перед складанням відповіді */
export function rideDepartures(input: Pick<ComposeInput, 'intent' | 'now' | 'date' | 'listings'>, shape: TripShape = classify(input.intent)): string[] {
  if ((shape.kind !== 'to_malyn' && shape.kind !== 'from_malyn') || !ridesWanted(input.intent.modes)) return [];
  const win = searchWindow(input.intent, input.date, input.now);
  const times = ridesInWindow(input.listings, win).map((x) => clock(x.dep));
  return [...new Set(times)].slice(0, RIDE_TIMES_ASKED);
}

/** Місце посадки / висадки в Малині: з примітки водія, а не названо — центр («зазвичай») */
function malynRidePoint(note: NotePlaces | null, dir: 'to_malyn' | 'from_malyn'): { place: GazetteerPlace | null; stopId: string; assumed: boolean } {
  const named = note?.malyn ? resolvePlace(note.malyn) ?? null : null;
  const stopId = named?.stopIds?.[0];
  if (named && stopId) return { place: named, stopId, assumed: false };
  return { place: CENTRE, stopId: (dir === 'to_malyn' ? RIDE_DROP : RIDE_PICKUP).stopId, assumed: true };
}

function rideStory(input: ComposeInput, shape: Extract<TripShape, { kind: 'to_malyn' | 'from_malyn' }>, l: ViberListing, dep: number): { story: Story; worst: number; traffic: boolean } {
  const { planner, date } = input;
  const drive = input.driveMinutes?.(dep) ?? { minutes: defaultCarMinutes(shape.far), traffic: false };
  const arr = dep + drive.minutes;
  const note = l.notes ? input.notePlaces?.(l.notes, shape.kind) ?? null : null;
  const malyn = malynRidePoint(note, shape.kind);
  const far = shape.far;
  // київські точки з примітки — лише для київського коридору
  const kyiv = far === 'Kyiv' && note?.kyiv && KYIV_POINTS[note.kyiv] ? note.kyiv : null;
  const farUsual = far === 'Kyiv' ? USUAL_KYIV : { from: 'з Житомира', at: 'у Житомирі' };
  const kyivText = kyiv ? kyivStopText(kyiv, 'marshrutka', KYIV_POINTS[kyiv].label) : null;
  const sameMalyn = (p: GazetteerPlace) => p.id === malyn.place?.id || Boolean(p.stopIds?.includes(malyn.stopId));
  const leg = (boardLabel: string, boardAssumed: boolean, alightLabel: string, alightAssumed: boolean): Extract<StoryLeg, { kind: 'ride' }> => ({
    kind: 'ride',
    ride: rideOf(l),
    depMins: dep,
    arrMins: arr,
    driveMinutes: drive.minutes,
    traffic: drive.traffic,
    boardLabel,
    boardAssumed,
    alightLabel,
    alightAssumed,
  });

  if (shape.kind === 'from_malyn') {
    const origin = shape.origin;
    const originSpot = origin.isCity ? null : spotOf(planner, origin);
    // «заберу по місту»: водій підʼїде сам — до центру їхати не треба
    const door = Boolean(note?.door) && malyn.assumed;
    const from = door ? 'по місту — домовтесь, де сісти' : malyn.assumed ? RIDE_PICKUP.from : `від «${placeLabel(malyn.place!)}»`;
    let before: StoryLeg[] = [];
    let leave = dep;
    if (originSpot && !door && !sameMalyn(origin)) {
      const pick = planner ? beforeBoard(planner, originSpot, malyn.stopId, dep - RIDE_BOARD_BUFFER) : null;
      if (pick) {
        before = [...pick.legs, { kind: 'wait', text: `Будьте на місці о ${clock(dep - RIDE_BOARD_BUFFER)} — водій виїжджає о ${clock(dep)}.` }];
        leave = pick.departMins;
      } else {
        before = [{ kind: 'wait', text: 'Міським автобусом до місця посадки в цей час не доїхати — домовтесь із водієм, де сісти.' }];
      }
    }
    const target = shape.kyivPoint;
    let kyivLeg: StoryLeg | null = null;
    let end = arr;
    let endLabel = kyivText ? `Київ, ${kyivText.name}` : CITY_LABEL[far];
    let endNote: string | null = null;
    const dropPoint = shape.detail ? farPoint(far, kyiv ?? null) : null;
    if (shape.detail && dropPoint) {
      const step = cityStep(input, far, dropPoint, shape.detail, 'from', arr);
      kyivLeg = step.leg;
      endLabel = `${CITY_LABEL[far]}, ${shape.detail}`;
      if (step.minutes) end = arr + step.minutes;
      else endNote = `час — до висадки ${kyivText?.at ?? farUsual.at}`;
    } else if (kyiv && target && target !== kyiv) {
      const step = kyivStep(kyiv, target, 'from', arr, date, `Далі до: ${KYIV_POINTS[target]?.label ?? 'місця'}`);
      kyivLeg = step.leg;
      endLabel = `Київ, ${KYIV_POINTS[target]?.label ?? kyivText!.name}`;
      if (step.minutes) end = arr + step.minutes;
      else endNote = step.closed ? `${METRO_CLOSED_NOTE}; час — до висадки ${kyivText!.at}` : `час — до висадки ${kyivText!.at}`;
    } else if (kyiv && !target) {
      kyivLeg = { kind: 'kyiv', text: 'Далі по Києву', mapsUrl: mapsTransitUrl(KYIV_POINTS[kyiv].mapsQuery, null) };
    }
    const legs: StoryLeg[] = [...before, leg(from, malyn.assumed && !door, kyivText?.at ?? farUsual.at, !kyiv), ...(kyivLeg ? [kyivLeg] : [])];
    const story = makeStory(`ride-${l.id}`, 'poputka', date, placeLabel(origin), shape.detail ? `${CITY_LABEL[far]}, ${shape.detail}` : shape.kyivPoint ? placeLabel(resolvePlace(shape.kyivPoint)!) : CITY_LABEL[far], legs, {
      leave,
      arrive: end,
      approx: true,
      endLabel,
      // де висадить у Києві — каже картка попутки («Висадка… уточніть у водія»)
      endNote,
      price: l.priceUah ?? null,
    });
    return { story, worst: end + RIDE_LATE, traffic: drive.traffic };
  }

  // to_malyn: сідаємо в Києві, у Малині — до місця призначення
  const dest = shape.dest;
  const destSpot = spotOf(planner, dest);
  const user = shape.kyivPoint;
  const toRide = kyiv && user && user !== kyiv ? kyivStep(user, kyiv, 'until', dep, date, `Доїдьте: ${kyivText!.name}`) : null;
  const kyivLeg: StoryLeg | null = toRide?.leg ?? null;
  const at = malyn.assumed ? RIDE_DROP.label : `біля «${placeLabel(malyn.place!)}»`;
  let after: StoryLeg[] = [];
  let arrive = arr;
  let worst = arr + RIDE_LATE;
  let endNote: string | null = null;
  if (destSpot && !dest.isCity && !sameMalyn(dest)) {
    const pick = planner ? afterAlight(planner, malyn.stopId, destSpot, arr, arr + RIDE_LATE, 3, true) : null;
    const lateWalk = pick?.legs.find((x) => x.kind === 'walk' && x.late);
    if (lateWalk && lateWalk.kind === 'walk' && lateWalk.minutes > 25) {
      // автобуси вже не ходять, а пішки далеко: на відміну від маршрутки, водія можна попросити довезти
      endNote = 'міські автобуси вже не ходять — попросіть водія довезти до місця';
    } else if (pick) {
      const walk = pick.legs[0]?.kind === 'walk';
      after = [{ kind: 'wait', text: `Попросіть висадити ${at} (${clock(arr, true)}) і ${walk ? 'йдіть пішки' : 'пересядьте на міський автобус'}.` }, ...pick.legs];
      arrive = pick.arriveMins;
      worst = pick.worst;
      if (pick.legs.some((x) => x.kind === 'walk' && x.late)) endNote = 'міські автобуси вже не ходять';
    } else {
      endNote = 'до самого місця домовтесь із водієм';
    }
  }
  const legs: StoryLeg[] = [...(kyivLeg ? [kyivLeg] : []), leg(kyivText?.from ?? farUsual.from, !kyiv, at, malyn.assumed), ...after];
  const story = makeStory(`ride-${l.id}`, 'poputka', date, user ? placeLabel(resolvePlace(user)!) : CITY_LABEL[far], placeLabel(dest), legs, {
    leave: dep - (toRide?.minutes ?? 0),
    arrive,
    approx: true,
    endLabel: dest.isCity ? `Малин, ${malyn.assumed ? RIDE_DROP.name : placeLabel(malyn.place!)}` : placeLabel(dest),
    endNote: endNote ?? approxNote(dest),
    price: l.priceUah ?? null,
  });
  return { story, worst, traffic: drive.traffic };
}

/** До трьох попуток як варіанти поруч із маршруткою й електричкою */
function rideStories(input: ComposeInput, shape: Extract<TripShape, { kind: 'to_malyn' | 'from_malyn' }>, win: SearchWindow): { stories: Story[]; total: number; traffic: boolean } {
  const total = activeDrivers(input.listings).length;
  const stories: Story[] = [];
  let traffic = false;
  for (const { l, dep } of ridesInWindow(input.listings, win)) {
    if (stories.length >= RIDES_SHOWN) break;
    const made = rideStory(input, shape, l, dep);
    // вийти з дому треба було б раніше, ніж «зараз», або до названої години не встигнути — не варіант
    if (made.story.leaveMins < win.start) continue;
    if (win.kind === 'arrive' && win.deadline != null && made.worst > win.deadline) continue;
    stories.push(made.story);
    traffic = traffic || made.traffic;
  }
  return { stories, total, traffic };
}

const POPUTKY_SHOWN = 5;

/** Попутки: оголошення водіїв на цей день, за часом; телефонів тут немає — контакт відкривають на дошці сайту */
function poputkyOutcome(input: ComposeInput, shape: Extract<TripShape, { kind: 'poputky' }>): ComposeOutcome {
  const all = (input.listings ?? []).filter((l) => l.isActive !== false);
  const sorted = all
    .filter((l) => l.listingType === 'driver')
    .sort((a, b) => (a.departureTime ?? '99').localeCompare(b.departureTime ?? '99') || a.id - b.id);
  // «зранку», «після 18» — лише оголошення на цей час; якщо таких немає, показуємо всі за день і кажемо про це
  const { when } = input.intent;
  const startOf = (l: ViberListing) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(l.departureTime ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const [th, tm] = (when.time ?? '').split(':').map(Number);
  const lo = when.time ? (when.kind === 'arrive' ? 0 : th * 60 + tm - 30) : when.part ? partStartMins(when.part) : null;
  const hi = when.time ? (when.kind === 'arrive' ? th * 60 + tm : 24 * 60) : when.part ? partEndMins(when.part) : null;
  const inWindow = lo == null || hi == null ? sorted : sorted.filter((l) => {
    const at = startOf(l);
    return at == null || (at >= lo && at <= hi);
  });
  const drivers = inWindow.length ? inWindow : sorted;
  const offWindow = lo != null && inWindow.length === 0 && sorted.length > 0;
  const q = new URLSearchParams({ type: 'carpool', from: shape.fromCity, to: shape.toCity, date: input.date });
  return {
    kind: 'poputky',
    fromCity: shape.fromCity,
    toCity: shape.toCity,
    fromLabel: CITY_LABEL[shape.fromCity],
    toLabel: CITY_LABEL[shape.toCity],
    rides: drivers.slice(0, POPUTKY_SHOWN).map(rideOf),
    more: Math.max(0, drivers.length - POPUTKY_SHOWN),
    passengers: all.filter((l) => l.listingType === 'passenger').length,
    boardUrl: `/mizhgorodski?${q.toString()}`,
    ...(offWindow ? { notice: 'На цей час оголошень немає — ось усі за день.' } : {}),
  };
}

function priceText(prices: number[]): string | null {
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min} грн` : `${min}–${max} грн`;
}

/** «Скільки коштує»: ціни з розкладу (Schedule.priceUah) і тариф міста з датасету — ШІ цифр не називає */
function priceOutcome(input: ComposeInput, shape: Extract<TripShape, { kind: 'price' }>): ComposeOutcome {
  const lines: PriceLine[] = [];
  if (shape.corridor) {
    const of = (type: string) => input.schedules.filter((s) => s.vehicleType === type).map((s) => s.priceUah).filter((p): p is number => typeof p === 'number' && p > 0);
    const wants = (mode: TripMode) => !input.intent.modes.some((m) => m !== 'city_bus') || input.intent.modes.includes(mode);
    const pair = `${CITY_LABEL[shape.far]} ↔ Малин`;
    const bus = priceText(of('marshrutka'));
    if (wants('marshrutka')) lines.push({ label: `Маршрутка ${pair}`, price: bus, note: bus ? 'за місце, в один бік' : 'ціну уточнюйте на автостанції' });
    // електрички між Малином і Житомиром немає
    if (wants('elektrichka') && shape.far === 'Kyiv') lines.push({ label: `Електричка ${pair}`, price: priceText(of('elektrichka')), note: 'квиток в один бік' });
    if (wants('poputka')) lines.push({ label: 'Попутка', price: 'за домовленістю', note: 'ціну називає водій в оголошенні' });
  }
  if (shape.city) lines.push({ label: 'Міський автобус Малина', price: input.cityFare ? `${input.cityFare} грн` : null, note: 'одна поїздка' });
  return { kind: 'price', lines };
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
  /** оголошення попуток на цю дату з того самого GET /poputky/search */
  listings?: ViberListing[];
  /** ціна проїзду в міському автобусі, грн; null — у даних немає */
  cityFare?: number | null;
  /** скільки авто їде коридором при виїзді о `depMins` (GET /dovede/drive-time); немає — сталі 1 год 35 хв */
  driveMinutes?: (depMins: number) => DriveEstimate;
  /** місця в примітці водія (nlu/notePlaces з індексом зупинок сторінки) */
  notePlaces?: (note: string, dir: NoteDir) => NotePlaces;
  /** дороги містом, які сторінка вже спитала в сервера (ключ — `cityAskKey`); null — спитали, відповіді немає */
  cityRoutes?: ReadonlyMap<string, CityRoute | null>;
}

/** Дороги містом, яких бракує показаним історіям: сторінка питає їх у сервера і складає відповідь ще раз */
export function cityAsks(outcome: ComposeOutcome, known?: ReadonlyMap<string, CityRoute | null>): CityAsk[] {
  if (outcome.kind !== 'stories') return [];
  const out = new Map<string, CityAsk>();
  for (const s of outcome.stories) {
    for (const l of s.legs) {
      if (l.kind === 'city' && !l.route && !known?.has(cityAskKey(l.ask))) out.set(cityAskKey(l.ask), l.ask);
    }
  }
  return [...out.values()];
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
    case 'poputky':
      return poputkyOutcome(input, shape);
    case 'price':
      return priceOutcome(input, shape);
    case 'contact':
      return { kind: 'contact' };
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
  const picked = pickPerMode(options, win);
  const rides = ridesWanted(input.intent.modes) ? rideStories(input, shape, win) : null;
  const stories = [...picked.stories, ...(rides?.stories ?? [])].sort((a, b) => a.arriveMins - b.arriveMins);
  if (!stories.length) return { kind: 'empty', reason: input.date === input.now.date ? 'too_late' : 'no_trips' };
  const askMode = input.intent.modes.length === 0 && new Set(stories.map((s) => s.mode)).size > 1;
  const cities = corridorCities(shape)!;
  const board = new URLSearchParams({ type: 'carpool', from: cities.from, to: cities.to, date: input.date });
  return {
    kind: 'stories',
    stories,
    askMode,
    notice: picked.notice,
    ...(rides && rides.total > 0 ? { rides: { more: rides.total - rides.stories.length, boardUrl: `/mizhgorodski?${board.toString()}`, traffic: rides.traffic } } : {}),
  };
}
