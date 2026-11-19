"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_PAGE_DATA = void 0;
exports.shuttleProblem = shuttleProblem;
exports.serviceProblem = serviceProblem;
exports.ringExtraProblem = ringExtraProblem;
exports.examplesProblem = examplesProblem;
exports.createDovedePageData = createDovedePageData;
/**
 * «Доведе» · дані сторінки, які змінюються в житті й раніше потребували коду та деплою (Docs/dovede-admin-roadmap.md,
 * крок 11): автобус замість метро, години й тариф метро, дні додаткових рейсів міської електрички, приклади питань. Типові значення живуть у коді сторінки
 * (`frontend/src/pages/DovedePage/data/…`); тут — лише те, що власник змінив в адмінці.
 *
 * Зберігається в тій самій таблиці, що й налаштування (`DovedeSetting`), з ключем `page.<ключ>` і значенням `{ v }`:
 * так «змінено на null» (наприклад, «метро знову їздить усюди») відрізняється від «не змінено» (`Prisma.DbNull` —
 * повернути типове з коду). Сторінка читає `GET /dovede/page-data` — лише змінені ключі; решта — з коду.
 */
const client_1 = require("@prisma/client");
const kyivMetroData_1 = require("./kyivMetroData");
const LINES = ['M1', 'M2', 'M3'];
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Автобус замість метро: дільниця лінії після станції `after`; null — поїзди їздять усюди */
function shuttleProblem(v) {
    if (v === null)
        return null;
    if (!isObj(v))
        return 'обʼєкт або null';
    const line = v.line;
    if (!LINES.includes(line))
        return 'line: M1, M2 або M3';
    const onLine = new Set(kyivMetroData_1.METRO_STATIONS.filter((s) => s.line === line).map((s) => s.id));
    if (typeof v.after !== 'string' || !onLine.has(v.after))
        return 'after: станція цієї лінії';
    if (!Array.isArray(v.stations) || !v.stations.length || v.stations.length > 30 || v.stations.some((s) => typeof s !== 'string' || !onLine.has(s) || s === v.after)) {
        return 'stations: від 1 до 30 станцій цієї лінії, крім after';
    }
    if (typeof v.bus !== 'string' || !/^[\p{L}\d-]{1,10}$/u.test(v.bus.trim()))
        return 'bus: номер автобуса, до 10 знаків';
    if (!isInt(v.hopSeconds, 30, 1800))
        return 'hopSeconds: від 30 до 1800';
    if (!isInt(v.waitSeconds, 0, 3600))
        return 'waitSeconds: від 0 до 3600';
    if (v.checkedAt !== undefined && (typeof v.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.checkedAt)))
        return 'checkedAt: YYYY-MM-DD';
    return null;
}
/** Години й тариф метро: вхід і закриття, хв від півночі; тариф, грн */
function serviceProblem(v) {
    if (!isObj(v))
        return 'обʼєкт';
    if (!isInt(v.openMins, 0, 1439))
        return 'openMins: від 0 до 1439';
    if (!isInt(v.closeMins, 1, 1440) || v.closeMins <= v.openMins)
        return 'closeMins: пізніше за openMins, до 1440';
    if (!isInt(v.fareUah, 0, 500))
        return 'fareUah: від 0 до 500';
    return null;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v) => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
