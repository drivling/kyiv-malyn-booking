import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  buildLegacyRouteKey,
  defaultLabelUk,
  findOrCreateTripRoute,
  normalizeViaPointIds,
  validateTripPointSelection,
} from '../schedule-trip';
import { listOdPairs } from '../poputky-od';

const includeStops = {
  startPoint: true,
  endPoint: true,
  stops: { include: { point: true }, orderBy: { position: 'asc' as const } },
  corridorRoute: true,
};

function normalizeStopOffsets(raw: unknown): Array<{ pointId: number; departureOffsetMinutes: number | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ pointId: number; departureOffsetMinutes: number | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { pointId?: unknown; departureOffsetMinutes?: unknown };
    const pointId = Number(row.pointId);
    if (!Number.isInteger(pointId) || pointId <= 0) continue;
    let offset: number | null = null;
    if (row.departureOffsetMinutes === null || row.departureOffsetMinutes === '') {
      offset = null;
    } else if (row.departureOffsetMinutes !== undefined) {
      const n = Number(row.departureOffsetMinutes);
      if (!Number.isFinite(n) || n < 0) continue;
      offset = Math.round(n);
    } else {
      continue;
    }
    out.push({ pointId, departureOffsetMinutes: offset });
  }
  return out;
}

async function applyStopOffsets(
  prisma: PrismaClient,
  tripRouteId: number,
  stopOffsets: Array<{ pointId: number; departureOffsetMinutes: number | null }>
): Promise<void> {
  for (const row of stopOffsets) {
    await prisma.tripRouteStop.updateMany({
      where: { tripRouteId, pointId: row.pointId },
      data: { departureOffsetMinutes: row.departureOffsetMinutes },
    });
  }
}

