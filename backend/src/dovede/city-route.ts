/**
 * «Доведе» · дорога містом між двома точками (Docs/dovede-roadmap.md, етап 3а) — і памʼять про неї.
 *
 * Порядок: (1) свіжа відповідь у базі (той самий ключ, тип дня, година ± 1, не старша за строк свіжості — типово
 * 30 днів, власник міняє його в адмінці: `DovedeCitySettings.freshDays`) — без зовнішніх
 * запитів, це вже наші дані; (2) Google Routes TRANSIT — і все знайдене пишемо в базу: сам маршрут, лінії, зупинки
 * (рішення власника 2026-11-17: зберігати дозволяє його договір з Google; `DOVEDE_CITY_STORE=0` вимикає запис);
 * (3) немає ключа, ліміт, збій — `fallback: 'maps'`, сторінка показує посилання Google Maps.
 *
 * Фонове навчання (`learnTick`) ще й оновлює збережені відповіді, що застаріли або ось-ось застаріють, — на той
 * самий тип дня й годину, у межах половини денного ліміту (`DOVEDE_CITY_REFRESH=0` вимикає).
 *
 * Рядки з Google ніколи не видаляються: «архівувати» ставить `archivedAt` (у відповідях і навчанні їх немає),
 * «відновити» знімає. Дані власника (`source: 'own'`) архівування не зачіпає.
 *
 * Архів одного місця (`archivePlace`, таблиця `DovedeCityPlace`) — для місця, яке Google за словами знаходить не те:
 * його дороги йдуть в архів, а нові питання про нього до Google не доходять (`reason: 'archived'`, сторінка дає
 * кнопку карти). Загальне «відновити» таких місць не повертає — лише `restorePlace`.
 */
import type { PrismaClient } from '@prisma/client';
// ключ пари й тип дня — спільні з обходом (`crawl-core.ts`): журнал обходу й база рахують їх однаково
import { dayTypeOf, normalizeKey } from './crawl-core';
export { dayTypeOf, normalizeKey };
import { METRO_STATIONS } from './kyivMetroData';
import { kyivDayStart } from './guard';
import { kyivWallToUtc } from '../viber-listing-expiry';
import { createDovedeSettings, GOOGLE_DAILY_MAX, type DovedeSettings } from './settings';

/** Скільки днів збережена відповідь свіжа, поки власник не задав свого в адмінці */
export const CITY_FRESH_DAYS = 30;
export const CITY_FRESH_DAYS_MIN = 1;
export const CITY_FRESH_DAYS_MAX = 365;
/** Налаштування з бази тримаємо в памʼяті хвилину: читати їх на кожен запит людини зайве */
const SETTINGS_TTL_MS = 60_000;

/** За скільки днів до кінця строку свіжості навчання оновлює відповідь, щоб людина не натрапила на застарілу */
export const refreshLeadDays = (freshDays: number): number => Math.min(2, Math.floor(freshDays / 4));

/**
 * Пару чи рядок, де Google дороги не знайшов, навчання не чіпає стільки днів — щоб не палити ліміт щогодини на те
 * саме. Лише «дороги немає»: збій Google чи вичерпана квота — не вина пари, позначок не ставимо, крок навчання спиняємо.
 */
export const REFRESH_RETRY_DAYS = 7;

/**
 * Google відмовив усім одразу — 429 (квоту проєкту в Google Cloud вичерпано) або 401 / 403 (ключ, вимкнений API,
 * білінг): стільки часу не питаємо зовсім і відповідаємо «ліміт» / «відмовлено».
 */
export const QUOTA_BACKOFF_MS = 10 * 60_000;

export const isValidFreshDays = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= CITY_FRESH_DAYS_MIN && v <= CITY_FRESH_DAYS_MAX;
export const DEFAULT_CITY_DAILY_CAP = 150;
/**
 * Межі денного ліміту з адмінки: 0 — Google не питати зовсім; угорі — запобіжник від зайвих нулів. Понад
 * `GOOGLE_DAILY_WARN` (20 000) — лише з підтвердженням (перевіряє роутер, `confirmNeeded`)
 */
export const CITY_DAILY_CAP_MIN = 0;
export const CITY_DAILY_CAP_MAX = GOOGLE_DAILY_MAX;
export const isValidDailyCap = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= CITY_DAILY_CAP_MIN && v <= CITY_DAILY_CAP_MAX;
const TIMEOUT_MS = 4000;
import { ownZhytomyrRoute } from './zhytomyr-own';
import { withKyivOwnLines } from './kyiv-own-lines';
import { halvesOf, ownKyivTrip, type OwnTrip, type TripHalf } from './kyiv-own-trip';
import { OWN_DATASET_CITY_CODES, byLearnCity, isLearnCity, type LearnCityCode } from './learn-cities';

/** Міста зі своїм датасетом: збережена дорога пари годиться на будь-яку годину (`findStored`) */
const OWN_DATASET: ReadonlySet<string> = new Set(OWN_DATASET_CITY_CODES);
import { ZT_OWN } from './zhytomyr-own-data';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.duration',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.transitDetails.stopCount',
  'routes.legs.steps.transitDetails.headway',
  'routes.legs.steps.transitDetails.headsign',
  'routes.legs.steps.transitDetails.stopDetails.departureStop',
  'routes.legs.steps.transitDetails.stopDetails.arrivalStop',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.color',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.transitLine.agencies.name',
].join(',');

export type CityCode = LearnCityCode;
export const CITY_NAME: Record<CityCode, string> = byLearnCity((c) => c.name);

export type DayType = 'weekday' | 'saturday' | 'sunday';
const DAY_TYPES: readonly DayType[] = ['weekday', 'saturday', 'sunday'];

/** Один крок дороги містом: транспорт або пішки */
export interface CityStep {
  kind: 'transit' | 'walk';
  minutes: number;
  /** пішки — метри */
  meters?: number;
  /** BUS | TROLLEYBUS | TRAM | SUBWAY | SHARE_TAXI … */
  mode?: string;
  /** номер, який бачить людина: «121», «3А» */
  line?: string;
  agency?: string;
  color?: string;
  headsign?: string;
  fromStop?: string;
  toStop?: string;
  stops?: number;
  /** поїзди / автобуси кожні стільки хвилин, якщо відомо */
  headwayMin?: number;
  /** 'HH:MM' — відправлення з розкладу (лише власні дані) */
  departs?: string;
  /** інтервал «від–до»: headwayMin … headwayMax (маршрутки з переліку міста) */
  headwayMax?: number;
  /** крок несе свої дані (лінія КПТ чи маршрутка з переліку Києва), а не Google */
  own?: true;
  /** 'HH:MM' — останній рейс від цієї зупинки сьогодні (свій розклад, коли вже скоро чи пішов) */
  lastDeparts?: string;
  /** 'HH:MM' — перший рейс ще не скоро */
  firstDeparts?: string;
  /** за своїм розкладом сьогодні вже не ходить */
  gone?: true;
}

/** Одна збережена дорога місця (адмінка «Місто» → «Місця» → розгортка) */
export interface CityPlaceRoute {
  from: string;
  to: string;
  /** to — від точки до місця, from — від місця */
  dir: 'to' | 'from';
  dayType: string;
  hour: number;
  minutes: number;
  source: string;
  hits: number;
  fetchedAt: string;
  archived: boolean;
  /** «BUS 37», «TRAM 12» */
  lines: string[];
}

/** Що відповів би сервер без Google (оцінка кампанії, `peekMany`) */
export type CityPeek = 'own' | 'fresh' | 'archived' | 'invalid' | 'none';

export type CityRouteAnswer =
  | { ok: true; source: 'google' | 'stored' | 'own'; city: CityCode; fromLabel: string; toLabel: string; steps: CityStep[]; minutes: number; fetchedAt: string }
  | { ok: false; fallback: 'maps'; reason: 'disabled' | 'no_key' | 'cap' | 'denied' | 'error' | 'no_route' | 'archived' };

/** Місце в адмінці «Місто: що вже знаємо»: скільки доріг про нього збережено і чи воно в архіві */
export interface CityPlaceRow {
  city: string;
  key: string;
  label: string;
  /** збережені дороги з Google, які віддаємо */
  routes: number;
  archivedRoutes: number;
  /** найкоротша й найдовша збережена дорога, хв: «5–8 хв від усіх станцій» — ознака, що Google знайшов не те місце */
  minMinutes: number | null;
  maxMinutes: number | null;
  /** null — місце не в архіві */
  archivedAt: string | null;
}

export interface CityPoint {
  /** ключ для бази */
  key: string;
  /** як показати людині */
  label: string;
  /** що питати в Google */
  address: string;
  /** координати, коли точку знаємо точно (зупинка датасету, вокзал): Google питаємо ними, а не адресою */
  lat?: number;
  lng?: number;
}

