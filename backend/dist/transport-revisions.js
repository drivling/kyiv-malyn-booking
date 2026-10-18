"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plural = exports.TRANSPORT_REVISIONS_MAX_LIMIT = exports.TRANSPORT_REVISIONS_DEFAULT_LIMIT = void 0;
exports.diffTransportDatasets = diffTransportDatasets;
exports.isEmptyDiff = isEmptyDiff;
exports.transportRevisionStats = transportRevisionStats;
exports.describeTransportDiff = describeTransportDiff;
exports.describeTransportRevision = describeTransportRevision;
exports.snapshotTransportDataset = snapshotTransportDataset;
exports.recordTransportRevision = recordTransportRevision;
exports.ensureInitialTransportRevision = ensureInitialTransportRevision;
exports.listTransportRevisions = listTransportRevisions;
exports.parseRevisionsLimit = parseRevisionsLimit;
const gtfs_feed_1 = require("./gtfs-feed");
const local_transport_1 = require("./local-transport");
const stop_redirects_1 = require("./stop-redirects");
exports.TRANSPORT_REVISIONS_DEFAULT_LIMIT = 50;
exports.TRANSPORT_REVISIONS_MAX_LIMIT = 200;
const clock = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
const routeNoOf = (routes, routeId) => routes.get(routeId)?.shortName?.trim() || routeId;
const routeNameOf = (r) => [r.fromName, r.toName].filter((s) => s && s.trim()).join(' — ');
const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
/** Чистий diff двох датасетів: зупинки, маршрути, рейси, сегменти, редиректи. Порядок — за id, стабільний. */
function diffTransportDatasets(prev, next) {
    const prevStops = byId(prev.stops);
    const nextStops = byId(next.stops);
    const prevRoutes = byId(prev.routes);
    const nextRoutes = byId(next.routes);
    const prevTrips = byId(prev.trips);
    const nextTrips = byId(next.trips);
    const stops = { added: [], removed: [], renamed: [] };
    for (const s of next.stops) {
        const was = prevStops.get(s.id);
        if (!was)
            stops.added.push({ id: s.id, name: s.name });
        else if (was.name !== s.name)
            stops.renamed.push({ id: s.id, from: was.name, to: s.name });
    }
    for (const s of prev.stops)
        if (!nextStops.has(s.id))
            stops.removed.push({ id: s.id, name: s.name });
    const routes = { added: [], removed: [] };
    for (const r of next.routes)
        if (!prevRoutes.has(r.id))
            routes.added.push({ id: r.id, no: routeNoOf(nextRoutes, r.id), name: routeNameOf(r) });
    for (const r of prev.routes)
        if (!nextRoutes.has(r.id))
            routes.removed.push({ id: r.id, no: routeNoOf(prevRoutes, r.id), name: routeNameOf(r) });
    const trips = { added: [], removed: [], moved: [] };
    const tripRef = (t, routesMap) => ({
        id: t.id,
        routeId: t.routeId,
        routeNo: routeNoOf(routesMap, t.routeId),
        departureTime: clock(t.departureTime),
    });
    for (const t of next.trips) {
        const was = prevTrips.get(t.id);
        if (!was) {
            trips.added.push(tripRef(t, nextRoutes));
            continue;
        }
        const from = clock(was.departureTime);
        const to = clock(t.departureTime);
        if (from !== to)
            trips.moved.push({ ...tripRef(t, nextRoutes), from, to });
    }
    for (const t of prev.trips)
        if (!nextTrips.has(t.id))
            trips.removed.push(tripRef(t, prevRoutes));
    const segKey = (s) => `${s.routeId}|${s.fromStopId}|${s.toStopId}`;
    const prevSeg = new Map(prev.segments.map((s) => [segKey(s), Math.round(s.seconds)]));
    const nextSeg = new Map(next.segments.map((s) => [segKey(s), Math.round(s.seconds)]));
    let changed = 0;
    for (const [k, sec] of nextSeg)
        if (prevSeg.get(k) !== sec)
            changed++;
    for (const k of prevSeg.keys())
        if (!nextSeg.has(k))
            changed++;
    const prevRedirects = (0, stop_redirects_1.stopRedirectsOf)(prev);
    const nextRedirects = (0, stop_redirects_1.stopRedirectsOf)(next);
    const redirects = { added: [], removed: [] };
    for (const [from, to] of Object.entries(nextRedirects).sort())
        if (prevRedirects[from] !== to)
            redirects.added.push({ from, to });
    for (const [from, to] of Object.entries(prevRedirects).sort())
        if (nextRedirects[from] !== to)
            redirects.removed.push({ from, to });
    return { stops, routes, trips, segments: { changed }, redirects };
}
function isEmptyDiff(diff) {
    if (!diff)
        return true;
    return (!diff.stops.added.length &&
        !diff.stops.removed.length &&
        !diff.stops.renamed.length &&
        !diff.routes.added.length &&
        !diff.routes.removed.length &&
        !diff.trips.added.length &&
        !diff.trips.removed.length &&
        !diff.trips.moved.length &&
        !diff.segments.changed &&
        !diff.redirects.added.length &&
        !diff.redirects.removed.length);
}
/** Лічильники фіду на поточний стан — ті самі, що пише GTFS (unreliable маршрути не рахуються) */
function transportRevisionStats(dataset) {
    return (0, gtfs_feed_1.buildGtfsFeed)(dataset, { revision: dataset.revision ?? null }).stats;
}
/* ---------- людський підсумок ---------- */
const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11)
        return `${n} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
        return `${n} ${few}`;
    return `${n} ${many}`;
};
exports.plural = plural;
/** Скільки позицій перелічуємо поіменно в одній категорії; далі — «та ще N» */
const LIST_MAX = 6;
function listed(items, label, item) {
    const shown = items.slice(0, LIST_MAX).map(item).join(', ');
    const rest = items.length - LIST_MAX;
    return `${label(items.length)}: ${shown}${rest > 0 ? ` та ще ${rest}` : ''}`;
}
const stopItem = (s) => `«${s.name}» (${s.id})`;
const routeItem = (r) => `№${r.no}${r.name ? ` ${r.name}` : ''}`;
const tripItem = (t) => `№${t.routeNo} ${t.departureTime ? `о ${t.departureTime}` : 'без часу'} (${t.id})`;
/** Підсумок diff українською; порожній diff → '' (що писати тоді — вирішує describeTransportRevision за source) */
function describeTransportDiff(diff) {
    const parts = [];
    if (diff.stops.added.length)
        parts.push(listed(diff.stops.added, (n) => `додано ${(0, exports.plural)(n, 'зупинку', 'зупинки', 'зупинок')}`, stopItem));
    if (diff.stops.renamed.length)
        parts.push(listed(diff.stops.renamed, (n) => `перейменовано ${(0, exports.plural)(n, 'зупинку', 'зупинки', 'зупинок')}`, (r) => `«${r.from}» → «${r.to}» (${r.id})`));
    if (diff.stops.removed.length)
        parts.push(listed(diff.stops.removed, (n) => `знято ${(0, exports.plural)(n, 'зупинку', 'зупинки', 'зупинок')}`, stopItem));
    if (diff.routes.added.length)
        parts.push(listed(diff.routes.added, (n) => `додано ${(0, exports.plural)(n, 'маршрут', 'маршрути', 'маршрутів')}`, routeItem));
    if (diff.routes.removed.length)
        parts.push(listed(diff.routes.removed, (n) => `знято ${(0, exports.plural)(n, 'маршрут', 'маршрути', 'маршрутів')}`, routeItem));
    if (diff.trips.added.length)
        parts.push(listed(diff.trips.added, (n) => `додано ${(0, exports.plural)(n, 'рейс', 'рейси', 'рейсів')}`, tripItem));
    if (diff.trips.moved.length)
        parts.push(listed(diff.trips.moved, (n) => `зсунуто ${(0, exports.plural)(n, 'рейс', 'рейси', 'рейсів')}`, (t) => `№${t.routeNo} ${t.from || '—'} → ${t.to || '—'} (${t.id})`));
    if (diff.trips.removed.length)
        parts.push(listed(diff.trips.removed, (n) => `знято ${(0, exports.plural)(n, 'рейс', 'рейси', 'рейсів')}`, tripItem));
    if (diff.segments.changed)
        parts.push(`змінено час у дорозі на ${(0, exports.plural)(diff.segments.changed, 'перегоні', 'перегонах', 'перегонах')} між зупинками`);
    if (diff.redirects.added.length)
        parts.push(listed(diff.redirects.added, (n) => `${(0, exports.plural)(n, 'зупинку', 'зупинки', 'зупинок')} перенесено`, (r) => `${r.from} → ${r.to}`));
    if (diff.redirects.removed.length)
        parts.push(listed(diff.redirects.removed, (n) => `знято ${(0, exports.plural)(n, 'перенесення', 'перенесення', 'перенесень')}`, (r) => `${r.from} → ${r.to}`));
    if (!parts.length)
        return '';
    const text = parts.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}
/** Підсумок рядка журналу: diff, а коли його нема або він порожній — що це за запис за source */
function describeTransportRevision(row) {
    if (!row.diff) {
        return row.source === 'seed' ? 'Дані завантажено з початкового набору' : 'Перша збережена версія даних — попереднього стану для порівняння немає';
    }
    const text = describeTransportDiff(row.diff);
    if (text)
        return text;
    if (row.source === 'recalculate')
        return 'Перераховано час у дорозі — секунди на перегонах не змінились';
    if (row.source === 'stop-redirects')
        return 'Перенесення зупинок збережено без змін';
    return 'Технічне оновлення без змін у зупинках, маршрутах, рейсах і часі в дорозі (опис, контакти чи схема)';
}
function toRecord(row) {
    const diff = (row.diff ?? null);
    const source = row.source;
    return {
        revision: row.revision,
        createdAt: new Date(row.createdAt).toISOString(),
        source,
        stats: row.stats,
        diff,
        summary: describeTransportRevision({ source, diff }),
    };
}
/**
 * Датасет до запису — для diff. null, коли датасету ще нема (порожня БД) або його не вдалося прочитати:
 * журнал не має зірвати сам запис.
 */
async function snapshotTransportDataset(prisma) {
    try {
        const ds = await (0, local_transport_1.loadTransportDataset)(prisma);
        return ds.revision ? ds : null;
    }
    catch (e) {
        console.error('[transport-revisions] snapshot before write failed', e);
        return null;
    }
}
/**
 * Записати рядок про поточну revision (після запису в БД). previous — знімок до запису (snapshotTransportDataset);
 * без нього diff = null. Повторний виклик для тієї самої revision нічого не змінює (upsert без update).
 * Помилки лише в лог; повертає запис або null.
 */
async function recordTransportRevision(prisma, options) {
    try {
        const current = await (0, local_transport_1.loadTransportDataset)(prisma);
        if (!current.revision)
            return null;
        if (options.previous?.revision === current.revision)
            return null;
        const diff = options.previous ? diffTransportDatasets(options.previous, current) : null;
        const stats = transportRevisionStats(current);
        const row = await prisma.transportRevision.upsert({
            where: { revision: current.revision },
            create: {
                revision: current.revision,
                source: options.source,
                stats: stats,
                diff: diff === null ? undefined : diff,
            },
            update: {},
        });
        return toRecord(row);
    }
    catch (e) {
        console.error('[transport-revisions] record failed', e);
        return null;
    }
}
/** При старті: журнал порожній, а датасет є → перший рядок із поточного стану без diff */
async function ensureInitialTransportRevision(prisma) {
    try {
        if ((await prisma.transportRevision.count()) > 0)
            return null;
    }
    catch (e) {
        console.error('[transport-revisions] count failed', e);
        return null;
    }
    return recordTransportRevision(prisma, { source: 'initial', previous: null });
}
/** Останні рядки журналу, новіші першими (revision — ISO, тож сортується як час) */
async function listTransportRevisions(prisma, limit = exports.TRANSPORT_REVISIONS_DEFAULT_LIMIT) {
    const take = Math.min(Math.max(1, Math.floor(limit)), exports.TRANSPORT_REVISIONS_MAX_LIMIT);
    const rows = await prisma.transportRevision.findMany({ orderBy: { revision: 'desc' }, take });
    return rows.map(toRecord);
}
/** ?limit= з запиту → число в межах 1…200, типово 50 */
function parseRevisionsLimit(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1)
        return exports.TRANSPORT_REVISIONS_DEFAULT_LIMIT;
    return Math.min(Math.floor(n), exports.TRANSPORT_REVISIONS_MAX_LIMIT);
}
