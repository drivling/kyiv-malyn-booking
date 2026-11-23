"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAR_SUM_MIN = exports.ASYM_MIN = exports.WALK_ONLY_MIN = exports.NEAR_MIN = void 0;
exports.findSuspicious = findSuspicious;
exports.createCityQuality = createCityQuality;
const crawl_core_1 = require("./crawl-core");
const learn_cities_1 = require("./learn-cities");
const local_transport_1 = require("../local-transport");
const own_timetable_1 = require("./own-timetable");
/** Дорога з такою кількістю хвилин від точки — «одразу поруч»: Google, мабуть, знайшов саму точку */
exports.NEAR_MIN = 5;
/** Лише пішки від стількох хвилин — транспорту Google не знайшов */
exports.WALK_ONLY_MIN = 25;
/** Туди й назад: удвічі довше й щонайменше на стільки хвилин */
exports.ASYM_MIN = 20;
/**
 * Київ: захід (Академмістечко, Житомирська, Святошин) і вокзал — ~10 км і ~20 хв метро одне від одного. Місце, до
 * якого від обох разом менше за стільки хвилин, бути не може.
 */
exports.FAR_SUM_MIN = 20;
const KYIV_WEST = ['kyiv.akadem', 'kyiv.zhytomyrska', 'kyiv.sviatoshyn'];
const KYIV_STATION = 'kyiv.pas';
const isPoint = (city, key) => crawl_core_1.ARRIVAL_POINTS[city]?.includes(key) || key.startsWith('kyiv.m.');
const transits = (steps) => (Array.isArray(steps) ? steps.filter((s) => s?.kind === 'transit') : []);
const rides = (steps) => transits(steps).length;
/** Залізниця в межах міста — електричка, поїзд (Google: HEAVY_RAIL, RAIL, COMMUTER_TRAIN, LONG_DISTANCE_TRAIN…) */
const isRail = (mode) => /RAIL|TRAIN/.test(String(mode ?? '')) && !/LIGHT_RAIL/.test(String(mode ?? ''));
const DAY_UK = { weekday: 'будні', saturday: 'субота', sunday: 'неділя' };
const pointLabel = (key, label) => crawl_core_1.POINT_LABEL[key] ?? label;
/**
 * Підозрілі місця за правилами вище; `skip` — «місто|ключ», які власник уже визнав нормальними. `own` — свій розклад
 * міст зі своїм датасетом (пункт 4 аналізу 2026-11-23): там наші зупинки не перевіряємо, «лише пішки» й «туди й назад
 * удвічі» рахуємо лише в години, коли ходять автобуси (уночі пішки — це правда), і додаємо перевірку лінії й години.
 */