/** Точки, які «Доведе» знає за id: куди привозять міжміські рейси */
const KNOWN_POINTS: Record<string, { label: string; address: string; city: CityCode; lat?: number; lng?: number }> = {
  'zhytomyr.avtovokzal': { label: 'автовокзал Житомир-1', address: 'Автовокзал Житомир-1, вул. Київська 93, Житомир, Україна', city: 'Zhytomyr' },
  'kyiv.pas': { label: 'вокзал Київ-Пасажирський', address: 'Приміський вокзал, Київ, Україна', city: 'Kyiv' },
  'kyiv.borshch': { label: 'платформа «Борщагівка»', address: 'зупинний пункт Борщагівка, Київ, Україна', city: 'Kyiv' },
  // координати — зупинка «Залізничний вокзал» датасету Коростеня (st_1001), якір коридору Коростень ↔ Малин
  'korosten.vokzal': { label: 'залізничний вокзал Коростеня', address: 'Залізничний вокзал, Коростень, Україна', city: 'Korosten', lat: 50.956595, lng: 28.6342028 },
};

/** Точка за id (автовокзал, станція метро) або словами людини («Польова 12», «Охматдит»); null — порожньо чи сміття */
export function resolveCityPoint(city: CityCode, raw: string): CityPoint | null {
  const value = raw.trim();
  if (!value || value.length > 120) return null;
  const known = KNOWN_POINTS[value];
  if (known) return known.city === city ? { key: value, label: known.label, address: known.address, ...(known.lat != null && known.lng != null ? { lat: known.lat, lng: known.lng } : {}) } : null;
  const metro = METRO_STATIONS.find((s) => s.id === value);
  if (metro) return city === 'Kyiv' ? { key: value, label: `метро «${metro.name}»`, address: `станція метро ${metro.name}, Київ, Україна` } : null;
  // id якогось іншого словника сюди не має потрапляти
  if (/^[a-z]+\.[a-z0-9.:-]+$/i.test(value) || /^st_\d+$/.test(value)) return null;
  const key = normalizeKey(value);
  if (key.length < 2) return null;
  return { key, label: value.replace(/\s+/g, ' '), address: `${value}, ${CITY_NAME[city]}, Україна` };
}

/** id точки, яку «Доведе» знає сам (місце висадки, станція метро), — на відміну від слів людини */
const STOP_ID_RE = /^st_\d+$/;
const isKnownPointId = (value: string): boolean => Boolean(KNOWN_POINTS[value]) || STOP_ID_RE.test(value) || METRO_STATIONS.some((s) => s.id === value);

/** Що питати для збереженої пари: id лишається id, слова — як їх написала людина (підпис), а не ключ малими літерами */
export function storedPoint(key: string, label: string): string {
  return isKnownPointId(key) || normalizeKey(label) !== key ? key : label;
}

/** Найближча (не раніше ніж завтра за Києвом) дата потрібного типу дня й година — коли оновлювати збережену відповідь */
export function nextSlot(now: Date, dayType: DayType, hour: number): { date: string; time: string; utc: Date } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 1; i <= 7; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (dayTypeOf(date) !== dayType) continue;
    const [yy, mm, dd] = date.split('-').map(Number);
    return { date, time: `${String(hour).padStart(2, '0')}:00`, utc: kyivWallToUtc(yy, mm - 1, dd, hour, 0) };
  }
  throw new Error(`Невідомий тип дня: ${dayType}`);
}

const seconds = (v: unknown): number => Number(String(v ?? '').replace(/s$/, '')) || 0;

const STOP_CACHE_MS = 5 * 60_000;

/** Точка для Google Routes: координатами, коли знаємо їх, інакше адресою */
export function waypoint(p: CityPoint): { address: string } | { location: { latLng: { latitude: number; longitude: number } } } {
  return p.lat != null && p.lng != null ? { location: { latLng: { latitude: p.lat, longitude: p.lng } } } : { address: p.address };
}

interface GoogleStep {
  travelMode?: string;
  staticDuration?: string;
  distanceMeters?: number;
  transitDetails?: {
    stopCount?: number;
    headway?: string;
    headsign?: string;
    stopDetails?: { departureStop?: { name?: string; location?: { latLng?: { latitude?: number; longitude?: number } } }; arrivalStop?: { name?: string; location?: { latLng?: { latitude?: number; longitude?: number } } } };
    transitLine?: { name?: string; nameShort?: string; color?: string; vehicle?: { type?: string }; agencies?: Array<{ name?: string }> };
  };
}

export interface ParsedGoogleRoute {
  steps: CityStep[];
  minutes: number;
  stops: Array<{ name: string; lat: number | null; lng: number | null }>;
}

/** Відповідь Google → наші кроки: сусідні піші відрізки зливаються, дрібні (< 1 хв і < 60 м) відкидаються */
export function parseGoogleRoute(body: unknown): ParsedGoogleRoute | null {
  const route = (body as { routes?: Array<{ duration?: string; legs?: Array<{ steps?: GoogleStep[] }> }> })?.routes?.[0];
  const raw = route?.legs?.flatMap((l) => l.steps ?? []) ?? [];
  if (!route || !raw.length) return null;
  const steps: CityStep[] = [];
  const stops: ParsedGoogleRoute['stops'] = [];
  for (const s of raw) {
    const t = s.transitDetails;
    if (t) {
      const dep = t.stopDetails?.departureStop;
      const arr = t.stopDetails?.arrivalStop;
      for (const st of [dep, arr]) {
        if (st?.name) stops.push({ name: st.name.trim(), lat: st.location?.latLng?.latitude ?? null, lng: st.location?.latLng?.longitude ?? null });
      }
      const headway = seconds(t.headway);
      steps.push({
        kind: 'transit',
        minutes: Math.max(1, Math.round(seconds(s.staticDuration) / 60)),
        mode: t.transitLine?.vehicle?.type ?? 'BUS',
        line: (t.transitLine?.nameShort ?? t.transitLine?.name ?? '').trim(),
        agency: t.transitLine?.agencies?.[0]?.name?.trim() || undefined,
        color: t.transitLine?.color || undefined,
        headsign: t.headsign?.trim() || undefined,
        fromStop: dep?.name?.trim(),
        toStop: arr?.name?.trim(),
        stops: t.stopCount,
        ...(headway ? { headwayMin: Math.round(headway / 60) } : {}),
      });
      continue;
    }
    const secs = seconds(s.staticDuration);
    const meters = s.distanceMeters ?? 0;
    const last = steps[steps.length - 1];
    if (last?.kind === 'walk') {
      last.minutes += secs / 60;
      last.meters = (last.meters ?? 0) + meters;
    } else {
      steps.push({ kind: 'walk', minutes: secs / 60, meters });
    }
  }
  const cleaned = steps
    .map((s) => (s.kind === 'walk' ? { ...s, minutes: Math.round(s.minutes), meters: Math.round((s.meters ?? 0) / 10) * 10 } : s))
    .filter((s) => s.kind === 'transit' || s.minutes >= 1 || (s.meters ?? 0) >= 60);
  if (!cleaned.length) return null;
  const total = seconds(route.duration);
  const minutes = total ? Math.round(total / 60) : cleaned.reduce((n, s) => n + s.minutes, 0);
  // межі здорового глузду для дороги в межах одного міста
  if (minutes < 1 || minutes > 240) return null;
  return { steps: cleaned, minutes, stops };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface CityRouteQuery {
  city: CityCode;
  from: string;
  to: string;
  /** 'YYYY-MM-DD' і 'HH:MM' за Києвом — коли людина рушає містом */
  date: string;
  time: string;
  /** час відправлення в UTC для Google */
  departAt: Date;
}

export interface CityRoutesDeps {
  prisma: PrismaClient;
  /** null — ключа немає */
  key: () => string | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
  enabled?: () => boolean;
  /** писати знайдене в базу */
  store?: () => boolean;
  dailyCap?: () => number;
  /** пряма поїздка Житомиром за власними даними; у тестах — заглушка */
  ownRoute?: typeof ownZhytomyrRoute;
  ownEnabled?: () => boolean;
  /** фонове навчання оновлює застарілі збережені відповіді */
  refresh?: () => boolean;
  /** налаштування з адмінки (`dovede/settings.ts`); немає — створюємо над тією ж базою */
  settings?: DovedeSettings;
  /** пасажирська зупинка датасету міста за id (`st_1001`); у тестах — заглушка, типово — з бази з кешем на 5 хв */
  stopPoint?: (city: CityCode, id: string) => Promise<{ name: string; lat: number; lng: number } | null>;
}

export function cityRoutesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOVEDE_CITY_ROUTES ?? 'google').trim().toLowerCase() !== 'off';
}

