/**
 * «Доведе» · реєстр міст навчання — одне місце, де записано, для яких міст сервер веде «дорогу містом», кампанії й
 * звіт якості (Docs/dovede-learning-roadmap.md, крок 1). Нове місто = запис тут + його точки в `KNOWN_POINTS`
 * (`city-route.ts`) і стартові місця в `learn-places.ts`.
 *
 * Файл без залежностей: його разом із `crawl-core.ts` збирає локальна команда обходу (esbuild).
 */
export interface LearnCity {
  /** код міста в таблицях `DovedeCity*` (`cityCode`) і в `?city=` */
  code: string;
  /** назва в називному й родовому («до Києва») */
  name: string;
  genitive: string;
  /** id місця-міста в розборі сторінки */
  placeId: string;
  /** куди привозять (і звідки забирають) міжміські рейси — ті самі id, що шле сторінка */
  arrivalPoints: readonly string[];
  /** точки, з яких кампанія починає типово */
  defaultOrigins: readonly string[];
  /** типова глибина обходу кампанії «Навчити місто» */
  maxDepth: number;
  /** місто має власний датасет міського транспорту (той самий `cityCode`) — його розклад можна звіряти з Google */
  ownDataset?: boolean;
}

export const LEARN_CITIES = [
  {
    code: 'Kyiv',
    name: 'Київ',
    genitive: 'Києва',
    placeId: 'city.Kyiv',
    arrivalPoints: ['kyiv.akadem', 'kyiv.sviatoshyn', 'kyiv.zhytomyrska', 'kyiv.pas', 'kyiv.borshch'],
    defaultOrigins: ['kyiv.akadem', 'kyiv.pas'],
    maxDepth: 1,
  },
  {
    code: 'Zhytomyr',
    name: 'Житомир',
    genitive: 'Житомира',
    placeId: 'city.Zhytomyr',
    arrivalPoints: ['zhytomyr.avtovokzal'],
    defaultOrigins: ['zhytomyr.avtovokzal'],
    maxDepth: 2,
  },
  {
    // свій датасет лишається головним: сервер питають лише про місця без зупинки (крок 3 плану навчання)
    code: 'Korosten',
    name: 'Коростень',
    genitive: 'Коростеня',
    placeId: 'city.Korosten',
    arrivalPoints: ['korosten.vokzal'],
    defaultOrigins: ['korosten.vokzal'],
    maxDepth: 1,
    ownDataset: true,
  },
] as const satisfies readonly LearnCity[];

export type LearnCityCode = (typeof LEARN_CITIES)[number]['code'];

export const LEARN_CITY_CODES: readonly LearnCityCode[] = LEARN_CITIES.map((c) => c.code);

export const isLearnCity = (value: unknown): value is LearnCityCode => typeof value === 'string' && (LEARN_CITY_CODES as readonly string[]).includes(value);

export function learnCity(code: LearnCityCode): LearnCity {
  return LEARN_CITIES.find((c) => c.code === code) as LearnCity;
}

/** Міста з власним датасетом міського транспорту */
export const OWN_DATASET_CITY_CODES: readonly LearnCityCode[] = (LEARN_CITIES as readonly LearnCity[]).filter((c) => c.ownDataset).map((c) => c.code as LearnCityCode);

/** Місто за id місця з розбору сторінки («city.Kyiv»); null — не місто навчання */
export function learnCityByPlaceId(placeId: unknown): LearnCityCode | null {
  return LEARN_CITIES.find((c) => c.placeId === placeId)?.code ?? null;
}

/** «Kyiv | Zhytomyr» — для текстів помилок */
export const LEARN_CITY_LIST = LEARN_CITY_CODES.join(' | ');

/** Значення за кодом міста з реєстру: `byLearnCity((c) => c.name)` → `{ Kyiv: 'Київ', Zhytomyr: 'Житомир' }` */
export function byLearnCity<T>(pick: (city: LearnCity) => T): Record<LearnCityCode, T> {
  return Object.fromEntries(LEARN_CITIES.map((c) => [c.code, pick(c)])) as Record<LearnCityCode, T>;
}
