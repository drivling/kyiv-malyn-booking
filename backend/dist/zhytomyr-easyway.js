"use strict";
/**
 * Знімок EasyWay для Житомира (data/zhytomyr-transport/easyway/): що взято зі сторінок eway.in.ua руками через
 * браузер власника, з дозволу EasyWay (API в них нема; автоматично сайт не обходимо — Docs/zhytomyr-transport-2026-11.md).
 *
 * Чистий розбір файлів знімка, без мережі й файлової системи:
 * - routes.csv        — усі лінії міста зі списку EasyWay (тип, номер, кінцеві, години, інтервал, ціна);
 * - stop_sequence.csv — порядок зупинок за напрямками (ID зупинок EasyWay, де вони є);
 * - departures.csv    — відправлення з першої зупинки (будні / вихідні, позначка «в депо»);
 * - raw/**.txt        — сторінки маршрутів як знято (RI / TITLE / PANEL / F / B / S … WD / WE): звідси беремо те, чого
 *                       ще нема в CSV (електротранспорт збирається окремо й потрапляє спершу сюди).
 * Координат зупинок EasyWay не віддає (закодовані на карті) — їх дає zhytomyr-dataset.ts за назвами.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsvLine = parseCsvLine;
exports.parseEwRawText = parseEwRawText;
exports.parseEwRawJson = parseEwRawJson;
exports.parseEasywaySnapshot = parseEasywaySnapshot;
const MODES = {
    bus: 'bus',
    trol: 'trolleybus',
    trolleybus: 'trolleybus',
    tram: 'tram',
    suburban: 'suburban',
    'bus-suburban': 'suburban',
    'train-suburban': 'elektrichka',
    intercity: 'intercity',
    train: 'train',
    elektrichka: 'elektrichka',
};
/** Тип із назви сторінки: «2 тролейбус (…)», «1 автобус (…)» */
function modeFromTitle(title) {
    const t = title.toLowerCase();
    if (t.includes('тролейбус'))
        return 'trolleybus';
    if (t.includes('трамвай'))
        return 'tram';
    if (t.includes('автобус'))
        return 'bus';
    return null;
}
/** Рядок CSV з лапками ("a ""b""") */
function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            }
            else if (ch === '"')
                quoted = false;
            else
                cur += ch;
        }
        else if (ch === '"')
            quoted = true;
        else if (ch === ',') {
            out.push(cur);
            cur = '';
        }
        else
            cur += ch;
    }
    out.push(cur);
    return out;
}
function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length)
        return [];
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cells = parseCsvLine(line);
        return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
    });
}
const emptyDir = () => ({ stops: [], from: null, workdays: [], weekend: [] });
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const normTime = (t) => {
    const m = TIME_RE.exec(t.trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
/** «19:56d» — рейс у депо (так у raw/*.json) */
function departure(raw, mark = '') {
    const depot = /d$/i.test(raw.trim()) || /депо|depot/i.test(mark);
    const time = normTime(raw.trim().replace(/d$/i, ''));
    return time ? { time, depot } : null;
}
function parseEwRawText(text) {
    var _a;
    let ri = '';
    let title = '';
    let panel = null;
    const directions = {};
    let current = null;
    const stopsOf = (list) => list
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
        const m = /^(\d+)=(.+)$/.exec(s);
        return m ? { id: m[1], name: m[2].trim() } : { id: null, name: s };
    });
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        const head = /^\s*(RI|TITLE|PANEL|F|B|S|WD|WE|NOTE)\b\s?(.*)$/.exec(line);
        if (!head)
            continue;
        const [, key, rest] = head;
        if (key === 'RI')
            ri = rest.trim();
        else if (key === 'TITLE')
            title = rest.trim();
        else if (key === 'PANEL')
            panel = rest.trim() || null;
        else if (key === 'F' || key === 'B') {
            const stops = stopsOf(rest);
            if (stops.length)
                (directions[_a = key === 'F' ? 'forward' : 'backward'] ?? (directions[_a] = emptyDir())).stops = stops;
        }
        else if (key === 'S') {
            const m = /^(forward|backward)\s*(?:@(.*))?$/.exec(rest.trim());
            current = m ? m[1] : null;
            if (current)
                (directions[current] ?? (directions[current] = emptyDir())).from = m?.[2]?.trim() || null;
        }
        else if ((key === 'WD' || key === 'WE') && current) {
            const list = rest
                .split(/\s+/)
                .map((t) => departure(t))
                .filter((d) => d !== null);
            directions[current][key === 'WD' ? 'workdays' : 'weekend'] = list;
        }
    }
    if (!ri)
        return null;
    return { ri, title, panel, mode: modeFromTitle(title) ?? 'other', number: title.split(/\s+/)[0] ?? '', directions };
}
/** Сторінка маршруту в JSON (raw/route-N.json): stops.forward = [[id, назва]…], sched.<dir>.times = [будні, вихідні] */
function parseEwRawJson(text) {
    const d = JSON.parse(text);
    if (!d.ri)
        return null;
    const directions = {};
    for (const key of ['forward', 'backward']) {
        const stops = d.stops?.[key];
        const sched = d.sched?.[key];
        if (!stops?.length && !sched)
            continue;
        const dir = emptyDir();
        dir.stops = (stops ?? []).map(([id, name]) => ({ id: id || null, name }));
        dir.from = sched?.stop ?? null;
        const [wd = [], we = []] = sched?.times ?? [];
        dir.workdays = wd.map((t) => departure(t)).filter((x) => x !== null);
        dir.weekend = we.map((t) => departure(t)).filter((x) => x !== null);
        directions[key] = dir;
    }
    const title = d.title ?? '';
    return { ri: String(d.ri), title, panel: d.panel ?? null, mode: modeFromTitle(title) ?? 'other', number: title.split(/\s+/)[0] ?? '', directions };
}
const dirCount = (d) => (d ? d.stops.length + d.workdays.length + d.weekend.length : 0);
/**
 * Знімок EasyWay з файлів. CSV — основа (їх зводить людина, що знімає); сторінка з raw/ доповнює напрямок, коли в ній
 * більше (зупинки з ID, розклад, якого в CSV ще нема). Лінії без запису в routes.csv, але зі сторінкою — теж беремо.
 */
