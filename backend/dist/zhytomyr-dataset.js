"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZHYTOMYR_CENTER = exports.EW_STOP_BASE = exports.ZT_STOP_BASE = void 0;
exports.routeIdFor = routeIdFor;
exports.displayNumber = displayNumber;
exports.buildZhytomyrDataset = buildZhytomyrDataset;
/**
 * Датасет міського транспорту Житомира з двох джерел (Docs/zhytomyr-transport-2026-11.md). Чиста функція: джерела →
 * датасет у форматі PUT /transport/dataset?city=Zhytomyr і звіт «що перевірити руками». Мережі й бази не торкається;
 * файли читає zhytomyr-dataset-files.ts.
 *
 * - автобуси — zt.rozklad.in.ua (сайт власника): зупинки по порядку, хвилини між ними (виправлені за Google, як у
 *   «Доведе»), відправлення від першої зупинки; координати — data/zhytomyr-transport/stops.json (OSM, Google, підказки);
 * - трамвай і тролейбуси — знімок EasyWay (лише в них): порядок зупинок, відправлення від першої зупинки. Координат
 *   EasyWay не дає: зупинку з тією самою назвою беремо з наших автобусних (спільна зупинка — пересадка), інакше з OSM,
 *   інакше ставимо між сусідами. Хвилини між зупинками — оцінка за відстанню (у звіті позначено);
 * - автобус, який є в обох, — з zt; вечірні рейси EasyWay, яких у нас нема, лише в звіті, доки власник не
 *   ввімкне `easywayExtraTrips` у dataset-config.json;
 * - рейси «у депо» не беремо (не відомо, де закінчуються) — так само, як «Доведе».
 *
 * Id зупинок: zt-зупинка N → st_2NNNN (20000 + N), зупинка EasyWay без пари в zt → st_3NNNNN (300000 + id EasyWay);
 * діапазони не перетинаються з Малином (st_0…) і Коростенем (st_10NN).
 */
