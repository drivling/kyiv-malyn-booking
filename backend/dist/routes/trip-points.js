"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTripPointsRouter = createTripPointsRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
function normalizeQuickDirectPointIds(raw) {
    if (raw === undefined)
        return undefined;
    if (!Array.isArray(raw))
        return [];
    const ids = [];
    for (const item of raw) {
        const n = Number(item);
        if (Number.isInteger(n) && n > 0 && !ids.includes(n))
            ids.push(n);
    }
    return ids;
}
function createTripPointsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/trip-points', async (req, res) => {
        const appearFromTo = req.query.appearInFromTo === 'true' || req.query.appearInFromTo === '1';
        const appearPoputky = req.query.appearInPoputky === 'true' || req.query.appearInPoputky === '1';
        const where = {};
        if (appearFromTo)
            where.appearInFromTo = true;
        if (appearPoputky)
            where.appearInPoputky = true;
        const points = await prisma.tripPoint.findMany({
            where: Object.keys(where).length ? where : undefined,
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        res.json(points);
    });
    r.post('/trip-points', require_admin_1.requireAdmin, async (req, res) => {
        const { code, nameUk, requiredOnTrip, appearInFromTo, appearInPoputky, sortOrder, quickDirectPointIds } = req.body ?? {};
        if (!code || !String(code).trim() || !nameUk || !String(nameUk).trim()) {
            return res.status(400).json({ error: 'code and nameUk are required' });
        }
        const quickIds = normalizeQuickDirectPointIds(quickDirectPointIds);
        try {
            const point = await prisma.tripPoint.create({
                data: {
                    code: String(code).trim(),
                    nameUk: String(nameUk).trim(),
                    requiredOnTrip: Boolean(requiredOnTrip),
                    appearInFromTo: appearInFromTo === undefined ? true : Boolean(appearInFromTo),
                    appearInPoputky: appearInPoputky === undefined ? false : Boolean(appearInPoputky),
                    sortOrder: sortOrder != null ? Number(sortOrder) : 0,
                    ...(quickIds !== undefined ? { quickDirectPointIds: quickIds } : {}),
                },
            });
            res.status(201).json(point);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2002') {
                return res.status(409).json({ error: 'Trip point with this code already exists' });
            }
            res.status(500).json({ error: 'Failed to create trip point' });
        }
    });
    r.put('/trip-points/:id', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        const { code, nameUk, requiredOnTrip, appearInFromTo, appearInPoputky, sortOrder, quickDirectPointIds } = req.body ?? {};
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        const quickIds = normalizeQuickDirectPointIds(quickDirectPointIds);
        try {
            if (quickIds !== undefined) {
                for (const qid of quickIds) {
                    if (qid === id) {
                        return res.status(400).json({ error: 'quickDirectPointIds must not include self' });
                    }
                    const exists = await prisma.tripPoint.findUnique({ where: { id: qid }, select: { id: true } });
                    if (!exists) {
                        return res.status(400).json({ error: `Unknown quickDirect point id: ${qid}` });
                    }
                }
            }
            const point = await prisma.tripPoint.update({
                where: { id },
                data: {
                    ...(code !== undefined ? { code: String(code).trim() } : {}),
                    ...(nameUk !== undefined ? { nameUk: String(nameUk).trim() } : {}),
                    ...(requiredOnTrip !== undefined ? { requiredOnTrip: Boolean(requiredOnTrip) } : {}),
                    ...(appearInFromTo !== undefined ? { appearInFromTo: Boolean(appearInFromTo) } : {}),
                    ...(appearInPoputky !== undefined ? { appearInPoputky: Boolean(appearInPoputky) } : {}),
                    ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
                    ...(quickIds !== undefined ? { quickDirectPointIds: quickIds } : {}),
                },
            });
            res.json(point);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Trip point not found' });
            if (err.code === 'P2002')
                return res.status(409).json({ error: 'Trip point with this code already exists' });
            res.status(500).json({ error: 'Failed to update trip point' });
        }
    });
    r.delete('/trip-points/:id', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        try {
            const usedSchedule = await prisma.schedule.count({
                where: {
                    OR: [{ startPointId: id }, { endPointId: id }],
                },
            });
            if (usedSchedule > 0) {
                return res.status(409).json({ error: 'Trip point is used by schedules' });
            }
            const withVia = await prisma.schedule.findMany({ select: { id: true, viaPointIds: true } });
            const inVia = withVia.some((s) => Array.isArray(s.viaPointIds) && s.viaPointIds.includes(id));
            if (inVia) {
                return res.status(409).json({ error: 'Trip point is used as via on schedules' });
            }
            const usedAsRouteStop = await prisma.tripRouteStop.count({ where: { pointId: id } });
            if (usedAsRouteStop > 0) {
                return res.status(409).json({ error: 'Trip point is used on TripRoute stops' });
            }
            const usedAsRouteTerminal = await prisma.tripRoute.count({
                where: { OR: [{ startPointId: id }, { endPointId: id }] },
            });
            if (usedAsRouteTerminal > 0) {
                return res.status(409).json({ error: 'Trip point is used as TripRoute terminal' });
            }
            const usedListing = await prisma.viberListing.count({
                where: { OR: [{ fromPointId: id }, { toPointId: id }] },
            });
            if (usedListing > 0) {
                return res.status(409).json({ error: 'Trip point is used on Viber listings' });
            }
            const usedBooking = await prisma.booking.count({
                where: { OR: [{ fromPointId: id }, { toPointId: id }] },
            });
            if (usedBooking > 0) {
                return res.status(409).json({ error: 'Trip point is used on bookings' });
            }
            // Drop from other cities' quick-pick lists before delete
            const allPoints = await prisma.tripPoint.findMany({
                select: { id: true, quickDirectPointIds: true },
            });
            for (const p of allPoints) {
                if (p.id === id)
                    continue;
                if (!p.quickDirectPointIds?.includes(id))
                    continue;
                await prisma.tripPoint.update({
                    where: { id: p.id },
                    data: { quickDirectPointIds: p.quickDirectPointIds.filter((x) => x !== id) },
                });
            }
            await prisma.tripPoint.delete({ where: { id } });
            res.status(204).send();
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Trip point not found' });
            if (err.code === 'P2003') {
                return res.status(409).json({ error: 'Trip point is still referenced and cannot be deleted' });
            }
            res.status(500).json({ error: 'Failed to delete trip point' });
        }
    });
    return r;
}
