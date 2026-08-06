/**
 * Одноразовий (ідемпотентний) seed міського транспорту Малина з легасі runtime JSON у PostgreSQL.
 *
 * Джерело: data/malyn-transport/runtime/*.json (архів у репозиторії)
 *
 * Запуск із backend/:
 *   npm run seed:transport
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { convertLegacyRuntime, replaceTransportDataset, validateTransportDataset } from '../local-transport';

const runtimeDir = path.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'runtime');

function readJson(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(runtimeDir, name), 'utf8'));
}

async function main() {
  const transport = readJson('malyn_transport.json');
  const coords = readJson('stops_coords.json');
  const segments = readJson('segmentDurations.json');
  let agency: any = null;
  try {
    agency = readJson('agency.json');
  } catch {
    console.warn('agency.json not found — meta.agency will be null');
  }

  const { dataset, warnings } = convertLegacyRuntime({ transport, coords, segments, agency });
  for (const w of warnings) console.warn(`⚠️  ${w}`);

  const { errors } = validateTransportDataset(dataset);
  if (errors.length) {
    console.error('Dataset validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await replaceTransportDataset(prisma, dataset);
    console.log(
      `Seeded: ${dataset.stops.length} stops, ${dataset.routes.length} routes, ` +
        `${dataset.routeStops.length} route stops, ${dataset.trips.length} trips, ` +
        `${dataset.segments.length} segments.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
