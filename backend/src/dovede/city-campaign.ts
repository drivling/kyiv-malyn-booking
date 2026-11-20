/**
 * «Доведе» · кампанії навчання міста на сервері (Docs/dovede-admin-roadmap.md, крок 6).
 *
 * Власник в адмінці каже «навчи Житомир» (заготовка), бачить оцінку — скільки запитів до Google це коштуватиме — і
 * погоджує або міняє число (бюджет — кількість запитів до Google). Далі сервер сам, щохвилини (`tick`, фонова задача
 * `dovede-city-campaign`), обходить місця в ширину так само, як локальна команда `npm run dovede:crawl`: питає дорогу
 * від точки висадки до кожного місця (і назад), а зупинки й кінцеві з відповідей стають новими місцями до глибини
 * `maxDepth`. Логіка обходу спільна — `crawl-core.ts`.
 *
 * Межі: увесь бюджет кампанії, її денна частка (`dailyBudget`) і запас для людей — Google питаємо лише поки за день
 * витрачено менше ніж ліміт мінус `reserveFor(ліміт)`. Відмова Google (429 / 403), наш ліміт, вимкнений пошук —
 * кампанія чекає (`waiting` з причиною), питання лишається в черзі. Збережена свіжа відповідь і власні дані Житомира
 * Google не коштують, але теж ведуть обхід далі.
 *
 * Одночасно веде одну кампанію один контейнер (оренда `leaseUntil`): під час деплою їх два. Нічого не видаляється:
 * кампанія з питаннями — журнал, завершену можна лише сховати (`archivedAt`).
 */
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { DovedeCityCampaign, PrismaClient } from '@prisma/client';
import {
  ARRIVAL_POINTS,
  DAY_TYPES,
  POINT_LABEL,
  candidates,
  compactSteps,
  rejectedNames,
  normalizeKey,
  parseSlots,
  seedsFromUnanswered,
  siteForm,
  type CrawlCity,
  type CrawlDayType,
  type CrawlDir,
} from './crawl-core';
import { LEARN_PLACES } from './learn-places';
import { LEARN_CITY_CODES, byLearnCity, learnCity } from './learn-cities';
import { CITY_NAME, MODE_PAIRS, nextSlot, storedPoint, type CityRouteQuery, type CityRoutes } from './city-route';
import { ZT_OWN } from './zhytomyr-own-data';
import { PRIMARY_SITE, siteUrl } from '../site-domains';
import { kyivDayStart } from './guard';
import type { DovedeSettings } from './settings';

export interface CampaignSlot {
  dayType: CrawlDayType;
  hour: number;
}

/** Місце рівня 0: слова; точка й напрямок — якщо місце питали саме так (питання людей, «види транспорту») */
export interface CampaignSeed {
  place: string;
  via: string;
  origin?: string;
  dir?: CrawlDir;
  /** свої години замість основних плану («Освіжити застаріле»: тип дня й година застарілої відповіді) */
  slots?: CampaignSlot[];
}

export interface CampaignPlan {
  city: CrawlCity;
  /** точки висадки (id) — для місць без своєї точки */
  origins: string[];
  dirs: CrawlDir[];
  /** години, на які питаємо кожне місце */
  main: CampaignSlot[];
  /** додаткові — лише для місць, що отримали відповідь в основну годину */
  extra: CampaignSlot[];
  maxDepth: number;
  seeds: CampaignSeed[];
  /** години беруться з місць (`CampaignSeed.slots`), а не з `main` */
  ownSlots?: boolean;
}

/** Що власник може поміняти в заготовці */
export interface CampaignOptions {
  origins?: string[];
  dirs?: CrawlDir[];
  /** 'weekday@09,saturday@11' — як `--when` у `dovede:crawl` */
  main?: string;
  extra?: string;
  maxDepth?: number;
  /** «Свій список»: місця по одному в рядку */
  places?: string;
}

export interface CampaignInput {
  preset: string;
  city: string;
  options?: CampaignOptions;
  /** погоджена кількість запитів до Google: усього й на добу */
  budget?: number;
  dailyBudget?: number;
}

export class CampaignInputError extends Error {}

export const MAX_DEPTH = 3;
export const MAX_BUDGET = 20_000;
export const MAX_DAILY_BUDGET = 5_000;
/** місць рівня 0 і всього в одній кампанії — запобіжник від обходу, що розрісся */
export const MAX_SEED_PLACES = 2_000;
export const MAX_PLACES = 5_000;
const MAX_SLOTS = 12;
/** за одну хвилину — не більше стількох питань і не довше ніж стільки */
export const ASKS_PER_TICK = 20;
const TICK_MS = 50_000;
const LEASE_MS = 2 * 60_000;
/** питання «в роботі» довше за це — контейнер зник посеред питання, повертаємо в чергу */
const STUCK_MS = 5 * 60_000;
const WAIT_MS = 30 * 60_000;
const ERROR_WAIT_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const ERRORS_IN_ROW = 3;

/** Скільки з денного ліміту Google кампанії не чіпають — людям: п'ята частина, не менше 50 */
export const reserveFor = (cap: number): number => Math.min(cap, Math.max(50, Math.ceil(cap * 0.2)));

const ACTIVE = ['running', 'waiting'];

/** Кінцеві всіх маршрутів Житомира з власних даних */
const zhytomyrTerminals = (): string[] => [...new Set(ZT_OWN.dirs.map((d) => d.stops[d.stops.length - 1][0]))].sort();

interface PresetCtx {
  prisma: PrismaClient;
  city: CrawlCity;
  options: CampaignOptions;
  now: Date;
  /** строк свіжості збереженої відповіді, днів (`city.freshDays`) */
  freshDays: number;
}

export interface CampaignPreset {
  id: string;
  title: string;
  help: string;
  cities: readonly CrawlCity[];
  /** власник пише свій список місць */
  custom?: boolean;
  /** години — свої в кожного місця (власник їх не вибирає) */
  ownSlots?: boolean;
  defaults: (city: CrawlCity) => { origins: string[]; dirs: CrawlDir[]; main: string; extra: string; maxDepth: number };
  seeds: (ctx: PresetCtx) => Promise<CampaignSeed[]>;
}

const DEFAULT_ORIGINS: Record<CrawlCity, string[]> = byLearnCity((c) => [...c.defaultOrigins]);

/** Точка висадки або станція метро (`MODE_PAIRS`) — кінець пари, від якого навчаємось */
const isPointKey = (city: CrawlCity, key: string): boolean => ARRIVAL_POINTS[city].includes(key) || key.startsWith('kyiv.m.');

