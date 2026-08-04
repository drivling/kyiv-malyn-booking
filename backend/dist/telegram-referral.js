"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rideProofFlowStateMap = exports.referralFlowStateMap = exports.pendingReferralCodeMap = void 0;
exports.storePendingReferralCode = storePendingReferralCode;
exports.takePendingReferralCode = takePendingReferralCode;
exports.handleReferralStartParam = handleReferralStartParam;
exports.sendInviteProgramMessage = sendInviteProgramMessage;
exports.startReferralInviteFlow = startReferralInviteFlow;
exports.handleReferralContactInput = handleReferralContactInput;
exports.onReferralRegistration = onReferralRegistration;
exports.startRideProofFlow = startRideProofFlow;
exports.handleRideProofCallback = handleRideProofCallback;
exports.handleReferralCallback = handleReferralCallback;
exports.handleRideProofPhoto = handleRideProofPhoto;
exports.buildReferralHelpSection = buildReferralHelpSection;
const referral_1 = require("./referral");
/** chatId -> referrerPersonId з ?start=ref_CODE до реєстрації */
exports.pendingReferralCodeMap = new Map();
exports.referralFlowStateMap = new Map();
exports.rideProofFlowStateMap = new Map();
const FLOW_TTL_MS = 30 * 60 * 1000;
function isFlowExpired(since) {
    return Date.now() - since > FLOW_TTL_MS;
}
function storePendingReferralCode(chatId, referrerPersonId, code) {
    exports.pendingReferralCodeMap.set(chatId, { referrerPersonId, code });
}
function takePendingReferralCode(chatId) {
    const entry = exports.pendingReferralCodeMap.get(chatId);
    exports.pendingReferralCodeMap.delete(chatId);
    return entry?.code ?? null;
}
async function handleReferralStartParam(prisma, chatId, rawStart) {
    if (!rawStart.startsWith('ref_'))
        return false;
    const code = rawStart.replace(/^ref_/i, '').trim();
    if (!code)
        return false;
    const referrer = await (0, referral_1.findReferrerByCode)(prisma, code);
    if (!referrer)
        return false;
    storePendingReferralCode(chatId, referrer.id, code);
    return true;
}
async function sendInviteProgramMessage(bot, prisma, chatId, personId, botUsername) {
    const code = await (0, referral_1.ensurePersonReferralCode)(prisma, personId);
    const link = (0, referral_1.getReferralBotLink)(botUsername, code);
    const stats = await (0, referral_1.getReferralStatsForPerson)(prisma, personId);
    const keyboard = {
        inline_keyboard: [
            [{ text: '📲 Запросити за номером / @username', callback_data: 'referral_invite_contact' }],
            [{ text: '📊 Моя статистика', callback_data: 'referral_my_stats' }],
        ],
    };
    let extra = `\n\n📊 Запрошено: ${stats.referredCount} | Очікує виплати: <b>${stats.totalPendingUah} грн</b>`;
    if (stats.totalPaidUah > 0)
        extra += ` | Виплачено: ${stats.totalPaidUah} грн`;
    await bot.sendMessage(chatId, (0, referral_1.buildReferralProgramTermsHtml)(link) + extra, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
    });
}
async function startReferralInviteFlow(bot, chatId) {
    exports.referralFlowStateMap.set(chatId, { state: 'referral_flow', step: 'await_contact', since: Date.now() });
    await bot.sendMessage(chatId, '📲 <b>Запросити друга</b>\n\n' +
        'Надішліть номер телефону друга (0501234567) або його Telegram @username.\n\n' +
        'Друг має зареєструватися в боті та додати попутку як водій або пасажир.', { parse_mode: 'HTML' });
}
async function handleReferralContactInput(bot, prisma, chatId, personId, text) {
    const flow = exports.referralFlowStateMap.get(chatId);
    if (!flow || flow.step !== 'await_contact' || isFlowExpired(flow.since)) {
        exports.referralFlowStateMap.delete(chatId);
        return false;
    }
    const result = await (0, referral_1.createReferralInvite)(prisma, personId, text);
    exports.referralFlowStateMap.delete(chatId);
    if (!result.ok) {
        await bot.sendMessage(chatId, `❌ ${result.error}`, { parse_mode: 'HTML' });
        return true;
    }
    await bot.sendMessage(chatId, `✅ <b>Запрошення збережено!</b>\n\n` +
        `Контакт: ${result.display}\n\n` +
        'Коли друг проїде і підтвердить поїздку фото — ви обидва отримаєте бонус 💸\n' +
        'Надішліть йому своє посилання з /invite.', { parse_mode: 'HTML' });
    return true;
}
/** Лише прив'язка реферера. Гроші — після підтвердження поїздки. */
async function onReferralRegistration(prisma, personId, phoneNormalized, telegramUsername, referralCodeFromStart, notifyAdmin) {
    const { linked, referrerId } = await (0, referral_1.linkReferralOnRegistration)(prisma, personId, phoneNormalized, telegramUsername, referralCodeFromStart);
    if (!linked || !referrerId)
        return;
    if (notifyAdmin) {
        notifyAdmin(`🎁 <b>Реферал: новий зв'язок</b>\n` +
            `Запрошений Person #${personId}\n` +
            `Реферер Person #${referrerId}\n` +
            `<i>Нагорода ще не нарахована — чекаємо підтвердження поїздки.</i>`);
    }
}
async function startRideProofFlow(bot, prisma, chatId, personId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const listings = await prisma.viberListing.findMany({
        where: {
            personId,
            listingType: 'passenger',
            date: { lte: today },
        },
        orderBy: { date: 'desc' },
        take: 10,
    });
    const existingProofListingIds = new Set((await prisma.rideCompletionProof.findMany({
        where: { personId, viberListingId: { not: null } },
        select: { viberListingId: true },
    }))
        .map((p) => p.viberListingId)
        .filter((id) => id != null));
    const available = listings.filter((l) => !existingProofListingIds.has(l.id));
    if (available.length === 0) {
        await bot.sendMessage(chatId, '📷 <b>Підтвердження поїздки</b>\n\n' +
            'Немає завершених поїздок пасажира для підтвердження.\n\n' +
            'Спочатку додайте запит як пасажир (/addpassengerride), а після поїздки надішліть фото.', { parse_mode: 'HTML' });
        return;
    }
    const buttons = available.slice(0, 8).map((l) => {
        const dateStr = l.date.toISOString().slice(0, 10);
        return [{ text: `${l.route} ${dateStr}`, callback_data: `rideproof_select_${l.id}` }];
    });
    buttons.push([{ text: '❌ Скасувати', callback_data: 'rideproof_cancel' }]);
    exports.rideProofFlowStateMap.set(chatId, { state: 'ride_proof_flow', step: 'select_listing', since: Date.now() });
    await bot.sendMessage(chatId, '📷 <b>Підтвердження поїздки</b>\n\n' +
        'Оберіть поїздку, яку хочете підтвердити.\n\n' +
        '📸 Далі надішліть:\n' +
        '1️⃣ Фото на <b>місці відправлення</b> (з табличкою/орієнтиром)\n' +
        '2️⃣ Фото <b>після прибуття</b> (наприклад, на зупинці чи біля авто)\n\n' +
        '<i>Фото використаємо для рекламного посту — зробіть їх охайними 🙂</i>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
}
async function handleRideProofCallback(bot, prisma, chatId, personId, data) {
    if (data === 'rideproof_cancel') {
        exports.rideProofFlowStateMap.delete(chatId);
        await bot.sendMessage(chatId, 'Скасовано.');
        return true;
    }
    const selectMatch = data.match(/^rideproof_select_(\d+)$/);
    if (selectMatch) {
        const listingId = parseInt(selectMatch[1], 10);
        const listing = await prisma.viberListing.findFirst({
            where: { id: listingId, personId, listingType: 'passenger' },
        });
        if (!listing) {
            await bot.sendMessage(chatId, '❌ Поїздку не знайдено.');
            return true;
        }
        const proof = await prisma.rideCompletionProof.create({
            data: {
                personId,
                viberListingId: listingId,
                route: listing.route,
                rideDate: listing.date,
                departureTime: listing.departureTime,
                status: 'awaiting_photos',
            },
        });
        exports.rideProofFlowStateMap.set(chatId, {
            state: 'ride_proof_flow',
            step: 'photo_start',
            viberListingId: listingId,
            proofId: proof.id,
            since: Date.now(),
        });
        await bot.sendMessage(chatId, `📷 Поїздка: <b>${listing.route}</b> (${listing.date.toISOString().slice(0, 10)})\n\n` +
            '📸 Надішліть <b>перше фото</b> — на місці відправлення.\n\n' +
            '<i>Порада: зніміть себе або авто біля зупинки/місця збору — так краще для рекламного посту.</i>', { parse_mode: 'HTML' });
        return true;
    }
    return false;
}
async function handleReferralCallback(bot, prisma, chatId, personId, botUsername, data) {
    if (data === 'referral_invite_contact') {
        await startReferralInviteFlow(bot, chatId);
        return true;
    }
    if (data === 'referral_my_stats') {
        const stats = await (0, referral_1.getReferralStatsForPerson)(prisma, personId);
        const lines = stats.rewards.slice(0, 15).map((r) => {
            const typeLabel = r.rewardType === 'registration'
                ? 'Бонус за друга'
                : r.rewardType === 'driver_qualified' || r.rewardType === 'driver_first_listing'
                    ? 'Друг-водій'
                    : r.rewardType === 'passenger_self_confirm'
                        ? 'Моє підтвердження'
                        : 'Друг-пасажир';
            return `• ${typeLabel}: ${r.amountUah} грн — ${r.status}`;
        });
        await bot.sendMessage(chatId, `📊 <b>Ваша реферальна статистика</b>\n\n` +
            `Запрошено друзів: ${stats.referredCount}\n` +
            `Очікує виплати: <b>${stats.totalPendingUah} грн</b>\n` +
            `Виплачено: ${stats.totalPaidUah} грн\n\n` +
            (lines.length ? `<b>Останні нагороди:</b>\n${lines.join('\n')}` : 'Поки немає нагород.'), { parse_mode: 'HTML' });
        return true;
    }
    return false;
}
async function handleRideProofPhoto(bot, prisma, chatId, personId, photoFileId, notifyAdmin) {
    const flow = exports.rideProofFlowStateMap.get(chatId);
    if (!flow || isFlowExpired(flow.since)) {
        exports.rideProofFlowStateMap.delete(chatId);
        return false;
    }
    if (flow.step === 'photo_start' && flow.proofId) {
        await prisma.rideCompletionProof.update({
            where: { id: flow.proofId },
            data: { photoStartFileId: photoFileId },
        });
        exports.rideProofFlowStateMap.set(chatId, { ...flow, step: 'photo_end', photoStartFileId: photoFileId, since: Date.now() });
        await bot.sendMessage(chatId, '✅ Перше фото збережено!\n\n📸 Тепер надішліть <b>друге фото</b> — після прибуття в пункт призначення.', { parse_mode: 'HTML' });
        return true;
    }
    if (flow.step === 'photo_end' && flow.proofId) {
        const proof = await prisma.rideCompletionProof.update({
            where: { id: flow.proofId },
            data: { photoEndFileId: photoFileId, status: 'pending_review' },
        });
        exports.rideProofFlowStateMap.delete(chatId);
        const rewardResult = await (0, referral_1.processReferralRewardsAfterPassengerProof)(prisma, flow.proofId);
        let rewardText = '';
        if (rewardResult.flagged) {
            rewardText = '\n\n⚠️ Поїздку передано на перевірку адміністратору.';
        }
        else if (rewardResult.passengerSelfCreated) {
            rewardText =
                `\n\n💸 Вам нараховано <b>${rewardResult.passengerSelfUah} грн</b> за підтвердження` +
                    (rewardResult.passengerReferrerId
                        ? ` — і ваш друг також отримає бонус`
                        : '') +
                    '!';
        }
        else if (rewardResult.limitReached) {
            rewardText = '\n\nДякуємо! Бонусний ліміт за підтвердження вже використано.';
        }
        await bot.sendMessage(chatId, '✅ <b>Круто! Поїздку підтверджено.</b>\n\n' +
            'Фото прийнято. Дякуємо, що ділитесь дорогою з нами 🚗' +
            rewardText, { parse_mode: 'HTML' });
        if (notifyAdmin && proof.photoStartFileId) {
            const parts = [
                `📷 <b>Нове підтвердження поїздки #${flow.proofId}</b>`,
                `Person #${personId}`,
                `Маршрут: ${proof.route}`,
                `Дата: ${proof.rideDate.toISOString().slice(0, 10)}`,
            ];
            if (rewardResult.passengerSelfCreated) {
                parts.push(`💸 +${rewardResult.passengerSelfUah} грн самому пасажиру #${personId}`);
            }
            if (rewardResult.passengerRideCreated) {
                parts.push(`👤 +${referral_1.REFERRAL_REWARD_UAH.passenger_completed_ride} грн запрошувачу #${rewardResult.passengerReferrerId}`);
            }
            if (rewardResult.registrationCreated) {
                parts.push(`📝 +${referral_1.REFERRAL_REWARD_UAH.registration} грн (бонус за друга)`);
            }
            if (rewardResult.driverQualifiedCreated) {
                parts.push(`🚗 +${referral_1.REFERRAL_REWARD_UAH.driver_qualified} грн (водій) → #${rewardResult.driverReferrerId}`);
            }
            if (rewardResult.flagged)
                parts.push('⚠️ <b>Позначено підозрілим розкладом</b>');
            notifyAdmin(parts.join('\n'), [proof.photoStartFileId, photoFileId]);
        }
        return true;
    }
    return false;
}
function buildReferralHelpSection() {
    return ('\n\n🎁 <b>Акція «Приведи друга»</b>\n' +
        '/invite — ваше посилання та запрошення\n' +
        '/confirmride — підтвердити поїздку пасажира (фото до/після)');
}
