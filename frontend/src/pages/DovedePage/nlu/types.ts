/**
 * «Доведе» — результат розуміння питання (Docs/dovede-roadmap.md, «Контракти»).
 * Той самий контракт віддасть і Claude у фазі 2; числа (час, ціни, номери) сюди не потрапляють — лише намір.
 */
export type TripMode = 'marshrutka' | 'elektrichka' | 'poputka' | 'city_bus';

export type TripDay = 'today' | 'tomorrow' | string; // 'YYYY-MM-DD' для конкретної дати

export interface TripWhen {
  day: TripDay;
  /** 'HH:MM' за Києвом */
  time?: string;
  /** «о 8» — відправлення, «щоб бути до 9» — прибуття */
  kind: 'depart' | 'arrive' | 'any';
  /** зранку 05–11, вдень 11–17, ввечері 17–23 */
  part?: 'morning' | 'day' | 'evening';
}

export interface PlaceRef {
  /** id словника: city.Kyiv, kyiv.akadem, malyn.vokzal… */
  id: string;
  /** як написала людина */
  text: string;
  /** місце всередині Києва чи Житомира, якого немає у словнику («Польова 12», «Охматдит»); лише з id міста */
  detail?: string;
}

export interface TripIntent {
  /** route — питання про сам маршрут («куди їде №5», «коли 9-ка з Царського села») */
  intent: 'trip' | 'schedule' | 'route' | 'price' | 'contact' | 'other';
  from: PlaceRef | null;
  to: PlaceRef | null;
  when: TripWhen;
  /** [] — будь-яким транспортом */
  modes: TripMode[];
  /** id маршрутів міських автобусів, які назвала людина («№5», «9-ка»); немає — будь-яким */
  routes?: string[];
  /** id маршрутів, якими людина їхати не хоче («крім сімки», «тільки не №5») */
  avoidRoutes?: string[];
  /** слова про місця, яких немає в словнику */
  unknown: string[];
  confidence: 'high' | 'medium' | 'low';
}

export type SpanKind = 'from' | 'to' | 'when' | 'mode' | 'unknown';

/** Що саме в тексті розпізнано (для підсвічування в полі у фазі 3) */
export interface ParseSpan {
  start: number;
  end: number;
  kind: SpanKind;
}

export interface LocalParse {
  intent: TripIntent;
  spans: ParseSpan[];
  /** день названо явно (а не «сьогодні» за замовчуванням) */
  dayGiven: boolean;
  /** незнайоме слово стоїть на місці «звідки» чи «куди» */
  unknownRole: 'from' | 'to' | null;
}

/** «Зараз» за Києвом — розбір чистий, годинник передають ззовні */
export interface KyivNow {
  /** 'YYYY-MM-DD' */
  date: string;
  /** хвилини від півночі */
  mins: number;
}

/** Відповідь POST /dovede/understand (фаза 2) */
export interface DovedeUnderstanding {
  intent: TripIntent;
  /** чи збігся розбір Claude з місцевим (null — сервер не мав з чим порівняти) */
  agree: boolean | null;
  model: string;
  latencyMs: number;
}