/** Скільки застарілих відповідей бере «Освіжити застаріле» за раз */
const STALE_LIMIT = 2000;

/** Відповіді Google, старші за строк свіжості, — місце з точкою, напрямком і своїми годинами (тип дня й година рядка) */
async function staleSeeds(prisma: PrismaClient, city: CrawlCity, now: Date, freshDays: number): Promise<CampaignSeed[]> {
  const rows = await prisma.dovedeCityRoute.findMany({
    where: { cityCode: city, source: 'google', archivedAt: null, fetchedAt: { lt: new Date(now.getTime() - freshDays * 24 * 3600_000) } },
    select: { fromKey: true, toKey: true, fromLabel: true, toLabel: true, dayType: true, hour: true },
    orderBy: { hits: 'desc' },
    take: STALE_LIMIT,
  });
  const byPlace = new Map<string, CampaignSeed & { slots: CampaignSlot[] }>();
  for (const r of rows) {
    const fromPoint = isPointKey(city, r.fromKey);
    if (fromPoint === isPointKey(city, r.toKey)) continue;
    if (!DAY_TYPES.includes(r.dayType as CrawlDayType) || !Number.isInteger(r.hour)) continue;
    const seed = fromPoint
      ? { place: storedPoint(r.toKey, r.toLabel), origin: r.fromKey, dir: 'to' as const }
      : { place: storedPoint(r.fromKey, r.fromLabel), origin: r.toKey, dir: 'from' as const };
    const id = `${seed.origin}|${seed.dir}|${normalizeKey(seed.place)}`;
    const cur = byPlace.get(id) ?? { ...seed, via: 'stale', slots: [] };
    if (!cur.slots.some((x) => x.dayType === r.dayType && x.hour === r.hour)) cur.slots.push({ dayType: r.dayType as CrawlDayType, hour: r.hour });
    byPlace.set(id, cur);
  }
  return [...byPlace.values()];
}

/** Питання людей без відповіді — місце з точкою й напрямком, як питали */
async function unansweredSeeds(prisma: PrismaClient, city: CrawlCity): Promise<CampaignSeed[]> {
  const rows = await prisma.dovedeCityDemand.findMany({ where: { cityCode: city, answered: false, asked: { gt: 0 } }, orderBy: [{ asked: 'desc' }], take: 500 });
  return seedsFromUnanswered(rows.map((d) => ({ city: d.cityCode, fromKey: d.fromKey, toKey: d.toKey, from: d.fromLabel, to: d.toLabel }))).map((s) => ({ place: s.place, origin: s.origin, dir: s.dir, via: 'people' }));
}

/** Місця, про які в базі вже є дорога з Google від / до точки висадки, — для «дообучити» інші години */
async function knownSeeds(prisma: PrismaClient, city: CrawlCity): Promise<CampaignSeed[]> {
  const rows = await prisma.dovedeCityRoute.findMany({
    where: { cityCode: city, source: 'google', archivedAt: null },
    select: { fromKey: true, toKey: true, fromLabel: true, toLabel: true },
    distinct: ['fromKey', 'toKey'],
  });
  const out: CampaignSeed[] = [];
  for (const r of rows) {
    const fromPoint = isPointKey(city, r.fromKey);
    if (fromPoint === isPointKey(city, r.toKey)) continue;
    out.push(fromPoint ? { place: storedPoint(r.toKey, r.toLabel), origin: r.fromKey, dir: 'to', via: 'known' } : { place: storedPoint(r.fromKey, r.fromLabel), origin: r.toKey, dir: 'from', via: 'known' });
  }
  return out;
}

const refill = (id: string, title: string, help: string, main: string): CampaignPreset => ({
  id,
  title,
  help,
  cities: LEARN_CITY_CODES,
  defaults: (city) => ({ origins: ARRIVAL_POINTS[city], dirs: ['to', 'from'], main, extra: '', maxDepth: 0 }),
  seeds: ({ prisma, city }) => knownSeeds(prisma, city),
});

export const CAMPAIGN_PRESETS: readonly CampaignPreset[] = [
  {
    id: 'learn',
    title: 'Навчити місто',
    help: 'Від точки висадки до місць, куди їдуть найчастіше (лікарні, вокзали, ринки…), і назад; для Житомира — ще й до кінцевих усіх маршрутів. Питання людей без відповіді — теж. Зупинки й кінцеві з відповідей стають новими місцями.',
    cities: LEARN_CITY_CODES,
    defaults: (city) => ({ origins: DEFAULT_ORIGINS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: learnCity(city).maxDepth }),
    seeds: async ({ prisma, city }) => [
      ...LEARN_PLACES[city].map((place) => ({ place, via: 'list' })),
      ...(city === 'Zhytomyr' ? zhytomyrTerminals().map((place) => ({ place, via: 'terminal' })) : []),
      ...(await unansweredSeeds(prisma, city)),
    ],
  },
  refill('refill-evening', 'Дообучити: вечір', 'Місця, які вже знаємо, — на вечірні години буднього дня (дорога додому).', 'weekday@18,weekday@21'),
  refill('refill-weekend', 'Дообучити: вихідні', 'Місця, які вже знаємо, — на суботу й неділю.', 'saturday@11,saturday@17,sunday@11,sunday@17'),
  refill('refill-morning', 'Дообучити: ранок', 'Місця, які вже знаємо, — на ранок буднього дня.', 'weekday@07'),
  {
    id: 'refresh',
    title: 'Освіжити застаріле',
    help: 'Відповіді Google, старші за строк свіжості, — питаємо знову на той самий тип дня й годину. Нових місць не додає.',
    cities: LEARN_CITY_CODES,
    ownSlots: true,
    defaults: (city) => ({ origins: ARRIVAL_POINTS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 0 }),
    seeds: ({ prisma, city, now, freshDays }) => staleSeeds(prisma, city, now, freshDays),
  },
  {
    id: 'unanswered',
    title: 'Питання людей без відповіді',
    help: 'Лише пари, які питали люди й не отримали дороги. Новими місцями обхід іде на один крок.',
    cities: LEARN_CITY_CODES,
    defaults: (city) => ({ origins: ARRIVAL_POINTS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 1 }),
    seeds: ({ prisma, city }) => unansweredSeeds(prisma, city),
  },
  {
    id: 'modes',
    title: 'Види транспорту',
    help: 'Пари, у відповідях на які є кожен вид транспорту Києва (фунікулер, трамвай, тролейбус, кільцева…), — щоб картки мали свіжу справжню відповідь.',
    cities: ['Kyiv'],
    defaults: () => ({ origins: [], dirs: ['to'], main: 'weekday@09', extra: '', maxDepth: 0 }),
    seeds: async () => MODE_PAIRS.map((p) => ({ place: p.to, origin: p.from, dir: 'to' as const, via: 'modes' })),
  },
  {
    id: 'custom',
    title: 'Свій список',
    help: 'Місця, які ви напишете, — по одному в рядку, так, як написала б людина після «до Києва до …».',
    cities: LEARN_CITY_CODES,
    custom: true,
    defaults: (city) => ({ origins: DEFAULT_ORIGINS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 0 }),
    seeds: async ({ options }) =>
      String(options.places ?? '')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((place) => ({ place, via: 'custom' })),
  },
];

