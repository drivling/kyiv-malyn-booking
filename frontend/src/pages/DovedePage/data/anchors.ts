/**
 * Якорі — де міжміський рейс торкається зупинок Малина (Docs/dovede-roadmap.md, «Якорі v1»).
 * Зі слів власника (2026-11-13): маршрутка з Києва заїжджає біля ПТЛ, іде вулицею Бандери до центру,
 * головна зупинка — «Промінь»; у дорозі зазвичай 1 год 30 хв, максимум 1 год 37 хв, у пʼятницю ввечері з
 * Києва — до 1 год 40 хв; на маршрутку в Київ — бути щонайменше за 10 хв. Хвилини між точками — із
 * сегментів міських №7/№8. `confirmed: false` → історія каже «зазвичай».
 */
export const ANCHORS_VERSION = 2;

export type Corridor = 'to_malyn' | 'from_malyn';
export type IntercityMode = 'marshrutka' | 'elektrichka';
/** Місто на іншому кінці коридору: рідне місто сайту — Малин */
export type FarCity = 'Kyiv' | 'Zhytomyr';

export interface AnchorStop {
  /** id словника місць */
  placeId: string;
  /** зупинка, від якої (до якої) рахує планувальник */
  stopId: string;
  /** де виходити / сідати: «біля ПТЛ», «у центрі, біля «Промінь»» */
  label: string;
  /** назва на картці: «ПТЛ», «Автостанція» */
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
// Слова власника (2026-11-17): з Києва в центрі висаджують на зупинці біля РБК (пл. Соборна), а сідають на Київ —
// від «Промінь». Зупинки сусідні (≈ 120 м), але міські автобуси від них різні
const CENTRE_IN: AnchorStop = { placeId: 'malyn.tsentr', stopId: 'st_0070', label: 'у центрі, біля РБК', name: 'Центр, пл. Соборна (РБК)', from: 'з центру, від РБК', offsetMin: 0, confirmed: true };
const STATION_IN: AnchorStop = { placeId: 'malyn.avtostantsiya', stopId: 'st_0004', label: 'на автостанції', name: 'Автостанція', from: 'з автостанції', offsetMin: 4, confirmed: false };
const VOKZAL: AnchorStop = { placeId: 'malyn.vokzal', stopId: 'st_0019', label: 'на вокзалі', name: 'Залізничний вокзал', from: 'з вокзалу', offsetMin: 0, confirmed: true };
const STATION_OUT: AnchorStop = { placeId: 'malyn.avtostantsiya', stopId: 'st_0004', label: 'на автостанції', name: 'Автостанція', from: 'з автостанції', offsetMin: 0, confirmed: true };
const CENTRE_OUT: AnchorStop = { placeId: 'malyn.tsentr', stopId: 'st_0049', label: 'у центрі, біля «Промінь»', name: 'Центр, «Промінь»', from: 'з центру, від «Промінь»', offsetMin: 5, confirmed: false };

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
  // Житомир ↔ Малин (2026-11-17): у розкладі сайту посадка в Малині — «Автостанція Малин», у Житомирі —
  // «Автовокзал Житомир-1». Чи заїжджають рейси в центр Малина — невідомо, тому якір один. Тривалість — для
  // рейсів з Малина, де в розкладі немає часу прибуття (уточнюється за шляхом у compose/intercity.ts)
  {
    far: 'Zhytomyr',
    corridor: 'to_malyn',
    mode: 'marshrutka',
    stops: [STATION_OUT],
    duration: { typical: 90, max: 170 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
  {
    far: 'Zhytomyr',
    corridor: 'from_malyn',
    mode: 'marshrutka',
    stops: [STATION_OUT],
    duration: { typical: 90, max: 170 },
    bufferBeforeBoard: 10,
    bufferAfterAlight: 3,
  },
];

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
