/**
 * GTFS Static фід міського транспорту Малина з датасету (Docs/transport-open-data-2026-10.md, фаза 1;
 * що саме в фіді — Docs/local-transport-gtfs-feed.md). Чиста генерація без fs: той самий код живить
 * `GET /transport/gtfs.zip` (кеш у пам'яті за revision) і скрипт `npm run export:gtfs`.
 *
 * Лише рейси з departureTime (чесний фід); маршрути з прапорцем `unreliable` («Ненадійний — приховати»)
 * у фід не потрапляють; stop_times синтезуються із сегментів (gtfs-stop-times.ts).
 */
import type { PrismaClient } from '@prisma/client';
import { currentTransportRevision, loadTransportDataset, type TransportDataset, type TransportRouteStopInput } from './local-transport';
import { DEFAULT_SEC, buildTripStopTimes, toGtfsTime, type TripStopTimes } from './gtfs-stop-times';
import { buildZip } from './zip';

/** Ліцензія даних (рішення власника — Docs/transport-open-data-2026-10.md; дзеркало у frontend openData.ts) */
export const OPEN_DATA_LICENSE = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Дані: malin.kiev.ua',
} as const;

export const GTFS_ZIP_FILENAME = 'malyn-gtfs.zip';

/** Файли фіду у фіксованому порядку (порядок у zip теж такий — детермінований архів) */
export const GTFS_FEED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'feed_info.txt',
  'shapes.txt',
  'LICENSE.txt',
] as const;
export type GtfsFeedFile = (typeof GTFS_FEED_FILES)[number];

export function isGtfsFeedFile(name: unknown): name is GtfsFeedFile {
  return typeof name === 'string' && (GTFS_FEED_FILES as readonly string[]).includes(name);
}

const SERVICE_START_DATE = '20240101';
const SERVICE_END_DATE = '20271231';

const SERVICE_MAP: Record<string, string> = {
  'пн-вт-ср-чт-пт-сб-нд': 'everyday',
  everyday: 'everyday',
  weekdays: 'weekdays',
};

const FEED_PUBLISHER = {
  feed_publisher_name: 'Technologies LLC',
  feed_publisher_url: 'https://malin.kiev.ua/',
  feed_lang: 'uk',
  feed_contact_email: 'mer.sergei@gmail.com',
  /** Блок «Дані відкриті» на сторінці схеми — ліцензія, версія, як відкрити */
  feed_contact_url: 'https://malin.kiev.ua/transport/scheme#open-data',
};

export interface GtfsFeedStats {
  routes: number;
  trips: number;
  stopTimes: number;
  stops: number;
  shapes: number;
  shapePoints: number;
  skippedNoStops: number;
  compressedTrips: number;
  partialTrips: number;
  timedTrips: number;
  hiddenRouteIds: string[];
}

