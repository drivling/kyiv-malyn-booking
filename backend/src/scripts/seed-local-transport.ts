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

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { convertLegacyRuntime, replaceTransportDataset, validateTransportDataset } from '../local-transport';

function resolveRuntimeDir(): string {
  const candidates = [
    // dist/scripts → ../../seed-data/...  (= backend/seed-data/...)
    path.join(__dirname, '..', '..', 'seed-data', 'malyn-transport', 'runtime'),
    // dist/scripts → ../../../data/...   (= repo/data/... у монорепо)
    path.join(__dirname, '..', '..', '..', 'data', 'malyn-transport', 'runtime'),
    // cwd fallback
    path.join(process.cwd(), 'seed-data', 'malyn-transport', 'runtime'),
    path.join(process.cwd(), '..', 'data', 'malyn-transport', 'runtime'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'malyn_transport.json'))) return dir;
  }
  throw new Error(
    `Transport seed JSON not found. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`
  );
}

function readJson(runtimeDir: string, name: string): any {
  return JSON.parse(fs.readFileSync(path.join(runtimeDir, name), 'utf8'));
}

async function main() {
  const ifEmpty = process.argv.includes('--if-empty');
  const prisma = new PrismaClient();

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
    let agency: any = null;
    try {
      agency = readJson(runtimeDir, 'agency.json');
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

    await replaceTransportDataset(prisma, dataset);
    console.log(
      `[seed:transport] Seeded: ${dataset.stops.length} stops, ${dataset.routes.length} routes, ` +
        `${dataset.routeStops.length} routeStops, ${dataset.trips.length} trips, ` +
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
