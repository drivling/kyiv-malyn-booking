"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEGRAM_COPY_TEXT_MAX_CHARS = exports.SELF_REFERRAL_FLAG_REASON = exports.ADMIN_MANUAL_FLAG_PREFIX = exports.BOT_BLOCKED_REWARD_FLAG_REASON = exports.MIN_RIDE_DURATION_MINUTES = exports.REFERRAL_BUDGET_HOLD_REASON = exports.REFERRAL_PERSON_TOTAL_WARN_UAH = exports.MAX_RIDE_PROOFS_PER_DAY = exports.REFERRAL_DEFAULT_BUDGET_UAH = exports.MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED = exports.REFERRAL_REWARD_TYPE_LEGACY_DRIVER = exports.REFERRAL_REWARD_UAH = exports.REWARD_STATUSES_UNPAID = exports.REWARD_STATUSES_ON_HOLD = exports.REWARD_STATUS_FLAGGED = exports.REWARD_STATUS_PAID = exports.REWARD_STATUS_APPROVED = exports.REWARD_STATUS_HOLD = void 0;
exports.isRewardOnHold = isRewardOnHold;
exports.isRewardPayable = isRewardPayable;
exports.generateReferralCode = generateReferralCode;
exports.getReferralBotLink = getReferralBotLink;
exports.maxRewardUahPerReferred = maxRewardUahPerReferred;
exports.parseInviteContact = parseInviteContact;
exports.parseDepartureMinutes = parseDepartureMinutes;
exports.toDateKey = toDateKey;
exports.isReverseRoute = isReverseRoute;
exports.detectTimeConflict = detectTimeConflict;
exports.ensurePersonReferralCode = ensurePersonReferralCode;
exports.findReferrerByCode = findReferrerByCode;
exports.isPersonConnectedToBot = isPersonConnectedToBot;
exports.isSameTelegramAccount = isSameTelegramAccount;
exports.createReferralInvite = createReferralInvite;
exports.linkReferralOnRegistration = linkReferralOnRegistration;
exports.getReferralProgramSettings = getReferralProgramSettings;
exports.getReferralBudgetStatus = getReferralBudgetStatus;
exports.setReferralBudgetUah = setReferralBudgetUah;
exports.getPersonTotalReferralUah = getPersonTotalReferralUah;
exports.countRideProofsToday = countRideProofsToday;
exports.collectPersonRideSlots = collectPersonRideSlots;
exports.unlockRegistrationReward = unlockRegistrationReward;
exports.hasDriverListingForReferral = hasDriverListingForReferral;
exports.processReferralRewardsAfterPassengerProof = processReferralRewardsAfterPassengerProof;
exports.processReferralDriverListingReward = processReferralDriverListingReward;
exports.processReferralRegistrationReward = processReferralRegistrationReward;
exports.processReferralPassengerProofReward = processReferralPassengerProofReward;
exports.getReferralStatsForPerson = getReferralStatsForPerson;
exports.buildReferralProgramTermsHtml = buildReferralProgramTermsHtml;
exports.buildReferralProgramInlineKeyboard = buildReferralProgramInlineKeyboard;
exports.buildPayoutBalancesFromRewards = buildPayoutBalancesFromRewards;
exports.withAdminManualFlagReason = withAdminManualFlagReason;
exports.isProtectedFlagReason = isProtectedFlagReason;
exports.flagUnpaidRewardsForSelfReferral = flagUnpaidRewardsForSelfReferral;
exports.buildBotBlockedPayoutsFrozenMessage = buildBotBlockedPayoutsFrozenMessage;
exports.flagUnpaidReferralRewardsForBotBlocked = flagUnpaidReferralRewardsForBotBlocked;
exports.markReferralPayout = markReferralPayout;
exports.formatRideDateKeyUa = formatRideDateKeyUa;
exports.clipForTelegramCopyText = clipForTelegramCopyText;
exports.buildRideFacebookShareCaption = buildRideFacebookShareCaption;
exports.buildRideFacebookSharePromptHtml = buildRideFacebookSharePromptHtml;
exports.buildFacebookShareInlineKeyboard = buildFacebookShareInlineKeyboard;
exports.syncFlaggedRewardsForApprovedProofs = syncFlaggedRewardsForApprovedProofs;
exports.findUnlockableFlaggedRewardIds = findUnlockableFlaggedRewardIds;
exports.buildAdminReferralReport = buildAdminReferralReport;
const telegram_contact_1 = require("./telegram-contact");
/** Локальна копія normalizePhone з telegram.ts (уникаємо circular import) */
function normalizePhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0'))
        cleaned = '38' + cleaned;
    return cleaned;
}
/**
 * Статуси нагороди.
 * hold — створена, але фото ще не схвалене модератором: у виплати не потрапляє.
 * approved — фото схвалене, стоїть у черзі виплат.
 * Легасі 'pending' (до введення hold) читаємо як hold — теж не платимо.
 */
exports.REWARD_STATUS_HOLD = 'hold';
exports.REWARD_STATUS_APPROVED = 'approved';
exports.REWARD_STATUS_PAID = 'paid';
exports.REWARD_STATUS_FLAGGED = 'flagged';
/** Статуси «гроші ще не в черзі виплат» (включно з легасі 'pending') */
exports.REWARD_STATUSES_ON_HOLD = [exports.REWARD_STATUS_HOLD, 'pending'];
/** Статуси, які може заморозити flag або розблокувати схвалення фото */
exports.REWARD_STATUSES_UNPAID = [...exports.REWARD_STATUSES_ON_HOLD, exports.REWARD_STATUS_APPROVED];
function isRewardOnHold(status) {
    return exports.REWARD_STATUSES_ON_HOLD.includes(status);
}
function isRewardPayable(status) {
    return status === exports.REWARD_STATUS_APPROVED;
}
exports.REFERRAL_REWARD_UAH = {
    registration: 10,
    driver_qualified: 40,
    passenger_completed_ride: 20,
    /** Бонус самому запрошеному пасажиру за підтвердження поїздки фото */
    passenger_self_confirm: 20,
};
/** @deprecated використовуйте driver_qualified */
exports.REFERRAL_REWARD_TYPE_LEGACY_DRIVER = 'driver_first_listing';
exports.MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED = 3;
/** Бюджет акції за замовчуванням, грн (редагується в адмінці) */
exports.REFERRAL_DEFAULT_BUDGET_UAH = 4000;
/** Скільки нагород за поїздки людина може подати на добу (/confirmride) */
exports.MAX_RIDE_PROOFS_PER_DAY = 2;
/** Скільки грн на одну людину — привід придивитись (лише попередження в адмінці) */
exports.REFERRAL_PERSON_TOTAL_WARN_UAH = 200;
/**
 * Бюджет акції вичерпано: нагорода створюється на утриманні.
 * Причина захищена — схвалення фото її не розморожує, потрібне рішення адміна.
 */
