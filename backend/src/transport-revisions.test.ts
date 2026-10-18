/**
 * transport-revisions.ts: чистий diff двох датасетів, людський підсумок, запис/читання журналу через стаб Prisma.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { TransportDataset } from './local-transport';
import {
  describeTransportDiff,
  describeTransportRevision,
  diffTransportDatasets,
  ensureInitialTransportRevision,
  isEmptyDiff,
  listTransportRevisions,
  parseRevisionsLimit,
  plural,
  recordTransportRevision,
  transportRevisionStats,
} from './transport-revisions';

function base(): TransportDataset {
  return {
    stops: [
      { id: 'st_0001', name: 'Барміна', lat: 50.771, lng: 29.241 },
      { id: 'st_0002', name: 'Лікарня', lat: 50.772, lng: 29.242 },
      { id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 },
    ],
    routes: [
      { id: '2', fromName: 'Барміна', toName: 'Вокзал', shortName: '2А' },
      { id: '5', fromName: 'Фабрика', toName: 'Вокзал' },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 3 },
      { routeId: '2', stopId: 'st_0002', orderThere: 2, orderBack: 2 },
      { routeId: '2', stopId: 'st_0003', orderThere: 3, orderBack: 1 },
      { routeId: '5', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
      { routeId: '5', stopId: 'st_0003', orderThere: 2, orderBack: 1 },
    ],
    trips: [
      { id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '07:00:00' },
      { id: '2-02', routeId: '2', serviceId: 'weekdays', headsign: 'Барміна', directionId: '0', departureTime: '18:30' },
      { id: '5-01', routeId: '5', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '08:00' },
    ],
    segments: [
      { routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0002', seconds: 300 },
      { routeId: '2', fromStopId: 'st_0002', toStopId: 'st_0003', seconds: 600 },
      { routeId: '5', fromStopId: 'st_0001', toStopId: 'st_0003', seconds: 900 },
    ],
    meta: { defaultSec: 120, stopRedirects: { st_0042: 'st_0001' } },
    revision: '2026-10-12T10:00:00.000Z',
  };
}

test('diffTransportDatasets: identical datasets → empty diff', () => {
  const diff = diffTransportDatasets(base(), base());
  assert.ok(isEmptyDiff(diff));
  assert.equal(describeTransportDiff(diff), '');
  // «07:00:00» і «07:00» — той самий час
  const next = base();
  next.trips[0].departureTime = '07:00';
  assert.ok(isEmptyDiff(diffTransportDatasets(base(), next)));
});

test('diffTransportDatasets: stops added / renamed / removed, routes, trips, segments, redirects', () => {
  const prev = base();
  const next = base();
  next.stops = [
    { id: 'st_0001', name: 'Барміна, центр', lat: 50.771, lng: 29.241 }, // перейменовано
    { id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 },
    { id: 'st_0004', name: 'Ринок', lat: 50.775, lng: 29.245 }, // додано; st_0002 знято
  ];
  next.routes = [
    { id: '2', fromName: 'Барміна', toName: 'Вокзал', shortName: '2А' },
    { id: '7', fromName: 'Ринок', toName: 'Вокзал', shortName: '7/1' }, // додано; 5 знято
  ];
  next.trips = [
    { id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '07:10' }, // зсунуто
    { id: '2-02', routeId: '2', serviceId: 'weekdays', headsign: 'Барміна', directionId: '0', departureTime: '18:30' },
    { id: '7-01', routeId: '7', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '09:00' }, // додано; 5-01 знято
  ];
  next.segments = [
    { routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0002', seconds: 300 },
    { routeId: '2', fromStopId: 'st_0002', toStopId: 'st_0003', seconds: 660 }, // змінено
    // 5|st_0001|st_0003 зник, новий 7|…
    { routeId: '7', fromStopId: 'st_0004', toStopId: 'st_0003', seconds: 200 },
  ];
  next.meta = { ...next.meta, stopRedirects: { st_0042: 'st_0001', st_0002: 'st_0004' } };

  const diff = diffTransportDatasets(prev, next);
  assert.deepEqual(diff.stops, {
    added: [{ id: 'st_0004', name: 'Ринок' }],
    removed: [{ id: 'st_0002', name: 'Лікарня' }],
    renamed: [{ id: 'st_0001', from: 'Барміна', to: 'Барміна, центр' }],
  });
  assert.deepEqual(diff.routes, {
    added: [{ id: '7', no: '7/1', name: 'Ринок — Вокзал' }],
    removed: [{ id: '5', no: '5', name: 'Фабрика — Вокзал' }],
  });
  assert.deepEqual(diff.trips, {
    added: [{ id: '7-01', routeId: '7', routeNo: '7/1', departureTime: '09:00' }],
    removed: [{ id: '5-01', routeId: '5', routeNo: '5', departureTime: '08:00' }],
    moved: [{ id: '2-01', routeId: '2', routeNo: '2А', departureTime: '07:10', from: '07:00', to: '07:10' }],
  });
  // змінений + новий + зниклий
  assert.deepEqual(diff.segments, { changed: 3 });
  assert.deepEqual(diff.redirects, { added: [{ from: 'st_0002', to: 'st_0004' }], removed: [] });
  assert.ok(!isEmptyDiff(diff));

  const text = describeTransportDiff(diff);
  assert.equal(
    text,
    'Додано 1 зупинку: «Ринок» (st_0004); перейменовано 1 зупинку: «Барміна» → «Барміна, центр» (st_0001); ' +
      'знято 1 зупинку: «Лікарня» (st_0002); додано 1 маршрут: №7/1 Ринок — Вокзал; знято 1 маршрут: №5 Фабрика — Вокзал; ' +
      'додано 1 рейс: №7/1 о 09:00 (7-01); зсунуто 1 рейс: №2А 07:00 → 07:10 (2-01); знято 1 рейс: №5 о 08:00 (5-01); ' +
      'змінено час у дорозі на 3 перегонах між зупинками; 1 зупинку перенесено: st_0002 → st_0004'
  );
});

test('diffTransportDatasets: a redirect whose target changed counts as removed + added; dropped redirect is removed', () => {
  const prev = base();
  const next = base();
  next.meta = { ...next.meta, stopRedirects: { st_0042: 'st_0003' } };
  const diff = diffTransportDatasets(prev, next);
  assert.deepEqual(diff.redirects, { added: [{ from: 'st_0042', to: 'st_0003' }], removed: [{ from: 'st_0042', to: 'st_0001' }] });
  next.meta = { defaultSec: 120 };
  assert.deepEqual(diffTransportDatasets(prev, next).redirects, { added: [], removed: [{ from: 'st_0042', to: 'st_0001' }] });
});

test('describeTransportDiff: long lists are cut to 6 items with «та ще N»; plural forms', () => {
  const prev = base();
  const next = base();
  next.trips = [
    ...next.trips,
    ...Array.from({ length: 9 }, (_, i) => ({ id: `2-1${i}`, routeId: '2', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: `1${i}:00` })),
  ];
  const text = describeTransportDiff(diffTransportDatasets(prev, next));
  assert.ok(text.startsWith('Додано 9 рейсів: №2А о 10:00 (2-10), '), text);
  assert.ok(text.endsWith('№2А о 15:00 (2-15) та ще 3'), text);
  assert.equal(plural(1, 'рейс', 'рейси', 'рейсів'), '1 рейс');
  assert.equal(plural(3, 'рейс', 'рейси', 'рейсів'), '3 рейси');
  assert.equal(plural(11, 'рейс', 'рейси', 'рейсів'), '11 рейсів');
  assert.equal(plural(22, 'рейс', 'рейси', 'рейсів'), '22 рейси');
});

test('describeTransportRevision: no diff / empty diff wording depends on source', () => {
  assert.match(describeTransportRevision({ source: 'initial', diff: null }), /^Перша збережена версія/);
  assert.match(describeTransportRevision({ source: 'seed', diff: null }), /початкового набору/);
  const empty = diffTransportDatasets(base(), base());
  assert.match(describeTransportRevision({ source: 'recalculate', diff: empty }), /^Перераховано час у дорозі/);
  assert.match(describeTransportRevision({ source: 'stop-redirects', diff: empty }), /^Перенесення зупинок/);
  assert.match(describeTransportRevision({ source: 'dataset', diff: empty }), /^Технічне оновлення/);
  const moved = base();
  moved.trips[0].departureTime = '07:05';
  assert.equal(describeTransportRevision({ source: 'dataset', diff: diffTransportDatasets(base(), moved) }), 'Зсунуто 1 рейс: №2А 07:00 → 07:05 (2-01)');
});

test('transportRevisionStats mirrors the GTFS feed counters (hidden routes excluded)', () => {
  const ds = base();
  ds.routes[1].unreliable = true;
  const stats = transportRevisionStats(ds);
  assert.equal(stats.routes, 1);
  assert.equal(stats.trips, 2);
  assert.equal(stats.stops, 3);
  assert.deepEqual(stats.hiddenRouteIds, ['5']);
});

test('parseRevisionsLimit: default 50, clamp 1…200', () => {
  assert.equal(parseRevisionsLimit(undefined), 50);
  assert.equal(parseRevisionsLimit('abc'), 50);
  assert.equal(parseRevisionsLimit('0'), 50);
  assert.equal(parseRevisionsLimit('7.9'), 7);
  assert.equal(parseRevisionsLimit('999'), 200);
});

/** Стаб Prisma: датасет віддається з `state`, журнал — у `rows` */
function stub(state: { dataset: TransportDataset }, rows: any[]): PrismaClient {
  const ds = () => state.dataset;
  const list = (rowsOf: (d: TransportDataset) => any[]) => ({ findMany: async () => rowsOf(ds()) });
  return {
    transportStop: list((d) => d.stops),
    transportRoute: list((d) => d.routes.map((r) => ({ ...r, schedule: null, unreliable: r.unreliable ?? false, variants: r.variants ?? [] }))),
    transportRouteStop: list((d) => d.routeStops),
    transportTrip: list((d) => d.trips.map((t) => ({ ...t, variantId: null, timepoints: null }))),
    transportSegment: list((d) => d.segments),
    transportMeta: { findUnique: async () => (ds().revision ? { id: 1, payload: ds().meta, updatedAt: new Date(ds().revision!) } : null) },
    transportRevision: {
      count: async () => rows.length,
      findMany: async ({ take }: any) => [...rows].sort((a, b) => (a.revision < b.revision ? 1 : -1)).slice(0, take),
      upsert: async ({ where, create }: any) => {
        const found = rows.find((r) => r.revision === where.revision);
        if (found) return found;
        const row = { createdAt: new Date('2026-10-12T10:00:01Z'), ...create, diff: create.diff ?? null };
        rows.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;
}

test('recordTransportRevision: first row without diff, next row with diff; same revision is not written twice', async () => {
  const state = { dataset: base() };
  const rows: any[] = [];
  const prisma = stub(state, rows);

  const first = await ensureInitialTransportRevision(prisma);
  assert.ok(first);
  assert.equal(first.revision, '2026-10-12T10:00:00.000Z');
  assert.equal(first.source, 'initial');
  assert.equal(first.diff, null);
  assert.equal(first.stats.trips, 3);
  assert.match(first.summary, /^Перша збережена версія/);
  assert.equal(await ensureInitialTransportRevision(prisma), null, 'journal not empty any more');

  const previous = state.dataset;
  const next = base();
  next.trips[0].departureTime = '07:05';
  next.revision = '2026-10-13T08:00:00.000Z';
  state.dataset = next;
  const second = await recordTransportRevision(prisma, { source: 'dataset', previous });
  assert.ok(second);
  assert.equal(second.revision, '2026-10-13T08:00:00.000Z');
  assert.equal(second.summary, 'Зсунуто 1 рейс: №2А 07:00 → 07:05 (2-01)');
  assert.deepEqual(second.diff?.trips.moved.map((t) => t.id), ['2-01']);

  // revision не змінилась → запис пропускається
  assert.equal(await recordTransportRevision(prisma, { source: 'dataset', previous: next }), null);
  assert.equal(rows.length, 2);

  const listed = await listTransportRevisions(prisma, 1);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].revision, '2026-10-13T08:00:00.000Z');
  assert.equal((await listTransportRevisions(prisma)).length, 2);
});

test('recordTransportRevision: empty dataset → null; a failing write is logged, not thrown', async () => {
  const empty: TransportDataset = { stops: [], routes: [], routeStops: [], trips: [], segments: [], meta: {}, revision: null };
  assert.equal(await recordTransportRevision(stub({ dataset: empty }, []), { source: 'dataset', previous: null }), null);

  const prisma = stub({ dataset: base() }, []);
  (prisma as any).transportRevision.upsert = async () => {
    throw new Error('db down');
  };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    assert.equal(await recordTransportRevision(prisma, { source: 'dataset', previous: null }), null);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});
