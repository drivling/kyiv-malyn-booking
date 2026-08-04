import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import { buildAdminReferralReport } from '../referral';

export function createAdminReferralsRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  /** Повний звіт по реферальній програмі (нагороди, flagged/чит, запрошення, фото для реклами) */
  r.get('/admin/referrals/report', requireAdmin, async (_req, res) => {
    try {
      const report = await buildAdminReferralReport(prisma);
      res.json(report);
    } catch (e) {
      console.error('❌ GET /admin/referrals/report:', e);
      res.status(500).json({ error: 'Не вдалося сформувати звіт' });
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
      const body = (req.body || {}) as { status?: string; flagReason?: string | null };
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      if (!['pending', 'approved', 'paid', 'flagged'].includes(status)) {
        res.status(400).json({ error: 'status: pending | approved | paid | flagged' });
        return;
      }
      const reward = await prisma.referralReward.update({
        where: { id },
        data: {
          status,
          ...(body.flagReason !== undefined ? { flagReason: body.flagReason } : {}),
          ...(status === 'paid' ? { paidAt: new Date() } : {}),
        },
      });
      res.json(reward);
    } catch (e) {
      console.error('❌ PATCH /admin/referrals/rewards/:id:', e);
      res.status(500).json({ error: 'Не вдалося оновити нагороду' });
    }
  });

  /** Схвалити / відхилити підтвердження поїздки з фото */
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
      const proof = await prisma.rideCompletionProof.update({
        where: { id },
        data: {
          status,
          ...(body.rejectionReason !== undefined ? { rejectionReason: body.rejectionReason } : {}),
        },
      });
      res.json(proof);
    } catch (e) {
      console.error('❌ PATCH /admin/referrals/proofs/:id:', e);
      res.status(500).json({ error: 'Не вдалося оновити підтвердження' });
    }
  });

  return r;
}
