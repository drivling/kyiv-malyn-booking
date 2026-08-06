import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  loadTransportDataset,
  replaceTransportDataset,
  validateTransportDataset,
} from '../local-transport';

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

  return r;
}
