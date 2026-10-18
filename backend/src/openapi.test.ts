/**
 * OpenAPI публічного API (openapi/public.yaml, Docs/transport-open-protocols-2026-10.md, фаза 2): документ парситься,
 * це OpenAPI 3.1 з відповідями на кожній операції, кожен шлях з yaml існує серед роутів createApp, і навпаки —
 * кожен публічний ендпоінт із явного списку описаний. GET /openapi.yaml віддає файл як yaml із кешем на годину.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import { parse } from 'yaml';
import type { PrismaClient } from '@prisma/client';
import { createApp, getRegisteredRoutes } from './create-app';
import { OPENAPI_PUBLIC_PATH } from './routes/public-routes';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/**
 * Публічні ендпоінти бекенду, які мають бути в yaml. Новий публічний ендпоінт → рядок сюди і операція в yaml;
 * адмінські (`requireAdmin`, `/admin/*`) і `/user/*` (чекають перевірки підпису Telegram Login) — не публічні.
 */
const PUBLIC_ENDPOINTS = [
  'GET /health',
  'GET /openapi.yaml',
  'GET /transport/dataset',
  'GET /transport/gtfs.zip',
  'GET /transport/gtfs/:file',
  'POST /transport/sticker-scans',
  'POST /transport/sticker-returns',
  'POST /transport/arrival-reports',
  'GET /trip-points',
  'GET /viber-listings',
  'GET /viber-listings/search',
  'GET /viber-listings/:id/contact',
  'GET /poputky/search',
];

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string; license?: { name: string; url?: string } };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  components?: { schemas?: Record<string, unknown> };
};

function loadDoc(): OpenApiDoc {
  return parse(fs.readFileSync(OPENAPI_PUBLIC_PATH, 'utf8')) as OpenApiDoc;
}

/** `/transport/gtfs/{file}` → `/transport/gtfs/:file` — форма Express у getRegisteredRoutes */
const toExpress = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

function app() {
  return createApp({ prisma: {} as unknown as PrismaClient, adminPassword: 'openapi-test' });
}

test('public.yaml is OpenAPI 3.1 with license, server and a response set on every operation', () => {
  const doc = loadDoc();
  assert.match(doc.openapi, /^3\.1\.\d+$/);
  assert.equal(doc.info.license?.name, 'OwnNet Source License 1.1');
  assert.equal(doc.servers[0].url, 'https://kyiv-malyn-booking-production.up.railway.app');
  const operationIds = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    assert.ok(path.startsWith('/'), path);
    const ops = Object.entries(item).filter(([m]) => (HTTP_METHODS as readonly string[]).includes(m));
    assert.ok(ops.length > 0, `${path}: no operations`);
    for (const [method, op] of ops) {
      assert.ok(op.responses && Object.keys(op.responses).length > 0, `${method.toUpperCase()} ${path}: no responses`);
      assert.ok(op.operationId, `${method.toUpperCase()} ${path}: no operationId`);
      assert.ok(!operationIds.has(op.operationId!), `duplicate operationId ${op.operationId}`);
      operationIds.add(op.operationId!);
    }
  }
});

test('every $ref in public.yaml points at an existing component', () => {
  const raw = fs.readFileSync(OPENAPI_PUBLIC_PATH, 'utf8');
  const doc = parse(raw) as Record<string, any>;
  const refs = [...raw.matchAll(/\$ref:\s*'#\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(refs.length > 20, 'refs expected');
  for (const ref of refs) {
    let node: any = doc;
    for (const part of ref.split('/')) node = node?.[part];
    assert.ok(node, `unresolved $ref #/${ref}`);
  }
});

test('every path in public.yaml is a registered route, and every public endpoint is in public.yaml', () => {
  const doc = loadDoc();
  const registered = new Set(getRegisteredRoutes(app()));
  const documented = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item)) {
      if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
      const key = `${method.toUpperCase()} ${toExpress(path)}`;
      documented.add(key);
      assert.ok(registered.has(key), `${key} is documented but not registered in createApp`);
    }
  }
  for (const key of PUBLIC_ENDPOINTS) {
    assert.ok(registered.has(key), `${key} is not registered — update PUBLIC_ENDPOINTS`);
    assert.ok(documented.has(key), `${key} is public but missing from openapi/public.yaml`);
  }
});

test('getRegisteredRoutes keeps the mount prefix of app.use(prefix, router)', () => {
  const routes = getRegisteredRoutes(app());
  assert.ok(routes.includes('GET /poputky/search'), routes.filter((r) => r.includes('search')).join(', '));
  assert.ok(!routes.includes('GET /search'));
  assert.ok(routes.includes('GET /health'));
});

test('GET /openapi.yaml serves the document as yaml with an hour of cache', async () => {
  const res = await request(app()).get('/openapi.yaml').expect(200);
  assert.match(res.headers['content-type'], /^application\/yaml; charset=utf-8/);
  assert.equal(res.headers['cache-control'], 'public, max-age=3600');
  assert.ok(res.text.startsWith('openapi: 3.1'));
  assert.deepEqual(parse(res.text).paths['/transport/gtfs.zip'].get.operationId, 'getGtfsFeed');
});