const korosten_osm_1 = require("./korosten-osm");
const zhytomyr_routes_1 = require("./zhytomyr-routes");
const zhytomyr_stops_1 = require("./zhytomyr-stops");
exports.ZT_STOP_BASE = 20000;
exports.EW_STOP_BASE = 300000;
exports.ZHYTOMYR_CENTER = [50.2547, 28.6587];
// ---------- id і назви ----------
const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'h', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ю: 'yu', я: 'ya', '*': 's',
};
/** Номер маршруту → id [a-z0-9]: «19А» → «19a», «А2» → «a2», «18*» → «18s»; тролейбус і трамвай — з префіксом */
function routeIdFor(number, mode, overrides = {}) {
    const key = mode === 'bus' ? number : `${mode}:${number}`;
    if (overrides[key])
        return overrides[key];
    const base = [...number.toLowerCase()].map((ch) => (/[a-z0-9]/.test(ch) ? ch : TRANSLIT[ch] ?? '')).join('');
    if (mode === 'trolleybus')
        return `t${base}`;
    if (mode === 'tram')
        return 'tram';
    return base;
}
/** Номер для показу: латинська «A» у «4A» EasyWay → кирилична; трамвай — «Т» */
function displayNumber(number, mode) {
    if (mode === 'tram')
        return 'Т';
    return number.replace(/A/g, 'А').replace(/B/g, 'В').trim();
}
const MODE_UK = { bus: 'Автобус', trolleybus: 'Тролейбус', tram: 'Трамвай' };
const hhmmss = (t) => (t.length === 5 ? `${t}:00` : t);
const pad = (n, w = 3) => String(n).padStart(w, '0');
function addChain(b, routeId, chain, dirKey) {
    chain.forEach((stopId, i) => {
        let rs = b.routeStops.find((x) => x.routeId === routeId && x.stopId === stopId);
        if (!rs) {
            rs = { routeId, stopId, mapOnly: false };
            b.routeStops.push(rs);
        }
        rs[dirKey] = i + 1;
    });
}
function addSegments(b, routeId, chain, seconds) {
    for (let i = 0; i + 1 < chain.length; i++) {
        const key = `${routeId}|${chain[i]}|${chain[i + 1]}`;
        if (!b.segments.has(key))
            b.segments.set(key, { routeId, fromStopId: chain[i], toStopId: chain[i + 1], seconds: Math.max(0, Math.round(seconds[i])) });
    }
}
function addTrips(b, routeId, directionId, headsign, wd, we) {
    const side = directionId === '1' ? 't' : 'b';
    const list = [
        ['weekdays', 'w', wd],
        ['weekends', 'e', we],
    ];
    for (const [serviceId, tag, times] of list) {
        times.forEach((time, i) => {
            b.trips.push({
                id: `${routeId}-${side}${tag}${pad(i + 1)}`,
                routeId,
                serviceId,
                headsign,
                directionId,
                departureTime: hhmmss(time),
                blockId: null,
                wheelchairAccessible: '',
                bikesAllowed: '',
                startStopId: null,
                endStopId: null,
                arrivalTime: null,
                variantId: null,
                timepoints: null,
            });
        });
    }
}
const ztId = (id) => `st_${exports.ZT_STOP_BASE + id}`;
/** Точки zt-зупинок: відомі + приблизні між сусідами для тих, кого не знайшли ніде (missing у stops.json) */
function ztPoints(timed, ztStops) {
    const points = new Map();
    for (const s of ztStops)
        points.set(s.id, { lat: s.lat, lng: s.lng, approx: s.source === 'interpolated' });
    const guessed = [];
    for (let round = 0; round < 3; round++) {
        for (const t of timed) {
            const ids = t.dir.stops.map((s) => s.id);
            ids.forEach((id, i) => {
                if (points.has(id))
                    return;
                let a = i - 1;
                while (a >= 0 && !points.has(ids[a]))
                    a--;
                let c = i + 1;
                while (c < ids.length && !points.has(ids[c]))
                    c++;
                const pa = a >= 0 ? points.get(ids[a]) : undefined;
                const pc = c < ids.length ? points.get(ids[c]) : undefined;
                if (!pa && !pc)
                    return;
                const k = pa && pc ? (i - a) / (c - a) : 0;
                const lat = pa && pc ? pa.lat + (pc.lat - pa.lat) * k : (pa ?? pc).lat;
                const lng = pa && pc ? pa.lng + (pc.lng - pa.lng) * k : (pa ?? pc).lng;
                points.set(id, { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), approx: true });
                guessed.push(id);
            });
        }
    }
    const lost = [...new Set(timed.flatMap((t) => t.dir.stops.map((s) => s.id)).filter((id) => !points.has(id)))];
    return { points, guessed, lost };
}
/** Чи йдуть zt-зупинки a → b у якомусь напрямку поспіль (через ≤ 3 зупинки) — так вибираємо бік дороги */
function followsIndex(timed) {
    const next = new Map();
    for (const t of timed) {
        const ids = t.dir.stops.map((s) => s.id);
        ids.forEach((id, i) => {
            const set = next.get(id) ?? new Set();
            for (let j = i + 1; j <= i + 3 && j < ids.length; j++)
                set.add(ids[j]);
            next.set(id, set);
        });
    }
    return (a, b) => next.get(a)?.has(b) ?? false;
}
/** Хвилини між зупинками EasyWay: відстань × 1,3 (вулицями, не навпростець) за середньої швидкості + 20 с на зупинку */
function ewSeconds(a, b, speedKmh) {
    const sec = ((0, korosten_osm_1.distanceM)(a, b) * 1.3) / (speedKmh / 3.6) + 20;
    return Math.max(60, Math.round(sec / 30) * 30);
}
function buildZhytomyrDataset(input) {
    const { timed, ztStops, osm, easyway, config } = input;
    const b = { stops: new Map(), routes: [], routeStops: [], trips: [], segments: new Map(), colors: { ...(config.colors ?? {}) } };
    const notes = [];
    const overrides = config.routeIds ?? {};
    const { points, guessed, lost } = ztPoints(timed, ztStops);
    const ztName = new Map();
    for (const t of timed)
        for (const s of t.dir.stops)
            if (!ztName.has(s.id))
                ztName.set(s.id, (0, zhytomyr_routes_1.ztStopSide)(s.name));
    const addZtStop = (id) => {
        const p = points.get(id);
        if (!p)
            return false;
        const sid = ztId(id);
        if (!b.stops.has(sid))
            b.stops.set(sid, { id: sid, name: ztName.get(id) ?? String(id), lat: p.lat, lng: p.lng });
        return true;
    };
    // ---- автобуси з zt.rozklad.in.ua ----
    const ztByRoute = new Map();
    for (const t of timed)
        ztByRoute.set(t.route.number, [...(ztByRoute.get(t.route.number) ?? []), t]);
    const ztRouteIds = new Map();
    const skippedStops = [];
    for (const [number, dirs] of ztByRoute) {
        const id = routeIdFor(number, 'bus', overrides);
        if (b.routes.some((r) => r.id === id))
            throw new Error(`id маршруту ${id} двічі (${number})`);
        ztRouteIds.set(number, id);
        const first = dirs[0];
        const stopsOf = (t) => t.dir.stops.map((s, i) => ({ id: s.id, minutes: t.minutes[i] })).filter((s) => {
            const ok = addZtStop(s.id);
            if (!ok)
                skippedStops.push(`№${number}: ${ztName.get(s.id) ?? s.id}`);
            return ok;
        });
        const chains = dirs.map(stopsOf);
        const firstName = ztName.get(chains[0][0]?.id) ?? '';
        const lastName = ztName.get(chains[0][chains[0].length - 1]?.id) ?? '';
        const unchecked = dirs.filter((d) => !d.checked).length;
        b.routes.push({
            id,
            shortName: number === id ? '' : number,
            fromName: firstName,
            toName: lastName,
            scheme: 'city',
            note: `${MODE_UK.bus} №${number}: ${first.route.name}. Розклад: zt.rozklad.in.ua${config.zt.validFrom ? `, діє з ${config.zt.validFrom.split('-').reverse().join('.')}` : ''}.`,
            sourceUrl: config.zt.sourceUrl,
            unreliable: false,
            variants: [],
        });
        dirs.forEach((t, k) => {
            if (k > 1)
                return; // більше двох напрямків у маршруті сайт не має; про всяк випадок — лише два
            const chain = chains[k];
            const directionId = k === 0 ? '1' : '0';
            addChain(b, id, chain.map((s) => ztId(s.id)), k === 0 ? 'orderThere' : 'orderBack');
            addSegments(b, id, chain.map((s) => ztId(s.id)), chain.slice(1).map((s, i) => (s.minutes - chain[i].minutes) * 60));
            const times = (list) => list.filter((d) => !d.note?.includes('depot')).map((d) => d.time);
            addTrips(b, id, directionId, ztName.get(chain[chain.length - 1].id) ?? '', times(t.dir.workdays), times(t.dir.weekend));
        });
        if (unchecked)
            notes.push(`№${number}: ${unchecked} із ${dirs.length} напрямків не звірено з Google (data/zhytomyr-transport/REPORT.md) — хвилини з сайту як є`);
    }
    // ---- EasyWay: трамвай і тролейбуси; автобуси — лише звірка з zt ----
    const ewLines = [];
    const ewExtra = [];
    const ewSkipped = [];
    let ewStopStats = { zt: 0, osm: 0, between: 0, dropped: 0 };
    if (easyway) {
        const follows = followsIndex(timed);
        const ztByKeyName = (name) => [...ztName.entries()].filter(([id, n]) => points.has(id) && !points.get(id).approx && (0, zhytomyr_stops_1.sameStopName)(n, name)).map(([id]) => id);
        const osmByName = (name) => osm.filter((o) => (0, zhytomyr_stops_1.sameStopName)(o.name, name));
        const resolvedByEwId = new Map();
        const ewStopPoint = new Map();
        const pointOf = (stopId) => b.stops.get(stopId) ?? ewStopPoint.get(stopId);
        const resolveChain = (line, dir) => {
            let stops = dir.stops;
            // кільце: остання зупинка = перша — у ланцюжку зупинка буває лише раз
            if (stops.length > 2 && stops[0].name === stops[stops.length - 1].name)
                stops = stops.slice(0, -1);
            const cands = stops.map((s) => ztByKeyName(s.name));
            const out = stops.map((ew) => ({ ew, res: ew.id ? resolvedByEwId.get(ew.id) ?? null : null }));
            const used = new Set(out.map((o) => o.res?.stopId).filter((x) => !!x));
            // 1) пара з нашою автобусною зупинкою. Назви-вулиці («Корольова», «Шевченка») бувають у різних кінцях міста,
            //    тому спершу беремо лише певні: підтверджені сусідами (у нашому напрямку йдуть у тому самому порядку) або
            //    однозначні (усі зупинки з такою назвою — в одному місці, різні боки дороги)
            const score = (i, c) => (i > 0 && cands[i - 1].some((p) => follows(p, c)) ? 1 : 0) + (i + 1 < cands.length && cands[i + 1].some((n) => follows(c, n)) ? 1 : 0);
            const take = (i, c) => {
                addZtStop(c);
                out[i].res = { stopId: ztId(c), how: 'zt' };
                used.add(out[i].res.stopId);
            };
            out.forEach((o, i) => {
                if (o.res)
                    return;
                const options = cands[i].filter((c) => !used.has(ztId(c)));
                if (!options.length)
                    return;
                const best = [...options].sort((x, y) => score(i, y) - score(i, x) || x - y)[0];
                const pts = cands[i].map((c) => points.get(c));
                const oneplace = pts.every((p) => (0, korosten_osm_1.distanceM)(p, pts[0]) <= 400);
                if (score(i, best) > 0 || oneplace)
                    take(i, best);
            });
            /** найближчий уже знайдений сусід і скільки до нього зупинок */
            const neighbour = (i) => {
                for (let k = 1; k < out.length; k++) {
                    for (const j of [i - k, i + k]) {
                        const r = out[j]?.res;
                        const pt = r ? pointOf(r.stopId) : undefined;
                        if (pt)
                            return { pt, gap: k };
                    }
                }
                return null;
            };
            const NEAR_M = 1200;
            for (let changed = true; changed;) {
                changed = false;
                // решта пар — та, що найближче до знайденого сусіда, і не далі ~1,2 км на кожну зупинку між ними
                out.forEach((o, i) => {
                    if (o.res)
                        return;
                    const options = cands[i].filter((c) => !used.has(ztId(c)));
                    const n = neighbour(i);
                    if (!options.length || !n)
                        return;
                    const best = [...options].sort((x, y) => (0, korosten_osm_1.distanceM)(n.pt, points.get(x)) - (0, korosten_osm_1.distanceM)(n.pt, points.get(y)))[0];
                    if ((0, korosten_osm_1.distanceM)(n.pt, points.get(best)) > NEAR_M * n.gap)
                        return;
                    take(i, best);
                    changed = true;
                });
                // 2) OSM за назвою — так само біля знайденого сусіда
                out.forEach((o, i) => {
                    if (o.res)
                        return;
                    const options = osmByName(o.ew.name);
                    const n = neighbour(i);
                    if (!options.length || !n)
                        return;
                    const best = [...options].sort((x, y) => (0, korosten_osm_1.distanceM)(n.pt, x) - (0, korosten_osm_1.distanceM)(n.pt, y))[0];
                    if ((0, korosten_osm_1.distanceM)(n.pt, best) > NEAR_M * n.gap)
                        return;
                    const sid = ewStopId(o.ew, line, dir, i);
                    ewStopPoint.set(sid, { lat: best.lat, lng: best.lng });
                    o.res = { stopId: sid, how: 'osm' };
                    changed = true;
                });
            }
            // 3) між сусідами (приблизно)
            for (let round = 0; round < 3; round++) {
                out.forEach((o, i) => {
                    if (o.res)
                        return;
                    let a = i - 1;
                    while (a >= 0 && !out[a].res)
                        a--;
                    let c = i + 1;
                    while (c < out.length && !out[c].res)
                        c++;
                    const pa = a >= 0 ? pointOf(out[a].res.stopId) : undefined;
                    const pc = c < out.length ? pointOf(out[c].res.stopId) : undefined;
                    if (!pa || !pc)
                        return;
                    const k = (i - a) / (c - a);
                    const sid = ewStopId(o.ew, line, dir, i);
                    ewStopPoint.set(sid, { lat: Number((pa.lat + (pc.lat - pa.lat) * k).toFixed(6)), lng: Number((pa.lng + (pc.lng - pa.lng) * k).toFixed(6)) });
                    o.res = { stopId: sid, how: 'between' };
                });
            }
            for (const o of out)
                if (o.ew.id && o.res && !resolvedByEwId.has(o.ew.id))
                    resolvedByEwId.set(o.ew.id, o.res);
            return out;
        };
        for (const line of easyway.routes) {
            const fw = line.directions.forward;
            const bw = line.directions.backward;
            if (line.mode === 'bus') {
                const number = displayNumber(line.number, 'bus');
                const ours = ztByRoute.get(number);
                if (!ours) {
                    if (fw?.stops.length || bw?.stops.length)
                        ewLines.push(`- автобус №${number}: є в EasyWay, нема на zt.rozklad.in.ua — не взято`);
                    continue;
                }
                // вечірні рейси: час EasyWay, якого нема в нас (не «у депо»), за напрямком із тією самою першою зупинкою
                for (const dir of [fw, bw]) {
                    if (!dir?.stops.length)
                        continue;
                    const mine = ours.find((t) => (0, zhytomyr_stops_1.sameStopName)(t.dir.stops[0].name, dir.stops[0].name));
                    if (!mine)
                        continue;
                    const have = (list) => new Set(list.filter((d) => !d.note?.includes('depot')).map((d) => d.time));
                    const extra = (ew, ourSet) => ew.filter((d) => !d.depot && !ourSet.has(d.time)).map((d) => d.time);
                    const wd = extra(dir.workdays, have(mine.dir.workdays));
                    const we = extra(dir.weekend, have(mine.dir.weekend));
                    if (!wd.length && !we.length)
                        continue;
                    ewExtra.push(`- №${number} від «${(0, zhytomyr_routes_1.ztStopSide)(mine.dir.stops[0].name)}»: будні ${wd.join(', ') || '—'}; вихідні ${we.join(', ') || '—'}`);
                    if (config.easywayExtraTrips) {
                        const routeId = ztRouteIds.get(number);
                        const k = ours.indexOf(mine);
                        const directionId = k === 0 ? '1' : '0';
                        const last = mine.dir.stops[mine.dir.stops.length - 1];
                        const start = b.trips.filter((t) => t.routeId === routeId).length;
                        addTrips(b, routeId, directionId, ztName.get(last.id) ?? '', wd, we);
                        // id не мають перетинатися з уже доданими — перейменовуємо щойно додані
                        b.trips.slice(start).forEach((t, i) => (t.id = `${routeId}-ew${directionId}${pad(i + 1)}`));
                    }
                }
                continue;
            }
            if (!config.easywayModes.includes(line.mode))
                continue;
            const number = displayNumber(line.number, line.mode);
            const label = `${MODE_UK[line.mode] ?? line.mode} №${number}`;
            const dirs = [fw, bw].filter((d) => !!d && d.stops.length >= 2);
            if (!dirs.length) {
                ewSkipped.push(`- ${label}: нема порядку зупинок`);
                continue;
            }
            const id = routeIdFor(line.number, line.mode, overrides);
            if (b.routes.some((r) => r.id === id))
                throw new Error(`id маршруту ${id} двічі (${label})`);
            const chains = dirs.map((d) => resolveChain(line, d));
            const finalChains = chains.map((c) => c.filter((o) => o.res).map((o) => o.res.stopId));
            for (const c of chains) {
                for (const o of c) {
                    if (!o.res)
                        ewStopStats.dropped++;
                    else
                        ewStopStats[o.res.how]++;
                }
                const lostHere = c.filter((o) => !o.res).map((o) => o.ew.name);
                if (lostHere.length)
                    notes.push(`${label}: без точки й тому без зупинки на лінії — ${lostHere.join(', ')}`);
            }
            if (finalChains.some((c) => c.length < 2)) {
                ewSkipped.push(`- ${label}: зупинкам не знайшлося точок`);
                continue;
            }
            // зупинки EasyWay без пари в zt — у датасет
            for (const c of chains) {
                for (const o of c) {
                    if (!o.res || o.res.how === 'zt' || b.stops.has(o.res.stopId))
                        continue;
                    const p = ewStopPoint.get(o.res.stopId);
                    b.stops.set(o.res.stopId, { id: o.res.stopId, name: o.ew.name, lat: p.lat, lng: p.lng });
                }
            }
            const loop = line.shape === 'loop' || dirs.length === 1;
            b.routes.push({
                id,
                shortName: number,
                fromName: b.stops.get(finalChains[0][0])?.name ?? '',
                toName: b.stops.get(finalChains[0][finalChains[0].length - 1])?.name ?? '',
                scheme: 'city',
                note: `${MODE_UK[line.mode] ?? line.mode} №${number}${line.name ? `: ${line.name}` : ''}${loop ? ' (кільцевий)' : ''}. ` +
                    'Час між зупинками орієнтовний.',
                // сайт EasyWay на сторінках не згадуємо (рішення власника 2026-11-24)
                sourceUrl: '',
                unreliable: false,
                variants: [],
            });
            dirs.forEach((d, k) => {
                const chain = finalChains[k];
                addChain(b, id, chain, k === 0 ? 'orderThere' : 'orderBack');
                addSegments(b, id, chain, chain.slice(1).map((sid, i) => ewSeconds(pointOf(chain[i]), pointOf(sid), config.ewSpeedKmh)));
                const keep = (xs) => xs.filter((x) => !x.depot).map((x) => x.time);
                addTrips(b, id, k === 0 ? '1' : '0', b.stops.get(chain[chain.length - 1])?.name ?? '', keep(d.workdays), keep(d.weekend));
                if (!d.workdays.length && !d.weekend.length)
                    notes.push(`${label}: у знімку нема розкладу напрямку ${k === 0 ? '«туди»' : '«назад»'} — лише зупинки`);
            });
            // зупинки з тією самою назвою бувають у різних місцях: ламана через точки довша за лінію EasyWay — щось не там
            if (line.lengthKm) {
                finalChains.forEach((chain, k) => {
                    const km = chain.slice(1).reduce((sum, sid, i) => sum + (0, korosten_osm_1.distanceM)(pointOf(chain[i]), pointOf(sid)), 0) / 1000;
                    if (km > line.lengthKm * 1.15)
                        notes.push(`${label}, ${k === 0 ? 'туди' : 'назад'}: через точки зупинок ${km.toFixed(1)} км навпростець, а лінія EasyWay — ${line.lengthKm} км; частина зупинок, мабуть, стоїть не там (однакові назви в різних місцях) — перевірити на карті`);
                });
            }
            ewLines.push(`- ${label}${loop ? ' (кільце)' : ''}: ${dirs.map((d, k) => `${k === 0 ? 'туди' : 'назад'} ${finalChains[k].length} зуп., ${d.workdays.filter((x) => !x.depot).length}/${d.weekend.filter((x) => !x.depot).length} рейсів`).join('; ')}`);
        }
        const others = easyway.routes.filter((r) => !['bus', ...config.easywayModes].includes(r.mode));
        if (others.length)
            ewLines.push(`- не міський транспорт (приміські, поїзди) — не взято: ${others.length}`);
    }
    const stops = [...b.stops.values()].sort((x, y) => x.id.localeCompare(y.id, 'en', { numeric: true }));
    const used = new Set(b.routeStops.map((r) => r.stopId));
    const dataset = {
        stops: stops.filter((s) => used.has(s.id)),
        routes: b.routes,
        routeStops: b.routeStops.map((r) => ({ routeId: r.routeId, stopId: r.stopId, orderThere: r.orderThere ?? 0, orderBack: r.orderBack ?? 0, mapOnly: false })),
        trips: b.trips,
        segments: [...b.segments.values()],
        meta: {
            defaultSec: config.defaultSec,
            center: exports.ZHYTOMYR_CENTER,
            routeColors: b.colors,
            source: `Чернетка: zt.rozklad.in.ua (${config.zt.fetchedAt}), OpenStreetMap (ODbL)`,
        },
    };
    const count = (pred) => dataset.stops.filter(pred).length;
    const ztApprox = new Set([...points.entries()].filter(([, p]) => p.approx).map(([id]) => ztId(id)));
    const report = [
        '# Житомир: чернетка датасету міського транспорту',
        '',
        'ЗГЕНЕРОВАНО: `npm run zhytomyr:dataset` у backend/ (zhytomyr-dataset.ts). Руками не редагувати; рішення — у `dataset-config.json`.',
        '',
        '## Що всередині',
        '',
        `| | |`,
        `|---|---|`,
        `| Маршрутів | ${dataset.routes.length} (автобусів із zt.rozklad.in.ua ${ztByRoute.size}, ліній EasyWay ${dataset.routes.length - ztByRoute.size}) |`,
        `| Зупинок | ${dataset.stops.length} (із zt ${count((s) => s.id.startsWith('st_2'))}, лише EasyWay ${count((s) => s.id.startsWith('st_3'))}) |`,
        `| Рейсів | ${dataset.trips.length} |`,
        `| Перегонів | ${dataset.segments.length} |`,
        `| Приблизних точок zt (між сусідами) | ${count((s) => ztApprox.has(s.id))} |`,
        '',
        '## EasyWay',
        '',
        easyway
            ? [
                `Зупинки ліній EasyWay: спільні з нашими автобусними ${ewStopStats.zt}, з OSM за назвою ${ewStopStats.osm}, між сусідами ${ewStopStats.between}, без точки ${ewStopStats.dropped}.`,
                '',
                ...ewLines,
                ...(ewSkipped.length ? ['', 'Не взято:', '', ...ewSkipped] : []),
            ].join('\n')
            : 'Знімка EasyWay нема (data/zhytomyr-transport/easyway/).',
        '',
        '## Рейси EasyWay, яких нема на zt.rozklad.in.ua',
        '',
        ewExtra.length
            ? `${config.easywayExtraTrips ? 'Взято в датасет (`easywayExtraTrips: true`).' : 'Не взято: вирішує власник (`easywayExtraTrips` у dataset-config.json).'} «У депо» не рахуємо.\n\n${ewExtra.join('\n')}`
            : 'Нема.',
        '',
        '## Перевірити руками',
        '',
        ...(notes.length ? [...new Set(notes)].map((n) => `- ${n}`) : ['- нічого']),
        ...(guessed.length ? [`- zt-зупинок без точки ніде, поставлено між сусідами: ${guessed.length}`] : []),
        ...(lost.length || skippedStops.length ? [`- zt-зупинки, що випали з ланцюжків (нема точки й сусідів): ${[...new Set(skippedStops)].join('; ')}`] : []),
        '',
    ].join('\n');
    return { dataset, report };
}
/** Id зупинки EasyWay без пари в zt: за ID EasyWay; без нього — номер у ланцюжку */
function ewStopId(ew, line, dir, index) {
    if (ew.id && /^\d{1,7}$/.test(ew.id))
        return `st_${exports.EW_STOP_BASE + Number(ew.id)}`;
    const side = line.directions.forward === dir ? 1 : 2;
    return `st_${exports.EW_STOP_BASE * 30 + Number(line.ri) * 1000 + side * 100 + index}`;
}
