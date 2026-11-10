"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSPORT_MODELS = void 0;
exports.createTransportTestStore = createTransportTestStore;
/** Таблиці датасету й статистики — ті, що мають колонку cityCode */
exports.TRANSPORT_MODELS = [
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
];
const OTHER_MODELS = ['tripPoint', 'watchedSource'];
/** Моделі з автоінкрементним числовим id */
const AUTO_ID = new Set(['transportRouteStop', 'transportSegment', 'stickerScan', 'stickerReturn', 'stickerPrint', 'transportArrivalReport', 'tripPoint']);
/** Значення за замовчуванням із схеми (колонки з DEFAULT) */
const DEFAULTS = Object.fromEntries(exports.TRANSPORT_MODELS.map((m) => [m, { cityCode: 'Malyn' }]));
const cmp = (a, b) => {
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    if (x === y)
        return 0;
    if (x === null || x === undefined)
        return -1;
    if (y === null || y === undefined)
        return 1;
    return x < y ? -1 : 1;
};
function matchesField(value, cond) {
    if (cond === undefined)
        return true;
    if (cond === null || typeof cond !== 'object' || cond instanceof Date)
        return cmp(value, cond) === 0;
    const c = cond;
    if ('in' in c && !c.in.some((v) => cmp(value, v) === 0))
        return false;
    if ('not' in c && cmp(value, c.not) === 0)
        return false;
    if ('equals' in c && cmp(value, c.equals) !== 0)
        return false;
    if ('gte' in c && cmp(value, c.gte) < 0)
        return false;
    if ('gt' in c && cmp(value, c.gt) <= 0)
        return false;
    if ('lte' in c && cmp(value, c.lte) > 0)
        return false;
    if ('lt' in c && cmp(value, c.lt) >= 0)
        return false;
    return true;
}
function matches(row, where) {
    if (!where || typeof where !== 'object')
        return true;
    return Object.entries(where).every(([field, cond]) => {
        // Складений унікальний ключ Prisma: { clientId_clientEventId: { clientId, clientEventId } }
        if (field.includes('_') && cond && typeof cond === 'object' && !(field in row))
            return matches(row, cond);
        return matchesField(row[field], cond);
    });
}
function sortRows(rows, orderBy) {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
    if (!keys.length)
        return rows;
    return [...rows].sort((a, b) => {
        for (const [field, dir] of keys) {
            const d = cmp(a[field], b[field]);
            if (d)
                return dir === 'desc' ? -d : d;
        }
        return 0;
    });
}
function pick(row, select) {
    if (!select || typeof select !== 'object')
        return { ...row };
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}
function createTransportTestStore(initial = {}) {
    const tables = {};
    const calls = [];
    let clock = () => new Date();
    const nextId = {};
    const model = (name) => {
        tables[name] = (initial[name] ?? []).map((r) => ({ ...r }));
        nextId[name] = 1 + Math.max(0, ...tables[name].map((r) => (typeof r.id === 'number' ? r.id : 0)));
        const insert = (data) => {
            const row = { ...(DEFAULTS[name] ?? {}), ...data };
            if (AUTO_ID.has(name) && row.id === undefined)
                row.id = nextId[name]++;
            if (name === 'transportMeta' && row.id === undefined)
                row.id = 1;
            if (row.createdAt === undefined)
                row.createdAt = clock();
            row.updatedAt = clock();
            tables[name].push(row);
            return row;
        };
        const log = (method, args) => calls.push({ model: name, method, args: (args ?? {}) });
        const find = (where) => tables[name].filter((r) => matches(r, where));
        return {
            findMany: async (args = {}) => {
                log('findMany', args);
                const rows = sortRows(find(args.where), args.orderBy);
                return (args.take ? rows.slice(0, args.take) : rows).map((r) => pick(r, args.select));
            },
            findUnique: async (args) => {
                log('findUnique', args);
                const row = find(args.where)[0];
                return row ? pick(row, args.select) : null;
            },
            findFirst: async (args = {}) => {
                log('findFirst', args);
                const row = sortRows(find(args.where), args.orderBy)[0];
                return row ? pick(row, args.select) : null;
            },
            count: async (args = {}) => {
                log('count', args);
                return find(args.where).length;
            },
            create: async (args) => {
                log('create', args);
                return { ...insert(args.data) };
            },
            createMany: async (args) => {
                log('createMany', args);
                args.data.forEach((d) => insert(d));
                return { count: args.data.length };
            },
            update: async (args) => {
                log('update', args);
                const row = find(args.where)[0];
                if (!row)
                    throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
                Object.assign(row, args.data, { updatedAt: clock() });
                return { ...row };
            },
            updateMany: async (args) => {
                log('updateMany', args);
                const rows = find(args.where);
                rows.forEach((row) => Object.assign(row, args.data, { updatedAt: clock() }));
                return { count: rows.length };
            },
            upsert: async (args) => {
                log('upsert', args);
                const row = find(args.where)[0];
                if (!row)
                    return { ...insert(args.create) };
                if (Object.keys(args.update).length)
                    Object.assign(row, args.update, { updatedAt: clock() });
                return { ...row };
            },
            deleteMany: async (args = {}) => {
                log('deleteMany', args);
                const before = tables[name].length;
                tables[name] = tables[name].filter((r) => !matches(r, args.where));
                return { count: before - tables[name].length };
            },
            groupBy: async (args) => {
                log('groupBy', args);
                const groups = new Map();
                for (const row of find(args.where)) {
                    const k = args.by.map((f) => String(row[f])).join('\u0000');
                    if (!groups.has(k))
                        groups.set(k, []);
                    groups.get(k)?.push(row);
                }
                return [...groups.values()].map((rows) => {
                    const out = Object.fromEntries(args.by.map((f) => [f, rows[0][f]]));
                    out._count = { _all: rows.length };
                    if (args._max) {
                        out._max = Object.fromEntries(Object.keys(args._max).map((f) => [f, rows.map((r) => r[f]).sort(cmp).pop() ?? null]));
                    }
                    return out;
                });
            },
        };
    };
    const prisma = {};
    for (const name of [...exports.TRANSPORT_MODELS, ...OTHER_MODELS])
        prisma[name] = model(name);
    prisma.$transaction = async (arg) => typeof arg === 'function' ? arg(prisma) : Promise.all(arg);
    return {
        prisma: prisma,
        tables,
        calls,
        setNow(now) {
            clock = typeof now === 'function' ? now : () => now;
        },
    };
}
