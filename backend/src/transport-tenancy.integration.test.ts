/**
 * Tenancy M1 на справжньому Postgres (Docs/transport-tenancy-2026-11.md). Запускається лише з
 * RUN_INTEGRATION_TESTS=1 і DATABASE_URL / INTEGRATION_DATABASE_URL бази з накоченими міграціями та датасетом
 * Малина: `npm run test:integration-db`. Датасет Малина перезаписується тим самим вмістом; рядки тестового
 * міста прибираються в кінці.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { loadTransportDataset, replaceTransportDataset } from './local-transport';
import { listTransportRevisions, recordTransportRevision, snapshotTransportDataset } from './transport-revisions';
import { stickerScanStats } from './sticker-scans';

const url = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === '1' && !!url;
const CITY = 'Korosten';

test.skipIf(!enabled)('Postgres: колонка міста з default, scope читання й запису, рядки іншого міста не зачіпаються', async () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const cleanup = async () => {
    await prisma.transportSegment.deleteMany({ where: { cityCode: CITY } });
    await prisma.transportTrip.deleteMany({ where: { cityCode: CITY } });
    await prisma.transportRouteStop.deleteMany({ where: { cityCode: CITY } });
    await prisma.transportRoute.deleteMany({ where: { cityCode: CITY } });
    await prisma.transportStop.deleteMany({ where: { cityCode: CITY } });
    await prisma.stickerScan.deleteMany({ where: { cityCode: CITY } });
  };
  try {
    await cleanup();
    const before = await loadTransportDataset(prisma);
    assert.ok(before.stops.length > 0, 'у базі має бути датасет Малина (npm run seed:transport)');
    // Рядок, записаний без cityCode (як це робить код попереднього деплою), — малинський
    const legacy = await prisma.$queryRaw<Array<{ cityCode: string }>>`SELECT "cityCode" FROM "TransportStop" LIMIT 1`;
    assert.equal(legacy[0].cityCode, 'Malyn');

    // Інше місто з id, яких у Малина нема (спільні первинні ключі — до M2)
    await prisma.transportStop.create({ data: { cityCode: CITY, id: 'st_9901', name: 'Тестова', lat: 50.95, lng: 28.64 } });
    await prisma.transportRoute.create({ data: { cityCode: CITY, id: 'tenancy-test', fromName: 'А', toName: 'Б' } });
    await prisma.transportRouteStop.create({ data: { cityCode: CITY, routeId: 'tenancy-test', stopId: 'st_9901', orderThere: 1, orderBack: 1 } });
    await prisma.stickerScan.create({ data: { cityCode: CITY, stopId: 'st_9901', side: 'a' } });

    assert.deepEqual(await loadTransportDataset(prisma), before);
    const other = await loadTransportDataset(prisma, CITY);
    assert.deepEqual([other.stops.map((s) => s.id), other.routes.map((r) => r.id), other.revision], [['st_9901'], ['tenancy-test'], null]);
    assert.equal(JSON.stringify(await stickerScanStats(prisma)).includes('st_9901'), false);
    assert.equal(JSON.stringify(await stickerScanStats(prisma, { cityCode: CITY })).includes('st_9901'), true);

    // Повна заміна датасету Малина тим самим вмістом: дані ті самі, revision нова, чуже місто на місці
    const previous = await snapshotTransportDataset(prisma);
    await replaceTransportDataset(prisma, before);
    const row = await recordTransportRevision(prisma, { source: 'dataset', previous });
    const after = await loadTransportDataset(prisma);
    assert.deepEqual({ ...after, revision: null }, { ...before, revision: null });
    assert.notEqual(after.revision, before.revision);
    assert.equal(row?.revision, after.revision);
    assert.equal((await listTransportRevisions(prisma, 1))[0].revision, after.revision);
    assert.equal((await listTransportRevisions(prisma, 5, CITY)).length, 0);
    assert.equal((await loadTransportDataset(prisma, CITY)).stops.length, 1);
    assert.equal(await prisma.transportMeta.count(), 1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
});
