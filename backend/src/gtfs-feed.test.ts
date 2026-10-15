/**
 * GTFS feed generator (src/gtfs-feed.ts): file contents, hidden (unreliable) routes, feed_version = revision,
 * LICENSE.txt, deterministic zip.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'zlib';
import type { PrismaClient } from '@prisma/client';
import type { TransportDataset } from './local-transport';
import { GTFS_FEED_FILES, OPEN_DATA_LICENSE, buildGtfsFeed, createGtfsFeedProvider, gtfsFeedVersion, isGtfsFeedFile, zipGtfsFeed } from './gtfs-feed';

function dataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_0001', name: 'Барміна', lat: 50.771, lng: 29.241 },
      { id: 'st_0002', name: 'Лікарня', lat: 50.772, lng: 29.242 },
      { id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 },
      { id: 'st_0099', name: 'Технічна', lat: 50.7715, lng: 29.2415 },
    ],
    routes: [
      { id: '2', fromName: 'Фабрика', toName: 'Лікарня', shortName: '2А' },
      { id: '10', fromName: 'Поліклініка', toName: 'Вокзал', unreliable: true },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 3, mapOnly: false },
      { routeId: '2', stopId: 'st_0099', orderThere: 2, orderBack: 2, mapOnly: true },
      { routeId: '2', stopId: 'st_0002', orderThere: 3, orderBack: 1, mapOnly: false },
      { routeId: '10', stopId: 'st_0001', orderThere: 1, orderBack: 2, mapOnly: false },
      { routeId: '10', stopId: 'st_0003', orderThere: 2, orderBack: 1, mapOnly: false },
    ],
    trips: [
      { id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '07:00:00' },
      { id: '2-02', routeId: '2', serviceId: 'weekdays', headsign: 'Фабрика', directionId: '0', departureTime: '7:30' },
      { id: '2-03', routeId: '2', serviceId: 'everyday', headsign: 'Без часу', directionId: '1', departureTime: null },
      { id: '10-01', routeId: '10', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '08:00:00' },
    ],
    segments: [
      { routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0099', seconds: 60 },
      { routeId: '2', fromStopId: 'st_0099', toStopId: 'st_0002', seconds: 120 },
    ],
    meta: { defaultSec: 120, center: [50.768, 29.242] },
    revision: '2026-10-14T18:03:11.000Z',
  };
}

const lines = (txt: string) => txt.trimEnd().split('\n');

test('buildGtfsFeed: timed trips of visible routes only, stops without technical points, feed_version = revision', () => {
  const feed = buildGtfsFeed(dataset());
  assert.equal(feed.feedVersion, '2026-10-14T18:03:11.000Z');
  assert.deepEqual(Object.keys(feed.files).sort(), [...GTFS_FEED_FILES].sort());

  assert.deepEqual(lines(feed.files['routes.txt']), [
    'route_id,agency_id,route_short_name,route_long_name,route_type',
    '2,malyn,2А,Фабрика — Лікарня,3',
  ]);
  assert.deepEqual(lines(feed.files['trips.txt']), [
    'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id',
    '2,everyday,2-01,Лікарня,1,,shp_2_1',
    '2,weekdays,2-02,Фабрика,0,,shp_2_0',
  ]);
  assert.deepEqual(lines(feed.files['stop_times.txt']), [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint',
    '2-01,07:00:00,07:00:00,st_0001,1,1',
    '2-01,07:03:00,07:03:00,st_0002,2,0',
    '2-02,07:30:00,07:30:00,st_0002,1,1',
    '2-02,07:33:00,07:33:00,st_0001,2,0',
  ]);
  // Технічна точка — лише в shapes.txt, не в stops.txt; зупинки прихованого маршруту без рейсів — теж ні
  assert.deepEqual(lines(feed.files['stops.txt']), [
    'stop_id,stop_name,stop_lat,stop_lon,location_type',
    'st_0001,Барміна,50.771000,29.241000,0',
    'st_0002,Лікарня,50.772000,29.242000,0',
  ]);
  assert.ok(feed.files['shapes.txt'].includes('shp_2_1,50.771500,29.241500,2'));
  assert.ok(!feed.files['shapes.txt'].includes('shp_10_'));

  const feedInfo = lines(feed.files['feed_info.txt']);
  assert.equal(feedInfo[0], 'feed_publisher_name,feed_publisher_url,feed_lang,feed_contact_email,feed_contact_url,feed_start_date,feed_end_date,feed_version');
  assert.ok(feedInfo[1].endsWith(',20240101,20271231,2026-10-14T18:03:11.000Z'));
  assert.ok(feedInfo[1].includes('https://malin.kiev.ua/transport/scheme#open-data'));

  assert.ok(feed.files['LICENSE.txt'].includes(`License: ${OPEN_DATA_LICENSE.name} — ${OPEN_DATA_LICENSE.url}`));
  assert.ok(feed.files['LICENSE.txt'].includes('Feed version (dataset revision): 2026-10-14T18:03:11.000Z'));
  assert.ok(feed.files['agency.txt'].includes('malyn,Громадський транспорт міста Малина'));
  assert.equal(lines(feed.files['calendar.txt']).length, 3);

  assert.deepEqual(feed.stats, {
    routes: 1,
    trips: 2,
    stopTimes: 4,
    stops: 2,
    shapes: 2,
    shapePoints: 6,
    skippedNoStops: 0,
    compressedTrips: 0,
    partialTrips: 0,
    timedTrips: 2,
    hiddenRouteIds: ['10'],
  });
});

test('buildGtfsFeed: an unreliable route that becomes visible is back in the feed', () => {
  const ds = dataset();
  ds.routes[1].unreliable = false;
  const feed = buildGtfsFeed(ds);
  assert.ok(feed.files['routes.txt'].includes('10,malyn,10,Поліклініка — Вокзал,3'));
  assert.ok(feed.files['trips.txt'].includes('10,everyday,10-01,Вокзал,1,,shp_10_1'));
  assert.ok(feed.files['stops.txt'].includes('st_0003,Вокзал'));
  assert.deepEqual(feed.stats.hiddenRouteIds, []);
});

test('gtfsFeedVersion: revision as is, otherwise the build date', () => {
  assert.equal(gtfsFeedVersion('2026-10-14T18:03:11.000Z'), '2026-10-14T18:03:11.000Z');
  assert.equal(gtfsFeedVersion(null, new Date('2026-10-16T09:00:00Z')), '20261016');
  assert.equal(gtfsFeedVersion('  ', new Date('2026-10-16T09:00:00Z')), '20261016');
  const ds = dataset();
  ds.revision = null;
  assert.equal(buildGtfsFeed(ds, { now: new Date('2026-10-16T09:00:00Z') }).feedVersion, '20261016');
  assert.equal(buildGtfsFeed(ds, { revision: '2026-01-01T00:00:00.000Z' }).feedVersion, '2026-01-01T00:00:00.000Z');
});

test('isGtfsFeedFile accepts only feed files', () => {
  assert.equal(isGtfsFeedFile('feed_info.txt'), true);
  assert.equal(isGtfsFeedFile('LICENSE.txt'), true);
  assert.equal(isGtfsFeedFile('../index.js'), false);
  assert.equal(isGtfsFeedFile(42), false);
});

test('zipGtfsFeed: every feed file is inside, in order, and the archive is deterministic per revision', () => {
  const feed = buildGtfsFeed(dataset());
  const zip = zipGtfsFeed(feed);
  assert.ok(zip.equals(zipGtfsFeed(feed)));
  const names: string[] = [];
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const method = zip.readUInt16LE(p + 8);
    const compressed = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const name = zip.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const body = zip.subarray(p + 30 + nameLen, p + 30 + nameLen + compressed);
    const text = (method === 8 ? inflateRawSync(body) : body).toString('utf8');
    assert.equal(text, feed.files[name as keyof typeof feed.files], name);
    names.push(name);
    p += 30 + nameLen + compressed;
  }
  assert.deepEqual(names, [...GTFS_FEED_FILES]);
  // Час файлів = revision (DOS: 2026-10-14 18:03:10)
  assert.equal(zip.readUInt16LE(12), ((2026 - 1980) << 9) | (10 << 5) | 14);
});

test('createGtfsFeedProvider: builds once per revision, null without a dataset', async () => {
  let updatedAt: Date | null = null;
  let loads = 0;
  const ds = dataset();
  const prisma = {
    transportMeta: { findUnique: async () => (updatedAt ? { id: 1, payload: ds.meta, updatedAt } : null) },
    transportStop: { findMany: async () => (loads++, ds.stops) },
    transportRoute: { findMany: async () => ds.routes.map((r) => ({ scheme: '', note: '', sourceUrl: '', schedule: null, unreliable: false, shortName: '', variants: [], ...r })) },
    transportRouteStop: { findMany: async () => ds.routeStops },
    transportTrip: {
      findMany: async () =>
        ds.trips.map((t) => ({ blockId: null, wheelchairAccessible: '', bikesAllowed: '', startStopId: null, endStopId: null, arrivalTime: null, variantId: null, timepoints: null, ...t })),
    },
    transportSegment: { findMany: async () => ds.segments.map((s, i) => ({ id: i + 1, ...s })) },
  } as unknown as PrismaClient;
  const provider = createGtfsFeedProvider(prisma);

  assert.equal(await provider.get(), null);
  assert.equal(loads, 0);

  updatedAt = new Date('2026-10-14T18:03:11Z');
  const [a, b] = await Promise.all([provider.get(), provider.get()]);
  assert.ok(a && b);
  assert.equal(a.revision, '2026-10-14T18:03:11.000Z');
  assert.equal(a.feed.feedVersion, '2026-10-14T18:03:11.000Z');
  assert.equal(b, a);
  assert.equal(loads, 1);
  assert.equal(await provider.get(), a);
  assert.equal(loads, 1);

  updatedAt = new Date('2026-10-15T08:00:00Z');
  const c = await provider.get();
  assert.ok(c && c !== a);
  assert.equal(c.revision, '2026-10-15T08:00:00.000Z');
  assert.ok(!c.zip.equals(a.zip));
  assert.equal(loads, 2);
});
