import express, { type Router } from 'express';

export function createPublicRoutesRouter(options: { codeVersion: string }): Router {
  const r = express.Router();
  const { codeVersion } = options;

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