const PRESET_BY_ID = new Map(CAMPAIGN_PRESETS.map((p) => [p.id, p]));

function toSlots(spec: string | undefined, label: string): CampaignSlot[] {
  if (!String(spec ?? '').trim()) return [];
  let parsed;
  try {
    parsed = parseSlots(spec);
  } catch (e) {
    throw new CampaignInputError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = parsed.map((s) => ({ dayType: s.dayType, hour: Number(s.time.slice(0, 2)) }));
  const unique = out.filter((s, i) => out.findIndex((o) => o.dayType === s.dayType && o.hour === s.hour) === i);
  if (unique.length > MAX_SLOTS) throw new CampaignInputError(`${label}: не більше ${MAX_SLOTS} годин`);
  return unique;
}

const slotSpec = (slots: CampaignSlot[]): string => slots.map((s) => `${s.dayType}@${String(s.hour).padStart(2, '0')}`).join(',');

/** План кампанії із заготовки й змін власника; кидає `CampaignInputError` */
export async function buildPlan(prisma: PrismaClient, input: CampaignInput, ctx: { now?: Date; freshDays?: number } = {}): Promise<{ preset: CampaignPreset; plan: CampaignPlan }> {
  const preset = PRESET_BY_ID.get(String(input.preset ?? ''));
  if (!preset) throw new CampaignInputError(`Невідома заготовка: ${input.preset}`);
  const city = input.city as CrawlCity;
  if (!preset.cities.includes(city)) throw new CampaignInputError(`Заготовка «${preset.title}» — лише для: ${preset.cities.map((c) => CITY_NAME[c]).join(', ')}`);
  const options = input.options ?? {};
  const d = preset.defaults(city);
  const origins = options.origins ?? d.origins;
  if (!Array.isArray(origins) || origins.some((o) => !ARRIVAL_POINTS[city].includes(o))) throw new CampaignInputError(`Точки висадки: ${ARRIVAL_POINTS[city].join(', ')}`);
  const dirs = options.dirs ?? d.dirs;
  if (!Array.isArray(dirs) || !dirs.length || dirs.some((x) => x !== 'to' && x !== 'from')) throw new CampaignInputError('Напрямок: to і / або from');
  const main = toSlots(options.main ?? d.main, 'Години');
  if (!main.length) throw new CampaignInputError('Потрібна хоч одна година');
  const extra = toSlots(options.extra ?? d.extra, 'Додаткові години').filter((s) => !main.some((m) => m.dayType === s.dayType && m.hour === s.hour));
  const maxDepth = options.maxDepth ?? d.maxDepth;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH) throw new CampaignInputError(`Глибина: від 0 до ${MAX_DEPTH}`);
  const seeds = await preset.seeds({ prisma, city, options, now: ctx.now ?? new Date(), freshDays: ctx.freshDays ?? 30 });
  if (!seeds.length) throw new CampaignInputError(preset.custom ? 'Напишіть хоч одне місце' : 'Для цієї заготовки зараз немає місць');
  const own = Boolean(preset.ownSlots);
  return {
    preset,
    plan: { city, origins: [...new Set(origins)], dirs: [...new Set(dirs)], main, extra: own ? [] : extra, maxDepth: own ? 0 : maxDepth, seeds, ...(own ? { ownSlots: true } : {}) },
  };
}

export interface PlannedPlace {
  origin: string;
  dir: CrawlDir;
  place: string;
  placeKey: string;
  via: string;
  /** свої години (інакше — `plan.main`) */
  slots?: CampaignSlot[];
}

/** Години, які питаємо про місце рівня 0 */
export const placeSlots = (plan: CampaignPlan, p: { slots?: CampaignSlot[] }): CampaignSlot[] => (plan.ownSlots && p.slots?.length ? p.slots : plan.main);