async function rebuildStops(
  prisma: PrismaClient,
  tripRouteId: number,
  startPointId: number,
  endPointId: number,
  viaPointIds: number[]
): Promise<void> {
  await prisma.tripRouteStop.deleteMany({ where: { tripRouteId } });
  const stopRows = [
    { tripRouteId, pointId: startPointId, position: 0, role: 'start' },
    ...viaPointIds.map((pid, i) => ({
      tripRouteId,
      pointId: pid,
      position: i + 1,
      role: 'via',
    })),
    {
      tripRouteId,
      pointId: endPointId,
      position: 1 + viaPointIds.length,
      role: 'end',
    },
  ];
  await prisma.tripRouteStop.createMany({ data: stopRows });
}

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

  /** Unique OD chips from corridor terminals + along-stop pairs on variants. */
  r.get('/od-pairs', async (_req, res) => {
    try {
      const pairs = await listOdPairs(prisma);
      res.json(pairs);
    } catch (error) {
      console.error('od-pairs failed', error);
      res.status(500).json({ error: 'Failed to load OD pairs' });
    }
  });

  r.get('/trip-routes/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = await prisma.tripRoute.findUnique({ where: { id }, include: includeStops });
    if (!row) return res.status(404).json({ error: 'Trip route not found' });
    res.json(row);
  });

  r.post('/trip-routes', requireAdmin, async (req, res) => {
    const { startPointId, endPointId, viaPointIds, labelUk, stopOffsets } = req.body ?? {};
    if (startPointId == null || endPointId == null) {
      return res.status(400).json({ error: 'startPointId and endPointId are required' });
    }
    try {
      const created = await findOrCreateTripRoute(prisma, {
        startPointId: Number(startPointId),
        endPointId: Number(endPointId),
        viaPointIds: Array.isArray(viaPointIds) ? viaPointIds.map(Number) : [],
      });
      if (labelUk != null && String(labelUk).trim()) {
        await prisma.tripRoute.update({
          where: { id: created.id },
          data: { labelUk: String(labelUk).trim() },
        });
      }
      const offsets = normalizeStopOffsets(stopOffsets);
      if (offsets.length) await applyStopOffsets(prisma, created.id, offsets);
      const full = await prisma.tripRoute.findUnique({ where: { id: created.id }, include: includeStops });
      res.status(201).json(full);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create trip route';
      res.status(400).json({ error: msg });
    }
  });

  r.put('/trip-routes/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const existing = await prisma.tripRoute.findUnique({
      where: { id },
      include: { stops: { orderBy: { position: 'asc' } } },
    });
    if (!existing) return res.status(404).json({ error: 'Trip route not found' });

    const body = req.body ?? {};
    const startPointId =
      body.startPointId !== undefined ? Number(body.startPointId) : existing.startPointId;
    const endPointId = body.endPointId !== undefined ? Number(body.endPointId) : existing.endPointId;
    const viaFromBody =
      body.viaPointIds !== undefined
        ? normalizeViaPointIds(body.viaPointIds)
        : existing.stops.filter((s) => s.role === 'via').map((s) => s.pointId);

    const points = await prisma.tripPoint.findMany();
    const pointsById = new Map(points.map((p) => [p.id, p]));
    const validated = validateTripPointSelection({
      startPointId,
      endPointId,
      viaPointIds: viaFromBody,
      pointsById,
    });
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const start = pointsById.get(startPointId)!;
    const end = pointsById.get(endPointId)!;
    const viaCodes = validated.viaPointIds.map((pid) => pointsById.get(pid)!.code);
    const nextSlug = buildLegacyRouteKey(start.code, end.code, viaCodes);

    const slugOwner = await prisma.tripRoute.findUnique({ where: { slug: nextSlug } });
    if (slugOwner && slugOwner.id !== id) {
      return res.status(409).json({ error: `TripRoute slug «${nextSlug}» already exists` });
    }

    let corridorTripRouteId: number | null = null;
    if (validated.viaPointIds.length > 0) {
      const corridorSlug = buildLegacyRouteKey(start.code, end.code, []);
      let corridor = await prisma.tripRoute.findUnique({ where: { slug: corridorSlug } });
      if (!corridor) {
        const createdCorridor = await findOrCreateTripRoute(prisma, {
          startPointId,
          endPointId,
          viaPointIds: [],
        });
        corridor = await prisma.tripRoute.findUnique({ where: { id: createdCorridor.id } });
      }
      corridorTripRouteId = corridor && corridor.id !== id ? corridor.id : null;
    }

    const labelUk =
      body.labelUk !== undefined
        ? String(body.labelUk).trim() || defaultLabelUk(start.code, end.code, viaCodes)
        : existing.labelUk;

    try {
      await prisma.tripRoute.update({
        where: { id },
        data: {
          slug: nextSlug,
          labelUk,
          startPointId,
          endPointId,
          corridorTripRouteId,
        },
      });
      await rebuildStops(prisma, id, startPointId, endPointId, validated.viaPointIds);
      const offsets = normalizeStopOffsets(body.stopOffsets);
      if (offsets.length) await applyStopOffsets(prisma, id, offsets);

      // Keep schedule snapshots in sync when slug/terminals change
      await prisma.schedule.updateMany({
        where: { tripRouteId: id },
        data: {
          route: nextSlug,
          startPointId,
          endPointId,
          viaPointIds: validated.viaPointIds,
        },
      });

      const full = await prisma.tripRoute.findUnique({ where: { id }, include: includeStops });
      res.json(full);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        return res.status(409).json({ error: `TripRoute slug «${nextSlug}» already exists` });
      }
      console.error('Failed to update trip route', error);
      res.status(500).json({ error: 'Failed to update trip route' });
    }
  });

  r.delete('/trip-routes/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const existing = await prisma.tripRoute.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Trip route not found' });

    const scheduleCount = await prisma.schedule.count({ where: { tripRouteId: id } });
    if (scheduleCount > 0) {
      return res.status(409).json({
        error: `TripRoute is used by ${scheduleCount} schedule(s)`,
      });
    }

    const variantCount = await prisma.tripRoute.count({ where: { corridorTripRouteId: id } });
    if (variantCount > 0) {
      return res.status(409).json({
        error: `TripRoute is parent corridor for ${variantCount} variant(s)`,
      });
    }

    // ViberListing.tripRouteId is onDelete: SetNull
    await prisma.viberListing.updateMany({
      where: { tripRouteId: id },
      data: { tripRouteId: null },
    });
    await prisma.tripRoute.delete({ where: { id } });
    res.status(204).send();
  });

  return r;
}
