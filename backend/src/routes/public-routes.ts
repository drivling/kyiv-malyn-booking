import express, { type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

/**
 * OpenAPI 3.1 публічних ендпоінтів (Docs/transport-open-protocols-2026-10.md, фаза 2). Файл лежить у
 * `backend/openapi/` — однаковий відносний шлях із `src/routes` (ts-node, vitest) і з `dist/routes` (прод).
 */
export const OPENAPI_PUBLIC_PATH = path.resolve(__dirname, '../../openapi/public.yaml');

export function createPublicRoutesRouter(options: { codeVersion: string }): Router {
  const r = express.Router();
  const { codeVersion } = options;
  let openapiYaml: string | null = null;

  r.get('/health', (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.json({
      status: 'ok',
      version: 3,
      viber: true,
      codeVersion,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
      cwd: process.cwd(),
    });
  });

  /** Машинний опис публічного API; канонічна адреса — https://malin.kiev.ua/openapi.yaml (302 сюди) */
  r.get('/openapi.yaml', (_req, res) => {
    try {
      if (openapiYaml == null) openapiYaml = fs.readFileSync(OPENAPI_PUBLIC_PATH, 'utf8');
    } catch (e) {
      console.error('[GET /openapi.yaml] cannot read', OPENAPI_PUBLIC_PATH, e);
      res.status(500).json({ error: 'OpenAPI document is unavailable' });
      return;
    }
    res.set({ 'Content-Type': 'application/yaml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.send(openapiYaml);
  });

  r.get('/status', (_req, res) => {
    res.json({
      status: 'ok',
      version: 3,
      viber: true,
      codeVersion,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
      cwd: process.cwd(),
    });
  });

  return r;
}