/** Місця рівня 0: кожне місце без своєї точки — на кожну точку й напрямок; повтори відкидаємо */
export function expandSeeds(plan: CampaignPlan): PlannedPlace[] {
  const out: PlannedPlace[] = [];
  const seen = new Set<string>();
  const add = (origin: string, dir: CrawlDir, place: string, via: string, slots?: CampaignSlot[]) => {
    const placeKey = normalizeKey(place);
    if (!placeKey || placeKey === normalizeKey(origin)) return;
    const k = `${origin}|${dir}|${placeKey}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ origin, dir, place, placeKey, via, ...(slots?.length ? { slots } : {}) });
  };
  for (const s of plan.seeds) {
    if (s.origin) add(s.origin, s.dir ?? 'to', s.place, s.via, s.slots);
    else for (const origin of plan.origins) for (const dir of plan.dirs) add(origin, dir, s.place, s.via, s.slots);
  }
  return out;
}

/** Питання до сервера: від точки до місця (`to`) чи від місця до точки (`from`) — на найближчий день цього типу */
export function campaignQuery(city: CrawlCity, p: { origin: string; dir: string; place: string }, slot: CampaignSlot, now: Date): CityRouteQuery {
  const at = nextSlot(now, slot.dayType, slot.hour);
  const [from, to] = p.dir === 'from' ? [p.place, p.origin] : [p.origin, p.place];
  return { city, from, to, date: at.date, time: at.time, departAt: at.utc };
}

export interface CampaignEstimate {
  /** місць рівня 0 і основних питань про них */
  places: number;
  asks: number;
  /** з них: треба Google / відповідь уже є (база, власні дані) / пропускаємо (архів, не місце) */
  google: number;
  free: number;
  skipped: number;
  /** додаткових годин на місце з відповіддю; чи піде обхід углиб */
  extraSlots: number;
  maxDepth: number;
  /** запитів до Google усього — від і до (глибші рівні наперед не знати) */
  low: number;
  high: number;
  /** пропонований бюджет і денна частка; скільки днів займе */
  budget: number;
  dailyBudget: number;
  days: number;
  /** ліміт Google на день, уже витрачено сьогодні, запас для людей */
  cap: number;
  callsToday: number;
  reserve: number;
}

/** Частка питань, на які є дорога (крок обходу 2026-11-18: ~80 %), і нових місць на одну відповідь — від і до */
const OK_RATE = 0.8;
const GROWTH_LOW = 0.2;
const GROWTH_HIGH = 1.2;

/** Скільки запитів до Google коштуватиме план: рівень 0 — точно (що вже є в базі), глибші — оцінкою від і до */
export function estimateCost(plan: CampaignPlan, level0: { places: number; google: number; free: number }): { low: number; high: number } {
  const answered = (level0.google + level0.free) * OK_RATE;
  const extraHigh = Math.ceil(answered * plan.extra.length);
  const perNewPlace = plan.main.length + OK_RATE * plan.extra.length;
  const deeper = (g: number) => {
    let total = 0;
    let wave = answered;
    for (let depth = 1; depth <= plan.maxDepth; depth++) {
      const places = wave * g;
      total += places * perNewPlace;
      wave = places * plan.main.length * OK_RATE;
    }
    return total;
  };
  const low = level0.google + Math.ceil(extraHigh * 0.5) + Math.ceil(deeper(GROWTH_LOW));
  const high = level0.google + extraHigh + Math.ceil(deeper(GROWTH_HIGH));
  return { low, high: Math.max(low, high) };
}

export interface CityCampaignsDeps {
  prisma: PrismaClient;
  cityRoutes: CityRoutes;
  settings?: DovedeSettings;
  now?: () => Date;
  /** хто веде кампанію (у тестах — сталий) */
  holder?: string;
  log?: (m: string) => void;
  /** повідомлення власнику в адмін-чат (HTML): кампанія завершилась, Google відмовив у доступі */
  notify?: (html: string) => Promise<unknown>;
  /** скільки підозрілих доріг у місті (звіт якості, `city-quality.ts`) — для повідомлення про завершення */
  suspicious?: (city: CrawlCity) => Promise<number>;
}

type CampaignRow = DovedeCityCampaign;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LEARN_URL = siteUrl(PRIMARY_SITE, '/admin/dovede/learning');
const pct = (part: number, all: number) => (all ? Math.round((part / all) * 100) : 0);

/** Звіт після завершення: місця за кроками, без дороги, відкинуті як сміття назви, підозрілі в місті */
export interface CampaignReport {
  byDepth: Array<{ depth: number; places: number }>;
  noRoute: string[];
  /** частка питань без дороги, % */
  noRoutePct: number;
  /** найчастіші назви з відповідей, які обхід відкинув (загальні слова, не місце) */
  filtered: Array<{ name: string; count: number }>;
  /** підозрілих доріг у місті на момент завершення */
  suspicious: number | null;
}

/** Яку кампанію сервер веде зараз: найстаріша активна, що не чекає (або її очікування минуло) */
export function leaderOf<T extends { id: number; status: string; waitUntil: Date | null }>(activeById: readonly T[], at: Date): T | null {
  return activeById.find((c) => c.status === 'running' || !c.waitUntil || c.waitUntil.getTime() <= at.getTime()) ?? null;
}

export function createCityCampaigns(deps: CityCampaignsDeps) {
  const { prisma, cityRoutes } = deps;
  const now = deps.now ?? (() => new Date());
  const holder = deps.holder ?? `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  const log = deps.log ?? ((m: string) => console.log(m));
  const kyivDay = (at: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const nextMidnight = (at: Date): Date => new Date(kyivDayStart(at).getTime() + 24 * 3600_000 + 60_000);

  async function sharePct(): Promise<number> {
    return deps.settings ? deps.settings.int('learn.sharePct') : 50;
  }

  const planCtx = async () => ({ now: now(), freshDays: deps.settings ? await deps.settings.int('city.freshDays') : 30 });

  /** Оцінка без запису: рівень 0 — за базою (`peekMany`), глибше — від і до; пропонований бюджет і денна частка */
  async function preview(input: CampaignInput): Promise<{ title: string; plan: CampaignPlanView; estimate: CampaignEstimate }> {
    const { preset, plan } = await buildPlan(prisma, input, await planCtx());
    const places = expandSeeds(plan);
    if (places.length > MAX_SEED_PLACES) throw new CampaignInputError(`Забагато місць: ${places.length} (можна до ${MAX_SEED_PLACES}) — менше точок чи напрямків`);
    const at = now();
    const qs = places.flatMap((p) => placeSlots(plan, p).map((slot) => campaignQuery(plan.city, p, slot, at)));
    const peeks = await cityRoutes.peekMany(qs);
    const google = peeks.filter((p) => p === 'none').length;
    const free = peeks.filter((p) => p === 'fresh' || p === 'own').length;
    const { low, high } = estimateCost(plan, { places: places.length, google, free });
    const budgetNow = await cityRoutes.googleBudget();
    const reserve = reserveFor(budgetNow.cap);
    const dailyDefault = Math.max(10, Math.floor(((budgetNow.cap - reserve) * (await sharePct())) / 100));
    const budget = Math.min(MAX_BUDGET, Math.max(1, Math.ceil(high / 10) * 10));
    const dailyBudget = Math.min(budget, dailyDefault);
    return {
      title: titleOf(preset, plan.city),
      plan: planView(plan),
      estimate: {
        places: places.length,
        asks: qs.length,
        google,
        free,
        skipped: qs.length - google - free,
        extraSlots: plan.extra.length,
        maxDepth: plan.maxDepth,
        low,
        high,
        budget,
        dailyBudget,
        days: Math.max(1, Math.ceil(budget / Math.max(1, dailyBudget))),
        cap: budgetNow.cap,
        callsToday: budgetNow.calls,
        reserve,
      },
    };
  }

  const titleOf = (preset: CampaignPreset, city: CrawlCity) => `${preset.title} — ${CITY_NAME[city]}`;

  /** Створити й запустити: бюджет — погоджене власником число запитів до Google */
  async function create(input: CampaignInput): Promise<CampaignView> {
    const budget = Number(input.budget);
    const dailyBudget = Number(input.dailyBudget);
    if (!Number.isInteger(budget) || budget < 1 || budget > MAX_BUDGET) throw new CampaignInputError(`Бюджет: ціле від 1 до ${MAX_BUDGET} запитів до Google`);
    if (!Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > MAX_DAILY_BUDGET) throw new CampaignInputError(`На добу: ціле від 1 до ${MAX_DAILY_BUDGET}`);
    const { preset, plan } = await buildPlan(prisma, input, await planCtx());
    const places = expandSeeds(plan);
    if (places.length > MAX_SEED_PLACES) throw new CampaignInputError(`Забагато місць: ${places.length} (можна до ${MAX_SEED_PLACES})`);
    const at = now();
    const campaign = await prisma.dovedeCityCampaign.create({
      data: {
        cityCode: plan.city,
        preset: preset.id,
        title: titleOf(preset, plan.city),
        plan: plan as unknown as object,
        budget,
        dailyBudget: Math.min(dailyBudget, budget),
        status: 'running',
        places: places.length,
        startedAt: at,
        spentDay: kyivDay(at),
      },
    });
    await prisma.dovedeCityCampaignPlace.createMany({
      data: places.map((p) => ({ campaignId: campaign.id, cityCode: plan.city, origin: p.origin, dir: p.dir, place: p.place, placeKey: p.placeKey, depth: 0, via: p.via })),
      skipDuplicates: true,
    });
    const rows = await prisma.dovedeCityCampaignPlace.findMany({ where: { campaignId: campaign.id }, select: { id: true, origin: true, dir: true, placeKey: true }, orderBy: { id: 'asc' } });
    const planned = new Map(places.map((p) => [`${p.origin}|${p.dir}|${p.placeKey}`, p]));
    const queued = await prisma.dovedeCityCampaignAsk.createMany({
      data: rows.flatMap((r) => placeSlots(plan, planned.get(`${r.origin}|${r.dir}|${r.placeKey}`) ?? {}).map((s) => ({ campaignId: campaign.id, placeId: r.id, dayType: s.dayType, hour: s.hour, phase: 0 }))),
      skipDuplicates: true,
    });
    log(`🎓 Доведе · кампанія #${campaign.id} «${campaign.title}»: місць ${places.length}, бюджет ${budget} (на добу ${campaign.dailyBudget})`);
    return view(campaign, queued.count);
  }

  /** Обхід далі від відповіді: нові місця на крок глибше (з основними годинами) і додаткові години для цього місця */
  async function expand(c: CampaignRow, plan: CampaignPlan, place: { id: number; origin: string; dir: string; place: string; depth: number }, phase: number, steps: unknown): Promise<{ added: number; filtered: string[] }> {
    if (phase === 0 && plan.extra.length) {
      await prisma.dovedeCityCampaignAsk.createMany({
        data: plan.extra.map((s) => ({ campaignId: c.id, placeId: place.id, dayType: s.dayType, hour: s.hour, phase: 1 })),
        skipDuplicates: true,
      });
    }
    if (place.depth >= plan.maxDepth || c.places >= MAX_PLACES) return { added: 0, filtered: [] };
    const dir = place.dir === 'from' ? 'from' : 'to';
    const opts: { dir: CrawlDir; siteForm: (n: string) => string | null; exclude: string[] } = { dir, siteForm: (n) => siteForm(plan.city, n), exclude: [place.place, POINT_LABEL[place.origin] ?? place.origin] };
    const compact = compactSteps(steps);
    const filtered = rejectedNames(compact, opts);
    const found = candidates(compact, opts).slice(0, MAX_PLACES - c.places);
    if (!found.length) return { added: 0, filtered };
    const depth = place.depth + 1;
    const made = await prisma.dovedeCityCampaignPlace.createMany({
      data: found.map((f) => ({ campaignId: c.id, cityCode: plan.city, origin: place.origin, dir, place: f.name, placeKey: normalizeKey(f.name), depth, via: f.via })),
      skipDuplicates: true,
    });
    if (!made.count) return { added: 0, filtered };
    const fresh = await prisma.dovedeCityCampaignPlace.findMany({
      where: { campaignId: c.id, origin: place.origin, dir, depth, placeKey: { in: found.map((f) => normalizeKey(f.name)) } },
      select: { id: true },
    });
    await prisma.dovedeCityCampaignAsk.createMany({
      data: fresh.flatMap((r) => plan.main.map((s) => ({ campaignId: c.id, placeId: r.id, dayType: s.dayType, hour: s.hour, phase: 0 }))),
      skipDuplicates: true,
    });
    return { added: made.count, filtered };
  }

  async function wait(c: CampaignRow, reason: string, until: Date, error?: string): Promise<void> {
    // Google відмовив у доступі (ключ, API, білінг) — само не минеться: пишемо власнику один раз, до першої вдалої відповіді
    const alert = reason === 'denied' && c.alertedReason !== reason;
    const r = await prisma.dovedeCityCampaign.updateMany({
      where: { id: c.id, status: { in: ACTIVE } },
      data: { status: 'waiting', waitReason: reason, waitUntil: until, ...(error !== undefined ? { lastError: error } : {}), ...(alert ? { alertedReason: reason } : {}) },
    });
    if (alert && r.count && deps.notify) {
      const g = await cityRoutes.googleBudget().catch(() => null);
      const said = g?.lastError ? `\nGoogle (HTTP ${g.lastError.status}): «${esc(g.lastError.message)}»` : '';
      await deps
        .notify(`⛔ <b>Навчання «${esc(c.title)}» чекає</b>: Google відмовив у доступі — ключ, Routes API або білінг у Google Cloud.${said}\nПитання лишаються в черзі; продовжить сама, щойно Google відповідатиме.\n${LEARN_URL}`)
        .catch((e) => console.error('❌ кампанія: сповіщення не надіслано:', e instanceof Error ? e.message : e));
    }
  }

  async function finish(c: CampaignRow, reason: 'finished' | 'budget'): Promise<void> {
    const [byDepth, noRoute] = await Promise.all([
      prisma.dovedeCityCampaignPlace.groupBy({ by: ['depth'], where: { campaignId: c.id }, _count: { _all: true } }),
      prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: c.id, status: 'no_route' }, select: { placeId: true }, take: 200 }),
    ]);
    const names = noRoute.length
      ? (await prisma.dovedeCityCampaignPlace.findMany({ where: { id: { in: [...new Set(noRoute.map((a) => a.placeId))] } }, select: { place: true } })).map((p) => p.place)
      : [];
    const counts = new Map<string, number>();
    for (const a of await prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: c.id, status: 'ok' }, select: { filtered: true } })) {
      for (const name of Array.isArray(a.filtered) ? (a.filtered as unknown[]) : []) if (typeof name === 'string') counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const plan = c.plan as unknown as CampaignPlan;
    const suspicious = deps.suspicious ? await deps.suspicious(plan.city).catch(() => null) : null;
    const report: CampaignReport = {
      byDepth: byDepth.map((d) => ({ depth: d.depth, places: d._count._all })).sort((a, b) => a.depth - b.depth),
      noRoute: [...new Set(names)].slice(0, 50),
      noRoutePct: pct(c.noRoute, c.asked),
      filtered: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'uk')).slice(0, 30),
      suspicious,
    };
    const r = await prisma.dovedeCityCampaign.updateMany({
      where: { id: c.id, status: { in: ACTIVE } },
      data: { status: 'done', stopReason: reason, finishedAt: now(), waitUntil: null, waitReason: null, report: report as unknown as object },
    });
    log(`🎓 Доведе · кампанія #${c.id} завершена (${reason}): питань ${c.asked}, з відповіддю ${c.ok}, запитів до Google ${c.googleCalls}`);
    if (r.count && deps.notify) {
      const head = reason === 'budget' ? `💸 <b>Навчання «${esc(c.title)}»: бюджет вичерпано</b>` : `🎓 <b>Навчання «${esc(c.title)}» завершено</b>`;
      const lines = [
        head,
        `Питань ${c.asked}: з дорогою ${c.ok}${c.fromDb ? ` (з бази ${c.fromDb})` : ''}, без дороги ${c.noRoute} (${report.noRoutePct} %). Запитів до Google ${c.googleCalls} з ${c.budget}.`,
        reason === 'budget' ? 'У черзі ще є питання — у розділі «Навчання» можна додати бюджету.' : null,
        suspicious ? `Підозрілих доріг у місті: ${suspicious} — перевірте в розділі «Навчання» → «Якість».` : null,
        LEARN_URL,
      ];
      await deps.notify(lines.filter(Boolean).join('\n')).catch((e) => console.error('❌ кампанія: сповіщення не надіслано:', e instanceof Error ? e.message : e));
    }
  }

  /** Продовжити оренду (і перевірити, що кампанію не поставили на паузу посеред кроку) */
  async function renew(id: number): Promise<boolean> {
    const r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ACTIVE }, leaseHolder: holder }, data: { leaseUntil: new Date(now().getTime() + LEASE_MS) } });
    return r.count === 1;
  }

  /**
   * Крок фонової задачі: найстаріша активна кампанія, яку зараз можна вести, — до `ASKS_PER_TICK` питань.
   * Повертає, скільки питань поставлено (для журналу).
   */
  async function tick(): Promise<{ campaignId: number | null; asked: number }> {
    const at = now();
    const list = await prisma.dovedeCityCampaign.findMany({ where: { status: { in: ACTIVE }, archivedAt: null }, orderBy: { id: 'asc' } });
    const c0 = leaderOf(list, at);
    if (!c0) return { campaignId: null, asked: 0 };
    const claimed = await prisma.dovedeCityCampaign.updateMany({
      where: { id: c0.id, status: { in: ACTIVE }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: at } }, { leaseHolder: holder }] },
      data: { leaseHolder: holder, leaseUntil: new Date(at.getTime() + LEASE_MS), status: 'running', waitUntil: null, waitReason: null },
    });
    if (!claimed.count) return { campaignId: null, asked: 0 };
    let asked = 0;
    try {
      asked = await run(c0.id);
    } finally {
      await prisma.dovedeCityCampaign.updateMany({ where: { id: c0.id, leaseHolder: holder }, data: { leaseHolder: null, leaseUntil: null } });
    }
    return { campaignId: c0.id, asked };
  }

  async function run(id: number): Promise<number> {
    const started = now().getTime();
    // питання, яке контейнер узяв і зник (деплой посеред запиту), — назад у чергу
    await prisma.dovedeCityCampaignAsk.updateMany({ where: { campaignId: id, status: 'asking', claimedAt: { lt: new Date(started - STUCK_MS) } }, data: { status: 'queued' } });
    let done = 0;
    while (done < ASKS_PER_TICK && now().getTime() - started < TICK_MS) {
      let c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
      if (!c || !ACTIVE.includes(c.status)) break;
      const at = now();
      const day = kyivDay(at);
      if (c.spentDay !== day) c = await prisma.dovedeCityCampaign.update({ where: { id }, data: { spentDay: day, spentToday: 0 } });
      const plan = c.plan as unknown as CampaignPlan;

      if (c.googleCalls >= c.budget) {
        await finish(c, 'budget');
        break;
      }
      const g = await cityRoutes.googleBudget();
      if (!g.enabled || !g.hasKey) {
        await wait(c, 'disabled', new Date(at.getTime() + WAIT_MS));
        break;
      }
      if (g.blocked) {
        await wait(c, g.blocked === 'denied' ? 'denied' : 'quota', new Date(at.getTime() + WAIT_MS));
        break;
      }
      if (c.spentToday >= c.dailyBudget) {
        await wait(c, 'daily', nextMidnight(at));
        break;
      }
      if (g.calls >= g.cap - reserveFor(g.cap)) {
        await wait(c, 'cap', new Date(Math.min(nextMidnight(at).getTime(), at.getTime() + WAIT_MS)));
        break;
      }

      const ask = await prisma.dovedeCityCampaignAsk.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: [{ phase: 'asc' }, { id: 'asc' }] });
      if (!ask) {
        const busy = await prisma.dovedeCityCampaignAsk.count({ where: { campaignId: id, status: 'asking' } });
        if (!busy) await finish(c, 'finished');
        break;
      }
      const took = await prisma.dovedeCityCampaignAsk.updateMany({ where: { id: ask.id, status: 'queued' }, data: { status: 'asking', claimedAt: at, attempts: { increment: 1 } } });
      if (!took.count) continue;
      const place = await prisma.dovedeCityCampaignPlace.findUnique({ where: { id: ask.placeId } });
      if (!place) {
        await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: 'failed', error: 'місця немає', doneAt: at } });
        continue;
      }

      const { answer, googleCalled } = await cityRoutes.campaignAsk(campaignQuery(plan.city, place, { dayType: ask.dayType as CrawlDayType, hour: ask.hour }, at));
      const spent = googleCalled ? 1 : 0;
      const counters = { googleCalls: { increment: spent }, spentToday: { increment: spent } };

      if (answer.ok) {
        const { added, filtered } = await expand(c, plan, place, ask.phase, answer.steps);
        await prisma.dovedeCityCampaignAsk.update({
          where: { id: ask.id },
          data: { status: 'ok', source: answer.source, minutes: answer.minutes, steps: compactSteps(answer.steps) as unknown as object, googleCalled, added, doneAt: now(), error: null, ...(filtered.length ? { filtered } : {}) },
        });
        await prisma.dovedeCityCampaign.update({
          where: { id },
          data: { ...counters, asked: { increment: 1 }, ok: { increment: 1 }, fromDb: { increment: googleCalled ? 0 : 1 }, places: { increment: added }, errorsInRow: 0, ...(googleCalled ? { alertedReason: null } : {}) },
        });
      } else if (answer.reason === 'no_route' || answer.reason === 'archived') {
        await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: answer.reason, googleCalled, doneAt: now() } });
        await prisma.dovedeCityCampaign.update({
          where: { id },
          data: { ...counters, asked: { increment: 1 }, ...(answer.reason === 'no_route' ? { noRoute: { increment: 1 } } : {}), errorsInRow: 0, ...(googleCalled ? { alertedReason: null } : {}) },
        });
      } else if (answer.reason === 'error') {
        const last = ask.attempts + 1 >= MAX_ATTEMPTS;
        await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: last ? 'failed' : 'queued', googleCalled, error: 'Google не відповів', ...(last ? { doneAt: now() } : {}) } });
        c = await prisma.dovedeCityCampaign.update({
          where: { id },
          data: { ...counters, ...(last ? { asked: { increment: 1 }, failed: { increment: 1 } } : {}), errorsInRow: { increment: 1 }, lastError: 'Google не відповів' },
        });
        done++;
        if (c.errorsInRow >= ERRORS_IN_ROW) {
          await wait(c, 'errors', new Date(now().getTime() + ERROR_WAIT_MS));
          break;
        }
        if (!(await renew(id))) break;
        continue;
      } else {
        // ліміт, квота, відмова, вимкнено — не вина питання: назад у чергу, кампанія чекає
        await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: 'queued', attempts: { decrement: 1 } } });
        if (spent) await prisma.dovedeCityCampaign.update({ where: { id }, data: counters });
        // «cap» від сервера — і наш ліміт, і квота Google (429): після 429 сервер ставить паузу
        const blockedAfter = answer.reason === 'cap' ? (await cityRoutes.googleBudget()).blocked : null;
        const reason = answer.reason === 'cap' ? (blockedAfter ? 'quota' : 'cap') : answer.reason === 'denied' ? 'denied' : 'disabled';
        await wait(c, reason, new Date(now().getTime() + WAIT_MS));
        break;
      }
      done++;
      if (!(await renew(id))) break;
    }
    return done;
  }

  /**
   * Черга: сервер веде одну кампанію за раз — найстарішу, яку зараз можна вести (`leaderOf`, той самий вибір, що в
   * `tick`). Решта зі станом «running» стоять за нею — адмінка показує «У черзі після …», а не «Іде».
   */
  async function queue(): Promise<{ leader: { id: number; title: string } | null }> {
    const active = await prisma.dovedeCityCampaign.findMany({ where: { status: { in: ACTIVE }, archivedAt: null }, orderBy: { id: 'asc' }, select: { id: true, title: true, status: true, waitUntil: true } });
    const l = leaderOf(active, now());
    return { leader: l ? { id: l.id, title: l.title } : null };
  }

  const behind = (c: Pick<CampaignRow, 'id' | 'status'>, leader: { id: number; title: string } | null) => (c.status === 'running' && leader && leader.id !== c.id ? leader : null);

  /** Список для адмінки: кампанії (без схованих), новіші вгорі, і стан денного обліку Google */
  async function list(): Promise<{ campaigns: CampaignView[]; google: { calls: number; cap: number; reserve: number } }> {
    const [rows, { leader }] = await Promise.all([prisma.dovedeCityCampaign.findMany({ where: { archivedAt: null }, orderBy: { id: 'desc' }, take: 50 }), queue()]);
    const queued = rows.length
      ? await prisma.dovedeCityCampaignAsk.groupBy({ by: ['campaignId'], where: { campaignId: { in: rows.map((r) => r.id) }, status: { in: ['queued', 'asking'] } }, _count: { _all: true } })
      : [];
    const left = new Map(queued.map((q) => [q.campaignId, q._count._all]));
    const g = await cityRoutes.googleBudget();
    return { campaigns: rows.map((r) => view(r, left.get(r.id) ?? 0, behind(r, leader))), google: { calls: g.calls, cap: g.cap, reserve: reserveFor(g.cap) } };
  }

  /** Одна кампанія: стан, питання за станами, місця за глибиною, останні відповіді */
  async function get(id: number) {
    const c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
    if (!c) return null;
    const [byStatus, byDepth, recent] = await Promise.all([
      prisma.dovedeCityCampaignAsk.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }),
      prisma.dovedeCityCampaignPlace.groupBy({ by: ['depth'], where: { campaignId: id }, _count: { _all: true } }),
      prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: id, doneAt: { not: null } }, orderBy: { doneAt: 'desc' }, take: 30 }),
    ]);
    const places = recent.length ? await prisma.dovedeCityCampaignPlace.findMany({ where: { id: { in: recent.map((a) => a.placeId) } } }) : [];
    const placeById = new Map(places.map((p) => [p.id, p]));
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const { leader } = await queue();
    return {
      ...view(c, count('queued') + count('asking'), behind(c, leader)),
      asks: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      byDepth: byDepth.map((d) => ({ depth: d.depth, places: d._count._all })).sort((a, b) => a.depth - b.depth),
      recent: recent.map((a) => {
        const p = placeById.get(a.placeId);
        return {
          place: p?.place ?? '',
          origin: p ? POINT_LABEL[p.origin] ?? p.origin : '',
          dir: p?.dir ?? 'to',
          depth: p?.depth ?? 0,
          slot: `${a.dayType}@${String(a.hour).padStart(2, '0')}`,
          status: a.status,
          source: a.source,
          minutes: a.minutes,
          google: a.googleCalled,
          added: a.added,
          at: a.doneAt?.toISOString() ?? null,
        };
      }),
    };
  }

  type Action = 'pause' | 'resume' | 'cancel' | 'extend' | 'archive';

  /** Керування з адмінки; null — такої кампанії немає, рядок — дія зараз неможлива (чому) */
  async function action(id: number, act: Action, body: { budget?: number; dailyBudget?: number } = {}): Promise<CampaignView | null | string> {
    const c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
    if (!c) return null;
    const at = now();
    let r: { count: number } = { count: 0 };
    if (act === 'pause') {
      r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status: 'paused', waitUntil: null, waitReason: null } });
      if (!r.count) return 'Кампанія не йде';
    } else if (act === 'resume') {
      r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ['paused', 'waiting', 'blocked'] } }, data: { status: 'running', waitUntil: null, waitReason: null, errorsInRow: 0 } });
      if (!r.count) return 'Відновити можна лише кампанію на паузі чи в очікуванні';
    } else if (act === 'cancel') {
      r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { notIn: ['done', 'cancelled'] } }, data: { status: 'cancelled', stopReason: 'cancelled', finishedAt: at, waitUntil: null, waitReason: null } });
      if (!r.count) return 'Кампанію вже завершено';
    } else if (act === 'extend') {
      const budget = body.budget === undefined ? c.budget : Number(body.budget);
      const daily = body.dailyBudget === undefined ? c.dailyBudget : Number(body.dailyBudget);
      if (!Number.isInteger(budget) || budget <= c.googleCalls || budget > MAX_BUDGET) return `Бюджет: більше ніж уже витрачено (${c.googleCalls}) і до ${MAX_BUDGET}`;
      if (!Number.isInteger(daily) || daily < 1 || daily > MAX_DAILY_BUDGET) return `На добу: ціле від 1 до ${MAX_DAILY_BUDGET}`;
      if (c.status === 'cancelled') return 'Кампанію скасовано';
      const reopen = c.status === 'done' && c.stopReason === 'budget';
      if (c.status === 'done' && !reopen) return 'Кампанію завершено: місць більше немає';
      const newDaily = Math.min(daily, budget);
      // Чекала саме на завтра через денну частку, а її підняли понад уже витрачене сьогодні — іде далі одразу.
      // Очікування з іншої причини (квота Google, ліміт дня, помилки) не чіпаємо: частка його не знімає
      const spentToday = c.spentDay === kyivDay(at) ? c.spentToday : 0;
      const goOn = c.status === 'waiting' && c.waitReason === 'daily' && newDaily > spentToday;
      r = await prisma.dovedeCityCampaign.updateMany({
        where: { id, updatedAt: c.updatedAt },
        data: {
          budget,
          dailyBudget: newDaily,
          ...(reopen ? { status: 'running', stopReason: null, finishedAt: null } : {}),
          ...(goOn ? { status: 'running', waitUntil: null, waitReason: null } : {}),
        },
      });
      if (!r.count) return 'Кампанію щойно змінено — оновіть сторінку';
    } else if (act === 'archive') {
      r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ['done', 'cancelled'] }, archivedAt: null }, data: { archivedAt: at } });
      if (!r.count) return 'Сховати можна лише завершену чи скасовану кампанію';
    } else {
      return 'Невідома дія';
    }
    const fresh = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
    const left = await prisma.dovedeCityCampaignAsk.count({ where: { campaignId: id, status: { in: ['queued', 'asking'] } } });
    const { leader } = await queue();
    return fresh ? view(fresh, left, behind(fresh, leader)) : null;
  }

  function view(c: CampaignRow, left = 0, queuedBehind: { id: number; title: string } | null = null): CampaignView {
    const plan = c.plan as unknown as CampaignPlan;
    return {
      id: c.id,
      city: c.cityCode,
      preset: c.preset,
      title: c.title,
      status: c.status,
      waitReason: c.waitReason,
      waitUntil: c.waitUntil?.toISOString() ?? null,
      stopReason: c.stopReason,
      budget: c.budget,
      dailyBudget: c.dailyBudget,
      googleCalls: c.googleCalls,
      spentToday: c.spentDay === kyivDay(now()) ? c.spentToday : 0,
      asked: c.asked,
      ok: c.ok,
      fromDb: c.fromDb,
      noRoute: c.noRoute,
      failed: c.failed,
      places: c.places,
      left,
      queuedBehind,
      lastError: c.lastError,
      plan: planView(plan),
      report: (c.report as unknown as CampaignView['report']) ?? null,
      createdAt: c.createdAt.toISOString(),
      startedAt: c.startedAt?.toISOString() ?? null,
      finishedAt: c.finishedAt?.toISOString() ?? null,
    };
  }

  function presets() {
    return CAMPAIGN_PRESETS.map((p) => ({
      id: p.id,
      title: p.title,
      help: p.help,
      custom: Boolean(p.custom),
      ownSlots: Boolean(p.ownSlots),
      cities: p.cities.map((city) => {
        const d = p.defaults(city);
        return { city, name: CITY_NAME[city], origins: d.origins, dirs: d.dirs, main: d.main, extra: d.extra, maxDepth: d.maxDepth, points: ARRIVAL_POINTS[city].map((id) => ({ id, label: POINT_LABEL[id] ?? id })) };
      }),
    }));
  }

  return { presets, preview, create, list, get, action, tick, holder };
}