exports.REFERRAL_BUDGET_HOLD_REASON = 'Бюджет акції вичерпано — нарахування на утриманні до рішення адміна';
/** Мінімальний час однієї поїздки (хв) для анти-чит перевірки */
exports.MIN_RIDE_DURATION_MINUTES = 75;
const REFERRAL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateReferralCode(length = 8) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)];
    }
    return code;
}
function getReferralBotLink(botUsername, code) {
    return `https://t.me/${botUsername}?start=ref_${code}`;
}
/** Максимум з одного друга: 10 + 40 (водій) + 20×3 (пасажир) */
function maxRewardUahPerReferred() {
    return (exports.REFERRAL_REWARD_UAH.registration +
        exports.REFERRAL_REWARD_UAH.driver_qualified +
        exports.REFERRAL_REWARD_UAH.passenger_completed_ride * exports.MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED);
}
function parseInviteContact(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith('@') || /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(trimmed)) {
        const username = (0, telegram_contact_1.normalizeTelegramUsername)(trimmed);
        if (!username)
            return null;
        return { type: 'telegram', username, display: `@${username}` };
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 10) {
        const phoneNormalized = normalizePhone(trimmed);
        return { type: 'phone', phoneNormalized, display: phoneNormalized };
    }
    return null;
}
/** Парсинг часу відправлення (початок інтервалу) у хвилини від півночі */
function parseDepartureMinutes(departureTime) {
    if (!departureTime?.trim())
        return null;
    const match = departureTime.trim().match(/(\d{1,2}):(\d{2})/);
    if (!match)
        return null;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59)
        return null;
    return h * 60 + m;
}
function toDateKey(d) {
    return d.toISOString().slice(0, 10);
}
/** Чи маршрут «назад» (зміна напрямку між містами) */
function isReverseRoute(a, b) {
    const partsA = a.split('-');
    const partsB = b.split('-');
    if (partsA.length < 2 || partsB.length < 2)
        return false;
    return partsA[0] === partsB[partsB.length - 1] && partsA[partsA.length - 1] === partsB[0];
}
/**
 * Перевірка фізичної можливості поїздок в один день.
 * Повертає текст причини підозри або null.
 */
function detectTimeConflict(slots) {
    const byDay = new Map();
    for (const slot of slots) {
        const arr = byDay.get(slot.dateKey) ?? [];
        arr.push(slot);
        byDay.set(slot.dateKey, arr);
    }
    for (const [, daySlots] of byDay) {
        const withTime = daySlots.filter((s) => Number.isFinite(s.startMin));
        if (withTime.length < 2)
            continue;
        withTime.sort((a, b) => a.startMin - b.startMin);
        for (let i = 0; i < withTime.length; i++) {
            for (let j = i + 1; j < withTime.length; j++) {
                const a = withTime[i];
                const b = withTime[j];
                const aEnd = a.endMin ?? a.startMin + exports.MIN_RIDE_DURATION_MINUTES;
                const bStart = b.startMin;
                if (bStart < aEnd && isReverseRoute(a.route, b.route)) {
                    return `Неможливий розклад ${a.dateKey}: ${a.route} о ${Math.floor(a.startMin / 60)}:${String(a.startMin % 60).padStart(2, '0')} і ${b.route} о ${Math.floor(bStart / 60)}:${String(bStart % 60).padStart(2, '0')} (менше ${exports.MIN_RIDE_DURATION_MINUTES} хв між зворотними поїздками)`;
                }
                if (bStart < aEnd && a.route === b.route) {
                    return `Дубль маршруту ${a.route} ${a.dateKey} о ${Math.floor(a.startMin / 60)}:${String(a.startMin % 60).padStart(2, '0')} та ${Math.floor(bStart / 60)}:${String(bStart % 60).padStart(2, '0')}`;
                }
            }
        }
    }
    return null;
}
async function ensurePersonReferralCode(prisma, personId) {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { referralCode: true } });
    if (person?.referralCode)
        return person.referralCode;
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateReferralCode();
        try {
            await prisma.person.update({ where: { id: personId }, data: { referralCode: code } });
            return code;
        }
        catch {
            // unique collision — retry
        }
    }
    throw new Error('Failed to generate unique referral code');
}
async function findReferrerByCode(prisma, code) {
    return prisma.person.findFirst({ where: { referralCode: code.toUpperCase() } });
}
/** Уже підключений до бота — не «новий» для акції */
function isPersonConnectedToBot(person) {
    const chat = person.telegramChatId?.trim();
    const user = person.telegramUserId?.trim();
    return !!(chat || user);
}
function normalizeTelegramId(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === '0')
        return null;
    return trimmed;
}
/**
 * Два Person — це насправді один Telegram-акаунт (другий номер у тому самому чаті).
 * Основа анти-фроду: реферер не може запросити сам себе.
 */
function isSameTelegramAccount(a, b) {
    const aChat = normalizeTelegramId(a.telegramChatId);
    const bChat = normalizeTelegramId(b.telegramChatId);
    if (aChat && bChat && aChat === bChat)
        return true;
    const aUser = normalizeTelegramId(a.telegramUserId);
    const bUser = normalizeTelegramId(b.telegramUserId);
    if (aUser && bUser && aUser === bUser)
        return true;
    return false;
}
async function createReferralInvite(prisma, referrerId, contactInput) {
    const parsed = parseInviteContact(contactInput);
    if (!parsed) {
        return { ok: false, error: 'Вкажіть номер телефону (0501234567) або Telegram @username' };
    }
    const existingPerson = parsed.type === 'phone'
        ? await prisma.person.findUnique({ where: { phoneNormalized: parsed.phoneNormalized } })
        : await prisma.person.findFirst({
            where: {
                OR: [{ telegramUsername: parsed.username }, { telegramUsername: `@${parsed.username}` }],
            },
        });
    if (existingPerson?.id === referrerId) {
        return { ok: false, error: 'Не можна запросити самого себе', selfReferral: true };
    }
    // Другий номер того самого Telegram-акаунта — це запрошення самого себе
    if (existingPerson) {
        const referrer = await prisma.person.findUnique({
            where: { id: referrerId },
            select: { telegramChatId: true, telegramUserId: true },
        });
        if (referrer && isSameTelegramAccount(referrer, existingPerson)) {
            return {
                ok: false,
                selfReferral: true,
                error: 'Не можна запросити самого себе: цей контакт привʼязаний до вашого ж Telegram-акаунта.',
            };
        }
    }
    // Уже користувач бота — м’яко відхиляємо
    if (existingPerson && isPersonConnectedToBot(existingPerson)) {
        return {
            ok: false,
            alreadyOurUser: true,
            error: 'Цей друг уже з нами в боті 🙂 Запрошення для акції не зарахується — спробуйте запросити когось іншого.',
        };
    }
    if (existingPerson?.referredByPersonId) {
        return {
            ok: false,
            alreadyOurUser: true,
            error: 'Цей друг уже був запрошений раніше 🙂 Оберіть, будь ласка, іншого.',
        };
    }
    const duplicate = await prisma.referralInvite.findFirst({
        where: {
            referrerId,
            status: 'pending',
            ...(parsed.type === 'phone'
                ? { invitePhoneNorm: parsed.phoneNormalized }
                : { inviteUsername: parsed.username }),
        },
    });
    if (duplicate) {
        return { ok: false, error: 'Ви вже запросили цей контакт — очікуємо, поки друг підключить бота' };
    }
    const alreadyInClientsDb = !!existingPerson;
    const registrationBonusEligible = !alreadyInClientsDb;
    const invite = await prisma.referralInvite.create({
        data: {
            referrerId,
            inviteContact: parsed.display,
            inviteType: parsed.type,
            invitePhoneNorm: parsed.type === 'phone' ? parsed.phoneNormalized : null,
            inviteUsername: parsed.type === 'telegram' ? parsed.username : null,
            referredPersonId: existingPerson?.id ?? null,
            status: existingPerson ? 'registered' : 'pending',
            registeredAt: existingPerson ? new Date() : null,
            registrationBonusEligible,
        },
    });
    if (existingPerson && !existingPerson.referredByPersonId) {
        await linkReferredPerson(prisma, existingPerson.id, referrerId, {
            inviteId: invite.id,
            registrationBonusEligible: false,
        });
    }
    return {
        ok: true,
        inviteId: invite.id,
        display: parsed.display,
        registrationBonusEligible,
        alreadyInClientsDb,
    };
}
async function linkReferredPerson(prisma, referredPersonId, referrerPersonId, opts) {
    if (referredPersonId === referrerPersonId)
        return false;
    const referred = await prisma.person.findUnique({
        where: { id: referredPersonId },
        select: { referredByPersonId: true },
    });
    if (referred?.referredByPersonId)
        return false;
    await prisma.person.update({
        where: { id: referredPersonId },
        data: {
            referredByPersonId: referrerPersonId,
            ...(opts?.registrationBonusEligible !== undefined
                ? { referralRegistrationBonusEligible: opts.registrationBonusEligible }
                : {}),
        },
    });
    if (opts?.inviteId) {
        await prisma.referralInvite.update({
            where: { id: opts.inviteId },
            data: { referredPersonId, status: 'registered', registeredAt: new Date() },
        });
    }
    await markMatchingInvitesRegistered(prisma, referredPersonId, referrerPersonId);
    return true;
}
async function markMatchingInvitesRegistered(prisma, referredPersonId, referrerPersonId) {
    const person = await prisma.person.findUnique({
        where: { id: referredPersonId },
        select: { phoneNormalized: true, telegramUsername: true },
    });
    if (!person)
        return;
    const username = person.telegramUsername ? (0, telegram_contact_1.normalizeTelegramUsername)(person.telegramUsername) : null;
    await prisma.referralInvite.updateMany({
        where: {
            referrerId: referrerPersonId,
            status: 'pending',
            OR: [
                ...(person.phoneNormalized ? [{ invitePhoneNorm: person.phoneNormalized }] : []),
                ...(username ? [{ inviteUsername: username }] : []),
            ],
        },
        data: { referredPersonId, status: 'registered', registeredAt: new Date() },
    });
}
/**
 * Прив'язати реферера при реєстрації (посилання ref_ або pending invite).
 * Нагороди тут НЕ нараховуються — лише зв'язок.
 * @param personWasNewToClientsDb — true лише якщо Person щойно створений (не було в базі клієнтів)
 */
