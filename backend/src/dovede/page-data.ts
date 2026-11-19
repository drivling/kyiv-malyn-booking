/**
 * «Доведе» · дані сторінки, які змінюються в житті й раніше потребували коду та деплою (Docs/dovede-admin-roadmap.md,
 * крок 11): автобус замість метро, години й тариф метро. Типові значення живуть у коді сторінки
 * (`frontend/src/pages/DovedePage/data/…`); тут — лише те, що власник змінив в адмінці.
 *
 * Зберігається в тій самій таблиці, що й налаштування (`DovedeSetting`), з ключем `page.<ключ>` і значенням `{ v }`:
 * так «змінено на null» (наприклад, «метро знову їздить усюди») відрізняється від «не змінено» (`Prisma.DbNull` —
 * повернути типове з коду). Сторінка читає `GET /dovede/page-data` — лише змінені ключі; решта — з коду.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { METRO_STATIONS, type MetroLine } from './kyivMetroData';

export interface PageDataDef {
  key: string;
  label: string;
  help: string;
  /** null — значення годиться; рядок — що не так */
  problem: (v: unknown) => string | null;
}

const LINES: MetroLine[] = ['M1', 'M2', 'M3'];
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Автобус замість метро: дільниця лінії після станції `after`; null — поїзди їздять усюди */
export function shuttleProblem(v: unknown): string | null {
  if (v === null) return null;
  if (!isObj(v)) return 'обʼєкт або null';
  const line = v.line as MetroLine;
  if (!LINES.includes(line)) return 'line: M1, M2 або M3';
  const onLine = new Set(METRO_STATIONS.filter((s) => s.line === line).map((s) => s.id));
  if (typeof v.after !== 'string' || !onLine.has(v.after)) return 'after: станція цієї лінії';
  if (!Array.isArray(v.stations) || !v.stations.length || v.stations.length > 30 || v.stations.some((s) => typeof s !== 'string' || !onLine.has(s) || s === v.after)) {
    return 'stations: від 1 до 30 станцій цієї лінії, крім after';
  }
  if (typeof v.bus !== 'string' || !/^[\p{L}\d-]{1,10}$/u.test(v.bus.trim())) return 'bus: номер автобуса, до 10 знаків';
  if (!isInt(v.hopSeconds, 30, 1800)) return 'hopSeconds: від 30 до 1800';
  if (!isInt(v.waitSeconds, 0, 3600)) return 'waitSeconds: від 0 до 3600';
  if (v.checkedAt !== undefined && (typeof v.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.checkedAt))) return 'checkedAt: YYYY-MM-DD';
  return null;
}

/** Години й тариф метро: вхід і закриття, хв від півночі; тариф, грн */
export function serviceProblem(v: unknown): string | null {
  if (!isObj(v)) return 'обʼєкт';
  if (!isInt(v.openMins, 0, 1439)) return 'openMins: від 0 до 1439';
  if (!isInt(v.closeMins, 1, 1440) || v.closeMins <= v.openMins) return 'closeMins: пізніше за openMins, до 1440';
  if (!isInt(v.fareUah, 0, 500)) return 'fareUah: від 0 до 500';
  return null;
}

export const DOVEDE_PAGE_DATA: readonly PageDataDef[] = [
  {
    key: 'metro.shuttle',
    label: 'Автобус замість метро',
    help: 'Дільниця лінії, де поїзди не ходять і їде автобус-замінник. «Метро їздить усюди» — вимкнути.',
    problem: shuttleProblem,
  },
  {
    key: 'metro.service',
    label: 'Години й тариф метро',
    help: 'Коли відкривається й закривається вхід і скільки коштує поїздка.',
    problem: serviceProblem,
  },
];

const BY_KEY = new Map(DOVEDE_PAGE_DATA.map((d) => [d.key, d]));
const PREFIX = 'page.';
const TTL_MS = 60_000;

export interface PageDataView {
  key: string;
  label: string;
  help: string;
  /** змінено в адмінці (тоді `value` — що діє, може бути null) */
  changed: boolean;
  value: unknown;
  updatedAt: string | null;
}

export function createDovedePageData(deps: { prisma: PrismaClient; now?: () => Date }) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  let memo: { at: number; rows: Map<string, { value: unknown; updatedAt: Date }> } | null = null;

  async function rows(): Promise<Map<string, { value: unknown; updatedAt: Date }>> {
    const at = now().getTime();
    if (memo && at - memo.at >= 0 && at - memo.at < TTL_MS) return memo.rows;
    try {
      const list = await prisma.dovedeSetting.findMany({ where: { key: { startsWith: PREFIX } } });
      const map = new Map<string, { value: unknown; updatedAt: Date }>();
      for (const r of list) {
        const key = r.key.slice(PREFIX.length);
        const def = BY_KEY.get(key);
        const stored = r.value as unknown;
        // лише значення, яке й досі проходить перевірку (схема могла змінитись)
        if (def && isObj(stored) && 'v' in stored && def.problem(stored.v) === null) map.set(key, { value: stored.v, updatedAt: r.updatedAt });
      }
      memo = { at, rows: map };
      return map;
    } catch (e) {
      console.error('❌ dovede page-data: не прочитано, беру попередні:', e instanceof Error ? e.message : e);
      return memo?.rows ?? new Map();
    }
  }

  /** Для сторінки: лише змінені ключі → значення */
  async function values(): Promise<Record<string, unknown>> {
    return Object.fromEntries([...(await rows())].map(([k, r]) => [k, r.value]));
  }

  async function list(): Promise<PageDataView[]> {
    const map = await rows();
    return DOVEDE_PAGE_DATA.map((d) => {
      const r = map.get(d.key);
      return { key: d.key, label: d.label, help: d.help, changed: Boolean(r), value: r ? r.value : null, updatedAt: r && r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null };
    });
  }

  /** Задати значення (`reset` — повернути типове з коду); кидає RangeError з поясненням */
  async function set(key: string, value: unknown, reset = false): Promise<PageDataView> {
    const def = BY_KEY.get(key);
    if (!def) throw new RangeError(`невідомі дані: ${key}`);
    if (!reset) {
      const problem = def.problem(value);
      if (problem) throw new RangeError(`${key}: ${problem}`);
    }
    const normalized = !reset && key === 'metro.shuttle' && isObj(value) ? { ...value, bus: String(value.bus).trim() } : value;
    const json = reset ? Prisma.DbNull : ({ v: normalized } as Prisma.InputJsonValue);
    await prisma.dovedeSetting.upsert({ where: { key: PREFIX + key }, create: { key: PREFIX + key, value: json }, update: { value: json } });
    memo = null;
    return (await list()).find((x) => x.key === key)!;
  }

  return { values, list, set };
}

export type DovedePageData = ReturnType<typeof createDovedePageData>;
