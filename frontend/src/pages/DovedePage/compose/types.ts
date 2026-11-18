import type { DayPlan, Endpoint } from '@/pages/LocalTransportPage/journey';
import type { Schedule } from '@/types';
import type { IntercityMode } from '../data/anchors';
import type { TripSegment } from '../data/kyiv';
import type { RingRide } from '../data/kyivRing';
import type { MetroStation } from '../nlu/kyivMetroData';

/** Міський планувальник одного міста на один день (RAPTOR з LocalTransportPage/journey) */
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
      /** місто підказки для заголовка; немає — Київ */
      city?: string;
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
      /** «транзит на Хмільник», «транзит з Вінниці» */
      transit: string | null;
      /** «Малин — Житомир» */
      routeLabel: string;
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
      /**
       * Місто автобуса, коли воно не місто сторінки (Коростень в історії з Малина): номер, колір і посилання на рейс —
       * цього міста, назви зупинок — `fromName` / `toName`
       */
      city?: string;
      fromName?: string;
      toName?: string;
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
  | {
      /** Міська електричка Києва (Kyiv City Express): рейс із розкладу (data/kyivRing) — час точний */
      kind: 'ring';
      ride: RingRide;
      depMins: number;
      arrMins: number;
      /** пішки від метро до платформи перед посадкою / від платформи до метро після виходу, хв (0 — не треба) */
      walkBeforeMin: number;
      walkAfterMin: number;
      /** наступні рейси тієї ж пари станцій, хв */
      later: number[];
      priceUah: number;
      mapsUrl: string;
    }
  | {
      /**
       * Містом (Київ, Житомир) до місця, названого словами: кроки віддає сервер (GET /dovede/city-route) —
       * зі своєї бази або щойно від Google. `route: null` — відповіді ще немає або її немає зовсім: тоді це
       * кнопка Google Maps.
       */
      kind: 'city';
      city: CityCode;
      cityName: string;
      ask: CityAsk;
      fromLabel: string;
      toLabel: string;
      route: CityRoute | null;
      depMins: number | null;
      arrMins: number | null;
      mapsUrl: string;
    }
  | { kind: 'wait'; text: string };

export type CityCode = 'Kyiv' | 'Zhytomyr';

/** Що питаємо в сервера: точка — id («zhytomyr.avtovokzal», «kyiv.akadem») або слова людини */
export interface CityAsk {
  city: CityCode;
  from: string;
  to: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' — коли людина вирушає містом */
  time: string;
}

export const cityAskKey = (a: CityAsk): string => [a.city, a.from, a.to, a.date, a.time].join('|');

/** Крок містом — той самий контракт, що `CityStep` у backend/src/dovede/city-route.ts */
export interface CityStep {
  kind: 'transit' | 'walk';
  minutes: number;
  meters?: number;
  /** BUS | TROLLEYBUS | TRAM | SUBWAY | SHARE_TAXI … */
  mode?: string;
  line?: string;
  agency?: string;
  color?: string;
  headsign?: string;
  fromStop?: string;
  toStop?: string;
  stops?: number;
  headwayMin?: number;
  /** 'HH:MM' — відправлення з розкладу (лише власні дані: Житомир із zt.rozklad.in.ua) */
  departs?: string;
}

export interface CityRoute {
  /** google — щойно від Google; stored — з нашої бази (до 30 днів); own — дані власника */
  source: 'google' | 'stored' | 'own';
  fromLabel: string;
  toLabel: string;
  steps: CityStep[];
  minutes: number;
  /** ISO: коли це перевірено */
  fetchedAt: string;
}

export interface Story {
  id: string;
  /** kyiv — поїздка в межах Києва: метро й міська електричка; city — у межах Києва чи Житомира до місця словами */
  mode: IntercityMode | 'city_bus' | 'poputka' | 'kyiv' | 'city';
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
  /** У межах одного міста (Київ, Житомир) сервер дороги не дав: лишається посилання на Google Maps */
  | { kind: 'city_link'; cityName: string; fromLabel: string; toLabel: string; mapsUrl: string }
  /** Попутки на цей день: оголошення водіїв з дошки сайту; контакт — на дошці */
  | { kind: 'poputky'; fromCity: string; toCity: string; fromLabel: string; toLabel: string; rides: PoputkaRide[]; more: number; passengers: number; boardUrl: string; notice?: string }
  /** «Скільки коштує»: ціни з розкладу сайту й тарифу міста */
  | { kind: 'price'; lines: PriceLine[] }
  /** «Телефон»: куди дзвонити */
  | { kind: 'contact' }
  /** Питання про сам маршрут: кінцеві, найближчі відправлення (з названої зупинки або з кінцевих) */
  | { kind: 'route_info'; atStopId: string | null; atStopLabel: string | null; items: RouteInfoItem[] }
  | { kind: 'not_trip'; intent: 'schedule' | 'other' };