export function cityStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOVEDE_CITY_STORE ?? '1').trim() !== '0';
}

export function cityRefreshEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOVEDE_CITY_REFRESH ?? '1').trim() !== '0';
}

export function cityDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.DOVEDE_CITY_DAILY_CAP ?? '').trim();
  if (!raw) return DEFAULT_CITY_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_CITY_DAILY_CAP;
}

/**
 * Пари, у відповідях на які є кожен вид транспорту Києва (2026-11-18): фунікулер угору й униз, трамвай №12, трамвай
 * Подолом після метро, швидкісний трамвай, тролейбус, автобус, кільцева, маршрутка + автобус, автобус + приміська.
 * Навчання тримає їх свіжими — так у базі завжди є справжня відповідь для картки кожного виду. Той самий перелік —
 * `ask` у frontend/src/pages/DovedePage/compose/fixtures/kyiv-city-modes.json (тест звіряє обидва).
 */
export const MODE_PAIRS: Array<{ city: CityCode; from: string; to: string }> = [
  { city: 'Kyiv', from: 'kyiv.m.poshtova', to: 'Михайлівська площа' },
  { city: 'Kyiv', from: 'Михайлівська площа', to: 'Контрактова площа' },
  { city: 'Kyiv', from: 'kyiv.m.kontraktova', to: 'Пуща-Водиця' },
  { city: 'Kyiv', from: 'kyiv.sviatoshyn', to: 'Інститут нейрохірургії' },
  { city: 'Kyiv', from: 'Інститут Шалімова', to: 'kyiv.pas' },
  { city: 'Kyiv', from: 'kyiv.pas', to: 'Національний військово-медичний клінічний центр' },
  { city: 'Kyiv', from: 'kyiv.m.kontraktova', to: 'вулиця Глибочицька 40' },
  { city: 'Kyiv', from: 'kyiv.pas', to: 'вулиця Сім’ї Сосніних 9' },
  { city: 'Kyiv', from: 'Платформа Куренівка', to: 'Платформа Русанівка' },
  { city: 'Kyiv', from: 'Райдужний масив, вулиця Каштанова', to: 'Київ-Деміївський вокзал' },
];