export interface GtfsFeed {
  files: Record<GtfsFeedFile, string>;
  /** feed_info.feed_version: revision датасету (ISO) або дата збірки, коли revision нема */
  feedVersion: string;
  stats: GtfsFeedStats;
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function table(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  return lines.join('\n') + '\n';
}

function fallbackVersion(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Версія фіду з revision датасету; без revision — дата (як у старого скрипта) */
export function gtfsFeedVersion(revision: string | null | undefined, now: Date = new Date()): string {
  return revision && revision.trim() ? revision.trim() : fallbackVersion(now);
}

export function buildGtfsFeed(dataset: TransportDataset, options: { revision?: string | null; now?: Date } = {}): GtfsFeed {
  const feedVersion = gtfsFeedVersion(options.revision ?? dataset.revision, options.now);
  const agency = (dataset.meta.agency as Record<string, string> | null) || {
    agency_id: 'malyn',
    agency_name: 'Громадський транспорт міста Малина',
    agency_url: 'https://malyn-rada.gov.ua/',
    agency_timezone: 'Europe/Kyiv',
    agency_lang: 'uk',
    agency_phone: '',
  };
  const defaultSec = Number(dataset.meta.defaultSec) || DEFAULT_SEC;

  const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
  const routeById = new Map(dataset.routes.map((r) => [r.id, r]));
  const routeStopsByRoute = new Map<string, TransportRouteStopInput[]>();
  for (const rs of dataset.routeStops) {
    if (!routeStopsByRoute.has(rs.routeId)) routeStopsByRoute.set(rs.routeId, []);
    routeStopsByRoute.get(rs.routeId)!.push(rs);
  }
  const segments: Record<string, number> = {};
  for (const seg of dataset.segments) segments[`${seg.routeId}|${seg.fromStopId}|${seg.toStopId}`] = seg.seconds;

  const agencyTxt = table(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone'], [
    {
      agency_id: agency.agency_id || 'malyn',
      agency_name: agency.agency_name,
      agency_url: agency.agency_url,
      agency_timezone: agency.agency_timezone || 'Europe/Kyiv',
      agency_lang: agency.agency_lang || 'uk',
      agency_phone: agency.agency_phone || '',
    },
  ]);

  const calendarTxt = table(
    ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    [
      { service_id: 'everyday', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1, start_date: SERVICE_START_DATE, end_date: SERVICE_END_DATE },
      { service_id: 'weekdays', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: SERVICE_START_DATE, end_date: SERVICE_END_DATE },
    ]
  );

  const usedStopIds = new Set(stopById.keys());
  // Ненадійні (приховані) маршрути у фід не потрапляють
  const hiddenRouteIds = new Set(dataset.routes.filter((r) => r.unreliable).map((r) => r.id));
  const timedTrips = dataset.trips.filter((t) => toGtfsTime(t.departureTime) && !hiddenRouteIds.has(t.routeId));
  const routeIds = [...new Set(timedTrips.map((t) => t.routeId))].sort((a, b) => Number(a) - Number(b));

  const routeRows = routeIds.map((routeId) => {
    const meta = routeById.get(routeId);
    const longName = [meta?.fromName, meta?.toName].filter(Boolean).join(' — ') || `Маршрут ${routeId}`;
    return {
      route_id: routeId,
      agency_id: agency.agency_id || 'malyn',
      route_short_name: meta?.shortName?.trim() || routeId,
      route_long_name: longName,
      route_type: 3,
    };
  });

  const shapeRows: Record<string, unknown>[] = [];
  const shapeIdByRouteDir = new Map<string, string>();

  /** Shape на маршрут+напрямок+варіант+зріз: скорочені рейси й варіанти шляху отримують власну лінію. */
  function ensureShape(routeId: string, built: TripStopTimes): string {
    const { direction, variantId, chainKeys, startIndex, endIndex } = built;
    const directionId = direction === 'there' ? 1 : 0;
    const full = startIndex === 0 && endIndex === chainKeys.length - 1;
    const cacheKey = `${routeId}|${direction}|${variantId ?? ''}|${startIndex}|${endIndex}`;
    if (shapeIdByRouteDir.has(cacheKey)) return shapeIdByRouteDir.get(cacheKey)!;
    const points = chainKeys
      .slice(startIndex, endIndex + 1)
      .map((stopId) => stopById.get(stopId))
      .filter((s): s is NonNullable<typeof s> => !!s);
    const base = variantId ? `shp_${routeId}_${directionId}_${variantId}` : `shp_${routeId}_${directionId}`;
    const shapeId = points.length >= 2 ? (full ? base : `${base}_${startIndex}_${endIndex}`) : '';
    if (shapeId) {
      points.forEach((s, i) => {
        shapeRows.push({
          shape_id: shapeId,
          shape_pt_lat: Number(s.lat).toFixed(6),
          shape_pt_lon: Number(s.lng).toFixed(6),
          shape_pt_sequence: i + 1,
        });
      });
    }
    shapeIdByRouteDir.set(cacheKey, shapeId);
    return shapeId;
  }

  const tripRows: Record<string, unknown>[] = [];
  const stopTimeRows: Record<string, unknown>[] = [];
  let skippedNoStops = 0;
  let compressedTrips = 0;
  let partialTrips = 0;

  for (const rec of timedTrips) {
    const serviceId = SERVICE_MAP[rec.serviceId || ''] || 'everyday';
    const routeStops = routeStopsByRoute.get(rec.routeId) || [];
    const built = buildTripStopTimes(rec, routeStops, segments, defaultSec, usedStopIds, routeById.get(rec.routeId)?.variants ?? []);
    if (!built) {
      skippedNoStops++;
      continue;
    }
    if (built.factor < 1) compressedTrips++;
    if (built.startIndex > 0 || built.endIndex < built.chainKeys.length - 1) partialTrips++;

    tripRows.push({
      route_id: rec.routeId,
      service_id: serviceId,
      trip_id: rec.id,
      trip_headsign: rec.headsign || '',
      direction_id: built.direction === 'there' ? 1 : 0,
      block_id: rec.blockId || '',
      shape_id: ensureShape(rec.routeId, built),
    });
    stopTimeRows.push(...built.rows.map((row) => ({ ...row })));
  }

  const referencedStopIds = new Set(stopTimeRows.map((r) => String(r.stop_id)));
  const stopRows = [...referencedStopIds]
    .map((stopId) => {
      const s = stopById.get(stopId)!;
      return {
        stop_id: stopId,
        stop_name: s.name || stopId,
        stop_lat: Number(s.lat).toFixed(6),
        stop_lon: Number(s.lng).toFixed(6),
        location_type: 0,
      };
    })
    .sort((a, b) => a.stop_id.localeCompare(b.stop_id));

  const feedInfoTxt = table(
    ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_contact_email', 'feed_contact_url', 'feed_start_date', 'feed_end_date', 'feed_version'],
    [{ ...FEED_PUBLISHER, feed_start_date: SERVICE_START_DATE, feed_end_date: SERVICE_END_DATE, feed_version: feedVersion }]
  );

  const licenseTxt = [
    `Malyn city public transport — GTFS Static feed (${GTFS_ZIP_FILENAME})`,
    '',
    `License: ${OPEN_DATA_LICENSE.name} — ${OPEN_DATA_LICENSE.url}`,
    `Attribution: ${OPEN_DATA_LICENSE.attribution} (https://malin.kiev.ua/transport)`,
    `Publisher: ${FEED_PUBLISHER.feed_publisher_name}, ${FEED_PUBLISHER.feed_publisher_url}`,
    `Contact: ${FEED_PUBLISHER.feed_contact_email}`,
    `Feed version (dataset revision): ${feedVersion}`,
    'Latest feed: https://malin.kiev.ua/transport/scheme#open-data',
    '',
    'Ліцензія даних: ' + OPEN_DATA_LICENSE.name + ' — використовуйте вільно, вказуйте джерело «' + OPEN_DATA_LICENSE.attribution + '».',
    '',
  ].join('\n');

  return {
    feedVersion,
    files: {
      'agency.txt': agencyTxt,
      'stops.txt': table(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'], stopRows),
      'routes.txt': table(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], routeRows),
      'trips.txt': table(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'], tripRows),
      'stop_times.txt': table(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint'], stopTimeRows),
      'calendar.txt': calendarTxt,
      'feed_info.txt': feedInfoTxt,
      'shapes.txt': table(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapeRows),
      'LICENSE.txt': licenseTxt,
    },
    stats: {
      routes: routeRows.length,
      trips: tripRows.length,
      stopTimes: stopTimeRows.length,
      stops: stopRows.length,
      shapes: shapeIdByRouteDir.size,
      shapePoints: shapeRows.length,
      skippedNoStops,
      compressedTrips,
      partialTrips,
      timedTrips: timedTrips.length,
      hiddenRouteIds: [...hiddenRouteIds],
    },
  };
}

/** Zip фіду; час файлів = revision (feedVersion як дата), інакше дата збірки → той самий архів для тієї самої revision */
export function zipGtfsFeed(feed: GtfsFeed, now: Date = new Date()): Buffer {
  const fromVersion = new Date(feed.feedVersion);
  const mtime = Number.isNaN(fromVersion.getTime()) ? now : fromVersion;
  return buildZip(
    GTFS_FEED_FILES.map((name) => ({ name, data: feed.files[name] })),
    { mtime }
  );
}

export interface CachedGtfsFeed {
  revision: string;
  feed: GtfsFeed;
  zip: Buffer;
}

/**
 * Фід для HTTP: один `TransportMeta.findUnique` на запит (revision), повна збірка лише коли revision змінилась.
 * null — датасету ще нема (порожня БД).
 */
export function createGtfsFeedProvider(prisma: PrismaClient): { get(): Promise<CachedGtfsFeed | null> } {
  let cache: CachedGtfsFeed | null = null;
  let building: Promise<CachedGtfsFeed> | null = null;
  return {
    async get() {
      const revision = await currentTransportRevision(prisma);
      if (!revision) return null;
      if (cache?.revision === revision) return cache;
      if (!building) {
        building = (async () => {
          const dataset = await loadTransportDataset(prisma);
          const feed = buildGtfsFeed(dataset, { revision });
          cache = { revision, feed, zip: zipGtfsFeed(feed) };
          return cache;
        })().finally(() => {
          building = null;
        });
      }
      const built = await building;
      // Паралельні запити ділять одну збірку; якщо revision встигла змінитись — наступний виклик перезбере
      return cache && cache.revision === revision ? cache : built;
    },
  };
}