export type CityCampaigns = ReturnType<typeof createCityCampaigns>;

export interface CampaignPlanView {
  city: CrawlCity;
  origins: Array<{ id: string; label: string }>;
  dirs: CrawlDir[];
  main: string;
  extra: string;
  maxDepth: number;
  seeds: number;
  /** години — свої в кожного місця («Освіжити застаріле») */
  ownSlots: boolean;
}

function planView(plan: CampaignPlan): CampaignPlanView {
  return {
    city: plan.city,
    origins: plan.origins.map((id) => ({ id, label: POINT_LABEL[id] ?? id })),
    dirs: plan.dirs,
    main: slotSpec(plan.main),
    extra: slotSpec(plan.extra),
    maxDepth: plan.maxDepth,
    seeds: plan.seeds.length,
    ownSlots: Boolean(plan.ownSlots),
  };
}

export interface CampaignView {
  id: number;
  city: string;
  preset: string;
  title: string;
  status: string;
  waitReason: string | null;
  waitUntil: string | null;
  stopReason: string | null;
  budget: number;
  dailyBudget: number;
  googleCalls: number;
  spentToday: number;
  asked: number;
  ok: number;
  fromDb: number;
  noRoute: number;
  failed: number;
  places: number;
  /** питань у черзі */
  left: number;
  /** стоїть у черзі за цією кампанією (сервер веде одну за раз); null — іде сама або не активна */
  queuedBehind: { id: number; title: string } | null;
  lastError: string | null;
  plan: CampaignPlanView;
  report: CampaignReport | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
