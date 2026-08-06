"use strict";
/**
 * Seed міського транспорту Малина з JSON → PostgreSQL.
 *
 * Джерело (перше існуюче):
 *   backend/seed-data/malyn-transport/runtime/   (Docker / Railway)
 *   data/malyn-transport/runtime/                (локальний монорепо)
 *
 * Запуск:
 *   npm run seed:transport              # завжди перезаписати
 *   npm run seed:transport -- --if-empty  # тільки якщо TransportStop порожній
 *
 * Production start викликає --if-empty автоматично.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const local_transport_1 = require("../local-transport");
function resolveRuntimeDir() {
    const candidates = [
        // dist/scripts → ../../seed-data/...  (= backend/seed-data/...)
        path_1.default.join(__dirname, '..', '..', 'seed-data', 'malyn-transport', 'runtime'),
        // dist/scripts → ../../../data/...   (= repo/data/... у монорепо)
        path_1.default.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'runtime'),
        // cwd fallback
        path_1.default.join(process.cwd(), 'seed-data', 'malyn-transport', 'runtime'),
        path_1.default.join(process.cwd(), '..', 'data', 'malyn-transport', 'runtime'),
    ];
    for (const dir of candidates) {
        if (fs_1.default.existsSync(path_1.default.join(dir, 'malyn_transport.json')))
            return dir;
    }
    throw new Error(`Transport seed JSON not found. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`);
}
function readJson(runtimeDir, name) {
    return JSON.parse(fs_1.default.readFileSync(path_1.default.join(runtimeDir, name), 'utf8'));
}
async function main() {
    const ifEmpty = process.argv.includes('--if-empty');
    const prisma = new client_1.PrismaClient();
    try {
        if (ifEmpty) {
            const count = await prisma.transportStop.count();
            if (count > 0) {
                console.log(`[seed:transport] skip — already have ${count} stops (--if-empty)`);
                return;
            }
            console.log('[seed:transport] TransportStop empty — seeding from JSON…');
        }
        const runtimeDir = resolveRuntimeDir();
        console.log(`[seed:transport] source: ${runtimeDir}`);
        const transport = readJson(runtimeDir, 'malyn_transport.json');
        const coords = readJson(runtimeDir, 'stops_coords.json');
        const segments = readJson(runtimeDir, 'segmentDurations.json');
        let agency = null;
        try {
            agency = readJson(runtimeDir, 'agency.json');
        }
        catch {
            console.warn('agency.json not found — meta.agency will be null');
        }
        const { dataset, warnings } = (0, local_transport_1.convertLegacyRuntime)({ transport, coords, segments, agency });
        for (const w of warnings)
            console.warn(`⚠️  ${w}`);
        const { errors } = (0, local_transport_1.validateTransportDataset)(dataset);
        if (errors.length) {
            console.error('Dataset validation failed:');
            for (const e of errors)
                console.error(`  - ${e}`);
            process.exit(1);
        }
        await (0, local_transport_1.replaceTransportDataset)(prisma, dataset);
        console.log(`[seed:transport] Seeded: ${dataset.stops.length} stops, ${dataset.routes.length} routes, ` +
            `${dataset.routeStops.length} routeStops, ${dataset.trips.length} trips, ` +
            `${dataset.segments.length} segments.`);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
