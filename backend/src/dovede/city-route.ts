/**
 * «Доведе» · дорога містом між двома точками (Docs/dovede-roadmap.md, етап 3а) — і памʼять про неї.
 *
 * Порядок: (1) свіжа відповідь у базі (той самий ключ, тип дня, година ± 1, не старша 30 днів) — без зовнішніх
 * запитів, це вже наші дані; (2) Google Routes TRANSIT — і все знайдене пишемо в базу: сам маршрут, лінії, зупинки
 * (рішення власника 2026-11-17: зберігати дозволяє його договір з Google; `DOVEDE_CITY_STORE=0` вимикає запис);
 * (3) немає ключа, ліміт, збій — `fallback: 'maps'`, сторінка показує посилання Google Maps.
 *
 * Рядки з Google ніколи не видаляються: «архівувати» ставить `archivedAt` (у відповідях і навчанні їх немає),
 * «відновити» знімає. Дані власника (`source: 'own'`) архівування не зачіпає.
 */
import type { PrismaClient } from '@prisma/client';
import { METRO_STATIONS } from './kyivMetroData';
import { kyivDayStart } from './guard';

export const CITY_FRESH_DAYS = 30;
export const DEFAULT_CITY_DAILY_CAP = 150;
const TIMEOUT_MS = 4000;
import { ownZhytomyrRoute } from './zhytomyr-own';

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
}

export function cityRoutesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOVEDE_CITY_ROUTES ?? 'google').trim().toLowerCase() !== 'off';
}

export function cityStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOVEDE_CITY_STORE ?? '1').trim() !== '0';
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
];

export function createCityRoutes(deps: CityRoutesDeps) {
  const { prisma } = deps;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = deps.now ?? (() => new Date());
  const enabled = deps.enabled ?? (() => cityRoutesEnabled());
  const store = deps.store ?? (() => cityStoreEnabled());
  const dailyCap = deps.dailyCap ?? (() => cityDailyCap());
  const ownRoute = deps.ownRoute ?? ownZhytomyrRoute;
  const ownEnabled = deps.ownEnabled ?? (() => (process.env.DOVEDE_CITY_OWN ?? '1').trim() !== '0');
  // лічильник у памʼяті — на випадок, коли запис у базу вимкнено й рахувати рядки нема з чого
  let memoDay = '';
  let memoCalls = 0;

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
    const freshFrom = new Date(now().getTime() - CITY_FRESH_DAYS * 24 * 3600_000);
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

  async function remember(q: CityRouteQuery, from: CityPoint, to: CityPoint, hour: number, parsed: ParsedGoogleRoute): Promise<void> {
    const at = now();
    const dayType = dayTypeOf(q.date);
    await prisma.dovedeCityRoute.upsert({
      where: { cityCode_fromKey_toKey_dayType_hour_source: { cityCode: q.city, fromKey: from.key, toKey: to.key, dayType, hour, source: 'google' } },
      create: { cityCode: q.city, fromKey: from.key, toKey: to.key, fromLabel: from.label, toLabel: to.label, dayType, hour, steps: parsed.steps as unknown as object, minutes: parsed.minutes, source: 'google', fetchedAt: at },
      // оновлення повертає рядок і з архіву: людина щойно отримала цю відповідь
      update: { steps: parsed.steps as unknown as object, minutes: parsed.minutes, fetchedAt: at, fromLabel: from.label, toLabel: to.label, archivedAt: null },
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

  /** Дорога містом для людини. `background` — фонове навчання: попит не рахує */
  async function find(q: CityRouteQuery, background = false): Promise<CityRouteAnswer> {
    if (!enabled()) return { ok: false, fallback: 'maps', reason: 'disabled' };
    const from = resolveCityPoint(q.city, q.from);
    const to = resolveCityPoint(q.city, q.to);
    const hour = Number(q.time.slice(0, 2));
    if (!from || !to || from.key === to.key || !Number.isInteger(hour)) return { ok: false, fallback: 'maps', reason: 'no_route' };

    // Житомир: спершу пряма поїздка за власним розкладом (zt.rozklad.in.ua), звіреним з Google, — без запитів назовні
    if (q.city === 'Zhytomyr' && ownEnabled()) {
      const own = ownRoute({ from: q.from.trim(), to: q.to.trim(), date: q.date, time: q.time }, { from: from.label, to: to.label });
      if (own) {
        if (!background) await noteDemand(q.city, from, to, true);
        return own;
      }
    }

    const stored = await findStored(q, from, to, hour).catch((e) => {
      console.error('❌ city-route: читання з бази:', e);
      return null;
    });
    if (stored) {
      if (!background) {
        await prisma.dovedeCityRoute.update({ where: { id: stored.id }, data: { hits: { increment: 1 }, lastAskedAt: now() } }).catch(() => undefined);
        await noteDemand(q.city, from, to, true);
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
    if (!background) await noteDemand(q.city, from, to, true);
    return { ok: true, source: 'google', city: q.city, fromLabel: from.label, toLabel: to.label, steps: got.steps, minutes: got.minutes, fetchedAt: now().toISOString() };
  }

  /**
   * Один крок фонового навчання: найзапитуваніші пари без свіжої відповіді (і стартовий набір, поки попиту немає),
   * не більше `batch` за раз і лише поки денний ліміт використано менше ніж наполовину — решта для людей.
   */
  async function learnTick(batch = 3): Promise<{ asked: number; learned: number }> {
    if (!enabled() || !store() || !deps.key()) return { asked: 0, learned: 0 };
    const demand = await prisma.dovedeCityDemand.findMany({ orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 40 });
    const queue: Array<{ city: CityCode; from: string; to: string }> = [
      ...demand.filter((d) => d.cityCode === 'Kyiv' || d.cityCode === 'Zhytomyr').map((d) => ({ city: d.cityCode as CityCode, from: d.fromKey, to: d.toKey })),
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
      const known = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: pair.city, fromKey: from.key, toKey: to.key, OR: [{ archivedAt: { not: null } }, { fetchedAt: { gte: new Date(now().getTime() - CITY_FRESH_DAYS * 24 * 3600_000) } }] } });
      if (known) continue;
      asked++;
      const r = await find(q, true);
      if (r.ok) learned++;
    }
    return { asked, learned };
  }

  /** Зведення для адмінки */
  async function stats() {
    const [routes, lines, stops, archived, today, demand] = await Promise.all([
      prisma.dovedeCityRoute.groupBy({ by: ['cityCode', 'source'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityLine.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityStop.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.dovedeCityRoute.count({ where: { archivedAt: { not: null } } }),
      callsToday(),
      prisma.dovedeCityDemand.findMany({ orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 30 }),
    ]);
    return {
      enabled: enabled(),
      store: store(),
      hasKey: Boolean(deps.key()),
      callsToday: today,
      dailyCap: dailyCap(),
      freshDays: CITY_FRESH_DAYS,
      archivedRoutes: archived,
      routes: routes.map((r) => ({ city: r.cityCode, source: r.source, count: r._count._all })),
      lines: lines.map((r) => ({ city: r.cityCode, count: r._count._all })),
      stops: stops.map((r) => ({ city: r.cityCode, count: r._count._all })),
      demand: demand.map((d) => ({ city: d.cityCode, from: d.fromLabel, to: d.toLabel, asked: d.asked, answered: d.answered, lastAskedAt: d.lastAskedAt.toISOString() })),
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

  return { find, learnTick, stats, archiveGoogle, restoreGoogle };
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