function parseEasywaySnapshot(files) {
    var _a, _b;
    const byRi = new Map();
    for (const row of files.routesCsv ? parseCsv(files.routesCsv) : []) {
        const ri = row.easyway_id;
        if (!ri)
            continue;
        const price = Number(row.price_uah);
        byRi.set(ri, {
            ri,
            mode: MODES[row.type] ?? 'other',
            number: row.number,
            name: row.name,
            workHours: row.work_hours,
            interval: row.interval_min,
            priceUah: Number.isFinite(price) && row.price_uah !== '' ? price : null,
            firstStop: row.first_stop,
            lastStop: row.last_stop,
            panel: null,
            shape: null,
            lengthKm: null,
            carrier: null,
            directions: {},
        });
    }
    const route = (ri, number, mode) => {
        let r = byRi.get(ri);
        if (!r) {
            r = { ri, mode, number, name: '', workHours: '', interval: '', priceUah: null, firstStop: '', lastStop: '', panel: null, shape: null, lengthKm: null, carrier: null, directions: {} };
            byRi.set(ri, r);
        }
        return r;
    };
    for (const row of files.electricRoutesCsv ? parseCsv(files.electricRoutesCsv) : []) {
        const r = byRi.get(row.easyway_route_id) ?? route(row.easyway_route_id, row.number, MODES[row.type] ?? 'other');
        if (row.shape === 'loop' || row.shape === 'two-way')
            r.shape = row.shape;
        const km = Number(row.length_km);
        if (row.length_km && Number.isFinite(km))
            r.lengthKm = km;
        if (row.carrier)
            r.carrier = row.carrier;
    }
    for (const row of files.stopSequenceCsv ? parseCsv(files.stopSequenceCsv) : []) {
        const key = row.direction;
        if (key !== 'forward' && key !== 'backward')
            continue;
        const r = route(row.easyway_route_id, row.number, MODES[row.type] ?? 'other');
        const dir = ((_a = r.directions)[key] ?? (_a[key] = emptyDir()));
        const seq = Number(row.seq);
        dir.stops[seq - 1] = { id: row.easyway_stop_id || null, name: row.stop_name };
    }
    for (const r of byRi.values())
        for (const d of Object.values(r.directions))
            if (d)
                d.stops = d.stops.filter(Boolean);
    for (const row of files.departuresCsv ? parseCsv(files.departuresCsv) : []) {
        const key = row.direction;
        if (key !== 'forward' && key !== 'backward')
            continue;
        const r = byRi.get(row.easyway_route_id);
        if (!r)
            continue;
        const dir = ((_b = r.directions)[key] ?? (_b[key] = emptyDir()));
        dir.from ?? (dir.from = row.stop || null);
        const dep = departure(row.time, row.mark);
        if (!dep)
            continue;
        if (row.day_type === 'workdays')
            dir.workdays.push(dep);
        else if (row.day_type === 'weekend')
            dir.weekend.push(dep);
    }
    // сторінки маршрутів: доповнюють напрямки, де в них більше
    for (const [file, text] of Object.entries(files.raw).sort(([a], [b]) => a.localeCompare(b))) {
        let page = null;
        try {
            page = file.endsWith('.json') ? parseEwRawJson(text) : file.endsWith('.txt') ? parseEwRawText(text) : null;
        }
        catch {
            page = null;
        }
        if (!page)
            continue;
        const r = route(page.ri, page.number, page.mode);
        if (r.mode === 'other' && page.mode !== 'other')
            r.mode = page.mode;
        r.panel ?? (r.panel = page.panel);
        for (const key of ['forward', 'backward']) {
            const fromPage = page.directions[key];
            if (!fromPage)
                continue;
            const mine = r.directions[key];
            if (!mine) {
                r.directions[key] = fromPage;
                continue;
            }
            if (fromPage.stops.length && (fromPage.stops.length > mine.stops.length || (!mine.stops.some((s) => s.id) && fromPage.stops.some((s) => s.id)))) {
                mine.stops = fromPage.stops;
            }
            if (fromPage.workdays.length + fromPage.weekend.length > mine.workdays.length + mine.weekend.length) {
                mine.workdays = fromPage.workdays;
                mine.weekend = fromPage.weekend;
                mine.from = fromPage.from ?? mine.from;
            }
        }
    }
    for (const r of byRi.values()) {
        for (const d of Object.values(r.directions)) {
            if (!d)
                continue;
            const uniq = (xs) => {
                const seen = new Map();
                for (const x of xs)
                    if (!seen.has(x.time))
                        seen.set(x.time, x);
                return [...seen.values()].sort((a, b) => a.time.localeCompare(b.time));
            };
            d.workdays = uniq(d.workdays);
            d.weekend = uniq(d.weekend);
        }
    }
    const routes = [...byRi.values()]
        .filter((r) => r.number || dirCount(r.directions.forward) || dirCount(r.directions.backward))
        .sort((a, b) => Number(a.ri) - Number(b.ri) || a.ri.localeCompare(b.ri));
    return { routes };
}
