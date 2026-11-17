/**
 * Київська частина (Docs/dovede-roadmap.md, «Підказки по Києву»): транспорту Києва в даних немає, тому —
 * короткі «таблички як у Google» з кураторських підказок і посилання на Google Maps у режимі громадського
 * транспорту (Maps URLs, без ключа API).
 */
import { findMetroIn, metroPath, type MetroPath, type MetroSegment } from '../nlu/kyivMetro';
import { METRO_LINE, METRO_SERVICE, METRO_SHUTTLE, metroOpenAt, metroPeriod } from './kyivMetroService';
import { METRO_STATIONS } from '../nlu/kyivMetroData';
import { RING_STATIONS } from '../nlu/kyivRingData';
import { normalizeWord } from '../nlu/normalize';

export interface KyivPoint {
  id: string;
  /** «метро «Святошин»», «платформа «Святошин»» */
  label: string;
  /** назва станції метро, якщо точка — станція */
  metro?: string;
  /** запит для Google Maps */
  mapsQuery: string;
}

/**
 * Точки Києва: усі станції метро (`nlu/kyivMetroData.ts`), станції міської електрички і кілька місць без станції. Вокзал — це і станція
 * «Вокзальна», і приміський вокзал, тому в нього власний підпис.
 */
export const KYIV_POINTS: Record<string, KyivPoint> = {
  // станції міської електрички (`nlu/kyivRingData.ts`); платформа біля метро — окрема точка лише для підпису
  ...Object.fromEntries(RING_STATIONS.map((st) => [st.id, { id: st.id, label: `платформа «${st.name}»`, mapsQuery: `залізнична станція ${st.name}, Київ` }])),
  ...Object.fromEntries(METRO_STATIONS.map((st) => [st.id, { id: st.id, label: `метро «${st.name}»`, metro: st.name, mapsQuery: `метро ${st.name}, Київ` }])),
  'kyiv.pas': { id: 'kyiv.pas', label: 'вокзал Київ-Пасажирський', metro: 'Вокзальна', mapsQuery: 'Приміський вокзал, Київ' },
  'kyiv.borshch': { id: 'kyiv.borshch', label: 'платформа «Борщагівка»', mapsQuery: 'зупинний пункт Борщагівка, Київ' },
  // цирк називають водії попуток у примітках («до Цирку»); станції там немає
  'kyiv.tsyrk': { id: 'kyiv.tsyrk', label: 'цирк', mapsQuery: 'Національний цирк України, Київ' },
};

/** Як назвати місце посадки / висадки: на картці, «звідки» і «де» */
export interface KyivStopText {
  name: string;
  from: string;
  at: string;
}

const MARSH_TEXT: Record<string, KyivStopText> = {
  'kyiv.tsyrk': { name: 'цирк', from: 'від цирку', at: 'біля цирку' },
  'kyiv.pas': { name: 'вокзал Київ-Пасажирський', from: 'від вокзалу Київ-Пасажирський', at: 'біля вокзалу Київ-Пасажирський' },
};

const TRAIN_TEXT: Record<string, KyivStopText> = {
  'kyiv.pas': { name: 'Київ-Пасажирський (Приміський)', from: 'з Київ-Пасажирського', at: 'на Київ-Пасажирському' },
  'kyiv.sviatoshyn': { name: 'платформа «Святошин»', from: 'з платформи «Святошин»', at: 'на платформі «Святошин»' },
  'kyiv.borshch': { name: 'платформа «Борщагівка»', from: 'з платформи «Борщагівка»', at: 'на платформі «Борщагівка»' },
};

export function kyivStopText(pointId: string | null, mode: 'marshrutka' | 'elektrichka', fallback: string): KyivStopText {
  const t = pointId ? (mode === 'elektrichka' ? TRAIN_TEXT : MARSH_TEXT)[pointId] : undefined;
  if (t) return t;
  // станція метро: маршрутки й попутки стають біля неї
  const metro = pointId && mode === 'marshrutka' ? KYIV_POINTS[pointId]?.metro : undefined;
  if (metro) return { name: `метро «${metro}»`, from: `від метро «${metro}»`, at: `біля метро «${metro}»` };
  return { name: fallback, from: `від: ${fallback}`, at: fallback };
}

/**
 * Де електричка Київ — Малин у хвилинах від Київ-Пас. (розклад УЗ, 2026-11-13: Київ-Пас. → Святошин 23–32 хв,
 * Борщагівка — 17). Час у проміжній точці — приблизний.
 */
export const TRAIN_POS: Record<string, number> = { 'kyiv.pas': 0, 'kyiv.borshch': 17, 'kyiv.sviatoshyn': 25 };

/** Точка посадки / висадки в Києві за текстом розкладу або маршрутом (Kyiv-Malyn-Irpin → Академмістечко) */
export function kyivPointForPlace(place: string | null | undefined, route?: string | null): string | null {
  const n = normalizeWord(place ?? '');
  if (n.includes('академ')) return 'kyiv.akadem';
  if (n.includes('святош')) return 'kyiv.sviatoshyn';
  if (n.includes('борщаг')) return 'kyiv.borshch';
  if (n.includes('житомирськ')) return 'kyiv.zhytomyrska';
  if (n.includes('київ-пас') || n.includes('пасаж') || n.includes('приміськ')) return 'kyiv.pas';
  if (route && /-Irpin$/.test(route)) return 'kyiv.akadem';
  if (route && /-Bucha$/.test(route)) return 'kyiv.sviatoshyn';
  return null;
}

