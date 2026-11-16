/**
 * Київська частина (Docs/dovede-roadmap.md, «Підказки по Києву»): транспорту Києва в даних немає, тому —
 * короткі «таблички як у Google» з кураторських підказок і посилання на Google Maps у режимі громадського
 * транспорту (Maps URLs, без ключа API).
 */
import { findMetroIn, metroPath, metroStation } from '../nlu/kyivMetro';
import { METRO_STATIONS } from '../nlu/kyivMetroData';
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
 * Точки Києва: усі станції метро (`nlu/kyivMetroData.ts`) і кілька місць без станції. Вокзал — це і станція
 * «Вокзальна», і приміський вокзал, тому в нього власний підпис.
 */
export const KYIV_POINTS: Record<string, KyivPoint> = {
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

export interface MetroTrip {
  /** «метро М1 «Святошин» → «Вокзальна», 5 станцій, ≈ 15 хв» */
  text: string;
  /** хвилини разом із входом і виходом — на стільки зсувається час історії */
  minutes: number;
}

function stationsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'станція';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'станції';
  return 'станцій';
}

/** Дорога метро між двома точками Києва: текст підказки й хвилини; null — одна з точок не на метро */
export function metroTrip(fromId: string, toId: string): MetroTrip | null {
  const path = metroPath(fromId, toId);
  const a = KYIV_POINTS[fromId]?.metro;
  const b = KYIV_POINTS[toId]?.metro;
  if (!path || !a || !b) return null;
  const line = path.transfers.length ? '' : ` ${metroStation(fromId)!.line.replace('M', 'М')}`;
  const change = path.transfers.map((t) => `, пересадка «${t.from.name}» → «${t.to.name}»`).join('');
  return { text: `метро${line} «${a}» → «${b}», ${path.hops} ${stationsWord(path.hops)}${change}, ≈ ${path.minutes} хв`, minutes: path.minutes };
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
