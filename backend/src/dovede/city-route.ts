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
 */
import type { PrismaClient } from '@prisma/client';
import { METRO_STATIONS } from './kyivMetroData';
import { kyivDayStart } from './guard';
import { kyivWallToUtc } from '../viber-listing-expiry';

/** Скільки днів збережена відповідь свіжа, поки власник не задав свого в адмінці */
export const CITY_FRESH_DAYS = 30;
export const CITY_FRESH_DAYS_MIN = 1;
export const CITY_FRESH_DAYS_MAX = 365;
/** Налаштування з бази тримаємо в памʼяті хвилину: читати їх на кожен запит людини зайве */
const SETTINGS_TTL_MS = 60_000;

/** За скільки днів до кінця строку свіжості навчання оновлює відповідь, щоб людина не натрапила на застарілу */
export const refreshLeadDays = (freshDays: number): number => Math.min(2, Math.floor(freshDays / 4));

/** Пару чи рядок, де Google дороги не знайшов (або збій), навчання не чіпає стільки днів — щоб не палити ліміт щогодини на те саме */
export const REFRESH_RETRY_DAYS = 7;

export const isValidFreshDays = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= CITY_FRESH_DAYS_MIN && v <= CITY_FRESH_DAYS_MAX;
export const DEFAULT_CITY_DAILY_CAP = 150;
const TIMEOUT_MS = 4000;
import { ownZhytomyrRoute } from './zhytomyr-own';
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

export type CityCode = 'Kyiv' | 'Zhytomyr';
export const CITY_NAME: Record<CityCode, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };

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
}

export type CityRouteAnswer =
  | { ok: true; source: 'google' | 'stored' | 'own'; city: CityCode; fromLabel: string; toLabel: string; steps: CityStep[]; minutes: number; fetchedAt: string }
  | { ok: false; fallback: 'maps'; reason: 'disabled' | 'no_key' | 'cap' | 'error' | 'no_route' };

export interface CityPoint {
  /** ключ для бази */
  key: string;
  /** як показати людині */
  label: string;
  /** що питати в Google */
  address: string;
}

/** Точки, які «Доведе» знає за id: куди привозять міжміські рейси */
const KNOWN_POINTS: Record<string, { label: string; address: string; city: CityCode }> = {
  'zhytomyr.avtovokzal': { label: 'автовокзал Житомир-1', address: 'Автовокзал Житомир-1, вул. Київська 93, Житомир, Україна', city: 'Zhytomyr' },
  'kyiv.pas': { label: 'вокзал Київ-Пасажирський', address: 'Приміський вокзал, Київ, Україна', city: 'Kyiv' },
  'kyiv.borshch': { label: 'платформа «Борщагівка»', address: 'зупинний пункт Борщагівка, Київ, Україна', city: 'Kyiv' },
};

export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[«»"().,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Точка за id (автовокзал, станція метро) або словами людини («Польова 12», «Охматдит»); null — порожньо чи сміття */
export function resolveCityPoint(city: CityCode, raw: string): CityPoint | null {
  const value = raw.trim();
  if (!value || value.length > 120) return null;
  const known = KNOWN_POINTS[value];
  if (known) return known.city === city ? { key: value, label: known.label, address: known.address } : null;
  const metro = METRO_STATIONS.find((s) => s.id === value);
  if (metro) return city === 'Kyiv' ? { key: value, label: `метро «${metro.name}»`, address: `станція метро ${metro.name}, Київ, Україна` } : null;
  // id якогось іншого словника сюди не має потрапляти
  if (/^[a-z]+\.[a-z0-9.:-]+$/i.test(value) || /^st_\d+$/.test(value)) return null;
  const key = normalizeKey(value);
  if (key.length < 2) return null;
  return { key, label: value.replace(/\s+/g, ' '), address: `${value}, ${CITY_NAME[city]}, Україна` };
}

/** id точки, яку «Доведе» знає сам (місце висадки, станція метро), — на відміну від слів людини */
const isKnownPointId = (value: string): boolean => Boolean(KNOWN_POINTS[value]) || METRO_STATIONS.some((s) => s.id === value);

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

export function dayTypeOf(isoDate: string): DayType {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 'sunday' : wd === 6 ? 'saturday' : 'weekday';
}

const seconds = (v: unknown): number => Number(String(v ?? '').replace(/s$/, '')) || 0;

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
];

