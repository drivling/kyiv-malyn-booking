"use strict";
/**
 * Export Malyn city transport from PostgreSQL → GTFS Static feed.
 *
 * Output: data/malyn-transport/gtfs/  (txt + malyn-gtfs.zip)
 *
 * Only trips with departureTime are exported (honest feed).
 * stop_times are synthesized from ordered passenger stops + segment durations.
 *
 * Usage (from backend/):
 *   npm run export:gtfs
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const client_1 = require("@prisma/client");
const local_transport_1 = require("../local-transport");
const outDir = path_1.default.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'gtfs');
const DEFAULT_SEC = 120;
const FALLBACK_MINS = 2;
const SERVICE_START_DATE = '20240101';
const SERVICE_END_DATE = '20271231';
const SERVICE_MAP = {
    'пн-вт-ср-чт-пт-сб-нд': 'everyday',
    everyday: 'everyday',
    weekdays: 'weekdays',
};
function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function writeTable(filePath, headers, rows) {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => csvEscape(row[h])).join(','));
    }
    fs_1.default.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}
function toGtfsTime(raw) {
    const m = String(raw || '')
        .trim()
        .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const hh = String(Number(m[1])).padStart(2, '0');
    return `${hh}:${m[2]}:${m[3] || '00'}`;
}
function minutesToGtfs(mins) {
    const total = Math.max(0, Math.round(mins));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function parseMinutes(gtfsTime) {
    const m = gtfsTime.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m)
        return 0;
    return Number(m[1]) * 60 + Number(m[2]);
}
function orderedPassengerStops(stops, direction) {
    const key = direction === 'there' ? 'orderThere' : 'orderBack';
    return stops
        .filter((s) => !s.mapOnly && (s[key] ?? -1) > 0)
        .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}
function orderedAllStops(stops, direction) {
    const key = direction === 'there' ? 'orderThere' : 'orderBack';
    return stops
        .filter((s) => (s[key] ?? -1) > 0)
        .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}
function segmentSec(segments, defaultSec, routeId, fromKey, toKey) {
    const k1 = `${routeId}|${fromKey}|${toKey}`;
    const k2 = `${routeId}|${toKey}|${fromKey}`;
    return segments[k1] ?? segments[k2] ?? defaultSec;
}
function durationToStopMins(routeId, chainKeys, toIndex, segments, defaultSec) {
    let sec = 0;
    for (let i = 0; i < toIndex && i < chainKeys.length - 1; i++) {
        sec += segmentSec(segments, defaultSec, routeId, chainKeys[i], chainKeys[i + 1]);
    }
    if (sec === 0 && toIndex > 0 && Object.keys(segments).every((k) => !k.startsWith(`${routeId}|`))) {
        return toIndex * FALLBACK_MINS;
    }
    return sec / 60;
}
function exportGtfs(dataset) {
    const agency = dataset.meta.agency || {
        agency_id: 'malyn',
        agency_name: 'Громадський транспорт міста Малина',
        agency_url: 'https://malyn-rada.gov.ua/',
        agency_timezone: 'Europe/Kyiv',
        agency_lang: 'uk',
        agency_phone: '',
    };
    const defaultSec = Number(dataset.meta.defaultSec) || DEFAULT_SEC;
    const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
    const routeById = new Map(dataset.routes.map((r) => [r.id, r]));
    const routeStopsByRoute = new Map();
    for (const rs of dataset.routeStops) {
        if (!routeStopsByRoute.has(rs.routeId))
            routeStopsByRoute.set(rs.routeId, []);
        routeStopsByRoute.get(rs.routeId).push(rs);
    }
    const segments = {};
    for (const seg of dataset.segments) {
        segments[`${seg.routeId}|${seg.fromStopId}|${seg.toStopId}`] = seg.seconds;
    }
    fs_1.default.mkdirSync(outDir, { recursive: true });
    writeTable(path_1.default.join(outDir, 'agency.txt'), ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone'], [
        {
            agency_id: agency.agency_id || 'malyn',
            agency_name: agency.agency_name,
            agency_url: agency.agency_url,
            agency_timezone: agency.agency_timezone || 'Europe/Kyiv',
            agency_lang: agency.agency_lang || 'uk',
            agency_phone: agency.agency_phone || '',
        },
    ]);
    writeTable(path_1.default.join(outDir, 'calendar.txt'), ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], [
        {
            service_id: 'everyday',
            monday: 1,
            tuesday: 1,
            wednesday: 1,
            thursday: 1,
            friday: 1,
            saturday: 1,
            sunday: 1,
            start_date: SERVICE_START_DATE,
            end_date: SERVICE_END_DATE,
        },
        {
            service_id: 'weekdays',
            monday: 1,
            tuesday: 1,
            wednesday: 1,
            thursday: 1,
            friday: 1,
            saturday: 0,
            sunday: 0,
            start_date: SERVICE_START_DATE,
            end_date: SERVICE_END_DATE,
        },
    ]);
    const usedStopIds = new Set(stopById.keys());
    const timedTrips = dataset.trips.filter((t) => toGtfsTime(t.departureTime));
    const routeIds = [...new Set(timedTrips.map((t) => t.routeId))].sort((a, b) => Number(a) - Number(b));
    const routeRows = routeIds.map((routeId) => {
        const meta = routeById.get(routeId);
        const longName = [meta?.fromName, meta?.toName].filter(Boolean).join(' — ') || `Маршрут ${routeId}`;
        return {
            route_id: routeId,
            agency_id: agency.agency_id || 'malyn',
            route_short_name: routeId,
            route_long_name: longName,
            route_type: 3,
        };
    });
    writeTable(path_1.default.join(outDir, 'routes.txt'), ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], routeRows);
    const shapeRows = [];
    const shapeIdByRouteDir = new Map();
    function ensureShape(routeId, direction, directionId) {
        const cacheKey = `${routeId}|${direction}`;
        if (shapeIdByRouteDir.has(cacheKey))
            return shapeIdByRouteDir.get(cacheKey);
        const points = orderedAllStops(routeStopsByRoute.get(routeId) || [], direction)
            .map((s) => stopById.get(s.stopId))
            .filter((s) => !!s);
        const shapeId = points.length >= 2 ? `shp_${routeId}_${directionId}` : '';
        if (shapeId) {
            points.forEach((s, i) => {
                shapeRows.push({
                    shape_id: shapeId,
                    shape_pt_lat: Number(s.lat).toFixed(6),
                    shape_pt_lon: Number(s.lng).toFixed(6),
                    shape_pt_sequence: i + 1,
                });
            });
        }
        shapeIdByRouteDir.set(cacheKey, shapeId);
        return shapeId;
    }
    const tripRows = [];
    const stopTimeRows = [];
    let skippedNoStops = 0;
    for (const rec of timedTrips) {
        const dep = toGtfsTime(rec.departureTime);
        const serviceId = SERVICE_MAP[rec.serviceId || ''] || 'everyday';
        const directionThere = String(rec.directionId) === '1';
        const direction = directionThere ? 'there' : 'back';
        const routeStops = routeStopsByRoute.get(rec.routeId) || [];
        const passenger = orderedPassengerStops(routeStops, direction);
        const chain = orderedAllStops(routeStops, direction);
        const chainKeys = chain.map((s) => s.stopId);
        if (passenger.length < 2) {
            skippedNoStops++;
            continue;
        }
        const directionId = directionThere ? 1 : 0;
        tripRows.push({
            route_id: rec.routeId,
            service_id: serviceId,
            trip_id: rec.id,
            trip_headsign: rec.headsign || '',
            direction_id: directionId,
            block_id: rec.blockId || '',
            shape_id: ensureShape(rec.routeId, direction, directionId),
        });
        const baseMins = parseMinutes(dep);
        passenger.forEach((stop, seq) => {
            if (!usedStopIds.has(stop.stopId))
                return;
            const idxInChain = chainKeys.indexOf(stop.stopId);
            const offset = idxInChain >= 0
                ? durationToStopMins(rec.routeId, chainKeys, idxInChain, segments, defaultSec)
                : seq * FALLBACK_MINS;
            const t = minutesToGtfs(baseMins + offset);
            stopTimeRows.push({
                trip_id: rec.id,
                arrival_time: t,
                departure_time: t,
                stop_id: stop.stopId,
                stop_sequence: seq + 1,
                timepoint: seq === 0 ? 1 : 0,
            });
        });
    }
    writeTable(path_1.default.join(outDir, 'trips.txt'), ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'], tripRows);
    writeTable(path_1.default.join(outDir, 'shapes.txt'), ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapeRows);
    writeTable(path_1.default.join(outDir, 'stop_times.txt'), ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint'], stopTimeRows);
    const referencedStopIds = new Set(stopTimeRows.map((r) => String(r.stop_id)));
    const stopRows = [...referencedStopIds]
        .map((stopId) => {
        const s = stopById.get(stopId);
        return {
            stop_id: stopId,
            stop_name: s.name || stopId,
            stop_lat: Number(s.lat).toFixed(6),
            stop_lon: Number(s.lng).toFixed(6),
            location_type: 0,
        };
    })
        .sort((a, b) => a.stop_id.localeCompare(b.stop_id));
    writeTable(path_1.default.join(outDir, 'stops.txt'), ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'], stopRows);
    const today = new Date();
    const feedVersion = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    writeTable(path_1.default.join(outDir, 'feed_info.txt'), ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_contact_email', 'feed_start_date', 'feed_end_date', 'feed_version'], [
        {
            feed_publisher_name: 'Technologies LLC',
            feed_publisher_url: 'https://malin.kiev.ua/',
            feed_lang: 'uk',
            feed_contact_email: 'mer.sergei@gmail.com',
            feed_start_date: SERVICE_START_DATE,
            feed_end_date: SERVICE_END_DATE,
            feed_version: feedVersion,
        },
    ]);
    const zipPath = path_1.default.join(outDir, 'malyn-gtfs.zip');
    if (fs_1.default.existsSync(zipPath))
        fs_1.default.unlinkSync(zipPath);
    const files = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'feed_info.txt', 'shapes.txt'];
    (0, child_process_1.execFileSync)('zip', ['-q', '-j', zipPath, ...files.map((f) => path_1.default.join(outDir, f))], { cwd: outDir });
    console.log(`GTFS written to ${outDir}`);
    console.log(`Routes: ${routeRows.length}, trips: ${tripRows.length}, stop_times: ${stopTimeRows.length}, stops: ${stopRows.length}, shapes: ${shapeIdByRouteDir.size} (${shapeRows.length} points)`);
    console.log(`Skipped trips (no passenger stops): ${skippedNoStops}`);
    console.log(`Timed trips in DB: ${timedTrips.length}; plate-only trips omitted from feed.`);
    console.log(`Zip: ${zipPath}`);
}
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        const dataset = await (0, local_transport_1.loadTransportDataset)(prisma);
        if (dataset.stops.length === 0) {
            console.error('Transport dataset is empty. Run: npm run seed:transport');
            process.exit(1);
        }
        exportGtfs(dataset);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
