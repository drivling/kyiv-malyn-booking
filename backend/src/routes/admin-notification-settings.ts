import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  countSmsSendsThisMonth,
  countSmsSendsToday,
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettingsPatch,
} from '../notification-settings';

const TOKEN_HINT_PREFIX = '••••';

/** Маска замість токена — щоб не віддавати платний секрет у фронт. */
function maskSettings(s: Awaited<ReturnType<typeof getNotificationSettings>>) {
  const { turboSmsToken, ...rest } = s;
  return {
    ...rest,
    hasToken: !!turboSmsToken,
    tokenHint: turboSmsToken ? TOKEN_HINT_PREFIX + turboSmsToken.slice(-4) : null,
  };
}

/** Значення токена, яке НЕ треба записувати (порожнє / маска з GET). */
function isNoopTokenValue(v: unknown): boolean {
  if (v == null) return false; // null = явне очищення, це не no-op
  const s = String(v).trim();
  return s === '' || s.startsWith(TOKEN_HINT_PREFIX);
}

export function createAdminNotificationSettingsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.get('/admin/notification-settings', requireAdmin, async (_req, res) => {
    try {
      const s = await getNotificationSettings(prisma);
      res.json(maskSettings(s));
    } catch (e) {
      console.error('❌ GET /admin/notification-settings:', e);
      res.status(500).json({ error: 'Не вдалося прочитати налаштування сповіщень' });
    }
  });

  r.patch('/admin/notification-settings', requireAdmin, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: NotificationSettingsPatch = {};

      for (const key of [
        'smsFallbackEnabled',
        'smsMatchEnabled',
        'smsAuthorConfirmationEnabled',
        'smsBookingReminderEnabled',
        'smsInactivityReminderEnabled',
        'smsChannelPromoEnabled',
        'smsMatchTypeThreshold',
        'smsDailyCap',
        'smsMonthlyCap',
        'turboSmsSender',
      ] as const) {
        if (key in body) (patch as Record<string, unknown>)[key] = body[key];
      }

      // Токен пишемо лише коли надіслано реальне значення (не маска, не порожньо).
      if ('turboSmsToken' in body && !isNoopTokenValue(body.turboSmsToken)) {
        patch.turboSmsToken = body.turboSmsToken == null ? null : String(body.turboSmsToken).trim();
      }

      const updated = await updateNotificationSettings(prisma, patch);
      res.json(maskSettings(updated));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка налаштувань';
      console.error('[admin/notification-settings PATCH]', e);
      res.status(400).json({ error: msg });
    }
  });

  r.get('/admin/notification-settings/usage', requireAdmin, async (_req, res) => {
    try {
      const s = await getNotificationSettings(prisma);
      const [sentToday, sentThisMonth, recent] = await Promise.all([
        countSmsSendsToday(prisma),
        countSmsSendsThisMonth(prisma),
        prisma.smsSendLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            phoneNormalized: true,
            useCase: true,
            channel: true,
            status: true,
            segments: true,
            errorText: true,
            createdAt: true,
            sentAt: true,
          },
        }),
      ]);
      res.json({
        sentToday,
        capToday: s.smsDailyCap,
        sentThisMonth,
        capThisMonth: s.smsMonthlyCap,
        recent,
      });
    } catch (e) {
      console.error('❌ GET /admin/notification-settings/usage:', e);
      res.status(500).json({ error: 'Не вдалося прочитати статистику відправок' });
    }
  });

  return r;
}