async function linkReferralOnRegistration(prisma, referredPersonId, phoneNormalized, telegramUsername, referralCodeFromStart, personWasNewToClientsDb) {
    const person = await prisma.person.findUnique({
        where: { id: referredPersonId },
        select: {
            referredByPersonId: true,
            referralRegistrationBonusEligible: true,
            telegramChatId: true,
            telegramUserId: true,
        },
    });
    if (person?.referredByPersonId) {
        return {
            linked: false,
            referrerId: person.referredByPersonId,
            registrationBonusEligible: person.referralRegistrationBonusEligible ?? undefined,
        };
    }
    let referrerId = null;
    let inviteBonusEligible = null;
    let pendingInviteId = null;
    if (referralCodeFromStart) {
        const referrer = await findReferrerByCode(prisma, referralCodeFromStart);
        if (referrer && referrer.id !== referredPersonId)
            referrerId = referrer.id;
    }
    if (!referrerId) {
        const username = telegramUsername ? (0, telegram_contact_1.normalizeTelegramUsername)(telegramUsername) : null;
        const pendingInvite = await prisma.referralInvite.findFirst({
            where: {
                status: 'pending',
                OR: [
                    { invitePhoneNorm: phoneNormalized },
                    ...(username ? [{ inviteUsername: username }] : []),
                ],
            },
            orderBy: { createdAt: 'asc' },
        });
        if (pendingInvite && pendingInvite.referrerId !== referredPersonId) {
            referrerId = pendingInvite.referrerId;
            inviteBonusEligible = pendingInvite.registrationBonusEligible;
            pendingInviteId = pendingInvite.id;
        }
    }
    if (!referrerId)
        return { linked: false };
    // Другий номер у тому самому Telegram — звʼязок не створюємо, запрошення позначаємо як blocked
    const referrer = await prisma.person.findUnique({
        where: { id: referrerId },
        select: { telegramChatId: true, telegramUserId: true },
    });
    if (referrer && person && isSameTelegramAccount(referrer, person)) {
        if (pendingInviteId) {
            await prisma.referralInvite.update({
                where: { id: pendingInviteId },
                data: { status: 'blocked_self_referral', referredPersonId },
            });
        }
        return { linked: false, referrerId, selfReferralBlocked: true };
    }
    if (pendingInviteId) {
        await prisma.referralInvite.update({
            where: { id: pendingInviteId },
            data: { referredPersonId, status: 'registered', registeredAt: new Date() },
        });
    }
    // 10 грн лише якщо людина нова в базі клієнтів і запрошення теж це дозволяє
    const registrationBonusEligible = personWasNewToClientsDb === true && (inviteBonusEligible === null || inviteBonusEligible === true);
    const linked = await linkReferredPerson(prisma, referredPersonId, referrerId, {
        registrationBonusEligible,
    });
    return linked
        ? { linked: true, referrerId, registrationBonusEligible }
        : { linked: false };
}
async function getReferrerIdForPerson(prisma, personId) {
    const p = await prisma.person.findUnique({ where: { id: personId }, select: { referredByPersonId: true } });
    return p?.referredByPersonId ?? null;
}
async function hasRewardType(prisma, referrerId, referredPersonId, rewardType) {
    const existing = await prisma.referralReward.findFirst({
        where: { referrerId, referredPersonId, rewardType },
        select: { id: true },
    });
    return !!existing;
}
/** Один рядок налаштувань акції; створюється при першому зверненні */
async function getReferralProgramSettings(prisma) {
    const existing = await prisma.referralProgramSettings.findFirst({
        orderBy: { id: 'asc' },
        select: { id: true, budgetUah: true },
    });
    if (existing)
        return existing;
    return prisma.referralProgramSettings.create({
        data: { budgetUah: exports.REFERRAL_DEFAULT_BUDGET_UAH },
        select: { id: true, budgetUah: true },
    });
}
/** Скільки бюджету вже витрачено і скільки лишилось */
async function getReferralBudgetStatus(prisma) {
    const { budgetUah } = await getReferralProgramSettings(prisma);
    const [committed, held] = await Promise.all([
        prisma.referralReward.aggregate({
            _sum: { amountUah: true },
            where: {
                status: { in: [exports.REWARD_STATUS_PAID, exports.REWARD_STATUS_APPROVED, ...exports.REWARD_STATUSES_ON_HOLD] },
                // утримані через бюджет не рахуємо — вони поки не обіцяні
                OR: [{ flagReason: null }, { flagReason: { not: exports.REFERRAL_BUDGET_HOLD_REASON } }],
            },
        }),
        prisma.referralReward.aggregate({
            _sum: { amountUah: true },
            _count: { _all: true },
            where: { flagReason: exports.REFERRAL_BUDGET_HOLD_REASON },
        }),
    ]);
    const committedUah = committed._sum.amountUah ?? 0;
    return {
        budgetUah,
        committedUah,
        remainingUah: Math.max(0, budgetUah - committedUah),
        budgetHeldUah: held._sum.amountUah ?? 0,
        budgetHeldCount: held._count._all ?? 0,
        exceeded: committedUah >= budgetUah,
    };
}
/**
 * Змінити бюджет акції. Якщо бюджет підняли — знімаємо утримання з нагород,
 * які тепер у нього вкладаються (у порядку нарахування).
 */