/**
 * Точка в Києві з примітки водія попутки: будь-яка станція метро (з описками й розмовними назвами — «Шулявка»,
 * «Аккадемістечко», «ст.м. Героїв Дніпра») і місця без станції, які водії називають самі. Слово «Житомирська»
 * без «м.» / «метро» — це траса, а не станція; «м. Житом.» — станція.
 */
export function kyivNotePoint(note: string | null | undefined): string | null {
  const text = note ?? '';
  const n = normalizeWord(text);
  if (/(^|[^а-яіїєґ])(м|ст\.?\s*м|метро)\.?\s*житом/.test(n)) return 'kyiv.zhytomyrska';
  const station = findMetroIn(text);
  if (station) return station.id;
  if (/(^|[^а-яіїєґ])цирк/.test(n)) return 'kyiv.tsyrk';
  if (n.includes('борщаг')) return 'kyiv.borshch';
  if (n.includes('київ-пас') || n.includes('пасаж') || n.includes('приміськ')) return 'kyiv.pas';
  return null;
}

/** Відрізок поїздки: метро або автобус, що зараз ходить замість нього (`bus` — номер) */
export type TripSegment = MetroSegment & { bus: string | null };

export interface MetroTrip {
  /** «метро М1 «Святошин» → «Вокзальна», 5 станцій, ≈ 20 хв» */
  text: string;
  /** хвилини від входу до виходу: перегони, пересадки, очікування поїзда, вхід і вихід */
  minutes: number;
  segments: TripSegment[];
  transfers: MetroPath['transfers'];
  /** поїзди о цій порі — кожні стільки хвилин */
  headwayMin: number;
  priceUah: number;
  /** о цій порі метро не працює: час не рахуємо, картка каже про це */
  closed: boolean;
}

/** Ділить відрізок там, де поїзди зараз не ходять і працює автобус (`METRO_SHUTTLE`): перегін автобусний, якщо хоч один його кінець — на закритій дільниці */
function splitShuttle(sg: MetroSegment): TripSegment[] {
  const sh = METRO_SHUTTLE;
  if (!sh || sg.line !== sh.line) return [{ ...sg, bus: null }];
  const byBus = (i: number) => sh.stations.includes(sg.stations[i].id) || sh.stations.includes(sg.stations[i + 1].id);
  const out: TripSegment[] = [];
  let start = 0;
  for (let i = 0; i < sg.hops; i++) {
    if (i + 1 < sg.hops && byBus(i + 1) === byBus(i)) continue;
    const stations = sg.stations.slice(start, i + 2);
    out.push({ ...sg, from: stations[0], to: stations[stations.length - 1], hops: stations.length - 1, stations, bus: byBus(i) ? sh.bus : null });
    start = i + 1;
  }
  return out;
}

function stationsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'станція';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'станції';
  return 'станцій';
}

/**
 * Дорога метро між двома точками Києва; null — одна з точок не на метро. `at` — коли людина заходить у метро
 * (хв від півночі й дата): від цього залежать інтервал поїздів і чи метро взагалі працює. Без `at` — денний час.
 */
export function metroTrip(fromId: string, toId: string, at?: { mins: number; date: string }): MetroTrip | null {
  const path = metroPath(fromId, toId);
  const a = KYIV_POINTS[fromId]?.metro;
  const b = KYIV_POINTS[toId]?.metro;
  if (!path || !a || !b) return null;
  const S = METRO_SERVICE;
  const headway = S.headwaySeconds[at ? metroPeriod(at.mins, at.date) : 'day'];
  const segments = path.segments.flatMap(splitShuttle);
  // на кожній посадці в поїзд чекаємо в середньому пів інтервалу; автобус-замінник — свій час і своє очікування
  const seconds =
    segments.reduce((n, sg) => n + (sg.bus ? sg.hops * METRO_SHUTTLE!.hopSeconds + METRO_SHUTTLE!.waitSeconds : sg.hops * S.hopSeconds[sg.line] + headway / 2), 0) +
    path.transfers.length * S.transferSeconds +
    S.accessSeconds;
  const minutes = Math.round(seconds / 60);
  const closed = at ? !metroOpenAt(at.mins) || !metroOpenAt(at.mins + minutes) : false;
  const bus = segments.find((sg) => sg.bus);
  const line = path.transfers.length || bus ? '' : ` ${METRO_LINE[path.segments[0].line].no}`;
  const change = path.transfers.map((t) => `, пересадка «${t.from.name}» → «${t.to.name}»`).join('');
  const shuttle = bus ? `, від «${bus.from.name}» до «${bus.to.name}» — автобус №${bus.bus} замість метро` : '';
  return {
    text: `метро${line} «${a}» → «${b}», ${path.hops} ${stationsWord(path.hops)}${change}${shuttle}, ≈ ${minutes} хв`,
    minutes,
    segments,
    transfers: path.transfers,
    headwayMin: Math.round(headway / 60),
    priceUah: S.fareUah,
    closed,
  };
}

/** Лише текст підказки (див. `metroTrip`) */
export function metroHint(fromId: string, toId: string): string | null {
  return metroTrip(fromId, toId)?.text ?? null;
}

/** Маршрут громадським транспортом у Google Maps (Maps URLs) */
export function mapsTransitUrl(origin: string | null, destination: string | null): string {
  const p = new URLSearchParams({ api: '1', travelmode: 'transit' });
  if (origin) p.set('origin', origin);
  if (destination) p.set('destination', destination);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}
