/**
 * Якорі — де міжміський рейс торкається зупинок Малина (Docs/dovede-roadmap.md, «Якорі v1»).
 * Зі слів власника (2026-11-13): маршрутка з Києва заїжджає біля ПТЛ, іде вулицею Бандери до центру,
 * головна зупинка — «Промінь»; у дорозі зазвичай 1 год 30 хв, максимум 1 год 37 хв, у пʼятницю ввечері з
 * Києва — до 1 год 40 хв; на маршрутку в Київ — бути щонайменше за 10 хв. Хвилини між точками — із
 * сегментів міських №7/№8. `confirmed: false` → історія каже «зазвичай».
 */
export const ANCHORS_VERSION = 3;

export type Corridor = 'to_malyn' | 'from_malyn';
export type IntercityMode = 'marshrutka' | 'elektrichka';
/** Місто на іншому кінці коридору: рідне місто сайту — Малин */
export type FarCity = 'Kyiv' | 'Zhytomyr' | 'Korosten';

export interface AnchorStop {
  /** id словника місць */
  placeId: string;
  /** зупинка, від якої (до якої) рахує планувальник; немає — місце без міської зупинки, тоді є `latLng` */
  stopId?: string;
  /**
   * Місце, де маршрутка бере людей, а міські автобуси не стають (навпроти музичної школи): планувальник веде туди
   * пішки від найближчих зупинок. Лише разом із відсутнім `stopId`
   */
  latLng?: [number, number];
  /** де виходити / сідати: «біля ПТЛ», «у центрі, біля РБК» */
  label: string;
  /** назва на картці й у кроці «пішки до …»: «ПТЛ», «Автостанція» */
  name: string;
  /** звідки відправлення: «з автостанції» */
  from: string;
  /** хв відносно прибуття в центр / на вокзал (to_malyn) або відправлення (from_malyn) */
  offsetMin: number;
  confirmed: boolean;
}

export interface IntercityAnchor {
  /** інше місто коридору; немає — Київ */
  far?: FarCity;
  corridor: Corridor;
  mode: IntercityMode;
  stops: AnchorStop[];
  /** коли в розкладі немає arrivalTime / durationMinutes */
  duration: { typical: number; max: number; peakMax?: number };
  bufferBeforeBoard: number;
  bufferAfterAlight: number;
}

const PTL: AnchorStop = { placeId: 'malyn.ptl', stopId: 'st_0079', label: 'біля ПТЛ', name: 'ПТЛ', from: 'від ПТЛ', offsetMin: -8, confirmed: true };
// Слова власника (2026-11-17): з Києва в центрі висаджують на зупинці біля РБК (пл. Соборна)
const CENTRE_IN: AnchorStop = { placeId: 'malyn.tsentr', stopId: 'st_0070', label: 'у центрі, біля РБК', name: 'Центр, пл. Соборна (РБК)', from: 'з центру, від РБК', offsetMin: 0, confirmed: true };
const STATION_IN: AnchorStop = { placeId: 'malyn.avtostantsiya', stopId: 'st_0004', label: 'на автостанції', name: 'Автостанція', from: 'з автостанції', offsetMin: 4, confirmed: false };
const VOKZAL: AnchorStop = { placeId: 'malyn.vokzal', stopId: 'st_0019', label: 'на вокзалі', name: 'Залізничний вокзал', from: 'з вокзалу', offsetMin: 0, confirmed: true };
const STATION_OUT: AnchorStop = { placeId: 'malyn.avtostantsiya', stopId: 'st_0004', label: 'на автостанції', name: 'Автостанція', from: 'з автостанції', offsetMin: 0, confirmed: true };
// Слова власника (2026-11-18): маршрутка на Київ іде з автостанції й у центрі бере людей не біля «Промінь», а навпроти
// музичної школи (пл. Соборна, 6 — у OSM «Малинська дитяча школа мистецтв»), на боці площі. Міські автобуси там не
// стають, тож це точка, а не зупинка: найближчі — «маркет «Соборний»» (≈ 35 м, через дорогу), біля РБК (≈ 95 м),
// «Промінь» (≈ 150 м). Хвилини від автостанції — оцінка (≈)
const CENTRE_OUT: AnchorStop = {
  placeId: 'malyn.tsentr',
  latLng: [50.768095, 29.241325],
  label: 'у центрі, навпроти музичної школи (на боці площі)',
  name: 'пл. Соборна, навпроти музичної школи',
  from: 'з центру, навпроти музичної школи',
  offsetMin: 5,
  confirmed: true,
};

