"use strict";
/**
 * Одноразовий (ідемпотентний) seed міського транспорту Малина з легасі runtime JSON у PostgreSQL.
 *
 * Джерело: data/malyn-transport/runtime/*.json (архів у репозиторії)
 *
 * Запуск із backend/:
 *   npm run seed:transport
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const local_transport_1 = require("../local-transport");
const runtimeDir = path_1.default.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'runtime');
function readJson(name) {
    return JSON.parse(fs_1.default.readFileSync(path_1.default.join(runtimeDir, name), 'utf8'));
}
async function main() {
    const transport = readJson('malyn_transport.json');
    const coords = readJson('stops_coords.json');
    const segments = readJson('segmentDurations.json');
    let agency = null;
    try {
        agency = readJson('agency.json');
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
    const prisma = new client_1.PrismaClient();
    try {
        await (0, local_transport_1.replaceTransportDataset)(prisma, dataset);
        console.log(`Seeded: ${dataset.stops.length} stops, ${dataset.routes.length} routes, ` +
            `${dataset.routeStops.length} route stops, ${dataset.trips.length} trips, ` +
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
