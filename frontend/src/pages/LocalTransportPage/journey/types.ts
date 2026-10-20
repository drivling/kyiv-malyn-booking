/**
 * Типи рушія поїздок з пересадками (RAPTOR). Час — цілі хвилини від півночі дня пошуку.
 * Рушій чистий: без React, localStorage й мережі — працює офлайн над тим самим датасетом, що й сайт.
 */
import type { JourneyOptions } from './options';

export type RouteDirection = 'there' | 'back';

/** Зупинка в розкладі. Без координат (lat/lng відсутні) пішки з неї й до неї не ходимо. */
export interface TimetableStop {
  id: string;
  lat?: number;
  lng?: number;
}

/** Рейс у патерні: час на кожній зупинці патерна (хв від півночі, не спадає). */
export interface PatternTrip {
  tripId: string;
  times: number[];
}

/**
 * Патерн RAPTOR: послідовність пасажирських зупинок одного маршруту (напрямок + варіант шляху + зріз start/end).
 * Рейси впорядковані за відправленням і не обганяють один одного (FIFO) — інакше патерн ділиться.
 */
export interface Pattern {
  routeId: string;
  direction: RouteDirection;
  variantId: string | null;
  /** Індекси в Timetable.stops */
  stops: number[];
  trips: PatternTrip[];
}

export interface Footpath {
  to: number;
  /** Хвилини з урахуванням нижньої межі minTransferMin */
  minutes: number;
  /** Орієнтовна довжина пішки, м (по прямій × detourFactor) */
  meters: number;
}

export interface Timetable {
  stops: TimetableStop[];
  stopIndex: Map<string, number>;
  patterns: Pattern[];
  /** Для кожної зупинки: у яких патернах і на якій позиції вона стоїть */
  patternsAtStop: Array<Array<{ pattern: number; pos: number }>>;
  footpaths: Footpath[][];
  options: JourneyOptions;
}

/** Кінець маршруту: зупинка або довільна точка (геолокація, клік на карті). */
export type Endpoint = { kind: 'stop'; stopId: string } | { kind: 'point'; lat: number; lng: number };

/** Місце на краю пішого відрізка */
export type Place = { stopId: string } | { lat: number; lng: number };

export interface WalkLeg {
  kind: 'walk';
  from: Place;
  to: Place;
  depMins: number;
  arrMins: number;
  meters: number;
}

export interface TransitLeg {
  kind: 'transit';
  routeId: string;
  tripId: string;
  direction: RouteDirection;
  variantId: string | null;
  boardStopId: string;
  alightStopId: string;
  depMins: number;
  arrMins: number;
  /** Зупинки від посадки до висадки включно */
  stopIds: string[];
  /** Час на кожній із stopIds */
  stopTimes: number[];
  /** Для legAlternatives: який патерн і який рейс у ньому, позиції посадки/висадки */
  patternIndex: number;
  tripIndex: number;
  boardPos: number;
  alightPos: number;
}

export type Leg = WalkLeg | TransitLeg;

export interface Journey {
  legs: Leg[];
  /** Коли людина вирушає з початкового місця */
  departMins: number;
  /** Коли вона на місці призначення */
  arriveMins: number;
  transfers: number;
  walkMeters: number;
  /** Очікування між відрізками, хв (без пішого часу) */
  waitMins: number;
}

/** Піший маршрут «напряму», без транспорту (для точок і близьких зупинок) */
export interface DirectWalk {
  meters: number;
  minutes: number;
}

export interface DayPlan {
  /** Недомінувані поїздки дня: Парето за (відправлення ↑, прибуття ↓, пересадки ↓), за відправленням */
  journeys: Journey[];
  directWalk: DirectWalk | null;
}

/** Наступний рейс того самого патерна (аналог numLegAlternatives у MOTIS) */
export interface LegAlternative {
  tripId: string;
  depMins: number;
  arrMins: number;
}
