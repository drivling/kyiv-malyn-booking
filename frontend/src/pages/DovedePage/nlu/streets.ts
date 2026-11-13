/**
 * Вулиці без зупинок і адреси будинків (Docs/dovede-roadmap.md, фаза 4): «з Городищанської 20», «до Чапаєва».
 * Таке місце — точка на карті, а не зупинка: планувальник сам доведе пішки до найближчих зупинок. Дані —
 * знімок OpenStreetMap (`data/malyn-streets.json`, генератор `data/malyn-transport/dovede-streets/build.py`):
 * вулиця, колишні назви, будинки з координатами. Номер будинку є в id (`street.x:20`), але не в адресі сторінки.
 * Жодних запитів до геокодерів: адреса людини нікуди не йде.
 */
import streetsDoc from '../data/malyn-streets.json';
import { findPlaceByToken, type GazetteerPlace } from './gazetteer';
import { tokenize, type Token } from './normalize';
import { wordMatchesName } from './stopPlaces';

export interface Street {
  id: string;
  kind: string;
  name: string;
  label: string;
  old: string[];
  lat: number;
  lng: number;
  lengthM: number;
  /** будинки, для яких вулицю вписано в OSM */
  houses: Record<string, number[]>;
  /** будинки, привʼязані до вулиці за геометрією (найближча вулиця): справжній будинок з таким номером поруч, але вулиця могла бути іншою */
  near: Record<string, number[]>;
}

export const STREETS = (streetsDoc as unknown as { streets: Street[] }).streets;
const BY_ID = new Map(STREETS.map((s) => [s.id, s]));

const NUMBER_RE = /^\d+$/;
const STREET_WORDS = /^(вул|вулиц|улиц|ул)/;
const LANE_WORDS = /^(пров|переул|пер$)/;
const KIND_WORDS = /^(вул|вулиц|улиц|ул$|пров|переул|площ|просп|набережн|узвіз|узвоз)/;
const HOUSE_WORDS = new Set(['буд', 'будинок', 'будинку', 'дім', 'дом', 'д']);

interface NameVariant {
  street: Street;
  /** слова назви без одно-літерних («1-й» → «1») */
  words: string[];
}

function nameWords(name: string): string[] {
  return tokenize(name)
    .map((t) => t.n)
    .filter((w) => NUMBER_RE.test(w) || w.length > 1);
}

/** Усі назви всіх вулиць (теперішня й колишні); довші — першими, вулиці — перед провулками */
const VARIANTS: NameVariant[] = STREETS.flatMap((street) => [street.name, ...street.old].map((n) => ({ street, words: nameWords(n) })))
  .filter((v) => v.words.some((w) => !NUMBER_RE.test(w)))
  .sort((a, b) => b.words.length - a.words.length || Number(a.street.kind !== 'вулиця') - Number(b.street.kind !== 'вулиця'));

export interface StreetMatch {
  street: Street;
  /** номер будинку, як у питанні («20», «22а»), або null */
  house: string | null;
  /** індекс останнього слова питання, що належить адресі */
  end: number;
  /** перед назвою стояло «вул.» / «провулок» — людина сама сказала, що це вулиця */
  explicit: boolean;
}

/** Скільки слів питання від `i` покриває назва: усі слова поспіль або лише останнє (прізвище: «Грушевського») */
function matchName(v: NameVariant, toks: Token[], i: number): number | null {
  const full = v.words.every((w, k) => toks[i + k] && wordMatchesName(w, toks[i + k].n));
  if (full) return i + v.words.length - 1;
  const last = v.words[v.words.length - 1];
  if (v.words.length > 1 && !NUMBER_RE.test(last) && wordMatchesName(last, toks[i].n)) return i;
  return null;
}

/**
 * Вулиця (і, якщо названо, будинок), що починається зі слова `i`. Провулок беремо, лише коли поруч сказано
 * «провулок»; інакше — вулицю з такою назвою.
 */
export function matchStreet(toks: Token[], i: number): StreetMatch | null {
  if (NUMBER_RE.test(toks[i].n) || KIND_WORDS.test(toks[i].n)) return null;
  const before = toks[i - 1]?.n ?? '';
  const explicit = STREET_WORDS.test(before) || LANE_WORDS.test(before);
  let best: { v: NameVariant; end: number } | null = null;
  for (const v of VARIANTS) {
    const end = matchName(v, toks, i);
    if (end == null) continue;
    const after = toks[end + 1]?.n ?? '';
    const lane = LANE_WORDS.test(before) || LANE_WORDS.test(after);
    const isLane = v.street.kind === 'провулок';
    if (isLane !== lane && (lane || isLane)) continue;
    if (!best || end > best.end) best = { v, end };
  }
  if (!best) return null;
  let end = best.end;
  // «Городищанська вулиця, будинок 20»
  if (toks[end + 1] && KIND_WORDS.test(toks[end + 1].n)) end++;
  let h = end + 1;
  if (toks[h] && HOUSE_WORDS.has(toks[h].n)) h++;
  let house: string | null = null;
  if (toks[h] && NUMBER_RE.test(toks[h].n) && toks[h].n.length <= 3) {
    house = toks[h].n;
    end = h;
    // «22а»: літера — окреме слово; беремо, лише якщо такий будинок справді є
    const letter = toks[h + 1];
    const lettered = house + (letter?.n ?? '');
    if (letter && letter.n.length === 1 && letter.start === toks[h].end && (best.v.street.houses[lettered] || best.v.street.near[lettered])) {
      house += letter.n;
      end = h + 1;
    }
  }
  return { street: best.v.street, house, end, explicit: explicit || end > best.end };
}

