/**
 * Київська частина (Docs/dovede-roadmap.md, «Підказки по Києву»): транспорту Києва в даних немає, тому —
 * короткі «таблички як у Google» з кураторських підказок і посилання на Google Maps у режимі громадського
 * транспорту (Maps URLs, без ключа API).
 */
import { normalizeWord } from '../nlu/normalize';

/** Червона лінія метро, із заходу на схід (лише ті, що потрібні для підказок) */
const M1 = ['Академмістечко', 'Житомирська', 'Святошин', 'Нивки', 'Берестейська', 'Шулявська', 'Політехнічний інститут', 'Вокзальна'];

export interface KyivPoint {
  id: string;
  /** «метро «Святошин»», «платформа «Святошин»» */
  label: string;
  metro?: string;
  /** запит для Google Maps */
  mapsQuery: string;
}

export const KYIV_POINTS: Record<string, KyivPoint> = {
  'kyiv.akadem': { id: 'kyiv.akadem', label: 'метро «Академмістечко»', metro: 'Академмістечко', mapsQuery: 'метро Академмістечко, Київ' },
  'kyiv.zhytomyrska': { id: 'kyiv.zhytomyrska', label: 'метро «Житомирська»', metro: 'Житомирська', mapsQuery: 'метро Житомирська, Київ' },
  'kyiv.sviatoshyn': { id: 'kyiv.sviatoshyn', label: 'метро «Святошин»', metro: 'Святошин', mapsQuery: 'метро Святошин, Київ' },
  'kyiv.pas': { id: 'kyiv.pas', label: 'вокзал Київ-Пасажирський', metro: 'Вокзальна', mapsQuery: 'Приміський вокзал, Київ' },
  'kyiv.borshch': { id: 'kyiv.borshch', label: 'платформа «Борщагівка»', mapsQuery: 'зупинний пункт Борщагівка, Київ' },
};

/** Як назвати місце посадки / висадки: на картці, «звідки» і «де» */
export interface KyivStopText {
  name: string;
  from: string;
  at: string;
}

const MARSH_TEXT: Record<string, KyivStopText> = {
  'kyiv.akadem': { name: 'метро «Академмістечко»', from: 'від метро «Академмістечко»', at: 'біля метро «Академмістечко»' },
  'kyiv.sviatoshyn': { name: 'метро «Святошин»', from: 'від метро «Святошин»', at: 'біля метро «Святошин»' },
  'kyiv.zhytomyrska': { name: 'метро «Житомирська»', from: 'від метро «Житомирська»', at: 'біля метро «Житомирська»' },
};

const TRAIN_TEXT: Record<string, KyivStopText> = {
  'kyiv.pas': { name: 'Київ-Пасажирський (Приміський)', from: 'з Київ-Пасажирського', at: 'на Київ-Пасажирському' },
  'kyiv.sviatoshyn': { name: 'платформа «Святошин»', from: 'з платформи «Святошин»', at: 'на платформі «Святошин»' },
  'kyiv.borshch': { name: 'платформа «Борщагівка»', from: 'з платформи «Борщагівка»', at: 'на платформі «Борщагівка»' },
};

export function kyivStopText(pointId: string | null, mode: 'marshrutka' | 'elektrichka', fallback: string): KyivStopText {
  const t = pointId ? (mode === 'elektrichka' ? TRAIN_TEXT : MARSH_TEXT)[pointId] : undefined;
  return t ?? { name: fallback, from: `від: ${fallback}`, at: fallback };
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

/** «2 станції метро М1, ≈ 5 хв» між двома точками на червоній лінії, інакше null */
export function metroHint(fromId: string, toId: string): string | null {
  const a = KYIV_POINTS[fromId]?.metro;
  const b = KYIV_POINTS[toId]?.metro;
  if (!a || !b || a === b) return null;
  const i = M1.indexOf(a);
  const j = M1.indexOf(b);
  if (i < 0 || j < 0) return null;
  const n = Math.abs(i - j);
  const word = n === 1 ? 'станція' : n < 5 ? 'станції' : 'станцій';
  return `метро М1 «${a}» → «${b}», ${n} ${word}, ≈ ${Math.max(3, n * 2 + 1)} хв`;
}

/** Маршрут громадським транспортом у Google Maps (Maps URLs) */
export function mapsTransitUrl(origin: string | null, destination: string | null): string {
  const p = new URLSearchParams({ api: '1', travelmode: 'transit' });
  if (origin) p.set('origin', origin);
  if (destination) p.set('destination', destination);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}
