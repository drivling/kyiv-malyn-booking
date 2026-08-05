"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_REFERRAL_CODE_TTL_DAYS = exports.rideProofFlowStateMap = exports.referralFlowStateMap = void 0;
exports.storePendingReferralCode = storePendingReferralCode;
exports.takePendingReferralCode = takePendingReferralCode;
exports.cleanupExpiredPendingReferralCodes = cleanupExpiredPendingReferralCodes;
exports.handleReferralStartParam = handleReferralStartParam;
exports.sendReferralTeaser = sendReferralTeaser;
exports.sendInviteProgramMessage = sendInviteProgramMessage;
exports.startReferralInviteFlow = startReferralInviteFlow;
exports.handleReferralContactInput = handleReferralContactInput;
exports.onReferralRegistration = onReferralRegistration;
exports.startRideProofFlow = startRideProofFlow;
exports.handleRideProofCallback = handleRideProofCallback;
exports.handleReferralCallback = handleReferralCallback;
exports.handleRideProofPhoto = handleRideProofPhoto;
exports.remindRideProofExpectsPhoto = remindRideProofExpectsPhoto;
exports.buildReferralHelpSection = buildReferralHelpSection;
const referral_1 = require("./referral");
exports.referralFlowStateMap = new Map();
exports.rideProofFlowStateMap = new Map();
const FLOW_TTL_MS = 30 * 60 * 1000;
/** Скільки живе код із ?start=ref_CODE, поки людина не надіслала номер */
exports.PENDING_REFERRAL_CODE_TTL_DAYS = 7;
function isFlowExpired(since) {
    return Date.now() - since > FLOW_TTL_MS;
}
/**
 * Запамʼятати реферальний код до реєстрації номера.
 * Зберігаємо в БД: перезапуск бота не має губити реферера.
 * Новий перехід за іншим посиланням замінює попередній.
 */
