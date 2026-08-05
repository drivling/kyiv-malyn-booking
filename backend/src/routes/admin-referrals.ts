import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import {
  buildAdminReferralReport,
  buildPayoutsCsv,
  findUnlockableFlaggedRewardIds,
  getPersonReferralDetails,
  getReferralBudgetStatus,
  listReferralInvites,
  markReferralPayout,
  searchReferralPersons,
  setReferralBudgetUah,
  syncFlaggedRewardsForApprovedProofs,
  undoReferralPayout,
  withAdminManualFlagReason,
  REWARD_STATUS_APPROVED,
  REWARD_STATUS_FLAGGED,
  REWARD_STATUS_HOLD,
  REWARD_STATUSES_UNPAID,
} from '../referral';
import { fetchTelegramFileById, sendTelegramHtmlToChat } from '../telegram';

export function createAdminReferralsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  /** Повний звіт по реферальній програмі (нагороди, виплати, flagged, фото) */
  r.get('/admin/referrals/report', requireAdmin, async (_req, res) => {
    try {
      const report = await buildAdminReferralReport(prisma);
      res.json(report);
    } catch (e) {
      console.error('❌ GET /admin/referrals/report:', e);
      res.status(500).json({ error: 'Не вдалося сформувати звіт' });
    }
  });

  /**
   * Підтягнути hold/flagged нагороди по вже схвалених фото у чергу виплат.
   * Раніше це робив GET звіту — тепер явна кнопка.
   */
  r.post('/admin/referrals/sync-approved', requireAdmin, async (_req, res) => {
    try {
      const unlocked = await syncFlaggedRewardsForApprovedProofs(prisma);
      res.json({ unlocked });
    } catch (e) {
      console.error('❌ POST /admin/referrals/sync-approved:', e);
      res.status(500).json({ error: 'Не вдалося синхронізувати нагороди' });
    }
  });

  /** CSV виплат (approved + paid) для звірки з поповненнями */
  r.get('/admin/referrals/payouts.csv', requireAdmin, async (_req, res) => {
    try {
      const csv = await buildPayoutsCsv(prisma);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="referral-payouts.csv"');
      res.send(csv);
    } catch (e) {
      console.error('❌ GET /admin/referrals/payouts.csv:', e);
      res.status(500).json({ error: 'Не вдалося сформувати CSV' });
    }
  });

  /** Сторінка запрошень */
  r.get('/admin/referrals/invites', requireAdmin, async (req, res) => {
    try {
      const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);
      const take = Math.min(Math.max(parseInt(String(req.query.take ?? '30'), 10) || 30, 1), 200);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      res.json(await listReferralInvites(prisma, { skip, take, status: status || undefined }));
    } catch (e) {
      console.error('❌ GET /admin/referrals/invites:', e);
      res.status(500).json({ error: 'Не вдалося завантажити запрошення' });
    }
  });

  /** Пошук людей (отримувачі й запрошені) */
  r.get('/admin/referrals/persons/search', requireAdmin, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json({ items: await searchReferralPersons(prisma, q) });
    } catch (e) {
      console.error('❌ GET /admin/referrals/persons/search:', e);
      res.status(500).json({ error: 'Не вдалося виконати пошук' });
    }
  });

  /** Граф / деталі людини: хто привів, кого привела, нагороди */
  r.get('/admin/referrals/persons/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Невірний id' });
        return;
      }
      const details = await getPersonReferralDetails(prisma, id);
      if (!details) {
        res.status(404).json({ error: 'Людину не знайдено' });
        return;
      }
      res.json(details);
    } catch (e) {
      console.error('❌ GET /admin/referrals/persons/:id:', e);
      res.status(500).json({ error: 'Не вдалося завантажити деталі' });
    }
  });

  /** Поточний бюджет акції та скільки з нього витрачено */
  r.get('/admin/referrals/budget', requireAdmin, async (_req, res) => {
    try {
      res.json(await getReferralBudgetStatus(prisma));
    } catch (e) {
      console.error('❌ GET /admin/referrals/budget:', e);
      res.status(500).json({ error: 'Не вдалося прочитати бюджет' });
    }
  });

  /**
   * Змінити бюджет акції. Якщо підняли — нагороди, що тепер вкладаються,
   * знімаються з бюджетного утримання (статус лишається hold).
   */
  r.patch('/admin/referrals/budget', requireAdmin, async (req, res) => {
    try {
      const raw = Number((req.body as { budgetUah?: number } | undefined)?.budgetUah);
      if (!Number.isInteger(raw) || raw < 0 || raw > 10_000_000) {
        res.status(400).json({ error: 'budgetUah: ціле число від 0 до 10000000' });
        return;
      }
      const result = await setReferralBudgetUah(prisma, raw);
      const status = await getReferralBudgetStatus(prisma);
      res.json({ ...status, releasedCount: result.releasedCount, releasedUah: result.releasedUah });
    } catch (e) {
      console.error('❌ PATCH /admin/referrals/budget:', e);
      res.status(500).json({ error: 'Не вдалося змінити бюджет' });
    }
  });

  /**
   * Превʼю фото підтвердження поїздки (проксі з Telegram Bot API).
   * kind = start | end
   */
  r.get('/admin/referrals/proofs/:id/photo/:kind', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const kind = String(req.params.kind || '').trim().toLowerCase();
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Невірний id' });
        return;
      }
      if (kind !== 'start' && kind !== 'end') {
        res.status(400).json({ error: 'kind: start | end' });
        return;
      }
      const proof = await prisma.rideCompletionProof.findUnique({
        where: { id },
        select: { photoStartFileId: true, photoEndFileId: true },
      });
      if (!proof) {
        res.status(404).json({ error: 'Підтвердження не знайдено' });
        return;
      }
      const fileId = kind === 'start' ? proof.photoStartFileId : proof.photoEndFileId;
      if (!fileId) {
        res.status(404).json({ error: 'Фото ще немає' });
        return;
      }
      const file = await fetchTelegramFileById(fileId);
      if (!file) {
        res.status(502).json({ error: 'Не вдалося завантажити фото з Telegram' });
        return;
      }
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(file.buffer);
    } catch (e) {
      console.error('❌ GET /admin/referrals/proofs/:id/photo:', e);
      res.status(500).json({ error: 'Помилка завантаження фото' });
    }
  });

  /**
   * Позначити виплату людині: усі pending/approved (або вибрані rewardIds) → paid.
   * Body: { personId, rewardIds?, note? }
   */
  r.post('/admin/referrals/payouts', requireAdmin, async (req, res) => {
    try {
      const body = (req.body || {}) as {
        personId?: number;
        rewardIds?: number[];
        note?: string | null;
      };
      const personId = Number(body.personId);
      if (!Number.isInteger(personId) || personId <= 0) {
        res.status(400).json({ error: 'Потрібен personId' });
        return;
      }
      const rewardIds = Array.isArray(body.rewardIds)
        ? body.rewardIds.filter((id) => Number.isInteger(id) && id > 0)
        : undefined;
      const result = await markReferralPayout(prisma, {
        personId,
        rewardIds,
        note: typeof body.note === 'string' ? body.note : null,
      });
      if (result.updatedCount === 0) {
        res.status(400).json({ error: 'Немає нагород до виплати для цієї людини' });
        return;
      }
      res.json(result);
    } catch (e) {
      console.error('❌ POST /admin/referrals/payouts:', e);
      res.status(500).json({ error: 'Не вдалося позначити виплату' });
    }
  });

  /**
   * Скасувати виплату (помилково натиснули «Виплатив»): paid → approved.
   * Body: { rewardIds: number[] }
   */
  r.post('/admin/referrals/payouts/undo', requireAdmin, async (req, res) => {
    try {
      const rewardIds = Array.isArray((req.body as { rewardIds?: number[] })?.rewardIds)
        ? (req.body as { rewardIds: number[] }).rewardIds.filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (rewardIds.length === 0) {
        res.status(400).json({ error: 'Потрібен rewardIds' });
        return;
      }
      const result = await undoReferralPayout(prisma, rewardIds);
      if (result.updatedCount === 0) {
        res.status(400).json({ error: 'Немає виплачених нагород серед переданих id' });
        return;
      }
      res.json(result);
    } catch (e) {
      console.error('❌ POST /admin/referrals/payouts/undo:', e);
      res.status(500).json({ error: 'Не вдалося скасувати виплату' });
    }
  });

  /** Оновити статус нагороди: pending | approved | paid | flagged */
  r.patch('/admin/referrals/rewards/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Невірний id' });
        return;
      }
      const body = (req.body || {}) as {
        status?: string;
        flagReason?: string | null;
        payoutNote?: string | null;
      };
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      if (![REWARD_STATUS_HOLD, 'pending', REWARD_STATUS_APPROVED, 'paid', REWARD_STATUS_FLAGGED].includes(status)) {
        res.status(400).json({ error: 'status: hold | approved | paid | flagged' });
        return;
      }
      const clearFlag = status === REWARD_STATUS_APPROVED || status === REWARD_STATUS_HOLD || status === 'pending';
      const flagReason =
        status === 'flagged'
          ? withAdminManualFlagReason(
              typeof body.flagReason === 'string' ? body.flagReason : 'Підозріла активність'
            )
          : body.flagReason !== undefined
            ? body.flagReason
            : clearFlag
              ? null
              : undefined;
      const reward = await prisma.referralReward.update({
        where: { id },
        data: {
          status,
          ...(body.payoutNote !== undefined ? { payoutNote: body.payoutNote } : {}),
          ...(status === 'paid' ? { paidAt: new Date() } : {}),
          ...(flagReason !== undefined ? { flagReason } : {}),
        },
      });
      res.json(reward);
    } catch (e) {
      console.error('❌ PATCH /admin/referrals/rewards/:id:', e);
      res.status(500).json({ error: 'Не вдалося оновити нагороду' });
    }
  });

  /**
   * Схвалити / відхилити підтвердження поїздки з фото.
   * При approve — повʼязані flagged нагороди → approved (у чергу виплат).
   * При reject — повʼязані нагороди → flagged з причиною відхилення.
   */
  r.patch('/admin/referrals/proofs/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Невірний id' });
        return;
      }
      const body = (req.body || {}) as { status?: string; rejectionReason?: string | null };
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      if (!['pending_review', 'approved', 'rejected', 'flagged'].includes(status)) {
        res.status(400).json({ error: 'status: pending_review | approved | rejected | flagged' });
        return;
      }

      const rejectionReason =
        typeof body.rejectionReason === 'string' && body.rejectionReason.trim()
          ? body.rejectionReason.trim()
          : null;

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.rideCompletionProof.update({
          where: { id },
          data: {
            status,
            ...(body.rejectionReason !== undefined ? { rejectionReason } : {}),
            ...(status === 'approved' ? { flagReason: null, rejectionReason: null } : {}),
            ...(status === 'rejected' && rejectionReason
              ? { rejectionReason, flagReason: rejectionReason }
              : {}),
          },
          include: {
            person: {
              select: {
                id: true,
                fullName: true,
                phoneNormalized: true,
                telegramUsername: true,
                telegramChatId: true,
              },
            },
            referralRewards: {
              select: {
                id: true,
                rewardType: true,
                amountUah: true,
                status: true,
                flagReason: true,
                referrerId: true,
                referrer: { select: { id: true, fullName: true, phoneNormalized: true } },
              },
            },
          },
        });

        let rewardsUnlocked = 0;
        if (status === 'approved') {
          const unlockIds = await findUnlockableFlaggedRewardIds(tx, {
            proofId: id,
            personId: updated.personId,
          });
          if (unlockIds.length > 0) {
            const unlocked = await tx.referralReward.updateMany({
              where: { id: { in: unlockIds } },
              data: { status: REWARD_STATUS_APPROVED, flagReason: null },
            });
            rewardsUnlocked = unlocked.count;
          }
        } else if (status === 'rejected') {
          const reason = rejectionReason || 'Фото відхилено модератором';
          await tx.referralReward.updateMany({
            where: { rideProofId: id, status: { in: REWARD_STATUSES_UNPAID } },
            data: { status: REWARD_STATUS_FLAGGED, flagReason: reason },
          });
        }

        return { proof: updated, rewardsUnlocked };
      });

      const routeNice = result.proof.route.replace(/-/g, ' → ');
      const dateKey = result.proof.rideDate.toISOString().slice(0, 10);
      let notifyBlocked = 0;
      let notifySent = 0;

      if (status === 'rejected') {
        const chatId = result.proof.person.telegramChatId?.trim();
        if (chatId) {
          const reason =
            (typeof body.rejectionReason === 'string' && body.rejectionReason.trim()) ||
            result.proof.rejectionReason ||
            'Фото не прийнято';
          const escaped = reason
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          const sendResult = await sendTelegramHtmlToChat(
            chatId,
            '❌ <b>Фото підтвердження поїздки відхилено</b>\n\n' +
              `${routeNice} · ${dateKey}\n` +
              `Причина: <i>${escaped}</i>\n\n` +
              'Можете надіслати <b>нові фото</b>: команда /confirmride → оберіть ту саму поїздку.\n' +
              'Після перевірки бонуси знову розглянемо.',
            {
              personId: result.proof.person.id,
              normalizedPhone: result.proof.person.phoneNormalized,
            }
          );
          if (sendResult.ok) notifySent += 1;
          if (sendResult.blocked) notifyBlocked += 1;
        }
      } else if (status === 'approved') {
        // Повідомити кожного отримувача нагород по цій заявці з конкретною сумою (грн)
        const payable = await prisma.referralReward.findMany({
          where: {
            rideProofId: id,
            status: REWARD_STATUS_APPROVED,
          },
          select: {
            amountUah: true,
            rewardType: true,
            referrerId: true,
            referrer: {
              select: {
                id: true,
                fullName: true,
                phoneNormalized: true,
                telegramChatId: true,
              },
            },
          },
        });

        const byPerson = new Map<
          number,
          {
            uah: number;
            count: number;
            chatId: string | null;
            phone: string;
            isPassenger: boolean;
          }
        >();
        for (const r of payable) {
          const prev = byPerson.get(r.referrerId);
          if (prev) {
            prev.uah += r.amountUah;
            prev.count += 1;
          } else {
            byPerson.set(r.referrerId, {
              uah: r.amountUah,
              count: 1,
              chatId: r.referrer.telegramChatId?.trim() || null,
              phone: r.referrer.phoneNormalized,
              isPassenger: r.referrerId === result.proof.personId,
            });
          }
        }

        // Якщо нагород ще немає (не реферал) — все одно подякувати пасажиру за фото
        if (byPerson.size === 0) {
          const chatId = result.proof.person.telegramChatId?.trim();
          if (chatId) {
            const sendResult = await sendTelegramHtmlToChat(
              chatId,
              '✅ <b>Фото підтвердження поїздки схвалено</b>\n\n' +
                `${routeNice} · ${dateKey}\n` +
                'Дякуємо, що підтвердили поїздку!',
              {
                personId: result.proof.person.id,
                normalizedPhone: result.proof.person.phoneNormalized,
              }
            );
            if (sendResult.ok) notifySent += 1;
            if (sendResult.blocked) notifyBlocked += 1;
          }
        } else {
          for (const [personId, info] of byPerson) {
            if (!info.chatId) continue;
            const html =
              '✅ <b>Бонус підтверджено</b>\n\n' +
              `${routeNice} · ${dateKey}\n` +
              (info.isPassenger
                ? 'Ваші фото поїздки схвалено.\n'
                : 'Поїздку вашого друга підтверджено фото.\n') +
              `💸 До виплати (поповнення мобільного): <b>${info.uah} грн</b>` +
              (info.count > 1 ? ` (${info.count} нагород)` : '') +
              '\n\nОчікуйте поповнення — адмін обробить чергу виплат.';
            const sendResult = await sendTelegramHtmlToChat(info.chatId, html, {
              personId,
              normalizedPhone: info.phone,
            });
            if (sendResult.ok) notifySent += 1;
            if (sendResult.blocked) notifyBlocked += 1;
          }
        }
      }

      res.json({
        ...result.proof,
        rewardsUnlocked: result.rewardsUnlocked,
        notifySent,
        notifyBlocked,
      });
    } catch (e) {
      console.error('❌ PATCH /admin/referrals/proofs/:id:', e);
      res.status(500).json({ error: 'Не вдалося оновити підтвердження' });
    }
  });

  return r;
}