/**
 * Чи брати вулицю, а не місце кураторського словника з тим самим словом («Грушевського» → зупинка, але
 * «Грушевського 12» чи «вул. Вокзальна» → адреса).
 */
export function streetWins(m: StreetMatch, firstToken: string): boolean {
  if (m.explicit || m.house) return true;
  return findPlaceByToken(firstToken) == null;
}

export function streetPlaceId(m: StreetMatch): string {
  return m.house ? `${m.street.id}:${m.house}` : m.street.id;
}

const ID_RE = /^(street\.[a-z0-9-]+)(?::([0-9]{1,3}[а-яіїєa-z]?))?$/;

/** `street.x:20` → вулиця й номер будинку */
export function parseStreetId(id: string): { street: Street; house: string | null } | null {
  const m = ID_RE.exec(id);
  const street = m ? BY_ID.get(m[1]) : undefined;
  return street ? { street, house: m?.[2] ?? null } : null;
}

/** Id без номера будинку — для адреси сторінки (принцип 7: адреса людини в URL не лишається) */
export function streetIdForUrl(id: string): string {
  return id.startsWith('street.') ? id.split(':')[0] : id;
}

export interface StreetSpot {
  lat: number;
  lng: number;
  /**
   * exact — будинок з вулицею в OSM; near — будинок привʼязано до вулиці за розташуванням (може бути неточно);
   * neighbour — сусідній відомий номер; street — середина вулиці
   */
  how: 'exact' | 'near' | 'neighbour' | 'street';
  exact: boolean;
}

/** Точка для адреси: сам будинок, найближчий за номером відомий будинок або середина вулиці */
export function streetSpot(street: Street, house: string | null): StreetSpot {
  if (house) {
    const hit = street.houses[house];
    if (hit) return { lat: hit[0], lng: hit[1], how: 'exact', exact: true };
    const guess = street.near[house];
    if (guess) return { lat: guess[0], lng: guess[1], how: 'near', exact: false };
    const n = parseInt(house, 10);
    const all = { ...street.near, ...street.houses };
    // сусідній номер — це ще той самий квартал; далекий номер нічого не каже про місце.
    // Спершу шукаємо на тому самому боці вулиці (та сама парність), і лише потім — на протилежному.
    const closest = (keys: string[]) =>
      keys.reduce<string | null>((best, k) => (best == null || Math.abs(parseInt(k, 10) - n) < Math.abs(parseInt(best, 10) - n) ? k : best), null);
    const within = (k: string | null): k is string => k != null && Math.abs(parseInt(k, 10) - n) <= 6;
    const keys = Object.keys(all);
    const sameSide = closest(keys.filter((k) => parseInt(k, 10) % 2 === n % 2));
    const near = within(sameSide) ? sameSide : closest(keys);
    if (within(near)) return { lat: all[near][0], lng: all[near][1], how: 'neighbour', exact: false };
  }
  return { lat: street.lat, lng: street.lng, how: 'street', exact: false };
}

/** Місце словника для адреси (`street.x` або `street.x:20`): без зупинок, з точкою */
export function streetPlace(id: string): GazetteerPlace | undefined {
  const p = parseStreetId(id);
  if (!p) return undefined;
  const spot = streetSpot(p.street, p.house);
  return { id, city: 'Malyn', label: p.house ? `${p.street.label}, ${p.house}` : p.street.label, stems: [], latLng: [spot.lat, spot.lng] };
}

/** Чи точка адреси приблизна (немає будинку в даних) — тоді відповідь чесно каже «приблизно» */
export function streetIsApprox(id: string): boolean {
  const p = parseStreetId(id);
  return p ? !streetSpot(p.street, p.house).exact : false;
}

/** Як саме знайдено точку адреси — для примітки під відповіддю; null — це не адреса */
export function streetPrecision(id: string): StreetSpot['how'] | null {
  const p = parseStreetId(id);
  return p ? streetSpot(p.street, p.house).how : null;
}

/** Claude повертає `street.x` без будинку, а номер лишає в словах людини — дістаємо його звідти */
export function withHouseFromText(id: string, text: string): string {
  const p = parseStreetId(id);
  if (!p || p.house) return id;
  const m = /(?:^|[^\d:.])(\d{1,3})\s?([а-яіїє])?(?![\d:.])/iu.exec(text);
  if (!m) return id;
  const withLetter = m[2] ? m[1] + m[2].toLowerCase() : null;
  return `${p.street.id}:${withLetter && (p.street.houses[withLetter] || p.street.near[withLetter]) ? withLetter : m[1]}`;
}
