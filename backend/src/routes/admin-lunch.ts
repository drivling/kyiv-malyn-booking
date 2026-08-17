import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  formatLunchMenuText,
  formatLunchTotalsComment,
  getLunchDaySummary,
  getLunchSettings,
  parseLunchMenuPayload,
  recordLunchPayment,
  todayKyivDate,
  updateLunchDish,
  updateLunchOrder,
  updateLunchTrayPrice,
  upsertLunchMenuForToday,
} from '../lunch';
import { postTextToLunchGroup } from '../lunch-telegram';
import { reparseLunchToday } from '../lunch-reparse';

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

      const { day, menuItems, notices } = await upsertLunchMenuForToday(
        prisma,
        items,
        parsedForStore
      );
      const settings = await getLunchSettings(prisma);
      const text = formatLunchMenuText(menuItems, settings.trayPriceUah);

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

      for (const n of notices) {
        const msg = `${n.displayName}, сьогодні немає: ${n.missingDishes.join(', ')}.`;
        try {
          await postTextToLunchGroup(prisma, msg, {
            replyToMessageId: n.sourceMessageId,
          });
        } catch (e) {
          console.error('[admin/lunch/menu] unavailable notice', e);
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
        notices,
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
      const text = formatLunchMenuText(summary.menuItems, summary.trayPriceUah);
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

  /** Знову розібрати повідомлення групи за сьогодні (замовлення / оплати / підсумок) */
  r.post('/admin/lunch/reparse', requireAdmin, async (_req, res) => {
    try {
      const result = await reparseLunchToday(prisma);
      if (!result.ok) {
        res.status(500).json({ error: result.error || 'Reparse failed', ...result });
        return;
      }
      const summary = await getLunchDaySummary(prisma);
      res.json({ ok: true, reparse: result, summary });
    } catch (e) {
      console.error('[admin/lunch/reparse]', e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка reparse' });
    }
  });

  /** Позначити оплату (за замовч. — весь борг учасника) */
  r.post('/admin/lunch/pay', requireAdmin, async (req, res) => {
    try {
      const participantId = Number(req.body?.participantId);
      const amountRaw = req.body?.amountUah;
      const amountUah =
        amountRaw === undefined || amountRaw === null || amountRaw === ''
          ? undefined
          : Number(amountRaw);
      if (!Number.isFinite(participantId) || participantId <= 0) {
        res.status(400).json({ error: 'participantId обовʼязковий' });
        return;
      }
      const pay = await recordLunchPayment(prisma, {
        participantId,
        amountUah,
        rawText: 'admin',
      });
      const summary = await getLunchDaySummary(prisma);
      res.json({ ok: true, payment: pay, summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка оплати';
      console.error('[admin/lunch/pay]', e);
      res.status(400).json({ error: msg });
    }
  });

  /**
   * Ручне редагування замовлення: замінити рядки на позиції меню,
   * оновити unmatchedText. rawText (оригінал) не змінюється.
   * Підправляє нашу відповідь у групі, якщо є replyMessageId.
   */
  r.patch('/admin/lunch/orders/:id', requireAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Некоректний id замовлення' });
        return;
      }
      const menuItemIds = Array.isArray(req.body?.menuItemIds)
        ? req.body.menuItemIds.map((x: unknown) => Number(x))
        : [];
      const lines = Array.isArray(req.body?.lines)
        ? (
            req.body.lines as Array<{
              dishId?: unknown;
              menuItemId?: unknown;
              asWritten?: unknown;
              qty?: unknown;
            }>
          ).map((l) => ({
            dishId: l.dishId != null && l.dishId !== '' ? Number(l.dishId) : undefined,
            menuItemId: l.menuItemId != null && l.menuItemId !== '' ? Number(l.menuItemId) : undefined,
            asWritten: l.asWritten != null ? String(l.asWritten) : '',
            qty: l.qty != null ? Number(l.qty) : 1,
          }))
        : undefined;
      const unmatchedText =
        req.body?.unmatchedText === undefined ? undefined : req.body.unmatchedText;
      const trayCount =
        req.body?.trayCount === undefined || req.body?.trayCount === null || req.body?.trayCount === ''
          ? null
          : Number(req.body.trayCount);
      const updated = await updateLunchOrder(prisma, orderId, {
        menuItemIds,
        lines,
        unmatchedText,
        trayCount,
      });

      let telegramQueued = false;
      let telegramError: string | null = null;
      if (updated.replyMessageId) {
        const result = await postTextToLunchGroup(prisma, updated.confirmText, {
          kind: 'edit',
          telegramMessageId: updated.replyMessageId,
        });
        telegramQueued = result.queued;
        if (!result.ok) telegramError = result.error || 'Не вдалося підправити відповідь у групі';
      } else if (updated.sourceMessageId) {
        const result = await postTextToLunchGroup(prisma, updated.confirmText, {
          replyToMessageId: updated.sourceMessageId,
        });
        telegramQueued = result.queued;
        if (!result.ok) telegramError = result.error || 'Не вдалося надіслати уточнення в групу';
      }

      const summary = await getLunchDaySummary(prisma);
      res.json({
        ok: true,
        summary,
        telegramQueued,
        telegramError,
        hasReply: Boolean(updated.replyMessageId),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка оновлення замовлення';
      console.error('[admin/lunch/orders]', e);
      res.status(400).json({ error: msg });
    }
  });

  r.patch('/admin/lunch/dishes/:id', requireAdmin, async (req, res) => {
    try {
      const dishId = Number(req.params.id);
      if (!Number.isFinite(dishId) || dishId <= 0) {
        res.status(400).json({ error: 'Некоректний id страви' });
        return;
      }
      await updateLunchDish(prisma, dishId, {
        priceUah: req.body?.priceUah !== undefined ? Number(req.body.priceUah) : undefined,
        trayRole: req.body?.trayRole != null ? String(req.body.trayRole) : undefined,
      });
      const summary = await getLunchDaySummary(prisma);
      res.json({ ok: true, summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка оновлення страви';
      console.error('[admin/lunch/dishes]', e);
      res.status(400).json({ error: msg });
    }
  });

  r.patch('/admin/lunch/settings', requireAdmin, async (req, res) => {
    try {
      const trayPriceUah = Number(req.body?.trayPriceUah);
      await updateLunchTrayPrice(prisma, trayPriceUah);
      const summary = await getLunchDaySummary(prisma);
      res.json({ ok: true, summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка налаштувань';
      console.error('[admin/lunch/settings]', e);
      res.status(400).json({ error: msg });
    }
  });

  /** Пост «підсумку» в групу: імʼя, страви, лотки, сума */
  r.post('/admin/lunch/post-totals', requireAdmin, async (_req, res) => {
    try {
      const summary = await getLunchDaySummary(prisma);
      if (!summary.orders.length) {
        res.status(400).json({ error: 'Немає замовлень на сьогодні' });
        return;
      }
      const text = formatLunchTotalsComment(
        summary.orders as Array<{
          displayName: string;
          totalUah: number;
          trayCount?: number;
          trayTotalUah?: number;
          rawText?: string;
          lines: Array<{
            rawName: string;
            menuItemName?: string | null;
            menuItemId?: number | null;
            qty?: number;
            unitPriceUah?: number;
            lineTotalUah?: number;
            unavailable?: boolean;
          }>;
        }>,
        summary.menuItems,
        summary.trayPriceUah
      );
      const result = await postTextToLunchGroup(prisma, text);
      res.json({
        ok: result.ok,
        queued: result.queued,
        preview: text,
        postError: result.ok ? null : result.error || 'Не вдалося надіслати',
      });
    } catch (e) {
      console.error('[admin/lunch/post-totals]', e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка посту' });
    }
  });

  return r;
}
