/**
 * Telegram-обробники реферальної програми «Приведи друга».
 */
import type TelegramBot from 'node-telegram-bot-api';
import type { PrismaClient } from '@prisma/client';
import {
  buildReferralProgramTermsHtml,
  createReferralInvite,
  ensurePersonReferralCode,
  findReferrerByCode,
  getReferralBotLink,
  getReferralStatsForPerson,
  linkReferralOnRegistration,
  buildFacebookShareInlineKeyboard,
  buildRideFacebookShareCaption,
  buildRideFacebookSharePromptHtml,
  processReferralRewardsAfterPassengerProof,
  REFERRAL_REWARD_UAH,
} from './referral';

export type ReferralFlowState = {
  state: 'referral_flow';
  step: 'await_contact';
  since: number;
};

export type RideProofFlowState = {
  state: 'ride_proof_flow';
  step: 'select_listing' | 'photo_start' | 'photo_end';
  viberListingId?: number;
  proofId?: number;
  photoStartFileId?: string;
  since: number;
};

/** chatId -> referrerPersonId з ?start=ref_CODE до реєстрації */
export const pendingReferralCodeMap = new Map<string, { referrerPersonId: number; code: string }>();

export const referralFlowStateMap = new Map<string, ReferralFlowState>();
export const rideProofFlowStateMap = new Map<string, RideProofFlowState>();

const FLOW_TTL_MS = 30 * 60 * 1000;

function isFlowExpired(since: number): boolean {
  return Date.now() - since > FLOW_TTL_MS;
}

export function storePendingReferralCode(chatId: string, referrerPersonId: number, code: string): void {
  pendingReferralCodeMap.set(chatId, { referrerPersonId, code });
}

export function takePendingReferralCode(chatId: string): string | null {
  const entry = pendingReferralCodeMap.get(chatId);
  pendingReferralCodeMap.delete(chatId);
  return entry?.code ?? null;
}

export async function handleReferralStartParam(
  prisma: PrismaClient,
  chatId: string,
  rawStart: string
): Promise<boolean> {
  if (!rawStart.startsWith('ref_')) return false;
  const code = rawStart.replace(/^ref_/i, '').trim();
  if (!code) return false;

  const referrer = await findReferrerByCode(prisma, code);
  if (!referrer) return false;

  storePendingReferralCode(chatId, referrer.id, code);
  return true;
}

