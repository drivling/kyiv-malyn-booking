/**
 * In-memory Prisma для таблиць міського транспорту — лише для тестів (Docs/transport-tenancy-2026-11.md).
 * На відміну від ручних заглушок, чесно застосовує where (зокрема cityCode), orderBy, take і веде журнал
 * викликів: тест може перевірити, що кожен запит до транспортних таблиць обмежений містом.
 */
import type { PrismaClient } from '@prisma/client';

export type StoreRow = Record<string, unknown>;
export interface StoreCall {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

/** Таблиці датасету й статистики — ті, що мають колонку cityCode */
export const TRANSPORT_MODELS = [
  'transportStop',
  'transportRoute',
  'transportRouteStop',
  'transportTrip',
  'transportSegment',
  'transportMeta',
  'transportRevision',
  'stickerScan',
  'stickerReturn',
  'stickerPrint',
  'transportArrivalReport',
] as const;
export type TransportModel = (typeof TRANSPORT_MODELS)[number];

const OTHER_MODELS = ['tripPoint', 'watchedSource'] as const;
/** Моделі з автоінкрементним числовим id */
const AUTO_ID = new Set<string>(['transportRouteStop', 'transportSegment', 'stickerScan', 'stickerReturn', 'stickerPrint', 'transportArrivalReport', 'tripPoint']);
/** Значення за замовчуванням із схеми (колонки з DEFAULT) */
const DEFAULTS: Record<string, StoreRow> = Object.fromEntries(TRANSPORT_MODELS.map((m) => [m, { cityCode: 'Malyn' }]));

const cmp = (a: unknown, b: unknown): number => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return (x as number | string) < (y as number | string) ? -1 : 1;
};

function matchesField(value: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return cmp(value, cond) === 0;
  const c = cond as Record<string, unknown>;
  if ('in' in c && !(c.in as unknown[]).some((v) => cmp(value, v) === 0)) return false;
  if ('not' in c && cmp(value, c.not) === 0) return false;
  if ('equals' in c && cmp(value, c.equals) !== 0) return false;
  if ('gte' in c && cmp(value, c.gte) < 0) return false;
  if ('gt' in c && cmp(value, c.gt) <= 0) return false;
  if ('lte' in c && cmp(value, c.lte) > 0) return false;
  if ('lt' in c && cmp(value, c.lt) >= 0) return false;
  return true;
}

function matches(row: StoreRow, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where as Record<string, unknown>).every(([field, cond]) => {
    // Складений унікальний ключ Prisma: { clientId_clientEventId: { clientId, clientEventId } }
    if (field.includes('_') && cond && typeof cond === 'object' && !(field in row)) return matches(row, cond);
    return matchesField(row[field], cond);
  });
}

function sortRows(rows: StoreRow[], orderBy: unknown): StoreRow[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o as Record<string, string>));
  if (!keys.length) return rows;
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const d = cmp(a[field], b[field]);
      if (d) return dir === 'desc' ? -d : d;
    }
    return 0;
  });
}

function pick(row: StoreRow, select: unknown): StoreRow {
  if (!select || typeof select !== 'object') return { ...row };
  return Object.fromEntries(Object.keys(select as object).filter((k) => (select as Record<string, unknown>)[k]).map((k) => [k, row[k]]));
}

export interface TransportTestStore {
  prisma: PrismaClient;
  tables: Record<string, StoreRow[]>;
  calls: StoreCall[];
  /** Годинник для createdAt / updatedAt */
  setNow(now: Date | (() => Date)): void;
}

