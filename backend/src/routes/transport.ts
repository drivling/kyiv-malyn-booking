import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  loadTransportDataset,
  replaceTransportDataset,
  validateTransportDataset,
} from '../local-transport';
import { recalculateSegmentDurations } from '../transport-segments';

export function createTransportRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  /** Публічний повний датасет міського транспорту (~150 КБ). */
  r.get('/transport/dataset', async (_req, res) => {
    try {
      const dataset = await loadTransportDataset(prisma);
      res.set({ 'Cache-Control': 'public, max-age=300' });
      res.json(dataset);
    } catch (e) {
      console.error('[GET /transport/dataset]', e);
      res.status(500).json({ error: 'Failed to load transport dataset' });
    }
  });

  /** Адмін: транзакційна заміна всього датасету. */
  r.put('/transport/dataset', requireAdmin, async (req, res) => {
    try {
      const { errors, dataset } = validateTransportDataset(req.body);
      if (errors.length || !dataset) {
        res.status(400).json({ error: 'Invalid transport dataset', details: errors });
        return;
      }
      await replaceTransportDataset(prisma, dataset);
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
    } catch (e) {
      console.error('[PUT /transport/dataset]', e);
      res.status(500).json({ error: 'Failed to save transport dataset' });
    }
  });

  /**
   * Адмін: перерахунок сегментів через OSRM за даними вже збереженими в БД.
   * Body: { routeId?: string } — без routeId перераховує всі verified маршрути.
   * Може тривати хвилини (багато запитів до OSRM).
   */
  r.post('/admin/transport/recalculate-segments', requireAdmin, async (req, res) => {
    try {
      const routeId =
        typeof req.body?.routeId === 'string' && req.body.routeId.trim()
          ? req.body.routeId.trim()
          : null;
      const result = await recalculateSegmentDurations(prisma, { routeId });
      res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[POST /admin/transport/recalculate-segments]', e);
      const message = e instanceof Error ? e.message : 'Failed to recalculate segments';
      res.status(400).json({ error: message });
    }
  });

  return r;
}
