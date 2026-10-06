import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  loadTransportDataset,
  replaceTransportDataset,
  validateTransportDataset,
} from '../local-transport';
import { recalculateSegmentDurations } from '../transport-segments';
import { clientKey, createScanDeduper, parseStickerScan, stickerScanStats } from '../sticker-scans';

export function createTransportRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();
  const isRepeatScan = createScanDeduper();

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

  /**
   * Публічний: відкриття табло з QR-наклейки (src/sticker-scans.ts). Body: { stopId, side: a|b|s }.
   * Невідома зупинка — 404; повтор із того самого клієнта за 2 хв — 200 { counted: false }.
   */
  r.post('/transport/sticker-scans', async (req, res) => {
    const scan = parseStickerScan(req.body);
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
      if (isRepeatScan(`${clientKey(req.headers, req.ip)}|${scan.stopId}|${scan.side}`)) {
        res.json({ ok: true, counted: false });
        return;
      }
      await prisma.stickerScan.create({ data: scan });
      res.status(201).json({ ok: true, counted: true });
    } catch (e) {
      console.error('[POST /transport/sticker-scans]', e);
      res.status(500).json({ error: 'Failed to save sticker scan' });
    }
  });

  /** Адмін: популярність наклейок — відкриття по зупинці й боку (усього, 7 і 30 днів). */
  r.get('/admin/transport/sticker-scans', requireAdmin, async (_req, res) => {
    try {
      res.json(await stickerScanStats(prisma));
    } catch (e) {
      console.error('[GET /admin/transport/sticker-scans]', e);
      res.status(500).json({ error: 'Failed to load sticker scans' });
    }
  });

  return r;
}
