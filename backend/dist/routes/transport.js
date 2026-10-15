"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransportRouter = createTransportRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const local_transport_1 = require("../local-transport");
const transport_segments_1 = require("../transport-segments");
const sticker_scans_1 = require("../sticker-scans");
const sticker_wall_1 = require("../sticker-wall");
const arrival_reports_1 = require("../arrival-reports");
function createTransportRouter(deps) {
    const { prisma } = deps;
    const adminPassword = (0, require_admin_1.resolveAdminPassword)(deps.adminPassword);
    const r = express_1.default.Router();
    const isRepeatScan = (0, sticker_scans_1.createScanDeduper)();
    // Повернення — раз за сесію на клієнті; сервер ще відсіює повтори того самого id за 30 хв
    const isRepeatReturn = (0, sticker_scans_1.createScanDeduper)(30 * 60 * 1000);
    // Той самий звіт про рейс із того самого клієнта за 10 хв — подвійне натискання, не новий факт
    const isRepeatArrival = (0, sticker_scans_1.createScanDeduper)(10 * 60 * 1000);
    /** Публічний повний датасет міського транспорту (~150 КБ). */
    r.get('/transport/dataset', async (_req, res) => {
        try {
            const dataset = await (0, local_transport_1.loadTransportDataset)(prisma);
            res.set({ 'Cache-Control': 'public, max-age=300' });
            res.json(dataset);
        }
        catch (e) {
            console.error('[GET /transport/dataset]', e);
            res.status(500).json({ error: 'Failed to load transport dataset' });
        }
    });
    /**
     * Адмін: транзакційна заміна всього датасету.
     * Маршрут без ключа variants зберігає свої варіанти (fillOmittedRouteFields — до валідації).
     * baseRevision (необов'язково) — revision з GET: якщо відтоді датасет змінився, 409, щоб застаріла вкладка
     * не відкотила чужі зміни. Старі клієнти поля не шлють — їх це не зачіпає.
     */
    r.put('/transport/dataset', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const baseRevision = typeof req.body?.baseRevision === 'string' ? req.body.baseRevision : null;
            if (baseRevision) {
                const revision = await (0, local_transport_1.currentTransportRevision)(prisma);
                if (revision && revision !== baseRevision) {
                    res.status(409).json({
                        error: 'Transport dataset changed since it was loaded — reload and repeat the edit',
                        revision,
                    });
                    return;
                }
            }
            await (0, local_transport_1.fillOmittedRouteFields)(prisma, req.body);
            const { errors, dataset } = (0, local_transport_1.validateTransportDataset)(req.body);
            if (errors.length || !dataset) {
                res.status(400).json({ error: 'Invalid transport dataset', details: errors });
                return;
            }
            await (0, local_transport_1.replaceTransportDataset)(prisma, dataset);
            res.json({
                ok: true,
                counts: {
                    stops: dataset.stops.length,
                    routes: dataset.routes.length,
                    routeStops: dataset.routeStops.length,
                    trips: dataset.trips.length,
                    segments: dataset.segments.length,
                    variants: dataset.routes.reduce((n, route) => n + (route.variants?.length ?? 0), 0),
                },
                revision: await (0, local_transport_1.currentTransportRevision)(prisma),
            });
        }
        catch (e) {
            console.error('[PUT /transport/dataset]', e);
            res.status(500).json({ error: 'Failed to save transport dataset' });
        }
    });
    /**
     * Адмін: перерахунок сегментів через OSRM за даними вже збереженими в БД.
     * Body: { routeId?: string } — без routeId перераховує всі verified маршрути.
     * Може тривати хвилини (багато запитів до OSRM).
     */
    r.post('/admin/transport/recalculate-segments', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const routeId = typeof req.body?.routeId === 'string' && req.body.routeId.trim()
                ? req.body.routeId.trim()
                : null;
            const result = await (0, transport_segments_1.recalculateSegmentDurations)(prisma, { routeId });
            res.json({ ok: true, ...result });
        }
        catch (e) {
            console.error('[POST /admin/transport/recalculate-segments]', e);
            const message = e instanceof Error ? e.message : 'Failed to recalculate segments';
            res.status(400).json({ error: message });
        }
    });
    /**
     * Публічний: відкриття табло з QR-наклейки (src/sticker-scans.ts). Body: { stopId, side: a|b|s }.
     * Невідома зупинка — 404; повтор із того самого клієнта за 2 хв — 200 { counted: false }.
     */
    r.post('/transport/sticker-scans', async (req, res) => {
        const scan = (0, sticker_scans_1.parseStickerScan)(req.body);
        if (!scan) {
            res.status(400).json({ error: 'Invalid sticker scan' });
            return;
        }
        try {
            const stop = await prisma.transportStop.findUnique({ where: { id: scan.stopId }, select: { id: true } });
            if (!stop) {
                res.status(404).json({ error: 'Unknown stop' });
                return;
            }
            if (isRepeatScan(`${(0, sticker_scans_1.clientKey)(req.headers, req.ip)}|${scan.stopId}|${scan.side}`)) {
                res.json({ ok: true, counted: false });
                return;
            }
            await prisma.stickerScan.create({ data: scan });
            res.status(201).json({ ok: true, counted: true });
        }
        catch (e) {
            console.error('[POST /transport/sticker-scans]', e);
            res.status(500).json({ error: 'Failed to save sticker scan' });
        }
    });
    /**
     * Публічний: людина, що колись прийшла з QR-наклейки, знову відкрила сайт (src/sticker-scans.ts).
     * Body: { stopId, side, clientId, via: reload|tab|direct, page }. Повтор того самого id за 30 хв — 200 { counted: false }.
     */
    r.post('/transport/sticker-returns', async (req, res) => {
        const ret = (0, sticker_scans_1.parseStickerReturn)(req.body);
        if (!ret) {
            res.status(400).json({ error: 'Invalid sticker return' });
            return;
        }
        try {
            if (isRepeatReturn(ret.clientId)) {
                res.json({ ok: true, counted: false });
                return;
            }
            await prisma.stickerReturn.create({ data: ret });
            res.status(201).json({ ok: true, counted: true });
        }
        catch (e) {
            console.error('[POST /transport/sticker-returns]', e);
            res.status(500).json({ error: 'Failed to save sticker return' });
        }
    });
    /**
     * Адмін: статистика наклейок — відкриття по зупинці й боку (усього, 7 і 30 днів), по київських
     * добах і годинах за ?days=7|30|90 (за замовчуванням 30) і облік друку.
     */
    r.get('/admin/transport/sticker-scans', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.json(await (0, sticker_scans_1.stickerScanStats)(prisma, { days: (0, sticker_scans_1.parseStatsDays)(req.query.days) }));
        }
        catch (e) {
            console.error('[GET /admin/transport/sticker-scans]', e);
            res.status(500).json({ error: 'Failed to load sticker scans' });
        }
    });
    /** Адмін: ключ посилання на віджет «Відкриття з QR» для телефона на стіні (лише читання знімка) */
    r.get('/admin/transport/sticker-wall-key', require_admin_1.requireAdmin, (_req, res) => {
        res.set({ 'Cache-Control': 'no-store' });
        res.json({ key: (0, sticker_wall_1.stickerWallKey)(adminPassword) });
    });
    /**
     * Віджет на стіну: сьогоднішні відкриття з QR (київська доба) + нові скани з id > ?after.
     * Доступ — ключем із посилання, без адмін-сесії.
     */
    r.get('/transport/sticker-wall', async (req, res) => {
        res.set({ 'Cache-Control': 'no-store' });
        if (!(0, sticker_wall_1.isStickerWallKey)(req.query.key, adminPassword)) {
            res.status(403).json({ error: 'Invalid wall key' });
            return;
        }
        try {
            res.json(await (0, sticker_wall_1.stickerWallSnapshot)(prisma, { after: Number(req.query.after) || 0 }));
        }
        catch (e) {
            console.error('[GET /transport/sticker-wall]', e);
            res.status(500).json({ error: 'Failed to load sticker wall' });
        }
    });
    /** Адмін: друк або SVG наклейок зупинки. Body: { stopId, sides: (a|b|s)[], size: A5|A4 } */
    r.post('/admin/transport/sticker-prints', require_admin_1.requireAdmin, async (req, res) => {
        const print = (0, sticker_scans_1.parseStickerPrint)(req.body);
        if (!print) {
            res.status(400).json({ error: 'Invalid sticker print' });
            return;
        }
        try {
            await prisma.stickerPrint.createMany({
                data: print.sides.map((side) => ({ stopId: print.stopId, side, size: print.size })),
            });
            res.status(201).json({ ok: true, count: print.sides.length });
        }
        catch (e) {
            console.error('[POST /admin/transport/sticker-prints]', e);
            res.status(500).json({ error: 'Failed to save sticker print' });
        }
    });
    /**
     * Публічний: пасажир повідомляє факт прибуття рейсу на зупинку (src/arrival-reports.ts).
     * Body: { kind: arrived|missed, routeId, tripId, direction, stopId, scheduledTime, source, minutesAgo?, waitedMin?, clientId?,
     *   occurredAt?, clientEventId? } — останні два шле outbox браузера (Docs/transport-offline-writes-2026-10.md).
     * Невідомий рейс/зупинка — 404; час події далеко від розкладу або старший за тиждень — 422; повтор із тим самим
     * clientId + clientEventId (запис уже є) або з того самого IP за 10 хв — 200 { counted: false }.
     */
    r.post('/transport/arrival-reports', async (req, res) => {
        const input = (0, arrival_reports_1.parseArrivalReport)(req.body);
        if (!input) {
            res.status(400).json({ error: 'Invalid arrival report' });
            return;
        }
        try {
            const [trip, stop] = await Promise.all([
                prisma.transportTrip.findUnique({ where: { id: input.tripId }, select: { routeId: true } }),
                prisma.transportStop.findUnique({ where: { id: input.stopId }, select: { id: true } }),
            ]);
            if (!trip || trip.routeId !== input.routeId || !stop) {
                res.status(404).json({ error: 'Unknown trip or stop' });
                return;
            }
            const built = (0, arrival_reports_1.buildArrivalRow)(input, new Date());
            if ('error' in built) {
                res.status(422).json({
                    error: built.error === 'too_old' ? 'Report is too old' : 'Report time is too far from the schedule',
                });
                return;
            }
            const { row } = built;
            // Ідемпотентність для черги в браузері: той самий запис уже збережено — відповідаємо тим, що є
            if (row.clientId && row.clientEventId) {
                const stored = await prisma.transportArrivalReport.findFirst({
                    where: { clientId: row.clientId, clientEventId: row.clientEventId },
                    select: { actualTime: true, delayMin: true },
                });
                if (stored) {
                    res.json({ ok: true, counted: false, actualTime: stored.actualTime, delayMin: stored.delayMin });
                    return;
                }
            }
            const dedupeKey = `${(0, sticker_scans_1.clientKey)(req.headers, req.ip)}|${row.tripId}|${row.stopId}|${row.serviceDate}|${row.kind}`;
            if (isRepeatArrival(dedupeKey)) {
                res.json({ ok: true, counted: false, actualTime: row.actualTime, delayMin: row.delayMin });
                return;
            }
            try {
                await prisma.transportArrivalReport.create({ data: row });
            }
            catch (e) {
                // Гонка двох вкладок з тим самим clientEventId — унікальний індекс (clientId, clientEventId)
                if (e?.code !== 'P2002')
                    throw e;
                res.json({ ok: true, counted: false, actualTime: row.actualTime, delayMin: row.delayMin });
                return;
            }
            res.status(201).json({ ok: true, counted: true, actualTime: row.actualTime, delayMin: row.delayMin });
        }
        catch (e) {
            console.error('[POST /transport/arrival-reports]', e);
            res.status(500).json({ error: 'Failed to save arrival report' });
        }
    });
    /** Адмін: звіти пасажирів про факт прибуття — зведення по рейсах на зупинках і останні звіти за ?days=1|7|30|90 */
    r.get('/admin/transport/arrival-reports', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.json(await (0, arrival_reports_1.arrivalReportStats)(prisma, { days: (0, arrival_reports_1.parseReportDays)(req.query.days) }));
        }
        catch (e) {
            console.error('[GET /admin/transport/arrival-reports]', e);
            res.status(500).json({ error: 'Failed to load arrival reports' });
        }
    });
    /** Адмін: видалити хибний / спам-звіт */
    r.delete('/admin/transport/arrival-reports/:id', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        try {
            const { count } = await prisma.transportArrivalReport.deleteMany({ where: { id } });
            if (!count) {
                res.status(404).json({ error: 'Report not found' });
                return;
            }
            res.json({ ok: true });
        }
        catch (e) {
            console.error('[DELETE /admin/transport/arrival-reports/:id]', e);
            res.status(500).json({ error: 'Failed to delete arrival report' });
        }
    });
    return r;
}
