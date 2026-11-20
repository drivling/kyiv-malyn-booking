/**
 * Golden-тест транспорту Малина (Docs/transport-tenancy-2026-11.md): справжній датасет з
 * data/malyn-transport/runtime → через replaceTransportDataset у тестове сховище → публічні відповіді API.
 * Їхні sha256 зафіксовано у fixtures/transport-golden.json ДО появи колонки міста: будь-яка зміна відповіді
 * Малина (навіть на байт) валить тест. Оновлювати файл можна лише свідомо:
 *   UPDATE_TRANSPORT_GOLDEN=1 npx vitest run src/transport-golden.test.ts
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import { createApp } from './create-app';
import { convertLegacyRuntime, replaceTransportDataset, validateTransportDataset } from './local-transport';
import { recordTransportRevision } from './transport-revisions';
import { createTransportTestStore } from './transport-test-store';

const RUNTIME = path.resolve(__dirname, '../../data/malyn-transport/runtime');
const GOLDEN_FILE = path.resolve(__dirname, 'fixtures/transport-golden.json');
const REVISION = new Date('2026-11-01T08:00:00.000Z');
const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(RUNTIME, name), 'utf8'));
const sha = (body: string): string => createHash('sha256').update(body).digest('hex');

type Golden = Record<string, { status: number; sha256: string; bytes: number }>;

async function snapshot(): Promise<Golden> {
  const store = createTransportTestStore();
  store.setNow(REVISION);
  const agency = fs.existsSync(path.join(RUNTIME, 'agency.json')) ? read('agency.json') : undefined;
  const { dataset } = convertLegacyRuntime({
    transport: read('malyn_transport.json'),
    coords: read('stops_coords.json'),
    segments: read('segmentDurations.json'),
    agency,
  });
  assert.deepEqual(validateTransportDataset(dataset).errors, []);
  await replaceTransportDataset(store.prisma, dataset);
  await recordTransportRevision(store.prisma, { source: 'seed', previous: null });

  const app = await listenLocal(createApp({ prisma: store.prisma, adminPassword: 'golden-test-password' }));
  const routeId = dataset.routes[0].id;
  const stopId = dataset.stops[0].id;
  const paths = [
    '/transport/dataset',
    '/transport/gtfs/agency.txt',
    '/transport/gtfs/stops.txt',
    '/transport/gtfs/routes.txt',
    '/transport/gtfs/trips.txt',
    '/transport/gtfs/stop_times.txt',
    '/transport/gtfs/calendar.txt',
    '/transport/gtfs/feed_info.txt',
    '/transport/changes.rss',
    '/transport/revisions',
    `/transport/route/${routeId}/calendar.ics`,
    '/transport/stop-redirects',
    `/transport/stops/${stopId}`,
  ];
  const out: Golden = {};
  for (const p of paths) {
    const res = await request(app).get(p).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const body = (res.body as Buffer).toString('utf8');
    // DTSTAMP у календарі та createdAt журналу — час запиту, а не дані
    const stable = body.replace(/DTSTAMP:\d{8}T\d{6}Z/g, 'DTSTAMP:X');
    out[p] = { status: res.status, sha256: sha(stable), bytes: Buffer.byteLength(stable) };
  }
  return out;
}

test('відповіді API для датасету Малина не змінились ні на байт', async () => {
  const actual = await snapshot();
  if (process.env.UPDATE_TRANSPORT_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
    fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as Golden;
  for (const [p, value] of Object.entries(actual)) {
    assert.equal(value.status, 200, `${p}: HTTP ${value.status}`);
    assert.ok(value.bytes >= 2, `${p}: порожня відповідь`);
  }
  assert.deepEqual(actual, golden);
});
