/**
 * «Доведе» · звіт якості навчання міста (Docs/dovede-admin-roadmap.md, крок 8): підозрілі дороги в базі.
 *
 * Google шукає місце за словами й іноді знаходить не те (як «Торговельно-економічний університет», що виявився за
 * 5–8 хв від будь-якої точки). Правила тут нічого не міняють — лише показують власнику, що перевірити; поруч у
 * адмінці «Відкрити як людина», «В архів» (`archivePlace`) і «Нормально» (`DovedeCityPlace.okAt` — більше не
 * показувати). Беремо лише відповіді Google, що не в архіві, і лише пари «точка висадки ↔ місце словами».
 */
import type { PrismaClient } from '@prisma/client';
import { ARRIVAL_POINTS, POINT_LABEL, type CrawlCity } from './crawl-core';
import type { CityStep } from './city-route';

export type QualityCode = 'next_to_point' | 'near_far_points' | 'asymmetric' | 'walk_only';

export interface QualityRouteRow {
  cityCode: string;
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
  dayType: string;
  hour: number;
  minutes: number;
  steps: unknown;
}

export interface QualityItem {
  city: CrawlCity;
  /** ключ місця (як `DovedeCityRoute.toKey`) і слова, як питали */
  key: string;
  label: string;
  reasons: Array<{ code: QualityCode; text: string }>;
  routes: Array<{ origin: string; originLabel: string; dir: 'to' | 'from'; dayType: string; hour: number; minutes: number; rides: number }>;
}

/** Дорога з такою кількістю хвилин від точки — «одразу поруч»: Google, мабуть, знайшов саму точку */
export const NEAR_MIN = 5;
/** Лише пішки від стількох хвилин — транспорту Google не знайшов */
export const WALK_ONLY_MIN = 25;
/** Туди й назад: удвічі довше й щонайменше на стільки хвилин */
export const ASYM_MIN = 20;
/**
 * Київ: захід (Академмістечко, Житомирська, Святошин) і вокзал — ~10 км і ~20 хв метро одне від одного. Місце, до
 * якого від обох разом менше за стільки хвилин, бути не може.
 */
export const FAR_SUM_MIN = 20;
const KYIV_WEST = ['kyiv.akadem', 'kyiv.zhytomyrska', 'kyiv.sviatoshyn'];
const KYIV_STATION = 'kyiv.pas';

const isPoint = (city: string, key: string): boolean => (ARRIVAL_POINTS as Record<string, string[]>)[city]?.includes(key) || key.startsWith('kyiv.m.');

const rides = (steps: unknown): number => (Array.isArray(steps) ? (steps as CityStep[]).filter((s) => s.kind === 'transit').length : 0);

const pointLabel = (key: string, label: string) => POINT_LABEL[key] ?? label;

