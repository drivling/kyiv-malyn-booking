"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const local_transport_1 = require("../local-transport");
const gtfs_feed_1 = require("../gtfs-feed");
const outDir = path_1.default.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'gtfs');
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        const dataset = await (0, local_transport_1.loadTransportDataset)(prisma);
        if (dataset.stops.length === 0) {
            console.error('Transport dataset is empty. Run: npm run seed:transport');
            process.exit(1);
        }
        const feed = (0, gtfs_feed_1.buildGtfsFeed)(dataset);
        fs_1.default.mkdirSync(outDir, { recursive: true });
        for (const name of gtfs_feed_1.GTFS_FEED_FILES)
            fs_1.default.writeFileSync(path_1.default.join(outDir, name), feed.files[name], 'utf8');
        const zipPath = path_1.default.join(outDir, gtfs_feed_1.GTFS_ZIP_FILENAME);
        fs_1.default.writeFileSync(zipPath, (0, gtfs_feed_1.zipGtfsFeed)(feed));
        const s = feed.stats;
        console.log(`GTFS written to ${outDir} (feed_version ${feed.feedVersion})`);
        console.log(`Routes: ${s.routes}, trips: ${s.trips}, stop_times: ${s.stopTimes}, stops: ${s.stops}, shapes: ${s.shapes} (${s.shapePoints} points)`);
        console.log(`Skipped trips (no passenger stops): ${s.skippedNoStops}`);
        console.log(`Partial (start/end stop) trips: ${s.partialTrips}; trips compressed to arrivalTime: ${s.compressedTrips}`);
        console.log(`Timed trips in DB: ${s.timedTrips}; plate-only trips omitted from feed.`);
        if (s.hiddenRouteIds.length)
            console.log(`Hidden (unreliable) routes omitted from feed: ${s.hiddenRouteIds.join(', ')}`);
        console.log(`Zip: ${zipPath}`);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
