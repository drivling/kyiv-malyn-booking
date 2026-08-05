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
    /** Поточний бюджет акції та скільки з нього витрачено */
    r.get('/admin/referrals/budget', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.json(await (0, referral_1.getReferralBudgetStatus)(prisma));
        }
        catch (e) {
            console.error('❌ GET /admin/referrals/budget:', e);
            res.status(500).json({ error: 'Не вдалося прочитати бюджет' });
        }
    });
    /**
     * Змінити бюджет акції. Якщо підняли — нагороди, що тепер вкладаються,
     * знімаються з бюджетного утримання (статус лишається hold).
     */
    r.patch('/admin/referrals/budget', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const raw = Number(req.body?.budgetUah);
            if (!Number.isInteger(raw) || raw < 0 || raw > 10000000) {
                res.status(400).json({ error: 'budgetUah: ціле число від 0 до 10000000' });
                return;
            }
            const result = await (0, referral_1.setReferralBudgetUah)(prisma, raw);
            const status = await (0, referral_1.getReferralBudgetStatus)(prisma);
            res.json({ ...status, releasedCount: result.releasedCount, releasedUah: result.releasedUah });
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/budget:', e);
            res.status(500).json({ error: 'Не вдалося змінити бюджет' });
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
            if (![referral_1.REWARD_STATUS_HOLD, 'pending', referral_1.REWARD_STATUS_APPROVED, 'paid', referral_1.REWARD_STATUS_FLAGGED].includes(status)) {
                res.status(400).json({ error: 'status: hold | approved | paid | flagged' });
                return;
            }
            const clearFlag = status === referral_1.REWARD_STATUS_APPROVED || status === referral_1.REWARD_STATUS_HOLD || status === 'pending';
            const flagReason = status === 'flagged'
                ? (0, referral_1.withAdminManualFlagReason)(typeof body.flagReason === 'string' ? body.flagReason : 'Підозріла активність')
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
                    const unlockIds = await (0, referral_1.findUnlockableFlaggedRewardIds)(tx, {
                        proofId: id,
                        personId: updated.personId,
                    });
                    if (unlockIds.length > 0) {
                        const unlocked = await tx.referralReward.updateMany({
                            where: { id: { in: unlockIds } },
                            data: { status: referral_1.REWARD_STATUS_APPROVED, flagReason: null },
                        });
                        rewardsUnlocked = unlocked.count;
                    }
                }
                else if (status === 'rejected') {
                    const reason = rejectionReason || 'Фото відхилено модератором';
                    await tx.referralReward.updateMany({
                        where: { rideProofId: id, status: { in: referral_1.REWARD_STATUSES_UNPAID } },
                        data: { status: referral_1.REWARD_STATUS_FLAGGED, flagReason: reason },
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
                    const reason = (typeof body.rejectionReason === 'string' && body.rejectionReason.trim()) ||
                        result.proof.rejectionReason ||
                        'Фото не прийнято';
                    const escaped = reason
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    const sendResult = await (0, telegram_1.sendTelegramHtmlToChat)(chatId, '❌ <b>Фото підтвердження поїздки відхилено</b>\n\n' +
                        `${routeNice} · ${dateKey}\n` +
                        `Причина: <i>${escaped}</i>\n\n` +
                        'Можете надіслати <b>нові фото</b>: команда /confirmride → оберіть ту саму поїздку.\n' +
                        'Після перевірки бонуси знову розглянемо.', {
                        personId: result.proof.person.id,
                        normalizedPhone: result.proof.person.phoneNormalized,
                    });
                    if (sendResult.ok)
                        notifySent += 1;
                    if (sendResult.blocked)
                        notifyBlocked += 1;
                }
            }
            else if (status === 'approved') {
                // Повідомити кожного отримувача нагород по цій заявці з конкретною сумою (грн)
                const payable = await prisma.referralReward.findMany({
                    where: {
                        rideProofId: id,
                        status: referral_1.REWARD_STATUS_APPROVED,
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
                const byPerson = new Map();
                for (const r of payable) {
                    const prev = byPerson.get(r.referrerId);
                    if (prev) {
                        prev.uah += r.amountUah;
                        prev.count += 1;
                    }
                    else {
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
                        const sendResult = await (0, telegram_1.sendTelegramHtmlToChat)(chatId, '✅ <b>Фото підтвердження поїздки схвалено</b>\n\n' +
                            `${routeNice} · ${dateKey}\n` +
                            'Дякуємо, що підтвердили поїздку!', {
                            personId: result.proof.person.id,
                            normalizedPhone: result.proof.person.phoneNormalized,
                        });
                        if (sendResult.ok)
                            notifySent += 1;
                        if (sendResult.blocked)
                            notifyBlocked += 1;
                    }
                }
                else {
                    for (const [personId, info] of byPerson) {
                        if (!info.chatId)
                            continue;
                        const html = '✅ <b>Бонус підтверджено</b>\n\n' +
                            `${routeNice} · ${dateKey}\n` +
                            (info.isPassenger
                                ? 'Ваші фото поїздки схвалено.\n'
                                : 'Поїздку вашого друга підтверджено фото.\n') +
                            `💸 До виплати (поповнення мобільного): <b>${info.uah} грн</b>` +
                            (info.count > 1 ? ` (${info.count} нагород)` : '') +
                            '\n\nОчікуйте поповнення — адмін обробить чергу виплат.';
                        const sendResult = await (0, telegram_1.sendTelegramHtmlToChat)(info.chatId, html, {
                            personId,
                            normalizedPhone: info.phone,
                        });
                        if (sendResult.ok)
                            notifySent += 1;
                        if (sendResult.blocked)
                            notifyBlocked += 1;
                    }
                }
            }
            res.json({
                ...result.proof,
                rewardsUnlocked: result.rewardsUnlocked,
                notifySent,
                notifyBlocked,
            });
        }
        catch (e) {
            console.error('❌ PATCH /admin/referrals/proofs/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити підтвердження' });
        }
    });
    return r;
}
