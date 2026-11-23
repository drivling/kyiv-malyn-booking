"use strict";
/**
 * «Доведе» · міський транспорт Києва з GTFS КП «Київпастранс» (Docs/dovede-learning-roadmap.md, крок 2) — дані
 * власника, як метро й кільцева: де в дорозі містом є лінія КПТ, час, інтервал і останній рейс беруться звідси.
 *
 * Чисті функції: архів (`data/kyiv-transport/kpt-gtfs/gtfs_static.zip`, розпакований `readZip`) → компактні дані для
 * сервера (`kyiv-kpt-data.ts`, пише `npm run kyiv:kpt`) і звіт `REPORT.md`.
 *
 * Що є в архіві й чого немає: у рейсі лише 2–8 контрольних точок (кінцеві й кілька проміжних), зупинки окремі для
 * кожного маршруту, назви скорочені; лінії маршрутів (`shapes.txt`) грубі — тому їх не беремо. Беремо надійне:
 * контрольні точки з координатами, хвилини між ними за годиною відправлення й відправлення окремо для буднів і
 * вихідних.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODE_UK = void 0;
exports.parseCsv = parseCsv;
exports.gtfsMinutes = gtfsMinutes;
exports.cleanStopName = cleanStopName;
exports.buildKptData = buildKptData;
exports.renderKptDataTs = renderKptDataTs;
exports.renderKptReport = renderKptReport;
const MODES = { '0': 'TRAM', '11': 'TROLLEYBUS', '3': 'BUS' };
/** CSV з лапками ("" — лапка всередині поля), BOM і \r\n */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else
                    quoted = false;
            }
            else
                field += ch;
        }
        else if (ch === '"')
            quoted = true;
        else if (ch === ',') {
            row.push(field);
            field = '';
        }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n')
                i++;
            row.push(field);
            field = '';
            if (row.some((v) => v !== ''))
                rows.push(row);
            row = [];
        }
        else
            field += ch;
    }
    if (field !== '' || row.length) {
        row.push(field);
        if (row.some((v) => v !== ''))
            rows.push(row);
    }
    const [head, ...body] = rows;
    if (!head)
        return [];
    return body.map((r) => Object.fromEntries(head.map((h, k) => [h.trim(), (r[k] ?? '').trim()])));
}
/** «05:48:00» → 348; «24:10:00» → 1450 */
function gtfsMinutes(t) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)];
};
const round6 = (x) => Math.round(x * 1e6) / 1e6;
/** Назва точки без подвійних пробілів і пробілу перед лапкою, що закриває: «ст.м. "Палац спорту "(55)» → «… спорту"(55)» */
function cleanStopName(name) {
    return name.replace(/\s+/g, ' ').replace(/\s+"(?=\(|$)/g, '"').trim();
}
function distanceM(a, b) {
    const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    return Math.hypot((a.lat - b.lat) * 111195, (a.lng - b.lng) * 111195 * k);
}
function toSegmentM(p, a, b) {
    const k = Math.cos(p.lat * (Math.PI / 180)) * 111195;
    const ax = (a.lng - p.lng) * k;
    const ay = (a.lat - p.lat) * 111195;
    const bx = (b.lng - p.lng) * k;
    const by = (b.lat - p.lat) * 111195;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
}
/** Файли архіву (ім'я → текст) → дані й звіт. Детерміновано: лише вміст архіву, без «сьогодні» */
function buildKptData(files) {
    const need = (n) => {
        const t = files[n];
        if (t == null)
            throw new Error(`GTFS: немає ${n}`);
        return parseCsv(t);
    };
    const routes = need('routes.txt');
    const trips = need('trips.txt');
    const stopTimes = need('stop_times.txt');
    const stops = new Map(need('stops.txt').map((s) => [s.stop_id, s]));
    const calendar = new Map(need('calendar.txt').map((c) => [c.service_id, c]));
    const feed = files['feed_info.txt'] ? parseCsv(files['feed_info.txt'])[0] ?? {} : {};
    const shapes = new Map();
    for (const p of files['shapes.txt'] ? parseCsv(files['shapes.txt']) : []) {
        const list = shapes.get(p.shape_id) ?? [];
        list.push({ seq: Number(p.shape_pt_sequence), lat: Number(p.shape_pt_lat), lng: Number(p.shape_pt_lon) });
        shapes.set(p.shape_id, list);
    }
    for (const list of shapes.values())
        list.sort((a, b) => a.seq - b.seq);
    const timesByTrip = new Map();
    for (const x of stopTimes) {
        const min = gtfsMinutes(x.departure_time || x.arrival_time);
        if (min == null)
            continue;
        const list = timesByTrip.get(x.trip_id) ?? [];
        list.push({ seq: Number(x.stop_sequence), stop: x.stop_id, min });
        timesByTrip.set(x.trip_id, list);
    }
    const routeById = new Map(routes.map((r) => [r.route_id, r]));
    const patterns = new Map();
    let badTrips = 0;
    for (const t of trips) {
        const route = routeById.get(t.route_id);
        const list = timesByTrip.get(t.trip_id);
        if (!route || !MODES[route.route_type] || !list || list.length < 2)
            continue;
        list.sort((a, b) => a.seq - b.seq);
        const offsets = list.map((x) => x.min - list[0].min);
        if (offsets.some((v, k) => k > 0 && v < offsets[k - 1])) {
            badTrips++;
            continue;
        }
        const cal = calendar.get(t.service_id);
        const wd = Boolean(cal && ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some((d) => cal[d] === '1'));
        const we = Boolean(cal && (cal.saturday === '1' || cal.sunday === '1'));
        if (!wd && !we)
            continue;
        const key = `${t.route_id}|${t.direction_id || '0'}|${list.map((x) => x.stop).join(',')}`;
        const p = patterns.get(key) ?? { route: t.route_id, direction: t.direction_id || '0', stops: list.map((x) => x.stop), shapes: new Map(), trips: [] };
        p.trips.push({ dep: list[0].min, offsets, wd, we });
        if (t.shape_id)
            p.shapes.set(t.shape_id, (p.shapes.get(t.shape_id) ?? 0) + 1);
        patterns.set(key, p);
    }
    // напрямки: у маршруті й напрямку — найчастіший набір точок першим
    const groups = new Map();
    for (const p of patterns.values()) {
        const g = groups.get(`${p.route}|${p.direction}`) ?? [];
        g.push(p);
        groups.set(`${p.route}|${p.direction}`, g);
    }
    const dirs = [];
    let pointsFar = 0;
    let pointsChecked = 0;
    const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const gk of groupKeys) {
        const list = groups.get(gk).sort((a, b) => b.trips.length - a.trips.length || a.stops.join(',').localeCompare(b.stops.join(',')));
        list.forEach((p, n) => {
            const route = routeById.get(p.route);
            const points = p.stops.map((id) => {
                const s = stops.get(id);
                return [cleanStopName(s?.stop_name ?? id), round6(Number(s?.stop_lat ?? 0)), round6(Number(s?.stop_lon ?? 0))];
            });
            // наскільки контрольні точки лежать на лінії найчастішої форми (лише для звіту)
            const shapeId = [...p.shapes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
            const shape = shapeId ? shapes.get(shapeId) : undefined;
            if (shape && shape.length >= 2) {
                for (const [, lat, lng] of points) {
                    pointsChecked++;
                    let best = Infinity;
                    for (let k = 0; k + 1 < shape.length; k++)
                        best = Math.min(best, toSegmentM({ lat, lng }, shape[k], shape[k + 1]));
                    if (best > 150)
                        pointsFar++;
                }
            }
            const byHour = new Map();
            for (const t of p.trips) {
                const h = Math.floor(t.dep / 60) % 24;
                const arr = byHour.get(h) ?? [];
                arr.push(t.offsets);
                byHour.set(h, arr);
            }
            const run = {};
            for (const h of [...byHour.keys()].sort((a, b) => a - b)) {
                const rows = byHour.get(h);
                run[String(h)] = p.stops.map((_, k) => median(rows.map((r) => r[k])));
            }
            const deps = (pick) => [...new Set(p.trips.filter(pick).map((t) => t.dep))].sort((a, b) => a - b);
            dirs.push({
                id: `${p.route}/${p.direction}/${n}`,
                mode: MODES[route.route_type],
                no: route.route_short_name,
                name: route.route_long_name.replace(/\s+/g, ' ').trim(),
                points,
                wd: deps((t) => t.wd),
                we: deps((t) => t.we),
                run,
            });
        });
    }
    const withTrips = new Set(dirs.map((d) => d.id.split('/')[0]));
    const modesByNo = new Map();
    for (const r of routes) {
        const mode = MODES[r.route_type];
        if (!mode)
            continue;
        const no = r.route_short_name.toLowerCase();
        modesByNo.set(no, (modesByNo.get(no) ?? new Set()).add(mode));
    }
    const byMode = { TRAM: 0, TROLLEYBUS: 0, BUS: 0 };
    for (const r of routes)
        if (MODES[r.route_type])
            byMode[MODES[r.route_type]]++;
    const coarse = [...shapes.values()].filter((s) => s.length <= 3).length;
    const sortNo = (a, b) => a.localeCompare(b, 'uk', { numeric: true });
    return {
        data: {
            version: feed.feed_version ?? '',
            validFrom: feed.feed_start_date ?? '',
            validTo: feed.feed_end_date ?? '',
            dirs,
        },
        report: {
            routes: routes.filter((r) => MODES[r.route_type]).length,
            byMode,
            dirs: dirs.length,
            trips: dirs.reduce((n, d) => n + new Set([...d.wd, ...d.we]).size, 0),
            routesWithoutTrips: routes.filter((r) => MODES[r.route_type] && !withTrips.has(r.route_id)).map((r) => `${exports.MODE_UK[MODES[r.route_type]]} ${r.route_short_name}`).sort(sortNo),
            sharedNumbers: [...modesByNo.entries()].filter(([, m]) => m.size > 1).map(([no]) => no).sort(sortNo),
            shapes: { total: shapes.size, coarse, pointsFar, pointsChecked },
            badTrips,
        },
    };
}
exports.MODE_UK = { TRAM: 'трамвай', TROLLEYBUS: 'тролейбус', BUS: 'автобус' };
/** Файл даних для сервера (як `zhytomyr-own-data.ts`): один рядок JSON, без форматування — дані, не код */
function renderKptDataTs(data) {
    return `/**
 * ЗГЕНЕРОВАНО: \`npm run kyiv:kpt\` у backend/ (dovede/kyiv-kpt.ts → buildKptData) з data/kyiv-transport/kpt-gtfs/gtfs_static.zip.
 * Руками не редагувати. Міський транспорт Києва з GTFS КП «Київпастранс» — дані власника (як метро): напрямки з
 * контрольними точками [назва, lat, lng], відправлення від першої точки (wd — будні, we — вихідні, хвилини доби) і
 * хвилини до кожної точки за годиною відправлення (run).
 */
import type { KptData } from './kyiv-kpt';

// prettier-ignore
export const KYIV_KPT: KptData = ${JSON.stringify(data)};
`;
}
const ymd = (s) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s || '—');
function renderKptReport(data, r) {
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    return `# GTFS «Київпастрансу» — що увійшло в дані «Доведе»

Згенеровано \`npm run kyiv:kpt\` (backend) з \`gtfs_static.zip\`; руками не редагувати.

- Версія архіву ${data.version || '—'}, чинний ${ymd(data.validFrom)} — ${ymd(data.validTo)}.
- Маршрутів ${r.routes}: трамваїв ${r.byMode.TRAM}, тролейбусів ${r.byMode.TROLLEYBUS}, автобусів ${r.byMode.BUS}.
- Напрямків з окремим набором контрольних точок: ${r.dirs}; рейсів (відправлень за добу, будні й вихідні разом): ${r.trips}.
- Маршрути без жодного рейсу (у дані не ввійшли): ${r.routesWithoutTrips.join(', ') || 'немає'}.
- Номери, що є в кількох видах транспорту (зіставляємо разом із видом): ${r.sharedNumbers.join(', ') || 'немає'}.
- Рейсів із часом, що не зростає від точки до точки (пропущено): ${r.badTrips}.

## Лінії маршрутів (shapes)

Ліній у архіві ${r.shapes.total}, з них ${r.shapes.coarse} (${pct(r.shapes.coarse, r.shapes.total)} %) мають не більше 3 точок —
це пряма між кінцевими, а не дорога. Контрольних точок далі 150 м від лінії свого рейсу: ${r.shapes.pointsFar} з
${r.shapes.pointsChecked} (${pct(r.shapes.pointsFar, r.shapes.pointsChecked)} %). Тому лінії в дані «Доведе» не беремо; час між
контрольними точками й інтервали — беремо.

## Чого в архіві немає

Контрольних точок у рейсі 2–8 (кінцеві й кілька проміжних), а не всі зупинки; маршрутних таксі й приміських автобусів
немає зовсім. Тому Google лишається потрібним для них і для пішої частини дороги.
`;
}
