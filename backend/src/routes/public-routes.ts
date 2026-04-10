import express, { type Router } from 'express';
import fs from 'fs';
import path from 'path';

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

  r.get('/localtransport/data', (_req, res) => {
    try {
      const dataDir = path.join(__dirname, '..', '..', 'localtransport-data');
      const transportPath = path.join(dataDir, 'malyn_transport.json');
      const coordsPath = path.join(dataDir, 'stops_coords.json');
      const segmentsPath = path.join(dataDir, 'segmentDurations.json');

      const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
      const coords = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
      const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf8'));

      res.set({
        'Cache-Control': 'public, max-age=300',
      });
      res.json({
        transport,
        coords,
        segments,
      });
    } catch (error) {
      console.error('❌ /localtransport/data error:', error);
      res.status(500).json({ error: 'Failed to load local transport data' });
    }
  });

  return r;
}
