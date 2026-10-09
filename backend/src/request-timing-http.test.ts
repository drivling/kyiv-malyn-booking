import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestTiming } from './middleware/request-timing';

describe('requestTiming middleware', () => {
  it('adds X-Response-Time and logs one line per request', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = express();
    app.use(requestTiming({ log: true }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/x', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/x?y=1');
    expect(res.status).toBe(200);
    expect(res.headers['x-response-time']).toMatch(/^\d+(\.\d+)?ms$/);

    await request(app).get('/health');
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.startsWith('[http] GET /x 200 '))).toHaveLength(1);
    expect(lines.some((l) => l.includes('/health'))).toBe(false);
    logSpy.mockRestore();
  });
});