/** Пари, з яких навчання починає, поки людей ще не питали (2026-11-17): куди найчастіше їдуть від місця висадки */
export const SEED_PAIRS: Array<{ city: CityCode; from: string; to: string }> = [
  { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Залізничний вокзал' },
  { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'майдан Соборний' },
  { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Обласна клінічна лікарня' },
  { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Житній ринок' },
  { city: 'Kyiv', from: 'kyiv.akadem', to: 'Охматдит' },
  { city: 'Kyiv', from: 'kyiv.akadem', to: 'Центральний автовокзал' },
  // Житомир: від автовокзалу до кінцевих усіх маршрутів міста — щоб база наповнювалась сама, не чекаючи питань
  ...[...new Set(ZT_OWN.dirs.map((d) => d.stops[d.stops.length - 1][0]))].sort().map((to) => ({ city: 'Zhytomyr' as const, from: 'zhytomyr.avtovokzal', to })),
  // Київ: по парі на кожен вид транспорту — щоб картки мали свіжу справжню відповідь
  ...MODE_PAIRS,
];

export function createCityRoutes(deps: CityRoutesDeps) {
  const { prisma } = deps;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = deps.now ?? (() => new Date());
  const settingsStore = deps.settings ?? createDovedeSettings({ prisma, now });
  // Вмикачі й числа — з налаштувань адмінки (там же головний вимикач зі змінної середовища); у тестах — заглушки
  const enabled = async (): Promise<boolean> => (deps.enabled ? deps.enabled() : settingsStore.bool('city.enabled'));
  const store = deps.store ?? (() => cityStoreEnabled());
  const ownRoute = deps.ownRoute ?? ownZhytomyrRoute;

  /** Пасажирські зупинки датасету міста (без технічних точок лінії) — відомі точки з координатами */
  const stopCache = new Map<string, { at: number; stops: Map<string, { name: string; lat: number; lng: number }> }>();
  async function datasetStop(city: CityCode, id: string): Promise<{ name: string; lat: number; lng: number } | null> {
    if (deps.stopPoint) return deps.stopPoint(city, id);
    const hit = stopCache.get(city);
    if (hit && now().getTime() - hit.at < STOP_CACHE_MS) return hit.stops.get(id) ?? null;
    const [rows, served] = await Promise.all([
      prisma.transportStop.findMany({ where: { cityCode: city }, select: { id: true, name: true, lat: true, lng: true } }),
      prisma.transportRouteStop.findMany({ where: { cityCode: city, mapOnly: false }, select: { stopId: true } }),
    ]);
    const passenger = new Set(served.map((r) => r.stopId));
    const stops = new Map(rows.filter((s) => passenger.has(s.id)).map((s) => [s.id, { name: s.name, lat: s.lat, lng: s.lng }]));
    stopCache.set(city, { at: now().getTime(), stops });
    return stops.get(id) ?? null;
  }

  /** Зупинки, які вже назвав Google (`DovedeCityStop`): назва → координати; для своїх ліній Києва (крок 8б) */
  let googleStops: { at: number; byName: Map<string, { lat: number; lng: number }> } | null = null;
  async function knownStops(city: CityCode): Promise<Map<string, { lat: number; lng: number }>> {
    if (googleStops && now().getTime() - googleStops.at < STOP_CACHE_MS) return googleStops.byName;
    const rows = await prisma.dovedeCityStop
      .findMany({ where: { cityCode: city, archivedAt: null, lat: { not: null }, lng: { not: null } }, select: { name: true, lat: true, lng: true } })
      .catch(() => []);
    const byName = new Map(rows.map((r) => [r.name, { lat: r.lat as number, lng: r.lng as number }]));
    googleStops = { at: now().getTime(), byName };
    return byName;
  }

  /**
   * Київ: кроки лініями «Київпастрансу» й маршрутками з переліку міста несуть свої інтервал, хвилини й «останній о …»
   * (`withKyivOwnLines`). Вимикається тим самим перемикачем, що й власні дані Житомира (`city.own`)
   */
  async function ownLines(q: CityRouteQuery, steps: CityStep[], minutes: number, fresh?: ParsedGoogleRoute['stops']): Promise<{ steps: CityStep[]; minutes: number }> {
    if (q.city !== 'Kyiv' || !(await ownEnabled())) return { steps, minutes };
    try {
      const fromAnswer = new Map((fresh ?? []).filter((s) => s.lat != null && s.lng != null).map((s) => [s.name, { lat: s.lat as number, lng: s.lng as number }]));
      const stored = await knownStops(q.city);
      return withKyivOwnLines({ steps, minutes, date: q.date, time: q.time, stopAt: (name) => fromAnswer.get(name.trim()) ?? stored.get(name.trim()) ?? null });
    } catch (e) {
      console.error('❌ city-route: свої лінії Києва:', e);
      return { steps, minutes };
    }
  }

  /**
   * Київ, крок 8б-2: «половинки» збережених відповідей Google — з якої зупинки сідають біля `from` (дороги з нього
   * будь-куди) і на якій виходять біля `to` (дороги в нього звідки завгодно) — і своя поїздка однією лінією КПТ між ними
   */
  async function ownKyiv(q: CityRouteQuery, from: CityPoint, to: CityPoint): Promise<OwnTrip | null> {
    const freshFrom = await freshSince();
    const base = { cityCode: q.city, archivedAt: null, source: 'google', fetchedAt: { gte: freshFrom } };
    const select = { steps: true, fetchedAt: true } as const;
    const [outs, ins] = await Promise.all([
      prisma.dovedeCityRoute.findMany({ where: { ...base, fromKey: from.key }, select, orderBy: { fetchedAt: 'desc' }, take: 60 }),
      prisma.dovedeCityRoute.findMany({ where: { ...base, toKey: to.key }, select, orderBy: { fetchedAt: 'desc' }, take: 60 }),
    ]);
    if (!outs.length || !ins.length) return null;
    const stops = await knownStops(q.city);
    const collect = (rows: typeof outs, side: 'start' | 'end'): TripHalf[] => {
      const seen = new Map<string, TripHalf>();
      for (const r of rows) {
        const h = halvesOf((r.steps as unknown as CityStep[]) ?? [])[side];
        const at = h ? stops.get(h.stop.trim()) : null;
        if (!h || !at) continue;
        const prev = seen.get(h.stop);
        if (!prev || h.walkMin < prev.walkMin) seen.set(h.stop, { stop: h.stop, lat: at.lat, lng: at.lng, walkMin: h.walkMin, walkM: h.walkM, fetchedAt: r.fetchedAt.toISOString() });
      }
      return [...seen.values()];
    };
    return ownKyivTrip({ starts: collect(outs, 'start'), ends: collect(ins, 'end'), date: q.date, time: q.time });
  }

  /** Точка питання: зупинка датасету міста за id (з координатами) або те, що знає `resolveCityPoint` */
  async function resolvePoint(city: CityCode, raw: string): Promise<CityPoint | null> {
    const value = raw.trim();
    if (!STOP_ID_RE.test(value)) return resolveCityPoint(city, raw);
    const stop = await datasetStop(city, value).catch((e) => {
      console.error('❌ city-route: зупинка датасету:', e);
      return null;
    });
    return stop ? { key: value, label: `зупинка «${stop.name}»`, address: `${stop.name}, ${CITY_NAME[city]}, Україна`, lat: stop.lat, lng: stop.lng } : null;
  }
  // Власні дані Житомира: маршрути й зупинки із сайту власника, хвилини виправлено за Google
  const ownEnabled = async (): Promise<boolean> => (deps.ownEnabled ? deps.ownEnabled() : settingsStore.bool('city.own'));
  // Лічильник і пауза — у базі (`DovedeCityGoogleDay`), спільні для всіх контейнерів. Памʼять — лише запас, коли база
  // не відповідає: тоді рахуємо в цьому процесі, як раніше
  let memoDay = '';
  let memoCalls = 0;
  let blockedUntil = 0;
  let blockedReason: 'cap' | 'denied' = 'cap';
  /**
   * Остання відмова Google з її текстом (для адмінки й журналу): у ньому названо квоту («…requests per day») або
   * причину відмови в доступі — за ним видно, що лагодити в Google Cloud. Ключа в тексті Google не повторює.
   */
  let googleError: { at: Date; status: number; message: string } | null = null;
  const refresh = async (): Promise<boolean> => (deps.refresh ? deps.refresh() : settingsStore.bool('learn.refresh'));
  // стартові пари, які Google не знайшов: рядка в базі для позначки в них немає, тож памʼятаємо тут (до перезапуску)
  const seedFailed = new Map<string, number>();

  /** Строк свіжості збереженої відповіді, днів: з адмінки, інакше типовий (30) */
  async function freshDays(): Promise<number> {
    return settingsStore.int('city.freshDays');
  }

  /** Ліміт без адмінки: заглушка тесту або змінна `DOVEDE_CITY_DAILY_CAP`, інакше 150 */
  async function defaultCap(): Promise<number> {
    return deps.dailyCap ? deps.dailyCap() : (await settingsStore.view('city.dailyCap')).default as number;
  }

  /** Денний ліміт запитів до Google: з адмінки, інакше змінна середовища (`DOVEDE_CITY_DAILY_CAP`), інакше 150 */
  async function capNow(): Promise<number> {
    const v = await settingsStore.view('city.dailyCap');
    return (v.stored as number | null) ?? (await defaultCap());
  }

  /** Скільки з денного ліміту може взяти фонове навчання (типово половину) */
  async function learnCap(): Promise<number> {
    return Math.floor(((await capNow()) * (await settingsStore.int('learn.sharePct'))) / 100);
  }

  const retryMs = async (): Promise<number> => (await settingsStore.int('learn.retryDays')) * 24 * 3600_000;
  const backoffMs = async (): Promise<number> => (await settingsStore.int('google.backoffMin')) * 60_000;

  async function setFreshDays(days: number): Promise<number> {
    if (!isValidFreshDays(days)) throw new RangeError(`freshDays: ціле від ${CITY_FRESH_DAYS_MIN} до ${CITY_FRESH_DAYS_MAX}`);
    await settingsStore.set('city.freshDays', days);
    return days;
  }

  /** null — повернути ліміт зі змінної середовища */
  async function setDailyCap(cap: number | null): Promise<number> {
    if (cap !== null && !isValidDailyCap(cap)) throw new RangeError(`dailyCap: ціле від ${CITY_DAILY_CAP_MIN} до ${CITY_DAILY_CAP_MAX} або null`);
    await settingsStore.set('city.dailyCap', cap);
    return capNow();
  }

  // Місця в архіві («місто|ключ»): власник прибрав їх із відповідей. Памʼять на хвилину; архів і повернення скидають її
  let archivedMemo: { at: number; keys: Set<string> } | null = null;

  async function archivedPlaces(): Promise<Set<string>> {
    const at = now().getTime();
    if (archivedMemo && at - archivedMemo.at >= 0 && at - archivedMemo.at < SETTINGS_TTL_MS) return archivedMemo.keys;
    try {
      const rows = await prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } }, select: { cityCode: true, key: true } });
      archivedMemo = { at, keys: new Set(rows.map((r) => `${r.cityCode}|${r.key}`)) };
      return archivedMemo.keys;
    } catch (e) {
      console.error('❌ city-route: архів місць не прочитано, беру попередній:', e instanceof Error ? e.message : e);
      return archivedMemo?.keys ?? new Set();
    }
  }

  const freshSince = async (): Promise<Date> => new Date(now().getTime() - (await freshDays()) * 24 * 3600_000);

  /** Київська дата 'YYYY-MM-DD' — ключ рядка обліку */
  const kyivDay = (at: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

  async function dayRow() {
    return prisma.dovedeCityGoogleDay.findUnique({ where: { day: kyivDay(now()) } }).catch((e) => {
      console.error('❌ city-route: облік Google не прочитано:', e instanceof Error ? e.message : e);
      return null;
    });
  }

  /**
   * Запитів до Google сьогодні: облік у базі; не менше за кількість сьогоднішніх записаних відповідей (у день
   * переходу на облік рядок порожній, а відповіді вже є) і за лічильник цього процесу (якщо база не відповідала).
   */
  async function callsToday(): Promise<number> {
    const today = kyivDayStart(now());
    const key = today.toISOString();
    if (key !== memoDay) {
      memoDay = key;
      memoCalls = 0;
    }
    const [row, stored] = await Promise.all([dayRow(), prisma.dovedeCityRoute.count({ where: { source: 'google', fetchedAt: { gte: today } } }).catch(() => 0)]);
    return Math.max(row?.calls ?? 0, stored, memoCalls);
  }

  type Purpose = 'people' | 'learn';

  /** Записати запит у облік до виклику; `undo` — Google відмовив усім (429 / 401 / 403), запит не рахується */
  async function countCall(purpose: Purpose, delta: 1 | -1): Promise<number | null> {
    const day = kyivDay(now());
    try {
      const row = await prisma.dovedeCityGoogleDay.upsert({
        where: { day },
        create: { day, calls: Math.max(0, delta), [purpose]: Math.max(0, delta) },
        update: { calls: { increment: delta }, [purpose]: { increment: delta } },
      });
      return row.calls;
    } catch (e) {
      console.error('❌ city-route: облік Google не записано:', e instanceof Error ? e.message : e);
      memoCalls += delta;
      return null;
    }
  }

  /** Людині не дали дорогу через ліміт чи квоту — видно в адмінці («людям відмовили») */
  async function noteRefused(): Promise<void> {
    const day = kyivDay(now());
    await prisma.dovedeCityGoogleDay
      .upsert({ where: { day }, create: { day, refused: 1 }, update: { refused: { increment: 1 } } })
      .catch((e) => console.error('❌ city-route: облік відмов:', e instanceof Error ? e.message : e));
  }

  /** Відмова Google: текст (і пауза для 429 / 401 / 403) — у базу, щоб бачили всі контейнери й адмінка після перезапуску */
  async function noteGoogleError(status: number, message: string, block: 'quota' | 'denied' | null): Promise<void> {
    const at = now();
    const day = kyivDay(at);
    const data = {
      lastErrorStatus: status,
      lastErrorMessage: message || null,
      lastErrorAt: at,
      ...(block ? { blockedUntil: new Date(at.getTime() + (await backoffMs())), blockedReason: block } : {}),
    };
    await prisma.dovedeCityGoogleDay.upsert({ where: { day }, create: { day, ...data }, update: data }).catch((e) => console.error('❌ city-route: відмову Google не записано:', e instanceof Error ? e.message : e));
  }

  /** Пауза після відмови Google — з бази (спільна), інакше з памʼяті цього процесу */
  async function blockedNow(): Promise<'cap' | 'denied' | null> {
    const row = await dayRow();
    const until = row?.blockedUntil ? row.blockedUntil.getTime() : 0;
    if (until > now().getTime()) return row?.blockedReason === 'denied' ? 'denied' : 'cap';
    if (now().getTime() < blockedUntil) return blockedReason;
    return null;
  }

  async function findStored(q: CityRouteQuery, from: CityPoint, to: CityPoint, hour: number) {
    const freshFrom = await freshSince();
    const dayType = dayTypeOf(q.date);
    // місто зі своїм датасетом (Коростень): сторінка бере з відповіді лише зупинку біля місця й хвилини пішки, а
    // автобус — зі свого розкладу, тож годину не порівнюємо — підходить дорога цієї пари на будь-яку годину
    const anyHour = OWN_DATASET.has(q.city);
    const rows = await prisma.dovedeCityRoute.findMany({
      where: { cityCode: q.city, fromKey: from.key, toKey: to.key, ...(anyHour ? {} : { dayType, hour: { in: [hour - 1, hour, hour + 1] } }), archivedAt: null, fetchedAt: { gte: freshFrom } },
    });
    if (!rows.length) return null;
    // власні дані сильніші за збережені з Google; серед рівних — ближча година
    const rides = (r: (typeof rows)[number]) => Array.isArray(r.steps) && (r.steps as Array<{ kind?: string }>).some((x) => x?.kind === 'transit');
    // будь-яка година: «лише пішки» о 21-й буває через те, що автобуси вже не ходять, — дорога з поїздкою корисніша
    const anyRides = anyHour && rows.some(rides);
    const rank = (r: (typeof rows)[number]) =>
      (r.source === 'own' ? 0 : 1) * 100_000 + (anyRides && !rides(r) ? 10_000 : 0) + (r.dayType === dayType ? 0 : 1_000) + Math.abs(r.hour - hour);
    return rows.sort((a, b) => rank(a) - rank(b))[0];
  }

  async function noteDemand(city: CityCode, from: CityPoint, to: CityPoint, answered: boolean): Promise<void> {
    const at = now();
    await prisma.dovedeCityDemand
      .upsert({
        where: { cityCode_fromKey_toKey: { cityCode: city, fromKey: from.key, toKey: to.key } },
        create: { cityCode: city, fromKey: from.key, toKey: to.key, fromLabel: from.label, toLabel: to.label, answered, lastAskedAt: at },
        update: { asked: { increment: 1 }, lastAskedAt: at, ...(answered ? { answered: true } : {}) },
      })
      .catch((e) => console.error('❌ city-route: журнал попиту:', e));
  }

  /** Навчання знайшло дорогу для пари, яку питали люди: у списку попиту вона більше не «без відповіді». Лічильник не чіпаємо */
  async function markAnswered(city: CityCode, from: CityPoint, to: CityPoint): Promise<void> {
    await prisma.dovedeCityDemand
      .updateMany({ where: { cityCode: city, fromKey: from.key, toKey: to.key, answered: false }, data: { answered: true } })
      .catch((e) => console.error('❌ city-route: журнал попиту:', e));
  }

  async function remember(q: CityRouteQuery, from: CityPoint, to: CityPoint, hour: number, parsed: ParsedGoogleRoute): Promise<void> {
    const at = now();
    const dayType = dayTypeOf(q.date);
    await prisma.dovedeCityRoute.upsert({
      where: { cityCode_fromKey_toKey_dayType_hour_source: { cityCode: q.city, fromKey: from.key, toKey: to.key, dayType, hour, source: 'google' } },
      create: { cityCode: q.city, fromKey: from.key, toKey: to.key, fromLabel: from.label, toLabel: to.label, dayType, hour, steps: parsed.steps as unknown as object, minutes: parsed.minutes, source: 'google', fetchedAt: at },
      // оновлення повертає рядок і з архіву: людина щойно отримала цю відповідь
      update: { steps: parsed.steps as unknown as object, minutes: parsed.minutes, fetchedAt: at, fromLabel: from.label, toLabel: to.label, archivedAt: null, refreshFailedAt: null },
    });
    for (const s of parsed.steps) {
      if (s.kind !== 'transit' || !s.line) continue;
      await prisma.dovedeCityLine.upsert({
        where: { cityCode_mode_name_agency: { cityCode: q.city, mode: s.mode ?? 'BUS', name: s.line, agency: s.agency ?? '' } },
        create: { cityCode: q.city, mode: s.mode ?? 'BUS', name: s.line, agency: s.agency ?? '', color: s.color ?? null, source: 'google', lastSeenAt: at },
        update: { seenCount: { increment: 1 }, lastSeenAt: at, ...(s.color ? { color: s.color } : {}) },
      });
    }
    const seen = new Set<string>();
    for (const st of parsed.stops) {
      if (seen.has(st.name)) continue;
      seen.add(st.name);
      await prisma.dovedeCityStop.upsert({
        where: { cityCode_name: { cityCode: q.city, name: st.name } },
        create: { cityCode: q.city, name: st.name, lat: st.lat, lng: st.lng, source: 'google', lastSeenAt: at },
        update: { seenCount: { increment: 1 }, lastSeenAt: at, ...(st.lat != null && st.lng != null ? { lat: st.lat, lng: st.lng } : {}) },
      });
    }
  }

  /** `trace.google` — запит до Google справді пішов і рахується (кампанія навчання рахує свій бюджет за ним) */
  async function askGoogle(q: CityRouteQuery, from: CityPoint, to: CityPoint, purpose: Purpose, trace?: { google: boolean }): Promise<ParsedGoogleRoute | 'no_key' | 'cap' | 'denied' | 'error' | 'no_route'> {
    const key = deps.key();
    if (!key) return 'no_key';
    const blocked = await blockedNow();
    if (blocked) return blocked;
    const cap = await capNow();
    if ((await callsToday()) >= cap) return 'cap';
    // записуємо запит до виклику: два контейнери, що питають одночасно, разом ліміту не перейдуть
    const counted = await countCall(purpose, 1);
    if (counted != null && counted > cap) {
      await countCall(purpose, -1);
      return 'cap';
    }
    if (trace) trace.google = true;
    try {
      // Google приймає лише майбутній час; для «вже зараз» — без нього
      const future = q.departAt.getTime() > now().getTime() + 60_000;
      const res = await fetchImpl(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ origin: waypoint(from), destination: waypoint(to), travelMode: 'TRANSIT', languageCode: 'uk', ...(future ? { departureTime: q.departAt.toISOString() } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return parseGoogleRoute(await res.json()) ?? 'no_route';
      const said = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
      const message = typeof said?.error?.message === 'string' ? said.error.message.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      googleError = { at: now(), status: res.status, message };
      const tail = message ? `: ${message}` : '';
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        // 429 — квота в Google Cloud менша за наш денний ліміт або її вибрали інші скрипти з тим самим ключем;
        // 401 / 403 — ключ, вимкнений API або білінг. Не вина пари й не наш ліміт: спроба не рахується
        await countCall(purpose, -1);
        if (trace) trace.google = false;
        blockedUntil = now().getTime() + (await backoffMs());
        blockedReason = res.status === 429 ? 'cap' : 'denied';
        await noteGoogleError(res.status, message, res.status === 429 ? 'quota' : 'denied');
        console.error(`⛔ city-route: Google Routes ${res.status} — ${res.status === 429 ? 'квоту вичерпано' : 'відмовлено в доступі'}, 10 хв не питаємо${tail}`);
        return blockedReason;
      }
      await noteGoogleError(res.status, message, null);
      // 400 / 404 — Google не прийняв саме цю пару (адресу): для неї дороги немає
      if (res.status === 400 || res.status === 404) return 'no_route';
      throw new Error(`Routes API ${res.status}${tail}`);
    } catch (e) {
      console.error('❌ city-route: Google Routes не відповів:', e instanceof Error ? e.message : e);
      return 'error';
    }
  }

  /**
   * Дорога містом для людини. `background` — навчання (фоновий таймер або `learn=1` з токеном адміна, так питає
   * `npm run dovede:crawl`): лічильник попиту й «скільки разів віддано» не рахує.
   */
  const find = (q: CityRouteQuery, background = false): Promise<CityRouteAnswer> => answer(q, background, false);

  /** `force` — оновлення збереженої відповіді: базу не читаємо, одразу питаємо Google */
  async function answer(q: CityRouteQuery, background: boolean, force: boolean, trace?: { google: boolean }): Promise<CityRouteAnswer> {
    if (!(await enabled())) return { ok: false, fallback: 'maps', reason: 'disabled' };
    const from = await resolvePoint(q.city, q.from);
    const to = await resolvePoint(q.city, q.to);
    const hour = Number(q.time.slice(0, 2));
    if (!from || !to || from.key === to.key || !Number.isInteger(hour)) return { ok: false, fallback: 'maps', reason: 'no_route' };

    // Житомир: спершу пряма поїздка за власним розкладом (zt.rozklad.in.ua), звіреним з Google, — без запитів назовні
    if (q.city === 'Zhytomyr' && (await ownEnabled())) {
      const own = ownRoute({ from: q.from.trim(), to: q.to.trim(), date: q.date, time: q.time }, { from: from.label, to: to.label });
      if (own) {
        if (background) await markAnswered(q.city, from, to);
        else await noteDemand(q.city, from, to, true);
        return own;
      }
    }

    // Місце в архіві (власник прибрав: Google показує для цих слів не те): ні збереженого, ні нового запиту —
    // сторінка дасть кнопку карти. Попит не рахуємо. Власні дані Житомира вище від архіву не залежать
    const hidden = await archivedPlaces();
    if (hidden.has(`${q.city}|${from.key}`) || hidden.has(`${q.city}|${to.key}`)) return { ok: false, fallback: 'maps', reason: 'archived' };

    const stored = force
      ? null
      : await findStored(q, from, to, hour).catch((e) => {
          console.error('❌ city-route: читання з бази:', e);
          return null;
        });
    if (stored) {
      if (!background) {
        await prisma.dovedeCityRoute.update({ where: { id: stored.id }, data: { hits: { increment: 1 }, lastAskedAt: now() } }).catch(() => undefined);
        await noteDemand(q.city, from, to, true);
      } else {
        await markAnswered(q.city, from, to);
      }
      const mine = await ownLines(q, stored.steps as unknown as CityStep[], stored.minutes);
      return { ok: true, source: stored.source === 'own' ? 'own' : 'stored', city: q.city, fromLabel: stored.fromLabel, toLabel: stored.toLabel, steps: mine.steps, minutes: mine.minutes, fetchedAt: stored.fetchedAt.toISOString() };
    }

    // Київ (крок 8б-2): одна лінія «Київпастрансу» між зупинками, які Google уже показав біля обох кінців, — без Google
    if (!force && q.city === 'Kyiv' && (await ownEnabled())) {
      const own = await ownKyiv(q, from, to).catch((e) => {
        console.error('❌ city-route: своя поїздка Києвом:', e);
        return null;
      });
      if (own) {
        if (background) await markAnswered(q.city, from, to);
        else await noteDemand(q.city, from, to, true);
        return { ok: true, source: 'own', city: q.city, fromLabel: from.label, toLabel: to.label, steps: own.steps, minutes: own.minutes, fetchedAt: own.fetchedAt };
      }
    }

    const got = await askGoogle(q, from, to, background ? 'learn' : 'people', trace);
    if (typeof got === 'string') {
      if (!background) await noteDemand(q.city, from, to, false);
      if (!background && (got === 'cap' || got === 'denied')) await noteRefused();
      return { ok: false, fallback: 'maps', reason: got };
    }
    if (store()) {
      await remember(q, from, to, hour, got).catch((e) => console.error('❌ city-route: запис у базу:', e));
    }
    if (background) await markAnswered(q.city, from, to);
    else await noteDemand(q.city, from, to, true);
    const mine = await ownLines(q, got.steps, got.minutes, got.stops);
    return { ok: true, source: 'google', city: q.city, fromLabel: from.label, toLabel: to.label, steps: mine.steps, minutes: mine.minutes, fetchedAt: now().toISOString() };
  }

  /**
   * Один крок фонового навчання: найзапитуваніші пари без свіжої відповіді (і стартовий набір, поки попиту немає),
   * далі — збережені відповіді, що застаріли або застаріють за `refreshLeadDays` (спершу ті, які віддавали людям).
   * Не більше `batch` за раз і лише поки денний ліміт використано менше ніж наполовину — решта для людей.
   */
  async function learnTick(batchArg?: number): Promise<{ asked: number; learned: number }> {
    if (!(await enabled()) || !store() || !deps.key()) return { asked: 0, learned: 0 };
    // скільки пар за крок — з налаштувань (кнопка «Оновити зараз» в адмінці задає своє)
    const batch = batchArg ?? (await settingsStore.int('learn.batch'));
    // обнулені кнопкою «Скинути лічильник попиту» пари навчання не бере, поки їх знову не спитає людина
    // …і пари, на які навчання вже питало Google без успіху, — тиждень (інакше кілька «мертвих» пар зʼїдали б кожен крок)
    const retryFrom = new Date(now().getTime() - (await retryMs()));
    const demand = await prisma.dovedeCityDemand.findMany({
      where: { asked: { gt: 0 }, OR: [{ learnFailedAt: null }, { learnFailedAt: { lt: retryFrom } }] },
      orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }],
      take: 40,
    });
    const freshFrom = await freshSince();
    const queue: Array<{ city: CityCode; from: string; to: string; demandId?: number }> = [
      ...demand
        .filter((d) => isLearnCity(d.cityCode))
        .map((d) => ({ city: d.cityCode as CityCode, from: storedPoint(d.fromKey, d.fromLabel), to: storedPoint(d.toKey, d.toLabel), demandId: d.id })),
      ...SEED_PAIRS,
    ];
    // навчаємось на «звичайний ранок»: найближчий будень, 09:00 за Києвом
    const at = nextWeekdayMorning(now());
    let asked = 0;
    let learned = 0;
    // ліміт, квота, немає ключа, збій Google — не вина пари: позначок не ставимо, решту кроку не питаємо
    let halted = false;
    for (const pair of queue) {
      if (asked >= batch) break;
      if ((await callsToday()) >= (await learnCap())) break;
      const from = await resolvePoint(pair.city, pair.from);
      const to = await resolvePoint(pair.city, pair.to);
      if (!from || !to) continue;
      const q: CityRouteQuery = { city: pair.city, from: pair.from, to: pair.to, date: at.date, time: '09:00', departAt: at.utc };
      // будь-який рядок цієї пари (і заархівований) — навчання її вже не чіпає: архів — рішення власника
      const known = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: pair.city, fromKey: from.key, toKey: to.key, OR: [{ archivedAt: { not: null } }, { fetchedAt: { gte: freshFrom } }] } });
      if (known) continue;
      const seedKey = `${pair.city}|${from.key}|${to.key}`;
      if (pair.demandId === undefined && (seedFailed.get(seedKey) ?? 0) > retryFrom.getTime()) continue;
      const r = await find(q, true);
      // місце в архіві — рішення власника: Google не питали, пара навчанню не потрібна
      if (!r.ok && r.reason === 'archived') continue;
      if (!r.ok && r.reason !== 'no_route') {
        if (r.reason === 'error') asked++;
        halted = true;
        break;
      }
      asked++;
      if (r.ok) {
        learned++;
      } else if (pair.demandId !== undefined) {
        await prisma.dovedeCityDemand.update({ where: { id: pair.demandId }, data: { learnFailedAt: now() } }).catch((e) => console.error('❌ city-route: позначка невдалого навчання:', e));
      } else {
        seedFailed.set(seedKey, now().getTime());
      }
    }

    // Оновлення збереженого: той самий тип дня й година, що в рядку, — людина з тим самим питанням і далі отримає
    // відповідь із бази. Архів не чіпаємо (рішення власника); власні дані оновлює їхній генератор.
    if ((await refresh()) && !halted) {
      const days = await freshDays();
      const edge = new Date(now().getTime() - (days - refreshLeadDays(days)) * 24 * 3600_000);
      const retryFrom = new Date(now().getTime() - (await retryMs()));
      const rows = await prisma.dovedeCityRoute.findMany({
        where: { source: 'google', archivedAt: null, fetchedAt: { lt: edge }, OR: [{ refreshFailedAt: null }, { refreshFailedAt: { lt: retryFrom } }] },
        orderBy: [{ hits: 'desc' }, { fetchedAt: 'asc' }],
        take: batch * 4,
      });
      // не вдалося — позначаємо рядок: повторимо за тиждень, а не щогодини (людина з цим питанням усе одно спитає Google)
      const giveUp = (id: number) => prisma.dovedeCityRoute.update({ where: { id }, data: { refreshFailedAt: now() } }).catch((e) => console.error('❌ city-route: позначка невдалого оновлення:', e));
      for (const row of rows) {
        if (asked >= batch) break;
        if ((await callsToday()) >= (await learnCap())) break;
        if (!isLearnCity(row.cityCode) || !DAY_TYPES.includes(row.dayType as DayType)) {
          await giveUp(row.id);
          continue;
        }
        const slot = nextSlot(now(), row.dayType as DayType, row.hour);
        const q: CityRouteQuery = { city: row.cityCode, from: storedPoint(row.fromKey, row.fromLabel), to: storedPoint(row.toKey, row.toLabel), date: slot.date, time: slot.time, departAt: slot.utc };
        const r = await answer(q, true, true);
        if (r.ok && r.source === 'google') {
          asked++;
          learned++;
          continue;
        }
        // ліміт, квота, немає ключа, збій Google — рядок ні до чого, спробуємо наступного разу
        if (!r.ok && r.reason !== 'no_route' && r.reason !== 'archived') {
          if (r.reason === 'error') asked++;
          break;
        }
        await giveUp(row.id);
        // `r.ok` тут — пару тепер закривають власні дані, `archived` — місце в архіві: Google не питали, лічити нічого
        if (!r.ok && r.reason === 'no_route') asked++;
      }
    }
    return { asked, learned };
  }

  /**
   * Питання кампанії навчання (`city-campaign.ts`): як фонове навчання (попиту не рахує), а ще каже, чи пішов запит
   * до Google — бюджет кампанії рахує саме їх.
   */
  async function campaignAsk(q: CityRouteQuery): Promise<{ answer: CityRouteAnswer; googleCalled: boolean }> {
    const trace = { google: false };
    const r = await answer(q, true, false, trace);
    return { answer: r, googleCalled: trace.google };
  }

  /**
   * Що відповів би сервер без Google — для оцінки кампанії, нічого не пише: `own` — власні дані Житомира, `fresh` —
   * свіжа відповідь у базі (той самий тип дня, година ± 1; у місті зі своїм датасетом — будь-яка година), `archived` — місце в архіві, `invalid` — слова не місце,
   * `none` — треба питати Google. Збережене читає одним запитом на всі питання.
   */
  async function peekMany(qs: CityRouteQuery[]): Promise<CityPeek[]> {
    const own = await ownEnabled();
    const hidden = await archivedPlaces();
    const resolved = await Promise.all(qs.map(async (q) => ({ q, from: await resolvePoint(q.city, q.from), to: await resolvePoint(q.city, q.to), hour: Number(q.time.slice(0, 2)) })));
    const keys = new Set<string>();
    for (const r of resolved) if (r.from && r.to) keys.add(r.from.key).add(r.to.key);
    const freshFrom = await freshSince();
    const rows = keys.size
      ? await prisma.dovedeCityRoute
          .findMany({
            where: { cityCode: { in: [...new Set(qs.map((q) => q.city))] }, archivedAt: null, fetchedAt: { gte: freshFrom }, fromKey: { in: [...keys] }, toKey: { in: [...keys] } },
            select: { cityCode: true, fromKey: true, toKey: true, dayType: true, hour: true },
          })
          .catch((e) => {
            console.error('❌ city-route: оцінка — база не відповіла:', e instanceof Error ? e.message : e);
            return [];
          })
      : [];
    const have = new Set(rows.map((r) => `${r.cityCode}|${r.fromKey}|${r.toKey}|${r.dayType}|${r.hour}`));
    // місто зі своїм датасетом: дорога пари годиться на будь-яку годину, як і в `findStored`
    const pairs = new Set(rows.map((r) => `${r.cityCode}|${r.fromKey}|${r.toKey}`));
    return resolved.map(({ q, from, to, hour }): CityPeek => {
      if (!from || !to || from.key === to.key || !Number.isInteger(hour)) return 'invalid';
      if (q.city === 'Zhytomyr' && own && ownRoute({ from: q.from.trim(), to: q.to.trim(), date: q.date, time: q.time }, { from: from.label, to: to.label })) return 'own';
      if (hidden.has(`${q.city}|${from.key}`) || hidden.has(`${q.city}|${to.key}`)) return 'archived';
      if (OWN_DATASET.has(q.city)) return pairs.has(`${q.city}|${from.key}|${to.key}`) ? 'fresh' : 'none';
      const day = dayTypeOf(q.date);
      return [hour - 1, hour, hour + 1].some((h) => have.has(`${q.city}|${from.key}|${to.key}|${day}|${h}`)) ? 'fresh' : 'none';
    });
  }

  /** Стан денного обліку Google для кампаній: скільки питали, ліміт, скільки людям відмовили, чи пауза після відмови */
  async function googleBudget(): Promise<{
    calls: number;
    cap: number;
    refused: number;
    blocked: 'cap' | 'denied' | null;
    hasKey: boolean;
    enabled: boolean;
    /** остання відмова Google за сьогодні з її текстом (для сповіщення власнику) */
    lastError: { status: number; message: string } | null;
  }> {
    const [calls, cap, row, blocked, on] = await Promise.all([callsToday(), capNow(), dayRow(), blockedNow(), enabled()]);
    const lastError = row?.lastErrorStatus ? { status: row.lastErrorStatus, message: row.lastErrorMessage ?? '' } : googleError ? { status: googleError.status, message: googleError.message } : null;
    return { calls, cap, refused: row?.refused ?? 0, blocked, hasKey: Boolean(deps.key()), enabled: on && store(), lastError };
  }

  /** Зведення для адмінки */
  async function stats() {
    const fresh = await freshDays();
    const [routes, lines, stops, archived, today, demand, unanswered, stale] = await Promise.all([
      prisma.dovedeCityRoute.groupBy({ by: ['cityCode', 'source'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityLine.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityStop.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityRoute.count({ where: { archivedAt: { not: null } } }),
      callsToday(),
      prisma.dovedeCityDemand.findMany({ where: { asked: { gt: 0 } }, orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 30 }),
      prisma.dovedeCityDemand.findMany({ where: { asked: { gt: 0 }, answered: false }, orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 100 }),
      prisma.dovedeCityRoute.count({ where: { source: 'google', archivedAt: null, fetchedAt: { lt: new Date(now().getTime() - fresh * 24 * 3600_000) } } }),
    ]);
    const [day, lastError] = await Promise.all([
      dayRow(),
      prisma.dovedeCityGoogleDay.findFirst({ where: { lastErrorAt: { not: null } }, orderBy: { lastErrorAt: 'desc' } }).catch(() => null),
    ]);
    // остання відмова: з бази (переживає перезапуск, спільна для контейнерів), інакше — з памʼяті цього процесу
    const fromDb = lastError?.lastErrorAt && lastError.lastErrorStatus != null ? { at: lastError.lastErrorAt, status: lastError.lastErrorStatus, message: lastError.lastErrorMessage ?? '' } : null;
    const lastRefusal = [fromDb, googleError].filter((x): x is { at: Date; status: number; message: string } => x != null).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
    const blockedTill = day?.blockedUntil && day.blockedUntil.getTime() > now().getTime() ? day.blockedUntil : null;
    return {
      enabled: await enabled(),
      store: store(),
      hasKey: Boolean(deps.key()),
      // остання відмова Google (статус і його власний текст); null — не відмовляв
      googleError: lastRefusal ? { at: lastRefusal.at.toISOString(), status: lastRefusal.status, message: lastRefusal.message } : null,
      callsToday: today,
      // з чого склались сьогоднішні запити: люди, навчання; скільки людям відмовили через ліміт чи квоту
      today: { people: day?.people ?? 0, learn: day?.learn ?? 0, refused: day?.refused ?? 0 },
      // пауза після відмови Google (429 — квота, 401 / 403 — доступ): до цього часу Google не питаємо
      blocked: blockedTill ? { until: blockedTill.toISOString(), reason: day?.blockedReason === 'denied' ? 'denied' : 'quota' } : null,
      dailyCap: await capNow(),
      // без значення з адмінки — ліміт зі змінної середовища (або 150 з коду); `dailyCapFromAdmin` — власник задав свій
      dailyCapDefault: await defaultCap(),
      dailyCapFromAdmin: (await settingsStore.view('city.dailyCap')).stored != null,
      freshDays: fresh,
      freshDaysDefault: CITY_FRESH_DAYS,
      // збережені відповіді з Google, старші за строк свіжості: людям їх не віддаємо; `refresh` — навчання оновлює їх саме
      staleRoutes: stale,
      refresh: await refresh(),
      archivedRoutes: archived,
      routes: routes.map((r) => ({ city: r.cityCode, source: r.source, count: r._count._all })),
      lines: lines.map((r) => ({ city: r.cityCode, count: r._count._all })),
      stops: stops.map((r) => ({ city: r.cityCode, count: r._count._all })),
      demand: demand.map((d) => ({ city: d.cityCode, from: d.fromLabel, to: d.toLabel, asked: d.asked, answered: d.answered, lastAskedAt: d.lastAskedAt.toISOString() })),
      // питання людей, на які відповіді не знайшлось (ліміт, збій, Google не знає місця): з ключами — для повторної спроби обходом
      unanswered: unanswered.map((d) => ({ city: d.cityCode, fromKey: d.fromKey, toKey: d.toKey, from: d.fromLabel, to: d.toLabel, asked: d.asked })),
    };
  }

  /** Архівує все, що прийшло з Google (маршрути, лінії, зупинки). Нічого не видаляє; дані власника не чіпає */
  async function archiveGoogle(): Promise<{ routes: number; lines: number; stops: number }> {
    const at = now();
    const where = { source: 'google', archivedAt: null };
    const [routes, lines, stops] = await prisma.$transaction([
      prisma.dovedeCityRoute.updateMany({ where, data: { archivedAt: at } }),
      prisma.dovedeCityLine.updateMany({ where, data: { archivedAt: at } }),
      prisma.dovedeCityStop.updateMany({ where, data: { archivedAt: at } }),
    ]);
    return { routes: routes.count, lines: lines.count, stops: stops.count };
  }

  async function restoreGoogle(): Promise<{ routes: number; lines: number; stops: number }> {
    const where = { source: 'google', archivedAt: { not: null } };
    const [routes, lines, stops] = await prisma.$transaction([
      prisma.dovedeCityRoute.updateMany({ where, data: { archivedAt: null } }),
      prisma.dovedeCityLine.updateMany({ where, data: { archivedAt: null } }),
      prisma.dovedeCityStop.updateMany({ where, data: { archivedAt: null } }),
    ]);
    // місця, які власник прибрав окремо, лишаються в архіві: їхні дороги повертає лише «Повернути» біля самого місця
    let kept = 0;
    const at = now();
    for (const m of await prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } } })) {
      const again = await prisma.dovedeCityRoute.updateMany({ where: { cityCode: m.cityCode, source: 'google', archivedAt: null, OR: [{ toKey: m.key }, { fromKey: m.key }] }, data: { archivedAt: at } });
      kept += again.count;
    }
    return { routes: routes.count - kept, lines: lines.count, stops: stops.count };
  }

  /** Ключ місця для архіву: слова людини; id точки посадки чи станції метро архівувати не можна — це наші власні точки */
  function placeKey(raw: string): string | null {
    const value = raw.trim();
    if (!value || value.length > 120 || isKnownPointId(value)) return null;
    const key = normalizeKey(value);
    return key.length >= 2 ? key : null;
  }

  const placeRoutes = (city: CityCode, key: string) => ({ cityCode: city, source: 'google', OR: [{ toKey: key }, { fromKey: key }] });

  /**
   * Архів одного місця: усі збережені з Google дороги до нього й від нього йдуть в архів, а саме місце — у
   * `DovedeCityPlace`: далі про нього не віддаємо збереженого й не питаємо Google (людина отримує кнопку карти),
   * навчання й оновлення його не чіпають. Нічого не видаляється. null — це не місце словами (порожньо, id точки).
   */
  async function archivePlace(city: CityCode, raw: string): Promise<{ city: CityCode; key: string; label: string; routes: number } | null> {
    const key = placeKey(raw);
    if (!key) return null;
    const at = now();
    const sample = await prisma.dovedeCityRoute.findFirst({ where: placeRoutes(city, key) });
    const label = sample ? (sample.toKey === key ? sample.toLabel : sample.fromLabel) : raw.trim().replace(/\s+/g, ' ');
    await prisma.dovedeCityPlace.upsert({ where: { cityCode_key: { cityCode: city, key } }, create: { cityCode: city, key, label, archivedAt: at }, update: { label, archivedAt: at } });
    const done = await prisma.dovedeCityRoute.updateMany({ where: { ...placeRoutes(city, key), archivedAt: null }, data: { archivedAt: at } });
    archivedMemo = null;
    return { city, key, label, routes: done.count };
  }

  /** Повертає місце з архіву разом із його збереженими дорогами (застарілі за цей час навчання оновить саме) */
  async function restorePlace(city: CityCode, raw: string): Promise<{ city: CityCode; key: string; routes: number } | null> {
    const key = placeKey(raw);
    if (!key) return null;
    await prisma.dovedeCityPlace.updateMany({ where: { cityCode: city, key, archivedAt: { not: null } }, data: { archivedAt: null } });
    const done = await prisma.dovedeCityRoute.updateMany({ where: { ...placeRoutes(city, key), archivedAt: { not: null } }, data: { archivedAt: null } });
    archivedMemo = null;
    return { city, key, routes: done.count };
  }

  /**
   * Місця словами, про які є збережені дороги з Google (кінець пари, що не є нашою точкою), і місця в архіві.
   * Для адмінки: знайти місце з неправильною відповіддю й прибрати саме його.
   */
  async function places(): Promise<CityPlaceRow[]> {
    const [rows, marks] = await Promise.all([
      prisma.dovedeCityRoute.findMany({ where: { source: 'google' }, select: { cityCode: true, fromKey: true, toKey: true, fromLabel: true, toLabel: true, minutes: true, archivedAt: true } }),
      prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } } }),
    ]);
    const byKey = new Map<string, CityPlaceRow>();
    const entry = (city: string, key: string, label: string): CityPlaceRow => {
      const id = `${city}|${key}`;
      let p = byKey.get(id);
      if (!p) {
        p = { city, key, label, routes: 0, archivedRoutes: 0, minMinutes: null, maxMinutes: null, archivedAt: null };
        byKey.set(id, p);
      }
      return p;
    };
    const add = (city: string, key: string, label: string, minutes: number, archived: boolean) => {
      if (isKnownPointId(key)) return;
      const p = entry(city, key, label);
      if (archived) p.archivedRoutes++;
      else p.routes++;
      p.minMinutes = p.minMinutes == null ? minutes : Math.min(p.minMinutes, minutes);
      p.maxMinutes = p.maxMinutes == null ? minutes : Math.max(p.maxMinutes, minutes);
    };
    for (const r of rows) {
      add(r.cityCode, r.toKey, r.toLabel, r.minutes, r.archivedAt != null);
      add(r.cityCode, r.fromKey, r.fromLabel, r.minutes, r.archivedAt != null);
    }
    for (const m of marks) entry(m.cityCode, m.key, m.label).archivedAt = (m.archivedAt as Date).toISOString();
    return [...byKey.values()].sort((a, b) => a.city.localeCompare(b.city) || a.label.localeCompare(b.label, 'uk'));
  }

  /**
   * Обнуляє лічильник попиту (після прогону самонавчання, щоб його пари не стояли поруч із питаннями людей).
   * Рядки лишаються: ці таблиці не видаляються. Збережені дороги, лінії й зупинки не зачеплено.
   */
  /**
   * Дороги одного місця (розгортка в адмінці «Місто» → «Місця»): усі збережені — з Google і власні, і в архіві —
   * від точки й до точки, з типом дня, годиною, хвилинами, лініями й датою; нічого не міняє.
   */
  async function placeRouteList(city: CityCode, key: string): Promise<CityPlaceRoute[]> {
    const rows = await prisma.dovedeCityRoute.findMany({
      where: { cityCode: city, OR: [{ fromKey: key }, { toKey: key }] },
      orderBy: [{ archivedAt: 'asc' }, { hits: 'desc' }, { fetchedAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => ({
      from: r.fromLabel,
      to: r.toLabel,
      dir: r.toKey === key ? 'to' : 'from',
      dayType: r.dayType,
      hour: r.hour,
      minutes: r.minutes,
      source: r.source,
      hits: r.hits,
      fetchedAt: r.fetchedAt.toISOString(),
      archived: r.archivedAt != null,
      lines: (Array.isArray(r.steps) ? (r.steps as unknown as CityStep[]) : []).filter((s) => s.kind === 'transit').map((s) => [s.mode ?? '', s.line ?? ''].filter(Boolean).join(' ')),
    }));
  }

  /** Що питають люди в місті: усі пари з лічильником > 0 (або лише без відповіді), найчастіші першими */
  async function demandList(city: CityCode | null, onlyUnanswered: boolean, limit = 500) {
    const rows = await prisma.dovedeCityDemand.findMany({
      where: { asked: { gt: 0 }, ...(city ? { cityCode: city } : {}), ...(onlyUnanswered ? { answered: false } : {}) },
      orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }],
      take: limit,
    });
    return rows.map((d) => ({ city: d.cityCode, fromKey: d.fromKey, toKey: d.toKey, from: d.fromLabel, to: d.toLabel, asked: d.asked, answered: d.answered, lastAskedAt: d.lastAskedAt.toISOString() }));
  }

  async function resetDemand(): Promise<{ reset: number }> {
    const r = await prisma.dovedeCityDemand.updateMany({ where: { asked: { gt: 0 } }, data: { asked: 0 } });
    return { reset: r.count };
  }

  return { find, campaignAsk, peekMany, googleBudget, learnTick, stats, placeRouteList, demandList, archiveGoogle, restoreGoogle, archivePlace, restorePlace, places, resetDemand, setFreshDays, setDailyCap };
}

export type CityRoutes = ReturnType<typeof createCityRoutes>;

/** Найближчий будень о 09:00 за Києвом (взимку UTC+2, влітку UTC+3 — похибка в годину для навчання неважлива) */
export function nextWeekdayMorning(now: Date): { date: string; utc: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 7, 0, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10), utc: d };
}

export function cityRoutesFromEnv(prisma: PrismaClient, settings?: DovedeSettings): CityRoutes {
  return createCityRoutes({ prisma, key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null, ...(settings ? { settings } : {}) });
}
