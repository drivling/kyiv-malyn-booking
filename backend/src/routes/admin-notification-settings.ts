import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  countSmsSendsThisMonth,
  countSmsSendsToday,
  getNotificationSettings,
  kyivDayStart,
  kyivMonthStart,
  updateNotificationSettings,
  type NotificationSettingsPatch,
} from '../notification-settings';
import { idDmGuard, idDmLimits } from '../telegram-user-dm-guard';

type Tally = { sent: number; failed: number };

/** Рядки groupBy → { ключ: { sent, failed } } */
function tally<K extends string>(rows: Array<Record<K, string> & { ok?: boolean; status?: string; _count: { _all: number } }>, key: K) {
  const out: Record<string, Tally> = {};
  for (const r of rows) {
    const t = (out[r[key]] ??= { sent: 0, failed: 0 });
    const ok = r.ok ?? (r.status === 'sent' || r.status === 'pending');
    if (ok) t.sent += r._count._all;
    else if (r.ok === false || r.status === 'failed') t.failed += r._count._all;
  }
  return out;
}

const sum = (m: Record<string, Tally>): Tally =>
  Object.values(m).reduce((a, t) => ({ sent: a.sent + t.sent, failed: a.failed + t.failed }), { sent: 0, failed: 0 });

/** Сесія особистого акаунта налаштована (те саме правило, що в telegram.ts) */
const telegramUserConfigured = () =>
  Boolean(process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim());

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
        'tgUserMatchEnabled',
        'tgUserAuthorConfirmationEnabled',
        'tgUserByIdEnabled',
        'tgUserByIdDailyCap',
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
      const dayStart = kyivDayStart();
      const monthStart = kyivMonthStart();
      const [sentToday, sentThisMonth, recent, smsMonth, tgToday, tgMonth, tgErrors] = await Promise.all([
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
        prisma.smsSendLog.groupBy({ by: ['useCase', 'status'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
        prisma.telegramUserSendLog.groupBy({ by: ['purpose', 'ok'], where: { createdAt: { gte: dayStart } }, _count: { _all: true } }),
        prisma.telegramUserSendLog.groupBy({ by: ['purpose', 'ok'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
        // без контакту: лише коли, як шукали і що відповів Telegram
        prisma.telegramUserSendError.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, contactType: true, errorCode: true, errorText: true, createdAt: true },
        }),
      ]);
      const byPurposeMonth = tally(tgMonth, 'purpose');
      const limits = idDmLimits(s);
      res.json({
        sentToday,
        capToday: s.smsDailyCap,
        sentThisMonth,
        capThisMonth: s.smsMonthlyCap,
        recent,
        smsByUseCase: tally(smsMonth, 'useCase'),
        telegramUser: {
          configured: telegramUserConfigured(),
          today: sum(tally(tgToday, 'purpose')),
          month: sum(byPurposeMonth),
          byPurpose: byPurposeMonth,
          byId: {
            enabled: limits.enabled,
            lockedBy: limits.lockedBy,
            cap: limits.cap,
            defaultCap: limits.defaultCap,
            usedToday: idDmGuard.used(),
            flooded: idDmGuard.tripped(),
          },
          recentErrors: tgErrors.map((e) => ({ ...e, errorText: (e.errorText ?? '').split('\n').filter(Boolean).pop()?.slice(0, 200) ?? null })),
        },
      });
    } catch (e) {
      console.error('❌ GET /admin/notification-settings/usage:', e);
      res.status(500).json({ error: 'Не вдалося прочитати статистику відправок' });
    }
  });

  return r;
}