async function setReferralBudgetUah(prisma, budgetUah) {
    const settings = await getReferralProgramSettings(prisma);
    await prisma.referralProgramSettings.update({
        where: { id: settings.id },
        data: { budgetUah },
    });
    const status = await getReferralBudgetStatus(prisma);
    let remaining = status.remainingUah;
    if (remaining <= 0)
        return { budgetUah, releasedCount: 0, releasedUah: 0 };
    const heldRewards = await prisma.referralReward.findMany({
        where: { flagReason: exports.REFERRAL_BUDGET_HOLD_REASON },
        orderBy: { id: 'asc' },
        select: { id: true, amountUah: true },
    });
    const releaseIds = [];
    let releasedUah = 0;
    for (const reward of heldRewards) {
        if (reward.amountUah > remaining)
            break;
        remaining -= reward.amountUah;
        releasedUah += reward.amountUah;
        releaseIds.push(reward.id);
    }
    if (releaseIds.length === 0)
        return { budgetUah, releasedCount: 0, releasedUah: 0 };
    // Знімаємо лише позначку бюджету — статус лишається hold, гроші й далі чекають схвалення фото
    await prisma.referralReward.updateMany({
        where: { id: { in: releaseIds } },
        data: { flagReason: null },
    });
    return { budgetUah, releasedCount: releaseIds.length, releasedUah };
}
/** Скільки людина заробила за весь час: виплачено + у черзі + на утриманні */
async function getPersonTotalReferralUah(prisma, personId) {
    const total = await prisma.referralReward.aggregate({
        _sum: { amountUah: true },
        where: {
            referrerId: personId,
            status: { in: [exports.REWARD_STATUS_PAID, exports.REWARD_STATUS_APPROVED, ...exports.REWARD_STATUSES_ON_HOLD] },
        },
    });
    return total._sum.amountUah ?? 0;
}
/** Скільки підтверджень поїздки людина створила сьогодні (антиспам /confirmride) */
async function countRideProofsToday(prisma, personId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return prisma.rideCompletionProof.count({
        where: { personId, createdAt: { gte: startOfDay } },
    });
}
/** Prisma P2002 — порушення unique-констрейнта */
function isUniqueConstraintError(e) {
    return typeof e === 'object' && e !== null && e.code === 'P2002';
}
async function createRewardIfNotExists(prisma, data) {
    // registration і driver_qualified — одна нагорода на пару referrer↔referred
    const oncePerPair = data.rewardType === 'registration' ||
        data.rewardType === 'driver_qualified' ||
        data.rewardType === exports.REFERRAL_REWARD_TYPE_LEGACY_DRIVER;
    const existing = await prisma.referralReward.findFirst({
        where: {
            referrerId: data.referrerId,
            referredPersonId: data.referredPersonId,
            rewardType: data.rewardType,
            ...(oncePerPair
                ? {}
                : {
                    ...(data.viberListingId != null ? { viberListingId: data.viberListingId } : {}),
                    ...(data.rideProofId != null ? { rideProofId: data.rideProofId } : {}),
                }),
        },
    });
    if (existing)
        return { created: false, rewardId: existing.id };
    // Не дублювати старий driver_first_listing і новий driver_qualified
    if (data.rewardType === 'driver_qualified') {
        const legacy = await prisma.referralReward.findFirst({
            where: {
                referrerId: data.referrerId,
                referredPersonId: data.referredPersonId,
                rewardType: exports.REFERRAL_REWARD_TYPE_LEGACY_DRIVER,
            },
        });
        if (legacy)
            return { created: false, rewardId: legacy.id };
    }
    try {
        const reward = await prisma.referralReward.create({
            data: {
                referrerId: data.referrerId,
                referredPersonId: data.referredPersonId,
                rewardType: data.rewardType,
                amountUah: data.amountUah,
                viberListingId: data.viberListingId ?? null,
                rideProofId: data.rideProofId ?? null,
                status: data.flagReason ? exports.REWARD_STATUS_FLAGGED : exports.REWARD_STATUS_HOLD,
                flagReason: data.flagReason ?? data.holdReason ?? null,
            },
        });
        return { created: true, rewardId: reward.id };
    }
    catch (e) {
        // Паралельний запит устиг створити ту саму нагороду (unique ReferralReward_dedupe_key)
        if (!isUniqueConstraintError(e))
            throw e;
        const concurrent = await prisma.referralReward.findFirst({
            where: {
                referrerId: data.referrerId,
                referredPersonId: data.referredPersonId,
                rewardType: data.rewardType,
                rideProofId: data.rideProofId ?? null,
            },
            select: { id: true },
        });
        if (!concurrent)
            throw e;
        return { created: false, rewardId: concurrent.id };
    }
}
/**
 * Слоти для античиту. Підтвердження (proof) має пріоритет над оголошенням:
 * якщо є proof на той самий маршрут+дату (або той самий listing) — listing не дублюємо,
 * інакше звичайний /confirmride завжди дає хибний «Дубль маршруту».
 */
async function collectPersonRideSlots(prisma, personId) {
    const listings = await prisma.viberListing.findMany({
        where: { personId, listingType: 'passenger' },
        select: { route: true, date: true, departureTime: true, id: true },
    });
    const proofs = await prisma.rideCompletionProof.findMany({
        where: { personId, status: { in: ['approved', 'pending_review', 'flagged'] } },
        select: { route: true, rideDate: true, departureTime: true, id: true, viberListingId: true },
    });
    const proofListingIds = new Set(proofs.map((p) => p.viberListingId).filter((id) => typeof id === 'number' && id > 0));
    const proofDayKeys = new Set(proofs.map((p) => `${p.route}__${toDateKey(p.rideDate)}`));
    const slots = [];
    for (const p of proofs) {
        const startMin = parseDepartureMinutes(p.departureTime);
        slots.push({
            route: p.route,
            dateKey: toDateKey(p.rideDate),
            startMin: startMin ?? 0,
            endMin: startMin != null ? startMin + exports.MIN_RIDE_DURATION_MINUTES : 24 * 60,
            source: `proof:${p.id}`,
        });
    }
    for (const l of listings) {
        if (proofListingIds.has(l.id))
            continue;
        const dayKey = `${l.route}__${toDateKey(l.date)}`;
        if (proofDayKeys.has(dayKey))
            continue;
        const startMin = parseDepartureMinutes(l.departureTime);
        slots.push({
            route: l.route,
            dateKey: toDateKey(l.date),
            startMin: startMin ?? 0,
            endMin: startMin != null ? startMin + exports.MIN_RIDE_DURATION_MINUTES : 24 * 60,
            source: `listing:${l.id}`,
        });
    }
    return slots;
}
/**
 * 10 грн за «нового друга» — лише після першої кваліфікації,
 * і лише якщо друг був дійсно новим у базі клієнтів (не referralRegistrationBonusEligible=false).
 */
