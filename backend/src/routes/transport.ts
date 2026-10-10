import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin, resolveAdminPassword } from '../middleware/require-admin';
import {
  loadTransportDataset,
  replaceTransportDataset,
  validateTransportDataset,
} from '../local-transport';
import { recalculateSegmentDurations } from '../transport-segments';
import {
  clientKey,
  createScanDeduper,
  parseStatsDays,
  parseStickerPrint,
  parseStickerReturn,
  parseStickerScan,
  stickerScanStats,
} from '../sticker-scans';
import { isStickerWallKey, stickerWallKey, stickerWallSnapshot } from '../sticker-wall';
import { arrivalReportStats, buildArrivalRow, parseArrivalReport, parseReportDays } from '../arrival-reports';

export function createTransportRouter(deps: { prisma: PrismaClient; adminPassword?: string }): Router {
  const { prisma } = deps;
  const adminPassword = resolveAdminPassword(deps.adminPassword);
  const r = express.Router();
  const isRepeatScan = createScanDeduper();
  // Повернення — раз за сесію на клієнті; сервер ще відсіює повтори того самого id за 30 хв
  const isRepeatReturn = createScanDeduper(30 * 60 * 1000);
  // Той самий звіт про рейс із того самого клієнта за 10 хв — подвійне натискання, не новий факт
  const isRepeatArrival = createScanDeduper(10 * 60 * 1000);

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

  /**
   * Публічний: людина, що колись прийшла з QR-наклейки, знову відкрила сайт (src/sticker-scans.ts).
   * Body: { stopId, side, clientId, via: reload|tab|direct, page }. Повтор того самого id за 30 хв — 200 { counted: false }.
   */
  r.post('/transport/sticker-returns', async (req, res) => {
    const ret = parseStickerReturn(req.body);
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
    } catch (e) {
      console.error('[POST /transport/sticker-returns]', e);
      res.status(500).json({ error: 'Failed to save sticker return' });
    }
  });

  /**
   * Адмін: статистика наклейок — відкриття по зупинці й боку (усього, 7 і 30 днів), по київських
   * добах і годинах за ?days=7|30|90 (за замовчуванням 30) і облік друку.
   */
  r.get('/admin/transport/sticker-scans', requireAdmin, async (req, res) => {
    try {
      res.json(await stickerScanStats(prisma, { days: parseStatsDays(req.query.days) }));
    } catch (e) {
      console.error('[GET /admin/transport/sticker-scans]', e);
      res.status(500).json({ error: 'Failed to load sticker scans' });
    }
  });

  /** Адмін: ключ посилання на віджет «Відкриття з QR» для телефона на стіні (лише читання знімка) */
  r.get('/admin/transport/sticker-wall-key', requireAdmin, (_req, res) => {
    res.set({ 'Cache-Control': 'no-store' });
    res.json({ key: stickerWallKey(adminPassword) });
  });

  /**
   * Віджет на стіну: сьогоднішні відкриття з QR (київська доба) + нові скани з id > ?after.
   * Доступ — ключем із посилання, без адмін-сесії.
   */
  r.get('/transport/sticker-wall', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store' });
    if (!isStickerWallKey(req.query.key, adminPassword)) {
      res.status(403).json({ error: 'Invalid wall key' });
      return;
    }
    try {
      res.json(await stickerWallSnapshot(prisma, { after: Number(req.query.after) || 0 }));
    } catch (e) {
      console.error('[GET /transport/sticker-wall]', e);
      res.status(500).json({ error: 'Failed to load sticker wall' });
    }
  });

  /** Адмін: друк або SVG наклейок зупинки. Body: { stopId, sides: (a|b|s)[], size: A5|A4 } */
  r.post('/admin/transport/sticker-prints', requireAdmin, async (req, res) => {
    const print = parseStickerPrint(req.body);
    if (!print) {
      res.status(400).json({ error: 'Invalid sticker print' });
      return;
    }
    try {
      await prisma.stickerPrint.createMany({
        data: print.sides.map((side) => ({ stopId: print.stopId, side, size: print.size })),
      });
      res.status(201).json({ ok: true, count: print.sides.length });
    } catch (e) {
      console.error('[POST /admin/transport/sticker-prints]', e);
      res.status(500).json({ error: 'Failed to save sticker print' });
    }
  });

  /**
   * Публічний: пасажир повідомляє факт прибуття рейсу на зупинку (src/arrival-reports.ts).
   * Body: { kind: arrived|missed, routeId, tripId, direction, stopId, scheduledTime, source, minutesAgo?, waitedMin?, clientId? }.
   * Невідомий рейс/зупинка — 404; час далеко від розкладу — 422; повтор за 10 хв — 200 { counted: false }.
   */
  r.post('/transport/arrival-reports', async (req, res) => {
    const input = parseArrivalReport(req.body);
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
      const built = buildArrivalRow(input, new Date());
      if ('error' in built) {
        res.status(422).json({ error: 'Report time is too far from the schedule' });
        return;
      }
      const { row } = built;
      const dedupeKey = `${clientKey(req.headers, req.ip)}|${row.tripId}|${row.stopId}|${row.serviceDate}|${row.kind}`;
      if (isRepeatArrival(dedupeKey)) {
        res.json({ ok: true, counted: false, actualTime: row.actualTime, delayMin: row.delayMin });
        return;
      }
      await prisma.transportArrivalReport.create({ data: row });
      res.status(201).json({ ok: true, counted: true, actualTime: row.actualTime, delayMin: row.delayMin });
    } catch (e) {
      console.error('[POST /transport/arrival-reports]', e);
      res.status(500).json({ error: 'Failed to save arrival report' });
    }
  });

  /** Адмін: звіти пасажирів про факт прибуття — зведення по рейсах на зупинках і останні звіти за ?days=1|7|30|90 */
  r.get('/admin/transport/arrival-reports', requireAdmin, async (req, res) => {
    try {
      res.json(await arrivalReportStats(prisma, { days: parseReportDays(req.query.days) }));
    } catch (e) {
      console.error('[GET /admin/transport/arrival-reports]', e);
      res.status(500).json({ error: 'Failed to load arrival reports' });
    }
  });

  /** Адмін: видалити хибний / спам-звіт */
  r.delete('/admin/transport/arrival-reports/:id', requireAdmin, async (req, res) => {
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
    } catch (e) {
      console.error('[DELETE /admin/transport/arrival-reports/:id]', e);
      res.status(500).json({ error: 'Failed to delete arrival report' });
    }
  });

  return r;
}
