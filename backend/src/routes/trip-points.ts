import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';

export function createTripPointsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/trip-points', async (req, res) => {
    const appearOnly = req.query.appearInFromTo === 'true' || req.query.appearInFromTo === '1';
    const points = await prisma.tripPoint.findMany({
      where: appearOnly ? { appearInFromTo: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(points);
  });

  r.post('/trip-points', requireAdmin, async (req, res) => {
    const { code, nameUk, requiredOnTrip, appearInFromTo, sortOrder } = req.body ?? {};
    if (!code || !String(code).trim() || !nameUk || !String(nameUk).trim()) {
      return res.status(400).json({ error: 'code and nameUk are required' });
    }
    try {
      const point = await prisma.tripPoint.create({
        data: {
          code: String(code).trim(),
          nameUk: String(nameUk).trim(),
          requiredOnTrip: Boolean(requiredOnTrip),
          appearInFromTo: appearInFromTo === undefined ? true : Boolean(appearInFromTo),
          sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        },
      });
      res.status(201).json(point);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Trip point with this code already exists' });
      }
      res.status(500).json({ error: 'Failed to create trip point' });
    }
  });

  r.put('/trip-points/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { code, nameUk, requiredOnTrip, appearInFromTo, sortOrder } = req.body ?? {};
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const point = await prisma.tripPoint.update({
        where: { id },
        data: {
          ...(code !== undefined ? { code: String(code).trim() } : {}),
          ...(nameUk !== undefined ? { nameUk: String(nameUk).trim() } : {}),
          ...(requiredOnTrip !== undefined ? { requiredOnTrip: Boolean(requiredOnTrip) } : {}),
          ...(appearInFromTo !== undefined ? { appearInFromTo: Boolean(appearInFromTo) } : {}),
          ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
        },
      });
      res.json(point);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return res.status(404).json({ error: 'Trip point not found' });
      if (err.code === 'P2002') return res.status(409).json({ error: 'Trip point with this code already exists' });
      res.status(500).json({ error: 'Failed to update trip point' });
    }
  });

  r.delete('/trip-points/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const used = await prisma.schedule.count({
        where: {
          OR: [{ startPointId: id }, { endPointId: id }],
        },
      });
      if (used > 0) {
        return res.status(409).json({ error: 'Trip point is used by schedules' });
      }
      // Also refuse if present in viaPointIds of any schedule (best-effort scan)
      const withVia = await prisma.schedule.findMany({ select: { id: true, viaPointIds: true } });
      const inVia = withVia.some((s) => Array.isArray(s.viaPointIds) && (s.viaPointIds as number[]).includes(id));
      if (inVia) {
        return res.status(409).json({ error: 'Trip point is used as via on schedules' });
      }
      await prisma.tripPoint.delete({ where: { id } });
      res.status(204).send();
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return res.status(404).json({ error: 'Trip point not found' });
      res.status(500).json({ error: 'Failed to delete trip point' });
    }
  });

  return r;
}
