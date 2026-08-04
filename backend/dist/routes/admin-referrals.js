"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminReferralsRouter = createAdminReferralsRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const referral_1 = require("../referral");
function createAdminReferralsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    /** Повний звіт по реферальній програмі (нагороди, виплати, flagged, фото) */
    r.get('/admin/referrals/report', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const report = await (0, referral_1.buildAdminReferralReport)(prisma);
            res.json(report);
        }
        catch (e) {
            console.error('❌ GET /admin/referrals/report:', e);
            res.status(500).json({ error: 'Не вдалося сформувати звіт' });
        }
    });
    /**
     * Позначити виплату людині: усі pending/approved (або вибрані rewardIds) → paid.
     * Body: { personId, rewardIds?, note? }
     */
    r.post('/admin/referrals/payouts', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body || {});
            const personId = Number(body.personId);
            if (!Number.isInteger(personId) || personId <= 0) {
                res.status(400).json({ error: 'Потрібен personId' });
                return;
            }
            const rewardIds = Array.isArray(body.rewardIds)
                ? body.rewardIds.filter((id) => Number.isInteger(id) && id > 0)
                : undefined;
            const result = await (0, referral_1.markReferralPayout)(prisma, {
                personId,
                rewardIds,
                note: typeof body.note === 'string' ? body.note : null,
            });
            if (result.updatedCount === 0) {
                res.status(400).json({ error: 'Немає нагород до виплати для цієї людини' });
                return;
            }
            res.json(result);
        }
        catch (e) {
            console.error('❌ POST /admin/referrals/payouts:', e);
            res.status(500).json({ error: 'Не вдалося позначити виплату' });
        }
    });
    /** Оновити статус нагороди: pending | approved | paid | flagged */
    r.patch('/admin/referrals/rewards/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const body = (req.body || {});
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
                    ...(body.payoutNote !== undefined ? { payoutNote: body.payoutNote } : {}),
                    ...(status === 'paid' ? { paidAt: new Date() } : {}),
                },
            });
            res.json(reward);
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/rewards/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити нагороду' });
        }
    });
    /** Схвалити / відхилити підтвердження поїздки з фото */
    r.patch('/admin/referrals/proofs/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const body = (req.body || {});
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
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/proofs/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити підтвердження' });
        }
    });
    return r;
}