async function storePendingReferralCode(prisma, chatId, referrerPersonId, code) {
    const expiresAt = new Date(Date.now() + exports.PENDING_REFERRAL_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
    await prisma.pendingReferralCode.upsert({
        where: { telegramChatId: chatId },
        create: { telegramChatId: chatId, code, referrerPersonId, expiresAt },
        update: { code, referrerPersonId, expiresAt },
    });
}
/** Забрати збережений код (одноразово). Протермінований не повертаємо. */
async function takePendingReferralCode(prisma, chatId) {
    const entry = await prisma.pendingReferralCode.findUnique({
        where: { telegramChatId: chatId },
        select: { code: true, expiresAt: true },
    });
    if (!entry)
        return null;
    await prisma.pendingReferralCode
        .delete({ where: { telegramChatId: chatId } })
        .catch(() => undefined);
    return entry.expiresAt.getTime() >= Date.now() ? entry.code : null;
}
/** Прибрати протерміновані коди (виклик при старті бота і раз на добу) */
async function cleanupExpiredPendingReferralCodes(prisma) {
    const result = await prisma.pendingReferralCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
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
    await storePendingReferralCode(prisma, chatId, referrer.id, code);
    return true;
}
/**
 * Короткий тизер акції для входу в бот (/start, реєстрація номера).
 * Повний текст — лише за явним інтересом: /invite, кнопка меню або «Дізнатись більше».
 */
async function sendReferralTeaser(bot, chatId) {
    await bot.sendMessage(chatId, '🎁 <b>Приведи друга — обидва в плюсі</b>\n' +
        'Друг проїде попуткою і підтвердить поїздку фото — бонус на мобільний отримаєте обидва.', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎁 Дізнатись більше', callback_data: 'referral_show_program' }],
            ],
        },
    });
}
async function sendInviteProgramMessage(bot, prisma, chatId, personId, botUsername) {
    const code = await (0, referral_1.ensurePersonReferralCode)(prisma, personId);
    const link = (0, referral_1.getReferralBotLink)(botUsername, code);
    const stats = await (0, referral_1.getReferralStatsForPerson)(prisma, personId);
    const keyboard = (0, referral_1.buildReferralProgramInlineKeyboard)(link, { withInviteActions: true });
    let extra = `\n\n📊 Запрошено: ${stats.referredCount}`;
    if (stats.totalPayableUah > 0)
        extra += ` | До виплати: <b>${stats.totalPayableUah} грн</b>`;
    if (stats.totalOnHoldUah > 0)
        extra += ` | На перевірці: ${stats.totalOnHoldUah} грн`;
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
        if (result.alreadyOurUser || result.selfReferral) {
            await bot.sendMessage(chatId, result.error, { parse_mode: 'HTML' });
        }
        else {
            await bot.sendMessage(chatId, `❌ ${result.error}`, { parse_mode: 'HTML' });
        }
        return true;
    }
    let extra = '';
    if (result.alreadyInClientsDb) {
        extra =
            '\n\nℹ️ Цей контакт уже був у нашій базі клієнтів — бонус «за нового друга» не нарахується, ' +
                'але за підтверджені поїздки бонуси будуть як завжди 💛';
    }
    await bot.sendMessage(chatId, `✅ <b>Запрошення збережено!</b>\n\n` +
        `Контакт: ${result.display}\n\n` +
        'Коли друг проїде і підтвердить поїздку фото — ви обидва отримаєте бонус 💸\n' +
        'Надішліть йому своє посилання з /invite.' +
        extra, { parse_mode: 'HTML' });
    return true;
}
/** Лише прив'язка реферера. Гроші — після підтвердження поїздки. */
async function onReferralRegistration(prisma, personId, phoneNormalized, telegramUsername, referralCodeFromStart, notifyAdmin, personWasNewToClientsDb) {
    const { linked, referrerId, registrationBonusEligible, selfReferralBlocked } = await (0, referral_1.linkReferralOnRegistration)(prisma, personId, phoneNormalized, telegramUsername, referralCodeFromStart, personWasNewToClientsDb);
    if (selfReferralBlocked && referrerId) {
        const frozen = await (0, referral_1.flagUnpaidRewardsForSelfReferral)(prisma, [referrerId, personId]).catch((err) => {
            console.error('Self-referral freeze:', err);
            return 0;
        });
        console.warn(`🚨 Само-реферал заблоковано: Person #${personId} ← реферер Person #${referrerId}, заморожено нагород: ${frozen}`);
        notifyAdmin?.(`🚨 <b>Реферал: спроба запросити себе</b>\n` +
            `Другий номер у тому самому Telegram-акаунті.\n\n` +
            `Запрошений Person #${personId} (${phoneNormalized})\n` +
            `Реферер Person #${referrerId}\n\n` +
            `Звʼязок <b>не створено</b>.\n` +
            (frozen > 0
                ? `❄️ Заморожено невиплачених нагород: <b>${frozen}</b> — дивіться «Підозрілі нагороди» в адмінці.`
                : `Невиплачених нагород не було.`));
        return;
    }
    if (!linked || !referrerId)
        return;
    if (notifyAdmin) {
        notifyAdmin(`🎁 <b>Реферал: новий зв'язок</b>\n` +
            `Запрошений Person #${personId}\n` +
            `Реферер Person #${referrerId}\n` +
            (registrationBonusEligible === false
                ? `<i>Уже був у базі клієнтів — без 10 грн за залучення; бонуси лише за підтверджені поїздки.</i>`
                : `<i>Нагорода ще не нарахована — чекаємо підтвердження поїздки.</i>`));
    }
}
/** Антиспам: скільки підтверджень поїздки людина вже подала сьогодні */
async function isRideProofDailyLimitReached(prisma, personId) {
    const today = await (0, referral_1.countRideProofsToday)(prisma, personId);
    return today >= referral_1.MAX_RIDE_PROOFS_PER_DAY;
}
const RIDE_PROOF_CANCEL_KEYBOARD = {
    inline_keyboard: [[{ text: '❌ Скасувати', callback_data: 'rideproof_cancel' }]],
};
/**
 * Чати, де просто зараз обробляється фото.
 * Альбом приходить двома апдейтами майже одночасно — без замка обидва прочитали б однаковий крок.
 */