/** Підозрілі місця за правилами вище; `skip` — «місто|ключ», які власник уже визнав нормальними */
export function findSuspicious(rows: QualityRouteRow[], skip: Set<string> = new Set()): QualityItem[] {
  const byPlace = new Map<string, QualityItem>();
  for (const r of rows) {
    if (r.cityCode !== 'Kyiv' && r.cityCode !== 'Zhytomyr') continue;
    const fromPoint = isPoint(r.cityCode, r.fromKey);
    if (fromPoint === isPoint(r.cityCode, r.toKey)) continue;
    const [key, label, origin, originLabel, dir] = fromPoint
      ? [r.toKey, r.toLabel, r.fromKey, pointLabel(r.fromKey, r.fromLabel), 'to' as const]
      : [r.fromKey, r.fromLabel, r.toKey, pointLabel(r.toKey, r.toLabel), 'from' as const];
    const id = `${r.cityCode}|${key}`;
    if (skip.has(id)) continue;
    const item = byPlace.get(id) ?? { city: r.cityCode as CrawlCity, key, label, reasons: [], routes: [] };
    item.routes.push({ origin, originLabel, dir, dayType: r.dayType, hour: r.hour, minutes: r.minutes, rides: rides(r.steps) });
    byPlace.set(id, item);
  }

  const out: QualityItem[] = [];
  for (const item of byPlace.values()) {
    const add = (code: QualityCode, text: string) => {
      if (!item.reasons.some((x) => x.code === code)) item.reasons.push({ code, text });
    };
    const near = item.routes.filter((r) => r.minutes <= NEAR_MIN).sort((a, b) => a.minutes - b.minutes)[0];
    if (near) add('next_to_point', `${near.minutes} хв від ${near.originLabel} — можливо, Google знайшов саму точку або щось поруч`);

    const best = (keys: string[]) => item.routes.filter((r) => keys.includes(r.origin)).sort((a, b) => a.minutes - b.minutes)[0];
    const west = best(KYIV_WEST);
    const station = best([KYIV_STATION]);
    if (item.city === 'Kyiv' && west && station && west.minutes + station.minutes < FAR_SUM_MIN) {
      add('near_far_points', `${west.minutes} хв від ${west.originLabel} і ${station.minutes} хв від вокзалу — так близько до обох не буває`);
    }

    for (const a of item.routes) {
      if (a.dir !== 'to') continue;
      const back = item.routes.filter((b) => b.dir === 'from' && b.origin === a.origin && b.dayType === a.dayType);
      for (const b of back) {
        const [lo, hi] = a.minutes < b.minutes ? [a.minutes, b.minutes] : [b.minutes, a.minutes];
        if (hi >= lo * 2 && hi - lo >= ASYM_MIN) add('asymmetric', `туди ${a.minutes} хв, назад ${b.minutes} хв (від: ${a.originLabel})`);
      }
    }

    const walk = item.routes.filter((r) => r.rides === 0 && r.minutes >= WALK_ONLY_MIN).sort((a, b) => b.minutes - a.minutes)[0];
    if (walk) add('walk_only', `лише пішки ${walk.minutes} хв від: ${walk.originLabel} — транспорту Google не знайшов`);

    if (item.reasons.length) out.push(item);
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || a.label.localeCompare(b.label, 'uk'));
}

export function createCityQuality(prisma: PrismaClient) {
  /** Підозрілі місця міста (або обох міст) і скільки місць переглянуто */
  async function report(city?: CrawlCity): Promise<{ items: QualityItem[]; places: number; okPlaces: number }> {
    const [rows, marks] = await Promise.all([
      prisma.dovedeCityRoute.findMany({
        where: { source: 'google', archivedAt: null, ...(city ? { cityCode: city } : {}) },
        select: { cityCode: true, fromKey: true, toKey: true, fromLabel: true, toLabel: true, dayType: true, hour: true, minutes: true, steps: true },
      }),
      prisma.dovedeCityPlace.findMany({ where: { okAt: { not: null }, ...(city ? { cityCode: city } : {}) }, select: { cityCode: true, key: true } }),
    ]);
    const ok = new Set(marks.map((m) => `${m.cityCode}|${m.key}`));
    const places = new Set(rows.map((r) => `${r.cityCode}|${isPoint(r.cityCode, r.fromKey) ? r.toKey : r.fromKey}`));
    return { items: findSuspicious(rows, ok), places: places.size, okPlaces: ok.size };
  }

  /** «Нормально» (true) — більше не показувати; false — показувати знову. Архіву не чіпає */
  async function markOk(city: CrawlCity, key: string, ok: boolean): Promise<boolean> {
    const route = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: city, OR: [{ toKey: key }, { fromKey: key }] }, select: { toKey: true, toLabel: true, fromLabel: true } });
    if (!route) return false;
    const label = route.toKey === key ? route.toLabel : route.fromLabel;
    const okAt = ok ? new Date() : null;
    await prisma.dovedeCityPlace.upsert({ where: { cityCode_key: { cityCode: city, key } }, create: { cityCode: city, key, label, okAt }, update: { okAt } });
    return true;
  }

  return { report, markOk };
}

export type CityQuality = ReturnType<typeof createCityQuality>;
