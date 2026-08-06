import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  formatLunchMenuText,
  getLunchDaySummary,
  parseLunchMenuPayload,
  todayKyivDate,
  upsertLunchMenuForToday,
} from '../lunch';
import { postTextToLunchGroup } from '../lunch-telegram';

export function createAdminLunchRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/admin/lunch/today', requireAdmin, async (_req, res) => {
    try {
      const summary = await getLunchDaySummary(prisma);
      res.json(summary);
    } catch (e) {
      console.error('[admin/lunch/today]', e);
      res.status(500).json({ error: 'Не вдалося завантажити день обідів' });
    }
  });

  /** Імпорт меню з JSON ChatGPT: { items:[{name,price}] } або raw string */
  r.post('/admin/lunch/menu', requireAdmin, async (req, res) => {
    try {
      const postToGroup = Boolean(req.body?.postToGroup);
      const rawPayload =
        req.body?.rawJson !== undefined
          ? req.body.rawJson
          : req.body?.items !== undefined
            ? { items: req.body.items }
            : req.body;

      const items = parseLunchMenuPayload(rawPayload);
      const parsedForStore =
        typeof rawPayload === 'string'
          ? (() => {
              try {
                return JSON.parse(rawPayload);
              } catch {
                return { items };
              }
            })()
          : rawPayload;

      const { day, menuItems } = await upsertLunchMenuForToday(prisma, items, parsedForStore);
      const text = formatLunchMenuText(menuItems);

      let posted = false;
      let queued = false;
      let postError: string | null = null;
      if (postToGroup) {
        try {
          const result = await postTextToLunchGroup(prisma, text);
          posted = result.ok && !result.queued;
          queued = result.queued;
          if (!result.ok) {
            postError = result.error || 'Не вдалося надіслати в групу';
          }
        } catch (e) {
          postError = e instanceof Error ? e.message : String(e);
        }
      }

      res.json({
        ok: true,
        day: {
          id: day.id,
          date: day.date.toISOString().slice(0, 10),
          status: day.status,
        },
        menuItems,
        preview: text,
        posted,
        queued,
        postError,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка імпорту меню';
      console.error('[admin/lunch/menu]', e);
      res.status(400).json({ error: msg });
    }
  });

  r.post('/admin/lunch/status', requireAdmin, async (req, res) => {
    try {
      const status = String(req.body?.status || '').trim();
      if (!['open', 'ordering', 'closed'].includes(status)) {
        res.status(400).json({ error: 'status: open | ordering | closed' });
        return;
      }
      const date = todayKyivDate();
      const day = await prisma.lunchDay.upsert({
        where: { date },
        create: { date, status },
        update: { status, updatedAt: new Date() },
      });
      res.json({
        ok: true,
        day: { id: day.id, date: day.date.toISOString().slice(0, 10), status: day.status },
      });
    } catch (e) {
      console.error('[admin/lunch/status]', e);
      res.status(500).json({ error: 'Не вдалося оновити статус' });
    }
  });

  /** Повторно надіслати поточне меню в групу */
  r.post('/admin/lunch/post-menu', requireAdmin, async (_req, res) => {
    try {
      const summary = await getLunchDaySummary(prisma);
      if (!summary.menuItems.length) {
        res.status(400).json({ error: 'Меню на сьогодні порожнє' });
        return;
      }
      const text = formatLunchMenuText(summary.menuItems);
      const result = await postTextToLunchGroup(prisma, text);
      res.json({
        ok: result.ok,
        queued: result.queued,
        preview: text,
        postError: result.ok ? null : result.error || 'Не вдалося надіслати',
      });
    } catch (e) {
      console.error('[admin/lunch/post-menu]', e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка посту' });
    }
  });

  return r;
}
