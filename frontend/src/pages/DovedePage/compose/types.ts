import type { DayPlan, Endpoint } from '@/pages/LocalTransportPage/journey';
import type { Schedule } from '@/types';
import type { IntercityMode } from '../data/anchors';
import type { TripSegment } from '../data/kyiv';
import type { MetroStation } from '../nlu/kyivMetroData';

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
  | {
      /** Попутка: оголошення водія. Час прибуття завжди приблизний — виїзд + час у дорозі авто */
      kind: 'ride';
      ride: PoputkaRide;
      depMins: number;
      arrMins: number;
      driveMinutes: number;
      /** час у дорозі пораховано із заторами (Google), а не сталий з адмінки */
      traffic: boolean;
      /** «з центру, від «Промінь»», «від метро «Академмістечко»» */
      boardLabel: string;
      /** водій місця посадки не назвав — це припущення («зазвичай із центру») */
      boardAssumed: boolean;
      alightLabel: string;
      alightAssumed: boolean;
    }
  | {
      /** Київське метро: свої дані (nlu/kyivMetroData, data/kyivMetroService). Час — завжди приблизний */
      kind: 'metro';
      segments: TripSegment[];
      transfers: Array<{ from: MetroStation; to: MetroStation }>;
      /** від входу до виходу, хв */
      minutes: number;
      depMins: number;
      arrMins: number;
      headwayMin: number;
      priceUah: number;
      /** о цій порі метро не працює — час не враховано */
      closed: boolean;
      mapsUrl: string;
    }
  | { kind: 'wait'; text: string };

export interface Story {
  id: string;
  mode: IntercityMode | 'city_bus' | 'poputka';
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

/** Один маршрут у картці маршрутів: номер, кінцеві, найближчі відправлення */
export interface RouteInfoItem {
  routeId: string;
  no: string;
  fromName: string;
  toName: string;
  boards: RouteBoard[];
}

/** Оголошення водія на дошці попуток — без телефону: контакт людина відкриває на дошці */
export interface PoputkaRide {
  id: number;
  /** як написав водій: «18:00», «18:00-19:00»; null — час не вказано */
  time: string | null;
  seats: number | null;
  priceUah: number | null;
  notes: string | null;
  name: string | null;
}

export interface PriceLine {
  /** «Маршрутка Київ ↔ Малин» */
  label: string;
  /** «310 грн», «60–75 грн»; null — ціни в даних немає */
  price: string | null;
  note?: string;
}

export type ComposeOutcome =
  | {
      kind: 'stories';
      stories: Story[];
      askMode: boolean;
      notice: string | null;
      /** попутки серед варіантів: скільки ще оголошень водіїв на дошці і чи враховано затори */
      rides?: { more: number; boardUrl: string; traffic: boolean };
    }
  | { kind: 'empty'; reason: 'no_trips' | 'too_late' }
  | { kind: 'ask_from'; destId: string }
  | { kind: 'ask_to' }
  | { kind: 'unknown_place'; words: string[] }
  | { kind: 'outside'; city: string | null }
  /** Попутки на цей день: оголошення водіїв з дошки сайту; контакт — на дошці */
  | { kind: 'poputky'; fromCity: string; toCity: string; fromLabel: string; toLabel: string; rides: PoputkaRide[]; more: number; passengers: number; boardUrl: string; notice?: string }
  /** «Скільки коштує»: ціни з розкладу сайту й тарифу міста */
  | { kind: 'price'; lines: PriceLine[] }
  /** «Телефон»: куди дзвонити */
  | { kind: 'contact' }
  /** Питання про сам маршрут: кінцеві, найближчі відправлення (з названої зупинки або з кінцевих) */
  | { kind: 'route_info'; atStopId: string | null; atStopLabel: string | null; items: RouteInfoItem[] }
  | { kind: 'not_trip'; intent: 'schedule' | 'other' };