async function unlockRegistrationReward(prisma, referredPersonId, opts) {
    const referrerId = await getReferrerIdForPerson(prisma, referredPersonId);
    if (!referrerId)
        return { created: false };
    const person = await prisma.person.findUnique({
        where: { id: referredPersonId },
        select: { referralRegistrationBonusEligible: true },
    });
    // false — уже був у базі клієнтів → без 10 грн; null/true — дозволено
    if (person?.referralRegistrationBonusEligible === false) {
        return { created: false, skippedExistingClient: true };
    }
    const result = await createRewardIfNotExists(prisma, {
        referrerId,
        referredPersonId,
        rewardType: 'registration',
        amountUah: exports.REFERRAL_REWARD_UAH.registration,
        rideProofId: opts?.rideProofId,
        viberListingId: opts?.viberListingId,
        flagReason: opts?.flagReason,
        holdReason: opts?.holdReason,
    });
    return { created: result.created, rewardId: result.rewardId };
}
/**
 * Чи друг-водій уже має оголошення водія (умова для 40 грн).
 * Нагороду тут НЕ нараховуємо — лише перевірка готовності.
 */
async function hasDriverListingForReferral(prisma, personId) {
    const listing = await prisma.viberListing.findFirst({
        where: { personId, listingType: 'driver' },
        select: { id: true },
    });
    return !!listing;
}
/**
 * Головний хук після двох фото пасажира (/confirmride).
 *
 * 1) Запрошений пасажир → собі 20 грн; запрошувачу 20 грн (+ 10 грн при першій поїздці).
 * 2) Якщо пасажира запросив друг-водій → рефереру водія 40 грн (+ 10 грн якщо ще не було).
 */
async function processReferralRewardsAfterPassengerProof(prisma, proofId) {
    const empty = {
        passengerRideCreated: false,
        passengerSelfCreated: false,
        passengerSelfUah: 0,
        registrationCreated: false,
        driverQualifiedCreated: false,
        totalNewUah: 0,
        budgetHeldUah: 0,
        personsOverWarnLimit: [],
    };
    const proof = await prisma.rideCompletionProof.findUnique({
        where: { id: proofId },
        include: {
            person: { select: { id: true, referredByPersonId: true } },
        },
    });
    if (!proof)
        return empty;
    const passengerPersonId = proof.person.id;
    const slots = await collectPersonRideSlots(prisma, passengerPersonId);
    const flagReason = detectTimeConflict(slots);
    if (flagReason) {
        await prisma.rideCompletionProof.update({
            where: { id: proofId },
            data: { status: 'flagged', flagReason },
        });
    }
    let totalNewUah = 0;
    const result = {
        ...empty,
        personsOverWarnLimit: [],
        flagged: !!flagReason,
        flagReason,
    };
    // Бюджет акції: те, що не вкладається, створюємо на утриманні (гроші не обіцяємо)
    const budget = await getReferralBudgetStatus(prisma);
    let budgetLeft = budget.remainingUah;
    const takeFromBudget = (amountUah) => {
        if (budgetLeft >= amountUah)
            return undefined;
        return exports.REFERRAL_BUDGET_HOLD_REASON;
    };
    const spendBudget = (amountUah, held) => {
        if (held)
            result.budgetHeldUah += amountUah;
        else
            budgetLeft -= amountUah;
    };
    /** Хто отримав нову нагороду — потім перевіримо їхні сумарні заробітки */
    const touchedReceivers = new Set();
    // --- Шлях А: друг-пасажир підтвердив поїздку ---
    const passengerReferrerId = proof.person.referredByPersonId;
    if (passengerReferrerId) {
        result.passengerReferrerId = passengerReferrerId;
        const existingCount = await prisma.referralReward.count({
            where: {
                referrerId: passengerReferrerId,
                referredPersonId: passengerPersonId,
                rewardType: 'passenger_completed_ride',
                status: { not: 'flagged' },
            },
        });
        if (existingCount >= exports.MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED) {
            result.limitReached = true;
        }
        else {
            const rideHeld = takeFromBudget(exports.REFERRAL_REWARD_UAH.passenger_completed_ride);
            const rideReward = await createRewardIfNotExists(prisma, {
                referrerId: passengerReferrerId,
                referredPersonId: passengerPersonId,
                rewardType: 'passenger_completed_ride',
                amountUah: exports.REFERRAL_REWARD_UAH.passenger_completed_ride,
                rideProofId: proofId,
                flagReason: flagReason ?? undefined,
                holdReason: rideHeld,
            });
            result.passengerRideCreated = rideReward.created;
            result.passengerRewardId = rideReward.rewardId;
            if (rideReward.created) {
                totalNewUah += exports.REFERRAL_REWARD_UAH.passenger_completed_ride;
                spendBudget(exports.REFERRAL_REWARD_UAH.passenger_completed_ride, rideHeld);
                touchedReceivers.add(passengerReferrerId);
            }
            // Бонус самому запрошеному пасажиру (referrerId = passenger = хто отримує виплату)
            const selfCount = await prisma.referralReward.count({
                where: {
                    referrerId: passengerPersonId,
                    referredPersonId: passengerPersonId,
                    rewardType: 'passenger_self_confirm',
                    status: { not: 'flagged' },
                },
            });
            if (selfCount < exports.MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED) {
                const selfHeld = takeFromBudget(exports.REFERRAL_REWARD_UAH.passenger_self_confirm);
                const selfReward = await createRewardIfNotExists(prisma, {
                    referrerId: passengerPersonId,
                    referredPersonId: passengerPersonId,
                    rewardType: 'passenger_self_confirm',
                    amountUah: exports.REFERRAL_REWARD_UAH.passenger_self_confirm,
                    rideProofId: proofId,
                    flagReason: flagReason ?? undefined,
                    holdReason: selfHeld,
                });
                result.passengerSelfCreated = selfReward.created;
                result.passengerSelfRewardId = selfReward.rewardId;
                if (selfReward.created) {
                    result.passengerSelfUah = exports.REFERRAL_REWARD_UAH.passenger_self_confirm;
                    totalNewUah += exports.REFERRAL_REWARD_UAH.passenger_self_confirm;
                    spendBudget(exports.REFERRAL_REWARD_UAH.passenger_self_confirm, selfHeld);
                    touchedReceivers.add(passengerPersonId);
                }
            }
        }
        // 10 грн запрошувачу — при першій кваліфікації
        const regHeld = takeFromBudget(exports.REFERRAL_REWARD_UAH.registration);
        const reg = await unlockRegistrationReward(prisma, passengerPersonId, {
            rideProofId: proofId,
            flagReason: flagReason ?? undefined,
            holdReason: regHeld,
        });
        result.registrationCreated = reg.created;
        result.registrationRewardId = reg.rewardId;
        if (reg.created) {
            totalNewUah += exports.REFERRAL_REWARD_UAH.registration;
            spendBudget(exports.REFERRAL_REWARD_UAH.registration, regHeld);
            touchedReceivers.add(passengerReferrerId);
        }
    }
    // --- Шлях Б: пасажира запросив друг-водій → кваліфікація водія для реферера водія ---
    if (passengerReferrerId) {
        const driverPersonId = passengerReferrerId;
        const driverHasListing = await hasDriverListingForReferral(prisma, driverPersonId);
        const driverReferrerId = await getReferrerIdForPerson(prisma, driverPersonId);
        if (driverHasListing && driverReferrerId) {
            result.driverReferrerId = driverReferrerId;
            const driverListing = await prisma.viberListing.findFirst({
                where: { personId: driverPersonId, listingType: 'driver' },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            });
            const alreadyDriverReward = (await hasRewardType(prisma, driverReferrerId, driverPersonId, 'driver_qualified')) ||
                (await hasRewardType(prisma, driverReferrerId, driverPersonId, exports.REFERRAL_REWARD_TYPE_LEGACY_DRIVER));
            if (!alreadyDriverReward) {
                const driverHeld = takeFromBudget(exports.REFERRAL_REWARD_UAH.driver_qualified);
                const driverReward = await createRewardIfNotExists(prisma, {
                    referrerId: driverReferrerId,
                    referredPersonId: driverPersonId,
                    rewardType: 'driver_qualified',
                    amountUah: exports.REFERRAL_REWARD_UAH.driver_qualified,
                    viberListingId: driverListing?.id,
                    rideProofId: proofId,
                    flagReason: flagReason ?? undefined,
                    holdReason: driverHeld,
                });
                result.driverQualifiedCreated = driverReward.created;
                result.driverQualifiedRewardId = driverReward.rewardId;
                if (driverReward.created) {
                    totalNewUah += exports.REFERRAL_REWARD_UAH.driver_qualified;
                    spendBudget(exports.REFERRAL_REWARD_UAH.driver_qualified, driverHeld);
                    touchedReceivers.add(driverReferrerId);
                }
                // 10 грн рефереру водія — якщо ще не розблоковано (інший referrer, ніж у шляху А)
                const regDriverHeld = takeFromBudget(exports.REFERRAL_REWARD_UAH.registration);
                const regDriver = await unlockRegistrationReward(prisma, driverPersonId, {
                    rideProofId: proofId,
                    viberListingId: driverListing?.id,
                    flagReason: flagReason ?? undefined,
                    holdReason: regDriverHeld,
                });
                if (regDriver.created) {
                    totalNewUah += exports.REFERRAL_REWARD_UAH.registration;
                    spendBudget(exports.REFERRAL_REWARD_UAH.registration, regDriverHeld);
                    touchedReceivers.add(driverReferrerId);
                }
            }
        }
    }
    // Поріг уваги на людину — лише сигнал адміну, нічого не блокуємо
    for (const personId of touchedReceivers) {
        const totalUah = await getPersonTotalReferralUah(prisma, personId);
        if (totalUah >= exports.REFERRAL_PERSON_TOTAL_WARN_UAH) {
            result.personsOverWarnLimit.push({ personId, totalUah });
        }
    }
    result.totalNewUah = totalNewUah;
    return result;
}
/**
 * @deprecated Нагорода водія більше не нараховується при розміщенні оголошення.
 * Залишено як no-op для сумісності викликів; повертає created: false.
 */