// Житомирські рейси в Малині: вʼїзд з півдня через Іршу → вул. Чорновола → центр (РБК) → автостанція, і назад
const ZT_ENTRY_IN: AnchorStop = { placeId: 'st_0092', stopId: 'st_0092', label: 'на вул. Чорновола, одразу за мостом через Іршу', name: 'вул. Чорновола', from: 'з вул. Чорновола', offsetMin: -8, confirmed: false };
const ZT_RBK_IN: AnchorStop = { placeId: 'malyn.tsentr', stopId: 'st_0070', label: 'у центрі, біля РБК', name: 'Центр, пл. Соборна (РБК)', from: 'з центру, від РБК', offsetMin: -3, confirmed: false };
const ZT_RBK_OUT: AnchorStop = { placeId: 'malyn.tsentr', stopId: 'st_0070', label: 'у центрі, біля РБК', name: 'Центр, пл. Соборна (РБК)', from: 'з центру, від РБК', offsetMin: 3, confirmed: false };
const ZT_ENTRY_OUT: AnchorStop = { placeId: 'st_0091', stopId: 'st_0091', label: 'на вул. Чорновола, перед мостом через Іршу', name: 'вул. Чорновола', from: 'з вул. Чорновола, перед мостом через Іршу', offsetMin: 8, confirmed: false };

export const ANCHORS: IntercityAnchor[] = [
  {
    corridor: 'to_malyn',
    mode: 'marshrutka',
    stops: [PTL, CENTRE_IN, STATION_IN],
    duration: { typical: 90, max: 97, peakMax: 100 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    corridor: 'to_malyn',
    mode: 'elektrichka',
    stops: [VOKZAL],
    duration: { typical: 140, max: 146 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    corridor: 'from_malyn',
    mode: 'marshrutka',
    stops: [STATION_OUT, CENTRE_OUT],
    duration: { typical: 90, max: 97 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    corridor: 'from_malyn',
    mode: 'elektrichka',
    stops: [VOKZAL],
    duration: { typical: 125, max: 160 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  // Житомир ↔ Малин (2026-11-17). У розкладі сайту посадка в Малині — «Автостанція Малин», у Житомирі —
  // «Автовокзал Житомир-1». Слова власника: автобус заїжджає в місто через Іршу, тож вийти можна раніше й пересісти
  // на №11/1 та інші; біля РБК він теж може зупинитись. Тому точок три: південний вʼїзд (вул. Чорновола — за даними
  // датасету, власник ще підтвердить саму зупинку), пл. Соборна біля РБК і автостанція. Перші дві — «зазвичай».
  // Хвилини — від прибуття на автостанцію (відправлення з неї). Тривалість — для рейсів з Малина без часу прибуття
  // (уточнюється за шляхом у compose/intercity.ts)
  {
    far: 'Zhytomyr',
    corridor: 'to_malyn',
    mode: 'marshrutka',
    stops: [ZT_ENTRY_IN, ZT_RBK_IN, STATION_OUT],
    duration: { typical: 90, max: 170 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    far: 'Zhytomyr',
    corridor: 'from_malyn',
    mode: 'marshrutka',
    stops: [STATION_OUT, ZT_RBK_OUT, ZT_ENTRY_OUT],
    duration: { typical: 90, max: 170 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  // Коростень ↔ Малин (2026-11-18, слова власника: і електричка, і маршрутка в Коростені — на вокзалі). У розкладі
  // сайту між містами лише електрички, у Малині — вокзал, як для Києва. Без часу прибуття (20:48) — з розкиду
  // розкладу: 48–68 хв
  {
    far: 'Korosten',
    corridor: 'to_malyn',
    mode: 'elektrichka',
    stops: [VOKZAL],
    duration: { typical: 66, max: 70 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    far: 'Korosten',
    corridor: 'from_malyn',
    mode: 'elektrichka',
    stops: [VOKZAL],
    duration: { typical: 67, max: 70 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
];

/** Вокзал Коростеня: сюди приходять електрички з Малина й маршрутки (слова власника); id зупинки в датасеті Коростеня */
export const KOROSTEN_STATION = {
  stopId: 'st_1001',
  name: 'вокзал',
  from: 'з вокзалу Коростеня',
  at: 'на вокзалі Коростеня',
} as const;

/** Якір коридору; null — такого виду транспорту на цьому коридорі немає (електричка на Житомир) */
export function findAnchor(corridor: Corridor, mode: IntercityMode, far: FarCity = 'Kyiv'): IntercityAnchor | null {
  return ANCHORS.find((x) => x.corridor === corridor && x.mode === mode && (x.far ?? 'Kyiv') === far) ?? null;
}

export function anchorFor(corridor: Corridor, mode: IntercityMode, far: FarCity = 'Kyiv'): IntercityAnchor {
  const a = findAnchor(corridor, mode, far);
  if (!a) throw new Error(`no anchor for ${far}/${corridor}/${mode}`);
  return a;
}

/** Пʼятниця ввечері з Києва — затор у місті (слова власника) */
export function isPeak(corridor: Corridor, isoDate: string, depMins: number): boolean {
  if (corridor !== 'to_malyn') return false;
  const [y, m, d] = isoDate.split('-').map(Number);
  const friday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5;
  return friday && depMins >= 15 * 60 && depMins <= 20 * 60;
}
