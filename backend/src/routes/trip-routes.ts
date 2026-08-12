import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import { findOrCreateTripRoute } from '../schedule-trip';

const includeStops = {
  startPoint: true,
  endPoint: true,
  stops: { include: { point: true }, orderBy: { position: 'asc' as const } },
  corridorRoute: true,
};

export function createTripRoutesRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/trip-routes', async (req, res) => {
    const corridorsOnly = req.query.corridors === 'true' || req.query.corridors === '1';
    const variantsOnly = req.query.variants === 'true' || req.query.variants === '1';
    const where = corridorsOnly
      ? { corridorTripRouteId: null }
      : variantsOnly
        ? { corridorTripRouteId: { not: null } }
        : undefined;
    const rows = await prisma.tripRoute.findMany({
      where,
      include: includeStops,
      orderBy: [{ slug: 'asc' }],
    });
    res.json(rows);
  });

  r.get('/trip-routes/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = await prisma.tripRoute.findUnique({ where: { id }, include: includeStops });
    if (!row) return res.status(404).json({ error: 'Trip route not found' });
    res.json(row);
  });

  r.post('/trip-routes', requireAdmin, async (req, res) => {
    const { startPointId, endPointId, viaPointIds } = req.body ?? {};
    if (startPointId == null || endPointId == null) {
      return res.status(400).json({ error: 'startPointId and endPointId are required' });
    }
    try {
      const created = await findOrCreateTripRoute(prisma, {
        startPointId: Number(startPointId),
        endPointId: Number(endPointId),
        viaPointIds: Array.isArray(viaPointIds) ? viaPointIds.map(Number) : [],
      });
      const full = await prisma.tripRoute.findUnique({ where: { id: created.id }, include: includeStops });
      res.status(201).json(full);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create trip route';
      res.status(400).json({ error: msg });
    }
  });

  return r;
}