export function createCityRoutes(deps: CityRoutesDeps) {
  const { prisma } = deps;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = deps.now ?? (() => new Date());
  const enabled = deps.enabled ?? (() => cityRoutesEnabled());
  const store = deps.store ?? (() => cityStoreEnabled());
  const dailyCap = deps.dailyCap ?? (() => cityDailyCap());
  const ownRoute = deps.ownRoute ?? ownZhytomyrRoute;
  // Власні дані Житомира: маршрути й зупинки із сайту власника, хвилини виправлено за Google; `DOVEDE_CITY_OWN=0` вимикає
  const ownEnabled = deps.ownEnabled ?? (() => (process.env.DOVEDE_CITY_OWN ?? '1').trim() !== '0');
  // лічильник у памʼяті — на випадок, коли запис у базу вимкнено й рахувати рядки нема з чого
  let memoDay = '';
  let memoCalls = 0;
  let freshMemo: { at: number; days: number } | null = null;
  const refresh = deps.refresh ?? (() => cityRefreshEnabled());
  // стартові пари, які Google не знайшов: рядка в базі для позначки в них немає, тож памʼятаємо тут (до перезапуску)
  const seedFailed = new Map<string, number>();

  /** Строк свіжості збереженої відповіді, днів: з адмінки (`DovedeCitySettings`), інакше типовий */
  async function freshDays(): Promise<number> {
    const at = now().getTime();
    if (freshMemo && at - freshMemo.at >= 0 && at - freshMemo.at < SETTINGS_TTL_MS) return freshMemo.days;
    try {
      const row = await prisma.dovedeCitySettings.findUnique({ where: { id: 1 } });
      freshMemo = { at, days: row && isValidFreshDays(row.freshDays) ? row.freshDays : CITY_FRESH_DAYS };
      return freshMemo.days;
    } catch (e) {
      console.error('❌ city-route: налаштування не прочитано, беру попередній строк свіжості:', e instanceof Error ? e.message : e);
      return freshMemo?.days ?? CITY_FRESH_DAYS;
    }
  }

  async function setFreshDays(days: number): Promise<number> {
    if (!isValidFreshDays(days)) throw new RangeError(`freshDays: ціле від ${CITY_FRESH_DAYS_MIN} до ${CITY_FRESH_DAYS_MAX}`);
    await prisma.dovedeCitySettings.upsert({ where: { id: 1 }, create: { id: 1, freshDays: days }, update: { freshDays: days } });
    freshMemo = { at: now().getTime(), days };
    return days;
  }

  const freshSince = async (): Promise<Date> => new Date(now().getTime() - (await freshDays()) * 24 * 3600_000);

  async function callsToday(): Promise<number> {
    const today = kyivDayStart(now());
    const key = today.toISOString();
    if (key !== memoDay) {
      memoDay = key;
      memoCalls = 0;
    }
    const stored = await prisma.dovedeCityRoute.count({ where: { source: 'google', fetchedAt: { gte: today } } }).catch(() => 0);
    return Math.max(stored, memoCalls);
  }

  async function findStored(q: CityRouteQuery, from: CityPoint, to: CityPoint, hour: number) {
    const freshFrom = await freshSince();
    const rows = await prisma.dovedeCityRoute.findMany({
      where: { cityCode: q.city, fromKey: from.key, toKey: to.key, dayType: dayTypeOf(q.date), hour: { in: [hour - 1, hour, hour + 1] }, archivedAt: null, fetchedAt: { gte: freshFrom } },
    });
    if (!rows.length) return null;
    // власні дані сильніші за збережені з Google; серед рівних — ближча година
    const rank = (r: (typeof rows)[number]) => (r.source === 'own' ? 0 : 1) * 10 + Math.abs(r.hour - hour);
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

  async function askGoogle(q: CityRouteQuery, from: CityPoint, to: CityPoint): Promise<ParsedGoogleRoute | 'no_key' | 'cap' | 'error' | 'no_route'> {
    const key = deps.key();
    if (!key) return 'no_key';
    if ((await callsToday()) >= dailyCap()) return 'cap';
    memoCalls++;
    try {
      // Google приймає лише майбутній час; для «вже зараз» — без нього
      const future = q.departAt.getTime() > now().getTime() + 60_000;
      const res = await fetchImpl(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ origin: { address: from.address }, destination: { address: to.address }, travelMode: 'TRANSIT', languageCode: 'uk', ...(future ? { departureTime: q.departAt.toISOString() } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Routes API ${res.status}`);
      return parseGoogleRoute(await res.json()) ?? 'no_route';
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
  async function answer(q: CityRouteQuery, background: boolean, force: boolean): Promise<CityRouteAnswer> {
    if (!enabled()) return { ok: false, fallback: 'maps', reason: 'disabled' };
    const from = resolveCityPoint(q.city, q.from);
    const to = resolveCityPoint(q.city, q.to);
    const hour = Number(q.time.slice(0, 2));
    if (!from || !to || from.key === to.key || !Number.isInteger(hour)) return { ok: false, fallback: 'maps', reason: 'no_route' };

    // Житомир: спершу пряма поїздка за власним розкладом (zt.rozklad.in.ua), звіреним з Google, — без запитів назовні
    if (q.city === 'Zhytomyr' && ownEnabled()) {
      const own = ownRoute({ from: q.from.trim(), to: q.to.trim(), date: q.date, time: q.time }, { from: from.label, to: to.label });
      if (own) {
        if (background) await markAnswered(q.city, from, to);
        else await noteDemand(q.city, from, to, true);
        return own;
      }
    }

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
      return { ok: true, source: stored.source === 'own' ? 'own' : 'stored', city: q.city, fromLabel: stored.fromLabel, toLabel: stored.toLabel, steps: stored.steps as unknown as CityStep[], minutes: stored.minutes, fetchedAt: stored.fetchedAt.toISOString() };
    }

    const got = await askGoogle(q, from, to);
    if (typeof got === 'string') {
      if (!background) await noteDemand(q.city, from, to, false);
      return { ok: false, fallback: 'maps', reason: got };
    }
    if (store()) {
      await remember(q, from, to, hour, got).catch((e) => console.error('❌ city-route: запис у базу:', e));
    }
    if (background) await markAnswered(q.city, from, to);
    else await noteDemand(q.city, from, to, true);
    return { ok: true, source: 'google', city: q.city, fromLabel: from.label, toLabel: to.label, steps: got.steps, minutes: got.minutes, fetchedAt: now().toISOString() };
  }

  /**
   * Один крок фонового навчання: найзапитуваніші пари без свіжої відповіді (і стартовий набір, поки попиту немає),
   * далі — збережені відповіді, що застаріли або застаріють за `refreshLeadDays` (спершу ті, які віддавали людям).
   * Не більше `batch` за раз і лише поки денний ліміт використано менше ніж наполовину — решта для людей.
   */
  async function learnTick(batch = 3): Promise<{ asked: number; learned: number }> {
    if (!enabled() || !store() || !deps.key()) return { asked: 0, learned: 0 };
    // обнулені кнопкою «Скинути лічильник попиту» пари навчання не бере, поки їх знову не спитає людина
    // …і пари, на які навчання вже питало Google без успіху, — тиждень (інакше кілька «мертвих» пар зʼїдали б кожен крок)
    const retryFrom = new Date(now().getTime() - REFRESH_RETRY_DAYS * 24 * 3600_000);
    const demand = await prisma.dovedeCityDemand.findMany({
      where: { asked: { gt: 0 }, OR: [{ learnFailedAt: null }, { learnFailedAt: { lt: retryFrom } }] },
      orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }],
      take: 40,
    });
    const freshFrom = await freshSince();
    const queue: Array<{ city: CityCode; from: string; to: string; demandId?: number }> = [
      ...demand
        .filter((d) => d.cityCode === 'Kyiv' || d.cityCode === 'Zhytomyr')
        .map((d) => ({ city: d.cityCode as CityCode, from: storedPoint(d.fromKey, d.fromLabel), to: storedPoint(d.toKey, d.toLabel), demandId: d.id })),
      ...SEED_PAIRS,
    ];
    // навчаємось на «звичайний ранок»: найближчий будень, 09:00 за Києвом
    const at = nextWeekdayMorning(now());
    let asked = 0;
    let learned = 0;
    for (const pair of queue) {
      if (asked >= batch) break;
      if ((await callsToday()) >= Math.floor(dailyCap() / 2)) break;
      const from = resolveCityPoint(pair.city, pair.from);
      const to = resolveCityPoint(pair.city, pair.to);
      if (!from || !to) continue;
      const q: CityRouteQuery = { city: pair.city, from: pair.from, to: pair.to, date: at.date, time: '09:00', departAt: at.utc };
      // будь-який рядок цієї пари (і заархівований) — навчання її вже не чіпає: архів — рішення власника
      const known = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: pair.city, fromKey: from.key, toKey: to.key, OR: [{ archivedAt: { not: null } }, { fetchedAt: { gte: freshFrom } }] } });
      if (known) continue;
      const seedKey = `${pair.city}|${from.key}|${to.key}`;
      if (pair.demandId === undefined && (seedFailed.get(seedKey) ?? 0) > retryFrom.getTime()) continue;
      const r = await find(q, true);
      // ліміт, немає ключа, вимкнено — пара ні до чого
      if (!r.ok && (r.reason === 'cap' || r.reason === 'no_key' || r.reason === 'disabled')) break;
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
    if (refresh()) {
      const days = await freshDays();
      const edge = new Date(now().getTime() - (days - refreshLeadDays(days)) * 24 * 3600_000);
      const retryFrom = new Date(now().getTime() - REFRESH_RETRY_DAYS * 24 * 3600_000);
      const rows = await prisma.dovedeCityRoute.findMany({
        where: { source: 'google', archivedAt: null, fetchedAt: { lt: edge }, OR: [{ refreshFailedAt: null }, { refreshFailedAt: { lt: retryFrom } }] },
        orderBy: [{ hits: 'desc' }, { fetchedAt: 'asc' }],
        take: batch * 4,
      });
      // не вдалося — позначаємо рядок: повторимо за тиждень, а не щогодини (людина з цим питанням усе одно спитає Google)
      const giveUp = (id: number) => prisma.dovedeCityRoute.update({ where: { id }, data: { refreshFailedAt: now() } }).catch((e) => console.error('❌ city-route: позначка невдалого оновлення:', e));
      for (const row of rows) {
        if (asked >= batch) break;
        if ((await callsToday()) >= Math.floor(dailyCap() / 2)) break;
        if ((row.cityCode !== 'Kyiv' && row.cityCode !== 'Zhytomyr') || !DAY_TYPES.includes(row.dayType as DayType)) {
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
        // ліміт, немає ключа, вимкнено — рядок ні до чого, спробуємо наступного разу
        if (!r.ok && (r.reason === 'cap' || r.reason === 'no_key' || r.reason === 'disabled')) break;
        await giveUp(row.id);
        // `r.ok` тут — пару тепер закривають власні дані: Google не питали, лічити нічого
        if (!r.ok) asked++;
      }
    }
    return { asked, learned };
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
    return {
      enabled: enabled(),
      store: store(),
      hasKey: Boolean(deps.key()),
      callsToday: today,
      dailyCap: dailyCap(),
      freshDays: fresh,
      freshDaysDefault: CITY_FRESH_DAYS,
      // збережені відповіді з Google, старші за строк свіжості: людям їх не віддаємо; `refresh` — навчання оновлює їх саме
      staleRoutes: stale,
      refresh: refresh(),
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
    return { routes: routes.count, lines: lines.count, stops: stops.count };
  }

  /**
   * Обнуляє лічильник попиту (після прогону самонавчання, щоб його пари не стояли поруч із питаннями людей).
   * Рядки лишаються: ці таблиці не видаляються. Збережені дороги, лінії й зупинки не зачеплено.
   */
  async function resetDemand(): Promise<{ reset: number }> {
    const r = await prisma.dovedeCityDemand.updateMany({ where: { asked: { gt: 0 } }, data: { asked: 0 } });
    return { reset: r.count };
  }

  return { find, learnTick, stats, archiveGoogle, restoreGoogle, resetDemand, setFreshDays };
}

export type CityRoutes = ReturnType<typeof createCityRoutes>;

/** Найближчий будень о 09:00 за Києвом (взимку UTC+2, влітку UTC+3 — похибка в годину для навчання неважлива) */
export function nextWeekdayMorning(now: Date): { date: string; utc: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 7, 0, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10), utc: d };
}

export function cityRoutesFromEnv(prisma: PrismaClient): CityRoutes {
  return createCityRoutes({ prisma, key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null });
}
