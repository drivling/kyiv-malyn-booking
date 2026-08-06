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
function createTransportRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
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
    /** Адмін: транзакційна заміна всього датасету. */
    r.put('/transport/dataset', require_admin_1.requireAdmin, async (req, res) => {
        try {
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
                },
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
    return r;
}