function findSuspicious(rows, skip = new Set(), own = {}) {
    const byPlace = new Map();
    for (const r of rows) {
        if (!(0, learn_cities_1.isLearnCity)(r.cityCode))
            continue;
        const fromPoint = isPoint(r.cityCode, r.fromKey);
        if (fromPoint === isPoint(r.cityCode, r.toKey))
            continue;
        const [key, label, origin, originLabel, dir] = fromPoint
            ? [r.toKey, r.toLabel, r.fromKey, pointLabel(r.fromKey, r.fromLabel), 'to']
            : [r.fromKey, r.fromLabel, r.toKey, pointLabel(r.toKey, r.toLabel), 'from'];
        const id = `${r.cityCode}|${key}`;
        if (skip.has(id))
            continue;
        // свій датасет: про нашу зупинку сторінка Google не питає — і звіт її не перевіряє
        if (own[r.cityCode]?.isOwnStop(label))
            continue;
        const item = byPlace.get(id) ?? { city: r.cityCode, key, label, reasons: [], routes: [] };
        const lines = transits(r.steps).map((x) => `${x.mode ?? ''} ${x.line ?? ''}`.trim());
        item.routes.push({ origin, originLabel, dir, dayType: r.dayType, hour: r.hour, minutes: r.minutes, rides: rides(r.steps), ...(own[r.cityCode] ? { lines } : {}) });
        byPlace.set(id, item);
    }
    const out = [];
    for (const item of byPlace.values()) {
        const add = (code, text) => {
            if (!item.reasons.some((x) => x.code === code))
                item.reasons.push({ code, text });
        };
        const tt = own[item.city];
        // години руху цього типу дня: поза ними «лише пішки» й довга дорога — правда, а не помилка Google
        const inService = (r) => {
            if (!tt)
                return true;
            const h = tt.hours(r.dayType);
            return Boolean(h && r.hour >= h.first && r.hour <= h.last);
        };
        const near = item.routes.filter((r) => r.minutes <= exports.NEAR_MIN).sort((a, b) => a.minutes - b.minutes)[0];
        if (near)
            add('next_to_point', `${near.minutes} хв від ${near.originLabel} — можливо, Google знайшов саму точку або щось поруч`);
        const best = (keys) => item.routes.filter((r) => keys.includes(r.origin)).sort((a, b) => a.minutes - b.minutes)[0];
        const west = best(KYIV_WEST);
        const station = best([KYIV_STATION]);
        if (item.city === 'Kyiv' && west && station && west.minutes + station.minutes < exports.FAR_SUM_MIN) {
            add('near_far_points', `${west.minutes} хв від ${west.originLabel} і ${station.minutes} хв від вокзалу — так близько до обох не буває`);
        }
        for (const a of item.routes) {
            if (a.dir !== 'to' || !inService(a))
                continue;
            const back = item.routes.filter((b) => b.dir === 'from' && b.origin === a.origin && b.dayType === a.dayType && inService(b));
            for (const b of back) {
                const [lo, hi] = a.minutes < b.minutes ? [a.minutes, b.minutes] : [b.minutes, a.minutes];
                if (hi >= lo * 2 && hi - lo >= exports.ASYM_MIN)
                    add('asymmetric', `туди ${a.minutes} хв, назад ${b.minutes} хв (від: ${a.originLabel})`);
            }
        }
        const walk = item.routes.filter((r) => r.rides === 0 && r.minutes >= exports.WALK_ONLY_MIN && inService(r)).sort((a, b) => b.minutes - a.minutes)[0];
        if (walk)
            add('walk_only', `лише пішки ${walk.minutes} хв від: ${walk.originLabel} — транспорту Google не знайшов`);
        if (tt) {
            for (const r of item.routes) {
                for (const l of r.lines ?? []) {
                    const [mode, ...rest] = l.split(' ');
                    const line = rest.join(' ');
                    const when = `${DAY_UK[r.dayType] ?? r.dayType}, ${String(r.hour).padStart(2, '0')}:00`;
                    if (isRail(mode))
                        add('rail_in_city', `${when}: Google везе електричкою${line ? ` ${line}` : ''} містом`);
                    else if (line && tt.lineRuns(line, r.dayType, r.hour) !== true) {
                        add('line_not_running', tt.lineRuns(line, r.dayType, r.hour) === null ? `${when}: лінії №${line} у нашому розкладі нема` : `${when}: №${line} — у нашому розкладі цієї години рейсу нема`);
                    }
                }
            }
        }
        if (item.reasons.length)
            out.push(item);
    }
    return out.sort((a, b) => b.reasons.length - a.reasons.length || a.label.localeCompare(b.label, 'uk'));
}
function createCityQuality(prisma, deps = {}) {
    const dataset = deps.dataset ?? ((city) => (0, local_transport_1.loadTransportDataset)(prisma, city));
    /** Свій розклад міст зі своїм датасетом, які є в звіті; датасет не прочитався — без перевірок свого розкладу */
    async function ownOf(city) {
        const out = {};
        for (const code of learn_cities_1.OWN_DATASET_CITY_CODES) {
            if (city && city !== code)
                continue;
            try {
                out[code] = (0, own_timetable_1.ownTimetable)(await dataset(code));
            }
            catch (e) {
                console.error(`❌ city-quality: датасет ${code} не прочитано:`, e instanceof Error ? e.message : e);
            }
        }
        return out;
    }
    /** Підозрілі місця міста (або обох міст) і скільки місць переглянуто */
    async function report(city) {
        const [rows, marks] = await Promise.all([
            prisma.dovedeCityRoute.findMany({
                where: { source: 'google', archivedAt: null, ...(city ? { cityCode: city } : {}) },
                select: { cityCode: true, fromKey: true, toKey: true, fromLabel: true, toLabel: true, dayType: true, hour: true, minutes: true, steps: true },
            }),
            prisma.dovedeCityPlace.findMany({ where: { okAt: { not: null }, ...(city ? { cityCode: city } : {}) }, select: { cityCode: true, key: true } }),
        ]);
        const ok = new Set(marks.map((m) => `${m.cityCode}|${m.key}`));
        const places = new Set(rows.map((r) => `${r.cityCode}|${isPoint(r.cityCode, r.fromKey) ? r.toKey : r.fromKey}`));
        return { items: findSuspicious(rows, ok, await ownOf(city)), places: places.size, okPlaces: ok.size };
    }
    /** «Нормально» (true) — більше не показувати; false — показувати знову. Архіву не чіпає */
    async function markOk(city, key, ok) {
        const route = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: city, OR: [{ toKey: key }, { fromKey: key }] }, select: { toKey: true, toLabel: true, fromLabel: true } });
        if (!route)
            return false;
        const label = route.toKey === key ? route.toLabel : route.fromLabel;
        const okAt = ok ? new Date() : null;
        await prisma.dovedeCityPlace.upsert({ where: { cityCode_key: { cityCode: city, key } }, create: { cityCode: city, key, label, okAt }, update: { okAt } });
        return true;
    }
    return { report, markOk };
}
