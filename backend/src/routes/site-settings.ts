/**
 * Налаштування сайту з адмінки (не лише «Доведе»). Поки — телефони «Зубастика» (`zubastyk-phones.ts`):
 * `GET /site/zubastyk-phones` — для всіх сторінок і збірки статичних (кеш 5 хв), `GET` / `PUT
 * /admin/site/zubastyk-phones` — власнику (`{ phones: [{ phone, note? }] }` або `{ reset: true }`).
 */
import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import { createZubastykPhonesStore, type ZubastykPhonesStore } from '../zubastyk-phones';

export function createSiteSettingsRouter(deps: { prisma: PrismaClient; zubastykPhones?: ZubastykPhonesStore }): Router {
  const store = deps.zubastykPhones ?? createZubastykPhonesStore(deps.prisma);
  // без спільного сховища (тести, інший процес) — прочитати базу один раз, при першому запиті
  let loaded: Promise<void> | null = deps.zubastykPhones ? Promise.resolve() : null;
  const ready = () => (loaded ??= store.refresh());
  const r = express.Router();

  r.get('/site/zubastyk-phones', async (_req, res) => {
    await ready();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ phones: store.view().phones });
  });

  r.get('/admin/site/zubastyk-phones', requireAdmin, async (_req, res) => {
    await ready();
    res.set('Cache-Control', 'private, no-store');
    res.json(store.view());
  });

  r.put('/admin/site/zubastyk-phones', requireAdmin, async (req, res) => {
    const b = (req.body ?? {}) as { phones?: unknown; reset?: unknown };
    if (b.reset !== true && !Array.isArray(b.phones)) {
      res.status(400).json({ error: 'потрібні phones: [{ phone, note? }] або reset: true' });
      return;
    }
    try {
      res.json(await store.set(b.reset === true ? null : b.phones));
    } catch (e) {
      if (e instanceof RangeError) {
        res.status(400).json({ error: e.message });
        return;
      }
      console.error('❌ PUT /admin/site/zubastyk-phones:', e);
      res.status(500).json({ error: 'Не вдалося зберегти' });
    }
  });

  return r;
}
