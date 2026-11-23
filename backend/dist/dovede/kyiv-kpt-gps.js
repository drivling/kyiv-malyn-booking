"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KYIV_GPS_DAYS_MAX = exports.KYIV_GPS_DAYS_DEFAULT = void 0;
exports.fetchFeedBytes = fetchFeedBytes;
exports.createKyivGpsRecorder = createKyivGpsRecorder;
exports.parseKyivGpsDays = parseKyivGpsDays;
exports.kyivGpsReport = kyivGpsReport;
const gtfs_rt_1 = require("../gtfs-rt");
const kyiv_kpt_passes_1 = require("./kyiv-kpt-passes");
const kyiv_kpt_gps_times_1 = require("./kyiv-kpt-gps-times");
exports.KYIV_GPS_DAYS_DEFAULT = 2;
exports.KYIV_GPS_DAYS_MAX = 7;
/** Скільки візитів максимум бере звіт (≈ 120 тис. на добу) */
const REPORT_LIMIT = 1000000;
async function fetchFeedBytes(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'transport-gps-recorder/1.0', Accept: 'application/x-protobuf, */*' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
function createKyivGpsRecorder(deps) {
    const tracker = deps.tracker ?? (0, kyiv_kpt_passes_1.createVisitTracker)();
    const now = deps.now ?? (() => new Date());
    const fetchBytes = deps.fetchBytes ?? fetchFeedBytes;
    const retentionMs = (deps.retentionDays ?? 30) * 86400000;
    let last = null;
    async function write(visits) {
        if (!visits.length)
            return 0;
        const r = await deps.prisma.kyivKptPass.createMany({ data: visits, skipDuplicates: true });
        return r.count;
    }
    return {
        async tick() {
            const at = now();
            try {
                const feed = (0, gtfs_rt_1.parseVehiclePositions)(await fetchBytes(deps.url));
                const written = await write(tracker.feed(feed.vehicles, at));
                const removed = await deps.prisma.kyivKptPass.deleteMany({ where: { firstAt: { lt: new Date(at.getTime() - retentionMs) } } });
                last = { at: at.toISOString(), vehicles: feed.vehicles.length, open: tracker.openCount(), written, deleted: removed.count };
            }
            catch (e) {
                last = { at: at.toISOString(), vehicles: 0, open: tracker.openCount(), written: 0, deleted: 0, error: e instanceof Error ? e.message : String(e) };
            }
            return last;
        },
        /** Закрити відкриті візити й записати (зупинка процесу) */
        async flush() {
            return write(tracker.flush()).catch(() => 0);
        },
        status: () => last,
    };
}
function parseKyivGpsDays(raw) {
    if (raw === undefined || raw === null || raw === '')
        return exports.KYIV_GPS_DAYS_DEFAULT;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= exports.KYIV_GPS_DAYS_MAX ? n : null;
}
/** Адмінка: звіт за останні `days` діб + скільки візитів усього */
async function kyivGpsReport(prisma, days, now = new Date()) {
    const rows = await prisma.kyivKptPass.findMany({
        where: { firstAt: { gte: new Date(now.getTime() - days * 86400000) } },
        orderBy: [{ vehicleId: 'asc' }, { firstAt: 'asc' }],
        take: REPORT_LIMIT + 1,
        select: { routeId: true, vehicleId: true, point: true, firstAt: true, lastAt: true },
    });
    const truncated = rows.length > REPORT_LIMIT;
    return { ...(0, kyiv_kpt_gps_times_1.buildKptGpsReport)(truncated ? rows.slice(0, REPORT_LIMIT) : rows), days, truncated };
}