export function createTransportTestStore(initial: Partial<Record<string, StoreRow[]>> = {}): TransportTestStore {
  const tables: Record<string, StoreRow[]> = {};
  const calls: StoreCall[] = [];
  let clock: () => Date = () => new Date();
  const nextId: Record<string, number> = {};

  const model = (name: string) => {
    tables[name] = (initial[name] ?? []).map((r) => ({ ...r }));
    nextId[name] = 1 + Math.max(0, ...tables[name].map((r) => (typeof r.id === 'number' ? r.id : 0)));
    const insert = (data: StoreRow): StoreRow => {
      const row: StoreRow = { ...(DEFAULTS[name] ?? {}), ...data };
      if (AUTO_ID.has(name) && row.id === undefined) row.id = nextId[name]++;
      if (name === 'transportMeta' && row.id === undefined) row.id = 1;
      if (row.createdAt === undefined) row.createdAt = clock();
      row.updatedAt = clock();
      tables[name].push(row);
      return row;
    };
    const log = (method: string, args: unknown) => calls.push({ model: name, method, args: (args ?? {}) as Record<string, unknown> });
    const find = (where: unknown) => tables[name].filter((r) => matches(r, where));
    return {
      findMany: async (args: { where?: unknown; orderBy?: unknown; take?: number; select?: unknown } = {}) => {
        log('findMany', args);
        const rows = sortRows(find(args.where), args.orderBy);
        return (args.take ? rows.slice(0, args.take) : rows).map((r) => pick(r, args.select));
      },
      findUnique: async (args: { where: unknown; select?: unknown }) => {
        log('findUnique', args);
        const row = find(args.where)[0];
        return row ? pick(row, args.select) : null;
      },
      findFirst: async (args: { where?: unknown; orderBy?: unknown; select?: unknown } = {}) => {
        log('findFirst', args);
        const row = sortRows(find(args.where), args.orderBy)[0];
        return row ? pick(row, args.select) : null;
      },
      count: async (args: { where?: unknown } = {}) => {
        log('count', args);
        return find(args.where).length;
      },
      create: async (args: { data: StoreRow }) => {
        log('create', args);
        return { ...insert(args.data) };
      },
      createMany: async (args: { data: StoreRow[] }) => {
        log('createMany', args);
        args.data.forEach((d) => insert(d));
        return { count: args.data.length };
      },
      update: async (args: { where: unknown; data: StoreRow }) => {
        log('update', args);
        const row = find(args.where)[0];
        if (!row) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
        Object.assign(row, args.data, { updatedAt: clock() });
        return { ...row };
      },
      updateMany: async (args: { where?: unknown; data: StoreRow }) => {
        log('updateMany', args);
        const rows = find(args.where);
        rows.forEach((row) => Object.assign(row, args.data, { updatedAt: clock() }));
        return { count: rows.length };
      },
      upsert: async (args: { where: unknown; create: StoreRow; update: StoreRow }) => {
        log('upsert', args);
        const row = find(args.where)[0];
        if (!row) return { ...insert(args.create) };
        if (Object.keys(args.update).length) Object.assign(row, args.update, { updatedAt: clock() });
        return { ...row };
      },
      deleteMany: async (args: { where?: unknown } = {}) => {
        log('deleteMany', args);
        const before = tables[name].length;
        tables[name] = tables[name].filter((r) => !matches(r, args.where));
        return { count: before - tables[name].length };
      },
      groupBy: async (args: { by: string[]; where?: unknown; _count?: unknown; _max?: Record<string, boolean> }) => {
        log('groupBy', args);
        const groups = new Map<string, StoreRow[]>();
        for (const row of find(args.where)) {
          const k = args.by.map((f) => String(row[f])).join('\u0000');
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)?.push(row);
        }
        return [...groups.values()].map((rows) => {
          const out: StoreRow = Object.fromEntries(args.by.map((f) => [f, rows[0][f]]));
          out._count = { _all: rows.length };
          if (args._max) {
            out._max = Object.fromEntries(Object.keys(args._max).map((f) => [f, rows.map((r) => r[f]).sort(cmp).pop() ?? null]));
          }
          return out;
        });
      },
    };
  };

  const prisma: Record<string, unknown> = {};
  for (const name of [...TRANSPORT_MODELS, ...OTHER_MODELS]) prisma[name] = model(name);
  prisma.$transaction = async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]);

  return {
    prisma: prisma as unknown as PrismaClient,
    tables,
    calls,
    setNow(now) {
      clock = typeof now === 'function' ? now : () => now;
    },
  };
}
