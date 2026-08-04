"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminReferralsRouter = createAdminReferralsRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const referral_1 = require("../referral");
const telegram_1 = require("../telegram");
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
     * Превʼю фото підтвердження поїздки (проксі з Telegram Bot API).
     * kind = start | end
     */
    r.get('/admin/referrals/proofs/:id/photo/:kind', require_admin_1.requireAdmin, async (req, res) => {
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
            const file = await (0, telegram_1.fetchTelegramFileById)(fileId);
            if (!file) {
                res.status(502).json({ error: 'Не вдалося завантажити фото з Telegram' });
                return;
            }
            res.setHeader('Content-Type', file.contentType);
            res.setHeader('Cache-Control', 'private, max-age=300');
            res.send(file.buffer);
        }
        catch (e) {
            console.error('❌ GET /admin/referrals/proofs/:id/photo:', e);
            res.status(500).json({ error: 'Помилка завантаження фото' });
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
            const clearFlag = status === 'approved' || status === 'pending';
            const reward = await prisma.referralReward.update({
                where: { id },
                data: {
                    status,
                    ...(body.payoutNote !== undefined ? { payoutNote: body.payoutNote } : {}),
                    ...(status === 'paid' ? { paidAt: new Date() } : {}),
                    ...(body.flagReason !== undefined
                        ? { flagReason: body.flagReason }
                        : clearFlag
                            ? { flagReason: null }
                            : {}),
                },
            });
            res.json(reward);
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/rewards/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити нагороду' });
        }
    });
    /**
     * Схвалити / відхилити підтвердження поїздки з фото.
     * При approve — повʼязані flagged нагороди → approved (у чергу виплат).
     * При reject — повʼязані нагороди → flagged з причиною відхилення.
     */
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
            const rejectionReason = typeof body.rejectionReason === 'string' && body.rejectionReason.trim()
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
                            select: { id: true, fullName: true, phoneNormalized: true, telegramUsername: true },
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
                    const unlocked = await tx.referralReward.updateMany({
                        where: { rideProofId: id, status: 'flagged' },
                        data: { status: 'approved', flagReason: null },
                    });
                    rewardsUnlocked = unlocked.count;
                    // Fallback: flagged без rideProofId, але по цьому пасажиру як referred
                    if (rewardsUnlocked === 0) {
                        const fallback = await tx.referralReward.updateMany({
                            where: {
                                referredPersonId: updated.personId,
                                status: 'flagged',
                                OR: [{ rideProofId: id }, { rideProofId: null }],
                            },
                            data: { status: 'approved', flagReason: null },
                        });
                        rewardsUnlocked = fallback.count;
                    }
                }
                else if (status === 'rejected') {
                    const reason = rejectionReason || 'Фото відхилено модератором';
                    await tx.referralReward.updateMany({
                        where: { rideProofId: id, status: { in: ['pending', 'approved', 'flagged'] } },
                        data: { status: 'flagged', flagReason: reason },
                    });
                }
                return { proof: updated, rewardsUnlocked };
            });
            res.json({ ...result.proof, rewardsUnlocked: result.rewardsUnlocked });
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/proofs/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити підтвердження' });
        }
    });
    return r;
}