export async function sendInviteProgramMessage(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number,
  botUsername: string
): Promise<void> {
  const code = await ensurePersonReferralCode(prisma, personId);
  const link = getReferralBotLink(botUsername, code);
  const stats = await getReferralStatsForPerson(prisma, personId);

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '📲 Запросити за номером / @username', callback_data: 'referral_invite_contact' }],
      [{ text: '📊 Моя статистика', callback_data: 'referral_my_stats' }],
    ],
  };

  let extra =
    `\n\n📊 Запрошено: ${stats.referredCount} | Очікує виплати: <b>${stats.totalPendingUah} грн</b>`;
  if (stats.totalPaidUah > 0) extra += ` | Виплачено: ${stats.totalPaidUah} грн`;

  await bot.sendMessage(chatId, buildReferralProgramTermsHtml(link) + extra, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

export async function startReferralInviteFlow(bot: TelegramBot, chatId: string): Promise<void> {
  referralFlowStateMap.set(chatId, { state: 'referral_flow', step: 'await_contact', since: Date.now() });
  await bot.sendMessage(
    chatId,
    '📲 <b>Запросити друга</b>\n\n' +
      'Надішліть номер телефону друга (0501234567) або його Telegram @username.\n\n' +
      'Друг має зареєструватися в боті та додати попутку як водій або пасажир.',
    { parse_mode: 'HTML' }
  );
}

export async function handleReferralContactInput(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number,
  text: string
): Promise<boolean> {
  const flow = referralFlowStateMap.get(chatId);
  if (!flow || flow.step !== 'await_contact' || isFlowExpired(flow.since)) {
    referralFlowStateMap.delete(chatId);
    return false;
  }

  const result = await createReferralInvite(prisma, personId, text);
  referralFlowStateMap.delete(chatId);

  if (!result.ok) {
    if (result.alreadyOurUser) {
      await bot.sendMessage(chatId, result.error, { parse_mode: 'HTML' });
    } else {
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

  await bot.sendMessage(
    chatId,
    `✅ <b>Запрошення збережено!</b>\n\n` +
      `Контакт: ${result.display}\n\n` +
      'Коли друг проїде і підтвердить поїздку фото — ви обидва отримаєте бонус 💸\n' +
      'Надішліть йому своє посилання з /invite.' +
      extra,
    { parse_mode: 'HTML' }
  );
  return true;
}

/** Лише прив'язка реферера. Гроші — після підтвердження поїздки. */
export async function onReferralRegistration(
  prisma: PrismaClient,
  personId: number,
  phoneNormalized: string,
  telegramUsername: string | null | undefined,
  referralCodeFromStart: string | null,
  notifyAdmin?: (text: string) => void,
  personWasNewToClientsDb?: boolean
): Promise<void> {
  const { linked, referrerId, registrationBonusEligible } = await linkReferralOnRegistration(
    prisma,
    personId,
    phoneNormalized,
    telegramUsername,
    referralCodeFromStart,
    personWasNewToClientsDb
  );
  if (!linked || !referrerId) return;

  if (notifyAdmin) {
    notifyAdmin(
      `🎁 <b>Реферал: новий зв'язок</b>\n` +
        `Запрошений Person #${personId}\n` +
        `Реферер Person #${referrerId}\n` +
        (registrationBonusEligible === false
          ? `<i>Уже був у базі клієнтів — без 10 грн за залучення; бонуси лише за підтверджені поїздки.</i>`
          : `<i>Нагорода ще не нарахована — чекаємо підтвердження поїздки.</i>`)
    );
  }
}

export async function startRideProofFlow(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number
): Promise<void> {
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

  const existingProofListingIds = new Set(
    (
      await prisma.rideCompletionProof.findMany({
        where: { personId, viberListingId: { not: null } },
        select: { viberListingId: true },
      })
    )
      .map((p) => p.viberListingId)
      .filter((id): id is number => id != null)
  );

  const available = listings.filter((l) => !existingProofListingIds.has(l.id));

  if (available.length === 0) {
    await bot.sendMessage(
      chatId,
      '📷 <b>Підтвердження поїздки</b>\n\n' +
        'Немає завершених поїздок пасажира для підтвердження.\n\n' +
        'Спочатку додайте запит як пасажир (/addpassengerride), а після поїздки надішліть фото.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const buttons = available.slice(0, 8).map((l) => {
    const dateStr = l.date.toISOString().slice(0, 10);
    return [{ text: `${l.route} ${dateStr}`, callback_data: `rideproof_select_${l.id}` }];
  });
  buttons.push([{ text: '❌ Скасувати', callback_data: 'rideproof_cancel' }]);

  rideProofFlowStateMap.set(chatId, { state: 'ride_proof_flow', step: 'select_listing', since: Date.now() });
  await bot.sendMessage(
    chatId,
    '📷 <b>Підтвердження поїздки</b>\n\n' +
      'Оберіть поїздку, яку хочете підтвердити.\n\n' +
      '📸 Далі надішліть:\n' +
      '1️⃣ Фото на <b>місці відправлення</b> (з табличкою/орієнтиром)\n' +
      '2️⃣ Фото <b>після прибуття</b> (наприклад, на зупинці чи біля авто)\n\n' +
      '<i>Фото використаємо для рекламного посту — зробіть їх охайними 🙂</i>',
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }
  );
}

export async function handleRideProofCallback(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number,
  data: string,
  botUsername: string = 'malin_kiev_ua_bot'
): Promise<boolean> {
  if (data === 'rideproof_cancel') {
    rideProofFlowStateMap.delete(chatId);
    await bot.sendMessage(chatId, 'Скасовано.');
    return true;
  }

  if (data === 'rideproof_fb_caption') {
    const proof = await prisma.rideCompletionProof.findFirst({
      where: {
        personId,
        photoStartFileId: { not: null },
        photoEndFileId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!proof) {
      await bot.sendMessage(chatId, 'Немає підтвердженої поїздки з фото для посту.');
      return true;
    }
    const code = await ensurePersonReferralCode(prisma, personId);
    const referralLink = getReferralBotLink(botUsername, code);
    const dateKey = proof.rideDate.toISOString().slice(0, 10);
    const fbCaption = buildRideFacebookShareCaption({
      route: proof.route,
      dateKey,
      referralLink,
    });
    await bot.sendMessage(chatId, buildRideFacebookSharePromptHtml(fbCaption), {
      parse_mode: 'HTML',
      reply_markup: buildFacebookShareInlineKeyboard(referralLink) as unknown as TelegramBot.InlineKeyboardMarkup,
    });
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

    rideProofFlowStateMap.set(chatId, {
      state: 'ride_proof_flow',
      step: 'photo_start',
      viberListingId: listingId,
      proofId: proof.id,
      since: Date.now(),
    });

    await bot.sendMessage(
      chatId,
      `📷 Поїздка: <b>${listing.route}</b> (${listing.date.toISOString().slice(0, 10)})\n\n` +
        '📸 Надішліть <b>перше фото</b> — на місці відправлення.\n\n' +
        '<i>Порада: зніміть себе або авто біля зупинки/місця збору — так краще для рекламного посту.</i>',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  return false;
}

export async function handleReferralCallback(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number,
  botUsername: string,
  data: string
): Promise<boolean> {
  if (data === 'referral_invite_contact') {
    await startReferralInviteFlow(bot, chatId);
    return true;
  }
  if (data === 'referral_my_stats') {
    const stats = await getReferralStatsForPerson(prisma, personId);
    const lines = stats.rewards.slice(0, 15).map((r) => {
      const typeLabel =
        r.rewardType === 'registration'
          ? 'Бонус за друга'
          : r.rewardType === 'driver_qualified' || r.rewardType === 'driver_first_listing'
            ? 'Друг-водій'
            : r.rewardType === 'passenger_self_confirm'
              ? 'Моє підтвердження'
              : 'Друг-пасажир';
      return `• ${typeLabel}: ${r.amountUah} грн — ${r.status}`;
    });
    await bot.sendMessage(
      chatId,
      `📊 <b>Ваша реферальна статистика</b>\n\n` +
        `Запрошено друзів: ${stats.referredCount}\n` +
        `Очікує виплати: <b>${stats.totalPendingUah} грн</b>\n` +
        `Виплачено: ${stats.totalPaidUah} грн\n\n` +
        (lines.length ? `<b>Останні нагороди:</b>\n${lines.join('\n')}` : 'Поки немає нагород.'),
      { parse_mode: 'HTML' }
    );
    return true;
  }
  return false;
}

export async function handleRideProofPhoto(
  bot: TelegramBot,
  prisma: PrismaClient,
  chatId: string,
  personId: number,
  photoFileId: string,
  notifyAdmin?: (text: string, photoFileIds?: string[]) => void,
  botUsername: string = 'malin_kiev_ua_bot'
): Promise<boolean> {
  const flow = rideProofFlowStateMap.get(chatId);
  if (!flow || isFlowExpired(flow.since)) {
    rideProofFlowStateMap.delete(chatId);
    return false;
  }

  if (flow.step === 'photo_start' && flow.proofId) {
    await prisma.rideCompletionProof.update({
      where: { id: flow.proofId },
      data: { photoStartFileId: photoFileId },
    });
    rideProofFlowStateMap.set(chatId, { ...flow, step: 'photo_end', photoStartFileId: photoFileId, since: Date.now() });
    await bot.sendMessage(
      chatId,
      '✅ Перше фото збережено!\n\n📸 Тепер надішліть <b>друге фото</b> — після прибуття в пункт призначення.',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (flow.step === 'photo_end' && flow.proofId) {
    const proof = await prisma.rideCompletionProof.update({
      where: { id: flow.proofId },
      data: { photoEndFileId: photoFileId, status: 'pending_review' },
    });
    rideProofFlowStateMap.delete(chatId);

    const rewardResult = await processReferralRewardsAfterPassengerProof(prisma, flow.proofId);

    let rewardText = '';
    if (rewardResult.flagged) {
      rewardText = '\n\n⚠️ Поїздку передано на перевірку адміністратору.';
    } else if (rewardResult.passengerSelfCreated) {
      rewardText =
        `\n\n💸 Вам нараховано <b>${rewardResult.passengerSelfUah} грн</b> за підтвердження` +
        (rewardResult.passengerReferrerId
          ? ` — і ваш друг також отримає бонус`
          : '') +
        '!';
    } else if (rewardResult.limitReached) {
      rewardText = '\n\nДякуємо! Бонусний ліміт за підтвердження вже використано.';
    }

    await bot.sendMessage(
      chatId,
      '✅ <b>Круто! Поїздку підтверджено.</b>\n\n' +
        'Фото прийнято. Дякуємо, що ділитесь дорогою з нами 🚗' +
        rewardText,
      { parse_mode: 'HTML' }
    );

    // Спочатку фото, потім фінальне повідомлення з текстом посту + кнопки
    if (proof.photoStartFileId) {
      await bot
        .sendPhoto(chatId, proof.photoStartFileId, { caption: '1️⃣ Фото на старті — збережи для Facebook' })
        .catch(() => {});
    }
    await bot
      .sendPhoto(chatId, photoFileId, { caption: '2️⃣ Фото після прибуття — збережи для Facebook' })
      .catch(() => {});

    const code = await ensurePersonReferralCode(prisma, personId);
    const referralLink = getReferralBotLink(botUsername, code);
    const dateKey = proof.rideDate.toISOString().slice(0, 10);
    const fbCaption = buildRideFacebookShareCaption({
      route: proof.route,
      dateKey,
      referralLink,
    });
    await bot
      .sendMessage(chatId, buildRideFacebookSharePromptHtml(fbCaption), {
        parse_mode: 'HTML',
        reply_markup: buildFacebookShareInlineKeyboard(referralLink) as unknown as TelegramBot.InlineKeyboardMarkup,
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
        parts.push(`👤 +${REFERRAL_REWARD_UAH.passenger_completed_ride} грн запрошувачу #${rewardResult.passengerReferrerId}`);
      }
      if (rewardResult.registrationCreated) {
        parts.push(`📝 +${REFERRAL_REWARD_UAH.registration} грн (бонус за друга)`);
      }
      if (rewardResult.driverQualifiedCreated) {
        parts.push(
          `🚗 +${REFERRAL_REWARD_UAH.driver_qualified} грн (водій) → #${rewardResult.driverReferrerId}`
        );
      }
      if (rewardResult.flagged) parts.push('⚠️ <b>Позначено підозрілим розкладом</b>');
      notifyAdmin(parts.join('\n'), [proof.photoStartFileId, photoFileId]);
    }
    return true;
  }

  return false;
}

export function buildReferralHelpSection(): string {
  return (
    '\n\n🎁 <b>Акція «Приведи друга»</b>\n' +
    '/invite — ваше посилання та запрошення\n' +
    '/confirmride — підтвердити поїздку пасажира (фото до/після)'
  );
}