async function processReferralDriverListingReward(_prisma, _referredPersonId, _viberListingId) {
    return { created: false, awaitingPassengerProof: true };
}
/** @deprecated використовуйте unlockRegistrationReward після кваліфікації */
async function processReferralRegistrationReward(prisma, referredPersonId) {
    // Навмисно не нараховуємо при реєстрації
    void prisma;
    void referredPersonId;
    return { created: false };
}
/** @deprecated використовуйте processReferralRewardsAfterPassengerProof */
async function processReferralPassengerProofReward(prisma, proofId) {
    const r = await processReferralRewardsAfterPassengerProof(prisma, proofId);
    return {
        created: r.passengerRideCreated ||
            r.passengerSelfCreated ||
            r.registrationCreated ||
            r.driverQualifiedCreated,
        rewardId: r.passengerSelfRewardId ??
            r.passengerRewardId ??
            r.registrationRewardId ??
            r.driverQualifiedRewardId,
        flagged: r.flagged,
        limitReached: r.limitReached,
    };
}
async function getReferralStatsForPerson(prisma, personId) {
    const [invites, rewards, referredCount] = await Promise.all([
        prisma.referralInvite.findMany({
            where: { referrerId: personId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { referredPerson: { select: { fullName: true, phoneNormalized: true } } },
        }),
        prisma.referralReward.findMany({
            where: { referrerId: personId },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.person.count({ where: { referredByPersonId: personId } }),
    ]);
    /** Чекає перевірки фото — ще не в черзі виплат */
    const totalOnHoldUah = rewards
        .filter((r) => isRewardOnHold(r.status))
        .reduce((s, r) => s + r.amountUah, 0);
    /** Фото схвалено — стоїть у черзі виплат */
    const totalPayableUah = rewards
        .filter((r) => isRewardPayable(r.status))
        .reduce((s, r) => s + r.amountUah, 0);
    const totalPaidUah = rewards
        .filter((r) => r.status === exports.REWARD_STATUS_PAID)
        .reduce((s, r) => s + r.amountUah, 0);
    const flaggedCount = rewards.filter((r) => r.status === exports.REWARD_STATUS_FLAGGED).length;
    return {
        invites,
        rewards,
        referredCount,
        totalOnHoldUah,
        totalPayableUah,
        totalPaidUah,
        flaggedCount,
    };
}
function buildReferralProgramTermsHtml(referralLink) {
    return ('🎁 <b>Приведи друга — обидва в плюсі</b>\n\n' +
        'Поділись посиланням з тим, з ким їздите.\n' +
        'Коли друг проїде попуткою і підтвердить поїздку двома фото — <b>бонус отримуєте ви обидва</b> (поповнення мобільного) 💸\n\n' +
        `👤 Друг поїхав пасажиром — вам від <b>${exports.REFERRAL_REWARD_UAH.registration + exports.REFERRAL_REWARD_UAH.passenger_completed_ride} грн</b>, йому <b>${exports.REFERRAL_REWARD_UAH.passenger_self_confirm} грн</b>\n` +
        `🚗 Друг віз людей як водій — вам до <b>${exports.REFERRAL_REWARD_UAH.registration + exports.REFERRAL_REWARD_UAH.driver_qualified} грн</b>\n\n` +
        `🔗 Твоє посилання:\n<code>${referralLink}</code>\n\n` +
        '🌐 https://malin.kiev.ua/poputky\n' +
        '📜 Умови: https://malin.kiev.ua/about#referral-promo');
}
/** Inline-кнопки під промо «Приведи друга» (копіювання посилання + опційно дії в боті). */
function buildReferralProgramInlineKeyboard(referralLink, opts) {
    const rows = [
        [{ text: '🔗 Копіювати посилання', copy_text: { text: clipForTelegramCopyText(referralLink) } }],
    ];
    if (opts?.withInviteActions) {
        rows.push([{ text: '📲 Запросити за номером / @username', callback_data: 'referral_invite_contact' }], [{ text: '📊 Моя статистика', callback_data: 'referral_my_stats' }]);
    }
    return { inline_keyboard: rows };
}
/** Агрегат «скільки кому виплатити» по referrerId (отримувач нагороди). */
function buildPayoutBalancesFromRewards(rewards) {
    const map = new Map();
    for (const r of rewards) {
        let row = map.get(r.referrerId);
        if (!row) {
            row = {
                personId: r.referrer.id,
                fullName: r.referrer.fullName,
                phoneNormalized: r.referrer.phoneNormalized,
                telegramUsername: r.referrer.telegramUsername,
                payableUah: 0,
                payableCount: 0,
                holdUah: 0,
                holdCount: 0,
                paidUah: 0,
                flaggedUah: 0,
                rewardIds: [],
            };
            map.set(r.referrerId, row);
        }
        if (isRewardPayable(r.status)) {
            row.payableUah += r.amountUah;
            row.payableCount += 1;
            row.rewardIds.push(r.id);
        }
        else if (isRewardOnHold(r.status)) {
            row.holdUah += r.amountUah;
            row.holdCount += 1;
        }
        else if (r.status === exports.REWARD_STATUS_PAID) {
            row.paidUah += r.amountUah;
        }
        else if (r.status === exports.REWARD_STATUS_FLAGGED) {
            row.flaggedUah += r.amountUah;
        }
    }
    return [...map.values()].sort((a, b) => b.payableUah - a.payableUah || b.holdUah - a.holdUah || b.paidUah - a.paidUah);
}
/** Причина flag, коли отримувач заблокував бота — адмін бачить у нотатці/flagReason */
exports.BOT_BLOCKED_REWARD_FLAG_REASON = 'Бот Telegram заблоковано користувачем — прибрано з виплат';
/** Префікс ручного Flag в адмінці — heal / approve-фото такі рядки не чіпають */
exports.ADMIN_MANUAL_FLAG_PREFIX = '[admin] ';
/**
 * Спроба запросити себе з того самого Telegram-акаунта.
 * Захищена причина: схвалення фото НЕ розморожує ці гроші — потрібне рішення адміна.
 */
exports.SELF_REFERRAL_FLAG_REASON = 'Само-реферал: запрошення з того самого Telegram-акаунта — потрібна перевірка адміна';
function withAdminManualFlagReason(reason) {
    const trimmed = reason.trim() || 'Підозріла активність';
    if (trimmed.startsWith(exports.ADMIN_MANUAL_FLAG_PREFIX))
        return trimmed;
    return `${exports.ADMIN_MANUAL_FLAG_PREFIX}${trimmed}`;
}
function isProtectedFlagReason(flagReason) {
    if (!flagReason)
        return false;
    if (flagReason === exports.BOT_BLOCKED_REWARD_FLAG_REASON)
        return true;
    if (flagReason === exports.SELF_REFERRAL_FLAG_REASON)
        return true;
    if (flagReason === exports.REFERRAL_BUDGET_HOLD_REASON)
        return true;
    if (flagReason.startsWith(exports.ADMIN_MANUAL_FLAG_PREFIX))
        return true;
    return false;
}
/**
 * Заморозити всі невиплачені нагороди обох Person, задіяних у спробі само-реферала.
 * Причина захищена — зняти може лише адмін кнопкою «Схвалити».
 */
async function flagUnpaidRewardsForSelfReferral(prisma, personIds) {
    const ids = [...new Set(personIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0)
        return 0;
    const result = await prisma.referralReward.updateMany({
        where: {
            referrerId: { in: ids },
            status: { in: exports.REWARD_STATUSES_UNPAID },
        },
        data: {
            status: exports.REWARD_STATUS_FLAGGED,
            flagReason: exports.SELF_REFERRAL_FLAG_REASON,
        },
    });
    return result.count;
}
/**
 * Текст (без сум) для особистої розсилки після першого блоку бота.
 * Йде через user-account (Telethon) по номеру / @username.
 */
function buildBotBlockedPayoutsFrozenMessage(botUsername = 'malin_kiev_ua_bot') {
    const bot = botUsername.replace(/^@/, '').trim() || 'malin_kiev_ua_bot';
    return ('⏸️ Бонуси програми «Приведи друга» тимчасово на паузі\n\n' +
        'Ми не можемо писати вам у бот — схоже, бот заблоковано або чат недоступний.\n' +
        'Поки бот недоступний, виплати бонусів заморожено.\n\n' +
        'Щоб знову отримувати повідомлення й розблокувати виплати:\n' +
        `1) Відкрийте @${bot}\n` +
        '2) Натисніть «Розблокувати» (якщо бот у чорному списку)\n' +
        '3) Натисніть Start / напишіть /start\n\n' +
        `🤖 https://t.me/${bot}\n` +
        'Після цього ми зможемо продовжити обробку ваших бонусів. Дякуємо 💛');
}
/**
 * Усі невиплачені нагороди отримувача (referrerId) → flagged з явною причиною.
 * Викликається при детекції блоку бота.
 */
async function flagUnpaidReferralRewardsForBotBlocked(prisma, personId) {
    if (!Number.isInteger(personId) || personId <= 0)
        return 0;
    const result = await prisma.referralReward.updateMany({
        where: {
            referrerId: personId,
            status: { in: exports.REWARD_STATUSES_UNPAID },
        },
        data: {
            status: exports.REWARD_STATUS_FLAGGED,
            flagReason: exports.BOT_BLOCKED_REWARD_FLAG_REASON,
        },
    });
    return result.count;
}
/**
 * Позначити нагороди людини як виплачені. Платимо лише те, що схвалене (approved).
 * Транзакція + статус у самому updateMany: подвійний клік не перезапише вже виплачене.
 */
async function markReferralPayout(prisma, opts) {
    const note = opts.note?.trim() || null;
    return prisma.$transaction(async (tx) => {
        const where = {
            referrerId: opts.personId,
            status: exports.REWARD_STATUS_APPROVED,
            ...(opts.rewardIds?.length ? { id: { in: opts.rewardIds } } : {}),
        };
        const toPay = await tx.referralReward.findMany({
            where,
            select: { id: true, amountUah: true },
        });
        if (toPay.length === 0) {
            return { updatedCount: 0, amountUah: 0, rewardIds: [] };
        }
        const paidAt = new Date();
        const paidIds = [];
        let amountUah = 0;
        for (const reward of toPay) {
            // статус повторно у where — паралельна виплата не спрацює двічі
            const updated = await tx.referralReward.updateMany({
                where: { id: reward.id, status: exports.REWARD_STATUS_APPROVED },
                data: {
                    status: exports.REWARD_STATUS_PAID,
                    paidAt,
                    ...(note != null ? { payoutNote: note } : {}),
                },
            });
            if (updated.count > 0) {
                paidIds.push(reward.id);
                amountUah += reward.amountUah;
            }
        }
        return { updatedCount: paidIds.length, amountUah, rewardIds: paidIds };
    });
}
/** Дата YYYY-MM-DD → DD.MM.YYYY для посту */
function formatRideDateKeyUa(dateKey) {
    const m = dateKey.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m)
        return dateKey;
    return `${m[3]}.${m[2]}.${m[1]}`;
}
/** Ліміт Telegram CopyTextButton */
exports.TELEGRAM_COPY_TEXT_MAX_CHARS = 256;
/** Обрізати для copy_text (Telegram: max 256 символів) */
function clipForTelegramCopyText(text) {
    const chars = [...text];
    if (chars.length <= exports.TELEGRAM_COPY_TEXT_MAX_CHARS)
        return text;
    return chars.slice(0, exports.TELEGRAM_COPY_TEXT_MAX_CHARS).join('');
}
/**
 * Текст для Facebook-посту пасажира після підтвердження поїздки фото.
 * Тримати ≤256 символів — щоб кнопка «Копіювати текст посту» працювала.
 */
function buildRideFacebookShareCaption(opts) {
    const routeNice = opts.route.replace(/-/g, ' → ');
    const dateNice = formatRideDateKeyUa(opts.dateKey);
    return (`Сьогодні їхав(ла) попуткою ${routeNice} 🚗\n` +
        `(${dateNice})\n\n` +
        `Попутки Малин↔Київ у боті + бонус на мобільний 💸\n` +
        `${opts.referralLink}\n` +
        `🌐 malin.kiev.ua/poputky\n` +
        `#Малин #Київ #Попутки #КиївМалин #malinkievua`);
}
function buildRideFacebookSharePromptHtml(caption) {
    const escaped = caption
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return ('📢 <b>Поділись у Facebook — це займає хвилину</b>\n\n' +
        '1️⃣ Збережи два фото <b>вище</b> (утримуй → Зберегти).\n' +
        '2️⃣ Натисни «Відкрити Facebook» або створи пост сам.\n' +
        '3️⃣ Додай обидва фото і встав текст — кнопка <b>«Копіювати текст посту»</b> нижче.\n\n' +
        'У тексті вже <b>твоє персональне посилання</b> — друзі зайдуть саме по ньому 🎁\n\n' +
        `<code>${escaped}</code>\n\n` +
        '<i>Facebook не дає автозаповнити текст і фото з бота — потрібні 2 кроки: кнопка + вставка.</i>\n' +
        'Так більше людей знайдуть попутку. Дякуємо 💛');
}
/** Кнопки під фінальним повідомленням про Facebook-пост */
function buildFacebookShareInlineKeyboard(referralLink, caption) {
    const fbShareUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(referralLink);
    return {
        inline_keyboard: [
            [{ text: '📘 Відкрити Facebook', url: fbShareUrl }],
            [{ text: '🔗 Копіювати моє посилання', copy_text: { text: clipForTelegramCopyText(referralLink) } }],
            [
                {
                    text: '📋 Копіювати текст посту',
                    copy_text: { text: clipForTelegramCopyText(caption) },
                },
            ],
        ],
    };
}
/**
 * Якщо фото вже схвалене, а нагороди лишились на hold або flagged (старий approve без каскаду) —
 * підтягуємо їх у чергу виплат.
 * Не чіпаємо ручний Flag адміна ([admin]) і блок бота — їх знімає лише явна кнопка «Схвалити».
 */
async function syncFlaggedRewardsForApprovedProofs(prisma) {
    const approved = await prisma.rideCompletionProof.findMany({
        where: { status: 'approved' },
        select: { id: true },
    });
    if (approved.length === 0)
        return 0;
    const candidates = await prisma.referralReward.findMany({
        where: {
            rideProofId: { in: approved.map((p) => p.id) },
            status: { in: [...exports.REWARD_STATUSES_ON_HOLD, exports.REWARD_STATUS_FLAGGED] },
        },
        select: { id: true, flagReason: true },
    });
    const ids = candidates.filter((r) => !isProtectedFlagReason(r.flagReason)).map((r) => r.id);
    if (ids.length === 0)
        return 0;
    const result = await prisma.referralReward.updateMany({
        where: { id: { in: ids } },
        data: { status: exports.REWARD_STATUS_APPROVED, flagReason: null },
    });
    return result.count;
}
/**
 * Id нагород, які схвалення фото переводить у чергу виплат: hold (легасі pending) і flagged
 * без ручного [admin] Flag та без блоку бота.
 */
async function findUnlockableFlaggedRewardIds(
// PrismaClient або transaction client
prisma, opts) {
    const candidates = await prisma.referralReward.findMany({
        where: {
            status: { in: [...exports.REWARD_STATUSES_ON_HOLD, exports.REWARD_STATUS_FLAGGED] },
            OR: [
                { rideProofId: opts.proofId },
                {
                    referredPersonId: opts.personId,
                    OR: [{ rideProofId: opts.proofId }, { rideProofId: null }],
                },
            ],
        },
        select: { id: true, flagReason: true },
    });
    return candidates.filter((r) => !isProtectedFlagReason(r.flagReason)).map((r) => r.id);
}
async function buildAdminReferralReport(prisma) {
    await syncFlaggedRewardsForApprovedProofs(prisma);
    const budget = await getReferralBudgetStatus(prisma);
    const rewards = await prisma.referralReward.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            referrer: { select: { id: true, fullName: true, phoneNormalized: true, telegramUsername: true } },
            referredPerson: { select: { id: true, fullName: true, phoneNormalized: true, telegramUsername: true } },
            viberListing: { select: { id: true, route: true, date: true, listingType: true } },
            rideProof: { select: { id: true, route: true, rideDate: true, photoStartFileId: true, photoEndFileId: true } },
        },
    });
    const flagged = rewards.filter((r) => r.status === exports.REWARD_STATUS_FLAGGED);
    /** Нараховано, але фото ще не схвалене — у виплати не йде */
    const onHold = rewards.filter((r) => isRewardOnHold(r.status));
    const paid = rewards.filter((r) => r.status === exports.REWARD_STATUS_PAID);
    const payoutBalances = buildPayoutBalancesFromRewards(rewards);
    const invites = await prisma.referralInvite.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
            referrer: { select: { fullName: true, phoneNormalized: true } },
            referredPerson: { select: { fullName: true, phoneNormalized: true } },
        },
    });
    const referredPersons = await prisma.person.findMany({
        where: { referredByPersonId: { not: null } },
        include: {
            referredByPerson: { select: { fullName: true, phoneNormalized: true, id: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
    const proofs = await prisma.rideCompletionProof.findMany({
        where: { photoStartFileId: { not: null }, photoEndFileId: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 80,
        include: {
            person: {
                select: {
                    id: true,
                    fullName: true,
                    phoneNormalized: true,
                    telegramChatId: true,
                    telegramUsername: true,
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
                orderBy: { id: 'asc' },
            },
        },
    });
    const payablePeople = payoutBalances.filter((p) => p.payableUah > 0);
    return {
        summary: {
            totalRewards: rewards.length,
            onHoldCount: onHold.length,
            onHoldUah: onHold.reduce((s, r) => s + r.amountUah, 0),
            paidCount: paid.length,
            paidUah: paid.reduce((s, r) => s + r.amountUah, 0),
            flaggedCount: flagged.length,
            flaggedUah: flagged.reduce((s, r) => s + r.amountUah, 0),
            referredPersonsCount: referredPersons.length,
            payablePeopleCount: payablePeople.length,
            payableUah: payablePeople.reduce((s, p) => s + p.payableUah, 0),
            personWarnLimitUah: exports.REFERRAL_PERSON_TOTAL_WARN_UAH,
        },
        budget,
        payoutBalances,
        rewards,
        flagged,
        invites,
        referredPersons,
        promoPhotoProofs: proofs,
    };
}