/** Дні додаткових рейсів «Д» міської електрички: з дати (і часу першого дня) до дати включно; null — рейсів немає */
function ringExtraProblem(v) {
    if (v === null)
        return null;
    if (!isObj(v))
        return 'обʼєкт або null';
    if (!validDate(v.from))
        return 'from: YYYY-MM-DD';
    if (!validDate(v.to) || v.to < v.from)
        return 'to: YYYY-MM-DD, не раніше from';
    if (v.fromTime !== undefined && (typeof v.fromTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.fromTime)))
        return 'fromTime: HH:MM';
    return null;
}
/** Приклади питань: `{ malyn?, korosten? }` — від 1 до 10 рядків по 3–120 знаків; хоч один список */
function examplesProblem(v) {
    if (!isObj(v))
        return 'обʼєкт { malyn?, korosten? }';
    const keys = Object.keys(v);
    if (!keys.length || keys.some((k) => k !== 'malyn' && k !== 'korosten'))
        return 'лише malyn і / або korosten';
    for (const k of keys) {
        const list = v[k];
        if (!Array.isArray(list) || !list.length || list.length > 10)
            return `${k}: від 1 до 10 питань`;
        if (list.some((x) => typeof x !== 'string' || x.trim().length < 3 || x.length > 120))
            return `${k}: кожне питання — від 3 до 120 знаків`;
    }
    return null;
}
exports.DOVEDE_PAGE_DATA = [
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
    {
        key: 'ring.extra',
        label: 'Додаткові рейси міської електрички',
        help: 'Рейси «Д» півкільцем Почайна — Дарниця — Видубичі ходять лише в оголошені дні. Продовжили — змінити дати; скасували — вимкнути.',
        problem: ringExtraProblem,
    },
    {
        key: 'examples',
        label: 'Приклади питань на сторінці',
        help: '«Спитайте, наприклад» під полем питання: кнопки, які людина натискає замість того, щоб писати.',
        problem: examplesProblem,
    },
];
const BY_KEY = new Map(exports.DOVEDE_PAGE_DATA.map((d) => [d.key, d]));
const PREFIX = 'page.';
const TTL_MS = 60000;
function createDovedePageData(deps) {
    const { prisma } = deps;
    const now = deps.now ?? (() => new Date());
    let memo = null;
    async function rows() {
        const at = now().getTime();
        if (memo && at - memo.at >= 0 && at - memo.at < TTL_MS)
            return memo.rows;
        try {
            const list = await prisma.dovedeSetting.findMany({ where: { key: { startsWith: PREFIX } } });
            const map = new Map();
            for (const r of list) {
                const key = r.key.slice(PREFIX.length);
                const def = BY_KEY.get(key);
                const stored = r.value;
                // лише значення, яке й досі проходить перевірку (схема могла змінитись)
                if (def && isObj(stored) && 'v' in stored && def.problem(stored.v) === null)
                    map.set(key, { value: stored.v, updatedAt: r.updatedAt });
            }
            memo = { at, rows: map };
            return map;
        }
        catch (e) {
            console.error('❌ dovede page-data: не прочитано, беру попередні:', e instanceof Error ? e.message : e);
            return memo?.rows ?? new Map();
        }
    }
    /** Для сторінки: лише змінені ключі → значення */
    async function values() {
        return Object.fromEntries([...(await rows())].map(([k, r]) => [k, r.value]));
    }
    async function list() {
        const map = await rows();
        return exports.DOVEDE_PAGE_DATA.map((d) => {
            const r = map.get(d.key);
            return { key: d.key, label: d.label, help: d.help, changed: Boolean(r), value: r ? r.value : null, updatedAt: r && r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null };
        });
    }
    /** Задати значення (`reset` — повернути типове з коду); кидає RangeError з поясненням */
    async function set(key, value, reset = false) {
        const def = BY_KEY.get(key);
        if (!def)
            throw new RangeError(`невідомі дані: ${key}`);
        if (!reset) {
            const problem = def.problem(value);
            if (problem)
                throw new RangeError(`${key}: ${problem}`);
        }
        const normalized = !reset && key === 'metro.shuttle' && isObj(value)
            ? { ...value, bus: String(value.bus).trim() }
            : !reset && key === 'examples' && isObj(value)
                ? Object.fromEntries(Object.entries(value).map(([k, list]) => [k, list.map((x) => x.replace(/\s+/g, ' ').trim())]))
                : value;
        const json = reset ? client_1.Prisma.DbNull : { v: normalized };
        await prisma.dovedeSetting.upsert({ where: { key: PREFIX + key }, create: { key: PREFIX + key, value: json }, update: { value: json } });
        memo = null;
        return (await list()).find((x) => x.key === key);
    }
    return { values, list, set };
}