const rideProofPhotoLocks = new Set();
const RIDE_PROOF_LIMIT_MESSAGE = '🚦 <b>На сьогодні досить</b>\n\n' +
    `Одна людина може підтвердити не більше ${referral_1.MAX_RIDE_PROOFS_PER_DAY} поїздок на добу.\n` +
    'Спробуйте завтра — уже надіслані фото нікуди не зникнуть.';
async function startRideProofFlow(bot, prisma, chatId, personId) {
    if (await isRideProofDailyLimitReached(prisma, personId)) {
        await bot.sendMessage(chatId, RIDE_PROOF_LIMIT_MESSAGE, { parse_mode: 'HTML' });
        return;
    }
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
    // Блокуємо лише активні / вже прийняті заявки. rejected і незавершені awaiting_photos —
    // можна знову обрати й надіслати фото.
    const blockingProofListingIds = new Set((await prisma.rideCompletionProof.findMany({
        where: {
            personId,
            viberListingId: { not: null },
            status: { in: ['pending_review', 'approved', 'flagged'] },
        },
        select: { viberListingId: true },
    }))
        .map((p) => p.viberListingId)
        .filter((id) => id != null));
    const available = listings.filter((l) => !blockingProofListingIds.has(l.id));
    if (available.length === 0) {
        await bot.sendMessage(chatId, '📷 <b>Підтвердження поїздки</b>\n\n' +
            'Немає завершених поїздок пасажира для підтвердження (або всі вже на перевірці / схвалені).\n\n' +
            'Якщо фото відхилили — оберіть ту саму поїздку знову після /confirmride.\n' +
            'Інакше спочатку додайте запит як пасажир (/addpassengerride).', { parse_mode: 'HTML' });
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
        '⚠️ <b>По одному фото за раз</b>, не альбомом — інакше друге може загубитись.\n\n' +
        '<i>Фото використаємо для рекламного посту — зробіть їх охайними 🙂</i>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
}
async function handleRideProofCallback(bot, prisma, chatId, personId, data, botUsername = 'malin_kiev_ua_bot') {
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
        const existingProof = await prisma.rideCompletionProof.findFirst({
            where: { personId, viberListingId: listingId },
            orderBy: { updatedAt: 'desc' },
        });
        if (existingProof &&
            (existingProof.status === 'pending_review' ||
                existingProof.status === 'approved' ||
                existingProof.status === 'flagged')) {
            await bot.sendMessage(chatId, existingProof.status === 'approved'
                ? '✅ Цю поїздку вже підтверджено.'
                : '⏳ Фото по цій поїздці вже на перевірці. Зачекайте рішення модератора.');
            return true;
        }
        // Нове підтвердження впирається в добовий ліміт; повторне фото по старому — ні
        if (!existingProof && (await isRideProofDailyLimitReached(prisma, personId))) {
            exports.rideProofFlowStateMap.delete(chatId);
            await bot.sendMessage(chatId, RIDE_PROOF_LIMIT_MESSAGE, { parse_mode: 'HTML' });
            return true;
        }
        const proof = existingProof
            ? await prisma.rideCompletionProof.update({
                where: { id: existingProof.id },
                data: {
                    photoStartFileId: null,
                    photoEndFileId: null,
                    status: 'awaiting_photos',
                    rejectionReason: null,
                    flagReason: null,
                    route: listing.route,
                    rideDate: listing.date,
                    departureTime: listing.departureTime,
                },
            })
            : await prisma.rideCompletionProof.create({
                data: {
                    personId,
                    viberListingId: listingId,
                    route: listing.route,
                    rideDate: listing.date,
                    departureTime: listing.departureTime,
                    status: 'awaiting_photos',
                },
            });
        const isResubmit = !!existingProof && existingProof.status === 'rejected';
        exports.rideProofFlowStateMap.set(chatId, {
            state: 'ride_proof_flow',
            step: 'photo_start',
            viberListingId: listingId,
            proofId: proof.id,
            since: Date.now(),
        });
        await bot.sendMessage(chatId, `📷 Поїздка: <b>${listing.route}</b> (${listing.date.toISOString().slice(0, 10)})\n\n` +
            (isResubmit
                ? '♻️ Попередні фото було відхилено — надішліть <b>нові</b>.\n\n'
                : '') +
            '📸 Надішліть <b>перше фото</b> — на місці відправлення.\n' +
            '⚠️ Одним повідомленням, не альбомом.\n\n' +
            '<i>Порада: зніміть себе або авто біля зупинки/місця збору — так краще для рекламного посту.</i>', { parse_mode: 'HTML', reply_markup: RIDE_PROOF_CANCEL_KEYBOARD });
        return true;
    }
    return false;
}
/** Технічні статуси нагороди — людською мовою для клієнта */
function describeRewardStatusForUser(status) {
    if (status === 'approved')
        return 'до виплати';
    if (status === 'paid')
        return 'виплачено';
    if (status === 'flagged')
        return 'потребує уваги';
    return 'чекає перевірки';
}
async function handleReferralCallback(bot, prisma, chatId, personId, botUsername, data) {
    if (data === 'referral_show_program') {
        await sendInviteProgramMessage(bot, prisma, chatId, personId, botUsername);
        return true;
    }
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
            return `• ${typeLabel}: ${r.amountUah} грн — ${describeRewardStatusForUser(r.status)}`;
        });
        const hints = [];
        if (stats.totalOnHoldUah > 0) {
            hints.push('⏳ «Чекає перевірки» — модератор ще не подивився фото поїздки.');
        }
        if (stats.totalPayableUah > 0) {
            hints.push('💸 «До виплати» — фото схвалено, чекайте поповнення мобільного.');
        }
        if (stats.flaggedCount > 0) {
            hints.push('🚩 «Потребує уваги» — щось не зійшлося. Напишіть нам, розберемось.');
        }
        await bot.sendMessage(chatId, `📊 <b>Ваша реферальна статистика</b>\n\n` +
            `Запрошено друзів: ${stats.referredCount}\n` +
            `Чекає перевірки: ${stats.totalOnHoldUah} грн\n` +
            `До виплати: <b>${stats.totalPayableUah} грн</b>\n` +
            `Виплачено: ${stats.totalPaidUah} грн\n\n` +
            (lines.length ? `<b>Останні нагороди:</b>\n${lines.join('\n')}\n\n` : 'Поки немає нагород.\n\n') +
            hints.join('\n'), { parse_mode: 'HTML' });
        return true;
    }
    return false;
}
async function handleRideProofPhoto(bot, prisma, chatId, personId, photoFileId, notifyAdmin, botUsername = 'malin_kiev_ua_bot') {
    const flow = exports.rideProofFlowStateMap.get(chatId);
    if (!flow || isFlowExpired(flow.since)) {
        exports.rideProofFlowStateMap.delete(chatId);
        return false;
    }
    // Друге фото з альбому приходить, поки перше ще пишеться — просимо надіслати окремо
    if (rideProofPhotoLocks.has(chatId)) {
        await bot
            .sendMessage(chatId, '⏳ Обробляю попереднє фото.\n\n' +
            'Схоже, ви надіслали кілька фото разом. Надішліть, будь ласка, <b>наступне окремим повідомленням</b>.', { parse_mode: 'HTML' })
            .catch(() => { });
        return true;
    }
    rideProofPhotoLocks.add(chatId);
    try {
        return await processRideProofPhoto(bot, prisma, chatId, personId, photoFileId, flow, notifyAdmin, botUsername);
    }
    finally {
        rideProofPhotoLocks.delete(chatId);
    }
}
async function processRideProofPhoto(bot, prisma, chatId, personId, photoFileId, flow, notifyAdmin, botUsername = 'malin_kiev_ua_bot') {
    if (flow.step === 'photo_start' && flow.proofId) {
        await prisma.rideCompletionProof.update({
            where: { id: flow.proofId },
            data: { photoStartFileId: photoFileId },
        });
        exports.rideProofFlowStateMap.set(chatId, { ...flow, step: 'photo_end', photoStartFileId: photoFileId, since: Date.now() });
        await bot.sendMessage(chatId, '✅ Перше фото збережено!\n\n📸 Тепер надішліть <b>друге фото</b> — після прибуття в пункт призначення.', { parse_mode: 'HTML', reply_markup: RIDE_PROOF_CANCEL_KEYBOARD });
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
        else if (rewardResult.passengerSelfRewardId) {
            // rewardId є і при повторній відправці фото — бонус нікуди не зник
            rewardText =
                `\n\n💸 Ваш бонус за підтвердження: <b>${referral_1.REFERRAL_REWARD_UAH.passenger_self_confirm} грн</b>` +
                    (rewardResult.passengerReferrerId ? ' — і ваш друг теж отримає свій' : '') +
                    '.';
        }
        else if (rewardResult.limitReached) {
            rewardText = '\n\nДякуємо! Бонусний ліміт за підтвердження вже використано.';
        }
        await bot.sendMessage(chatId, '✅ <b>Круто! Поїздку підтверджено.</b>\n\n' +
            'Фото прийнято. Дякуємо, що ділитесь дорогою з нами 🚗' +
            rewardText +
            '\n\n🕵️ Далі — перевірка модератором. Після схвалення бонус стане «до виплати», ' +
            'і ми напишемо вам у цей чат.', { parse_mode: 'HTML' });
        // Спочатку фото, потім фінальне повідомлення з текстом посту + кнопки
        if (proof.photoStartFileId) {
            await bot
                .sendPhoto(chatId, proof.photoStartFileId, { caption: '1️⃣ Фото на старті — збережи для Facebook' })
                .catch(() => { });
        }
        await bot
            .sendPhoto(chatId, photoFileId, { caption: '2️⃣ Фото після прибуття — збережи для Facebook' })
            .catch(() => { });
        const code = await (0, referral_1.ensurePersonReferralCode)(prisma, personId);
        const referralLink = (0, referral_1.getReferralBotLink)(botUsername, code);
        const dateKey = proof.rideDate.toISOString().slice(0, 10);
        const fbCaption = (0, referral_1.buildRideFacebookShareCaption)({
            route: proof.route,
            dateKey,
            referralLink,
        });
        await bot
            .sendMessage(chatId, (0, referral_1.buildRideFacebookSharePromptHtml)(fbCaption), {
            parse_mode: 'HTML',
            reply_markup: (0, referral_1.buildFacebookShareInlineKeyboard)(referralLink, fbCaption),
        })
            .catch((err) => console.error('FB share prompt:', err));
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
            if (rewardResult.budgetHeldUah > 0) {
                parts.push(`💰 <b>Бюджет акції вичерпано</b> — ${rewardResult.budgetHeldUah} грн створено на утриманні. ` +
                    'Підніміть бюджет в адмінці або лишіть як є.');
            }
            for (const person of rewardResult.personsOverWarnLimit) {
                parts.push(`👀 Person #${person.personId} вже набрав <b>${person.totalUah} грн</b> ` +
                    `(поріг ${referral_1.REFERRAL_PERSON_TOTAL_WARN_UAH} грн) — варто перевірити.`);
            }
            notifyAdmin(parts.join('\n'), [proof.photoStartFileId, photoFileId]);
        }
        return true;
    }
    return false;
}
/**
 * Людина у кроці фото надіслала щось інше (текст, стікер, геолокацію).
 * Без цього повідомлення вона просто не розуміє, чому нічого не відбувається.
 */
async function remindRideProofExpectsPhoto(bot, chatId) {
    const flow = exports.rideProofFlowStateMap.get(chatId);
    if (!flow || isFlowExpired(flow.since))
        return false;
    if (flow.step !== 'photo_start' && flow.step !== 'photo_end')
        return false;
    await bot.sendMessage(chatId, '📷 Зараз я чекаю <b>фото</b>' +
        (flow.step === 'photo_start' ? ' на місці відправлення' : ' після прибуття') +
        '.\n\n' +
        'Надішліть знімок або натисніть «Скасувати».', { parse_mode: 'HTML', reply_markup: RIDE_PROOF_CANCEL_KEYBOARD });
    return true;
}
function buildReferralHelpSection() {
    return ('\n\n🎁 <b>Акція «Приведи друга»</b>\n' +
        '/invite — ваше посилання та запрошення\n' +
        '/confirmride — підтвердити поїздку пасажира (фото до/після)');
}
