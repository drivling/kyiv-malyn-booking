import express, { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireAdmin, resolveAdminPassword } from '../middleware/require-admin';
import {
  currentTransportRevision,
  fillOmittedRouteFields,
  loadTransportDataset,
  replaceTransportDataset,
  validateTransportDataset,
} from '../local-transport';
import { lookupStop, parseStopRedirects, STOP_REDIRECTS_META_KEY, stopRedirectsOf } from '../stop-redirects';
import { buildChangesRss, buildRouteCalendar } from '../transport-feeds';
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
import { GTFS_ZIP_FILENAME, createGtfsFeedProvider, isGtfsFeedFile } from '../gtfs-feed';

export function createTransportRouter(deps: { prisma: PrismaClient; adminPassword?: string }): Router {
  const { prisma } = deps;
  const adminPassword = resolveAdminPassword(deps.adminPassword);
  const r = express.Router();
  const isRepeatScan = createScanDeduper();
  // Повернення — раз за сесію на клієнті; сервер ще відсіює повтори того самого id за 30 хв
  const isRepeatReturn = createScanDeduper(30 * 60 * 1000);
  // Той самий звіт про рейс із того самого клієнта за 10 хв — подвійне натискання, не новий факт
  const isRepeatArrival = createScanDeduper(10 * 60 * 1000);
  const gtfs = createGtfsFeedProvider(prisma);

  /** Заголовки відкритих даних: 5 хв у кешах, ETag = revision (Express сам відповідає 304 на If-None-Match) */
  const openDataHeaders = (revision: string) => ({
    'Cache-Control': 'public, max-age=300',
    ETag: `"${revision}"`,
    'Last-Modified': new Date(revision).toUTCString(),
  });

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

  /**
   * Публічний GTFS Static фід (Docs/transport-open-data-2026-10.md): той самий генератор, що й `npm run export:gtfs`,
   * кеш у пам'яті за revision; feed_version = revision; порожня БД — 404.
   */
  r.get('/transport/gtfs.zip', async (_req, res) => {
    try {
      const cached = await gtfs.get();
      if (!cached) {
        res.status(404).json({ error: 'Transport dataset is empty' });
        return;
      }
      res.set({
        ...openDataHeaders(cached.revision),
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${GTFS_ZIP_FILENAME}"`,
      });
      res.send(cached.zip);
    } catch (e) {
      console.error('[GET /transport/gtfs.zip]', e);
      res.status(500).json({ error: 'Failed to build GTFS feed' });
    }
  });

  /** Один файл фіду без zip (feed_info.txt — перевірити версію, stops.txt — curl); невідоме ім'я — 404 */
  r.get('/transport/gtfs/:file', async (req, res) => {
    const name = req.params.file;
    if (!isGtfsFeedFile(name)) {
      res.status(404).json({ error: 'Unknown GTFS file' });
      return;
    }
    try {
      const cached = await gtfs.get();
      if (!cached) {
        res.status(404).json({ error: 'Transport dataset is empty' });
        return;
      }
      res.set({ ...openDataHeaders(cached.revision), 'Content-Type': 'text/plain; charset=utf-8' });
      res.send(cached.feed.files[name]);
    } catch (e) {
      console.error('[GET /transport/gtfs/:file]', e);
      res.status(500).json({ error: 'Failed to build GTFS feed' });
    }
  });

  /**
   * Публічний: RSS «зміни розкладу» — один запис про поточну revision (Docs/transport-open-protocols-2026-10.md,
   * фаза 4; історії ревізій у БД немає). З кешу GTFS, ETag = revision.
   */
  r.get('/transport/changes.rss', async (_req, res) => {
    try {
      const cached = await gtfs.get();
      if (!cached) {
        res.status(404).json({ error: 'Transport dataset is empty' });
        return;
      }
      res.set({ ...openDataHeaders(cached.revision), 'Content-Type': 'application/rss+xml; charset=utf-8' });
      res.send(buildChangesRss(cached.feed));
    } catch (e) {
      console.error('[GET /transport/changes.rss]', e);
      res.status(500).json({ error: 'Failed to build RSS' });
    }
  });

  /** Публічний: iCalendar маршруту — подія на кожен рейс із тижневим повтором; маршруту немає у фіді → 404 */
  r.get('/transport/route/:id/calendar.ics', async (req, res) => {
    try {
      const cached = await gtfs.get();
      if (!cached) {
        res.status(404).json({ error: 'Transport dataset is empty' });
        return;
      }
      const ics = buildRouteCalendar(cached.feed, req.params.id);
      if (!ics) {
        res.status(404).json({ error: 'Unknown route or no timetable' });
        return;
      }
      res.set({
        ...openDataHeaders(cached.revision),
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `inline; filename="malyn-route-${encodeURIComponent(req.params.id)}.ics"`,
      });
      res.send(ics);
    } catch (e) {
      console.error('[GET /transport/route/:id/calendar.ics]', e);
      res.status(500).json({ error: 'Failed to build calendar' });
    }
  });

  /**
   * Публічний: мапа «старий id зупинки → чинний» (Docs/transport-open-protocols-2026-10.md, фаза 3) — злиті чи
   * видалені зупинки; споживачі GTFS/JSON читають її, бо в самому фіді старого stop_id більше немає.
   */
  r.get('/transport/stop-redirects', async (_req, res) => {
    try {
      const dataset = await loadTransportDataset(prisma);
      res.set(dataset.revision ? openDataHeaders(dataset.revision) : { 'Cache-Control': 'public, max-age=300' });
      res.json(stopRedirectsOf(dataset));
    } catch (e) {
      console.error('[GET /transport/stop-redirects]', e);
      res.status(500).json({ error: 'Failed to load stop redirects' });
    }
  });

  /**
   * Публічний: зупинка за стабільним id — назва, координати, видимі маршрути; старий id → 301 на чинний;
   * невідомий → 404. Контракт id — Docs/transport-open-data.md «Що ми обіцяємо».
   */
  r.get('/transport/stops/:id', async (req, res) => {
    try {
      const dataset = await loadTransportDataset(prisma);
      const found = lookupStop(dataset, req.params.id);
      if (found.kind === 'redirect') {
        res.set({ 'Cache-Control': 'public, max-age=86400' });
        res.redirect(301, `/transport/stops/${encodeURIComponent(found.to)}`);
        return;
      }
      if (found.kind === 'unknown') {
        res.status(404).json({ error: 'Unknown stop' });
        return;
      }
      res.set(dataset.revision ? openDataHeaders(dataset.revision) : { 'Cache-Control': 'public, max-age=300' });
      res.json(found.stop);
    } catch (e) {
      console.error('[GET /transport/stops/:id]', e);
      res.status(500).json({ error: 'Failed to load stop' });
    }
  });

  /**
   * Адмін: замінити мапу редиректів зупинок цілком — body { redirects: { "st_0042": "st_0019" } }. Окремий ендпоінт,
   * бо PUT датасету перезаписує meta тим, що редактор отримав у GET (скриптовий PUT без ключа стер би мапу).
   * Сміття (жива зупинка як ключ, невідома ціль, цикл) — 400 із переліком; порожній датасет — 409. Бампає revision.
   */
  r.put('/admin/transport/stop-redirects', requireAdmin, async (req, res) => {
    try {
      const raw = (req.body as { redirects?: unknown } | null)?.redirects;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        res.status(400).json({ error: 'Body must be { redirects: { oldStopId: newStopId } }' });
        return;
      }
      const [stops, meta] = await Promise.all([
        prisma.transportStop.findMany({ select: { id: true } }),
        prisma.transportMeta.findUnique({ where: { id: 1 } }),
      ]);
      if (!meta) {
        res.status(409).json({ error: 'Transport dataset is empty' });
        return;
      }
      const { redirects, problems } = parseStopRedirects(raw, stops.map((s) => s.id));
      if (problems.length) {
        res.status(400).json({ error: 'Invalid stop redirects', details: problems });
        return;
      }
      const payload = { ...((meta.payload as Record<string, unknown>) ?? {}), [STOP_REDIRECTS_META_KEY]: redirects };
      await prisma.transportMeta.update({ where: { id: 1 }, data: { payload: payload as Prisma.InputJsonValue } });
      res.json({ ok: true, redirects, revision: await currentTransportRevision(prisma) });
    } catch (e) {
      console.error('[PUT /admin/transport/stop-redirects]', e);
      res.status(500).json({ error: 'Failed to save stop redirects' });
    }
  });

  /**
   * Адмін: транзакційна заміна всього датасету.
   * Маршрут без ключа variants зберігає свої варіанти (fillOmittedRouteFields — до валідації).
   * baseRevision (необов'язково) — revision з GET: якщо відтоді датасет змінився, 409, щоб застаріла вкладка
   * не відкотила чужі зміни. Старі клієнти поля не шлють — їх це не зачіпає.
   */
  r.put('/transport/dataset', requireAdmin, async (req, res) => {
    try {
      const baseRevision = typeof req.body?.baseRevision === 'string' ? req.body.baseRevision : null;
      if (baseRevision) {
        const revision = await currentTransportRevision(prisma);
        if (revision && revision !== baseRevision) {
          res.status(409).json({
            error: 'Transport dataset changed since it was loaded — reload and repeat the edit',
            revision,
          });
          return;
        }
      }
      await fillOmittedRouteFields(prisma, req.body);
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
          variants: dataset.routes.reduce((n, route) => n + (route.variants?.length ?? 0), 0),
        },
        revision: await currentTransportRevision(prisma),
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
   * Body: { kind: arrived|missed, routeId, tripId, direction, stopId, scheduledTime, source, minutesAgo?, waitedMin?, clientId?,
   *   occurredAt?, clientEventId? } — останні два шле outbox браузера (Docs/transport-offline-writes-2026-10.md).
   * Невідомий рейс/зупинка — 404; час події далеко від розкладу або старший за тиждень — 422; повтор із тим самим
   * clientId + clientEventId (запис уже є) або з того самого IP за 10 хв — 200 { counted: false }.
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
      const dedupeKey = `${clientKey(req.headers, req.ip)}|${row.tripId}|${row.stopId}|${row.serviceDate}|${row.kind}`;
      if (isRepeatArrival(dedupeKey)) {
        res.json({ ok: true, counted: false, actualTime: row.actualTime, delayMin: row.delayMin });
        return;
      }
      try {
        await prisma.transportArrivalReport.create({ data: row });
      } catch (e) {
        // Гонка двох вкладок з тим самим clientEventId — унікальний індекс (clientId, clientEventId)
        if ((e as { code?: string })?.code !== 'P2002') throw e;
        res.json({ ok: true, counted: false, actualTime: row.actualTime, delayMin: row.delayMin });
        return;
      }
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
