/**
 * Export Malyn city transport from PostgreSQL → GTFS Static feed (files on disk).
 *
 * Output: data/malyn-transport/gtfs/  (txt + malyn-gtfs.zip)
 *
 * Thin wrapper over src/gtfs-feed.ts — the same generator serves GET /transport/gtfs.zip
 * (Docs/transport-open-data-2026-10.md). feed_version = dataset revision (TransportMeta.updatedAt).
 *
 * Usage (from backend/):
 *   npm run export:gtfs
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { loadTransportDataset } from '../local-transport';
import { GTFS_FEED_FILES, GTFS_ZIP_FILENAME, buildGtfsFeed, zipGtfsFeed } from '../gtfs-feed';

const outDir = path.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'gtfs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const dataset = await loadTransportDataset(prisma);
    if (dataset.stops.length === 0) {
      console.error('Transport dataset is empty. Run: npm run seed:transport');
      process.exit(1);
    }
    const feed = buildGtfsFeed(dataset);
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of GTFS_FEED_FILES) fs.writeFileSync(path.join(outDir, name), feed.files[name], 'utf8');
    const zipPath = path.join(outDir, GTFS_ZIP_FILENAME);
    fs.writeFileSync(zipPath, zipGtfsFeed(feed));

    const s = feed.stats;
    console.log(`GTFS written to ${outDir} (feed_version ${feed.feedVersion})`);
    console.log(`Routes: ${s.routes}, trips: ${s.trips}, stop_times: ${s.stopTimes}, stops: ${s.stops}, shapes: ${s.shapes} (${s.shapePoints} points)`);
    console.log(`Skipped trips (no passenger stops): ${s.skippedNoStops}`);
    console.log(`Partial (start/end stop) trips: ${s.partialTrips}; trips compressed to arrivalTime: ${s.compressedTrips}`);
    console.log(`Timed trips in DB: ${s.timedTrips}; plate-only trips omitted from feed.`);
    if (s.hiddenRouteIds.length) console.log(`Hidden (unreliable) routes omitted from feed: ${s.hiddenRouteIds.join(', ')}`);
    console.log(`Zip: ${zipPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
