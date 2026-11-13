import type { DayPlan, Endpoint } from '@/pages/LocalTransportPage/journey';
import type { Schedule } from '@/types';
import type { IntercityMode } from '../data/anchors';

/** Міський планувальник Малина на один день (RAPTOR з LocalTransportPage/journey) */
export interface LocalPlanner {
  plan(from: Endpoint, to: Endpoint): DayPlan;
  stopName(stopId: string): string;
  stopCoords(stopId: string): [number, number] | null;
  /** Відправлення маршруту за день, згруповані за кінцевою (usePlannerModel.routeDepartures) */
  routeDepartures?(routeId: string, stopId?: string | null): Array<{ fromStopId: string; towardStopId: string; mins: number[] }>;
}

/** Один напрямок маршруту в картці «Автобус №5» */
export interface RouteBoard {
  fromStopId: string;
  towardStopId: string;
  /** найближчі відправлення (хв від півночі), не більше шести */
  next: number[];
  first: number;
  last: number;
}

export type StoryLeg =
  | {
      kind: 'kyiv';
      /** «метро М1 «Святошин» → «Академмістечко», 2 станції, ≈ 5 хв» */
      text: string;
      mapsUrl: string;
    }
  | {
      kind: 'intercity';
      mode: IntercityMode;
      schedule: Schedule;
      boardLabel: string;
      boardMins: number;
      boardApprox: boolean;
      alightLabel: string;
      alightMins: number;
      alightApprox: boolean;
      /** зупинка-якір не підтверджена власником — «зазвичай» */
      usual: boolean;
      via: string | null;
      priceUah: number | null;
      phoneOnly: boolean;
      ticketUrl: string | null;
      tripNumber: string | null;
      /** наступні рейси того ж виду, «HH:MM» */
      later: string[];
    }
  | {
      kind: 'bus';
      routeId: string;
      fromStopId: string;
      toStopId: string;
      direction: 'there' | 'back';
      depMins: number;
      arrMins: number;
      stops: number;
      /** «Якщо приїдете раніше — №8 о 16:24» */
      note: string | null;
    }
  | {
      kind: 'walk';
      meters: number;
      minutes: number;
      toLabel: string | null;
      /** міські автобуси вже не ходять — довга пішка */
      late: boolean;
    }
  | { kind: 'wait'; text: string };

export interface Story {
  id: string;
  mode: IntercityMode | 'city_bus';
  /** 'YYYY-MM-DD' */
  date: string;
  /** коли вирушати з початкового місця (хв) */
  leaveMins: number;
  arriveMins: number;
  arriveApprox: boolean;
  fromLabel: string;
  toLabel: string;
  legs: StoryLeg[];
  endLabel: string;
  endNote: string | null;
  priceUah: number | null;
  transfers: number;
  /** перше речення історії (narrate.ts) */
  lead: string;
}

export type ComposeOutcome =
  | { kind: 'stories'; stories: Story[]; askMode: boolean; notice: string | null }
  | { kind: 'empty'; reason: 'no_trips' | 'too_late' }
  | { kind: 'ask_from'; destId: string }
  | { kind: 'ask_to' }
  | { kind: 'unknown_place'; words: string[] }
  | { kind: 'outside'; city: string | null }
  | { kind: 'poputka_soon' }
  /** Питання про сам маршрут: кінцеві, найближчі відправлення (з названої зупинки або з кінцевих) */
  | { kind: 'route_info'; routeId: string; no: string; fromName: string; toName: string; atStopId: string | null; atStopLabel: string | null; boards: RouteBoard[] }
  | { kind: 'not_trip'; intent: 'schedule' | 'price' | 'contact' | 'other' };
