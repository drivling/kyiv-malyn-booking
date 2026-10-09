/**
 * «Архівувати всі дані» — JSON-знімок усього, що система знає про людину, в PersonDataArchive,
 * після чого робочі рядки видаляються і поїздки зникають із сайту.
 *
 * Person НЕ видаляється: він лишається носієм заборони на номер. Через це жоден
 * `onDelete: Cascade` на Person не спрацює — усі залежні рядки треба видаляти явно.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Скільки рядків видалено/знеособлено з кожної таблиці. */
export type PersonArchiveCounts = {
  bookings: number;
  viberListings: number;
  viberRideEvents: number;
  rideShareRequests: number;
  matchNotifications: number;
  rideCompletionProofs: number;
  referralInvites: number;
  referralRewardsDeleted: number;
  referralRewardsKeptPaid: number;
  referralRewardsFlagged: number;
  smsSendLogs: number;
  telegramUserSendErrors: number;
  pendingReferralCodes: number;
};

export type PersonArchiveResult = {
  archiveId: number;
  personId: number;
  phoneNormalized: string;
  archivedAt: Date;
  counts: PersonArchiveCounts;
};

/**
 * Знімок + очищення. Повертає null, якщо персони немає.
 *
 * Порядок усередині транзакції критичний:
 *  1. читаємо ВСЕ (включно з дітьми оголошень, які підуть каскадом);
 *  2. пишемо архів;
 *  3. видаляємо — Booking СТРОГО перед ViberListing;
 *  4. вичищаємо Person, не видаляючи його.
 */
export async function archivePersonData(
  prisma: PrismaClient,
  opts: { personId: number; reason: string },
): Promise<PersonArchiveResult | null> {
  const id = opts.personId;
  const reason = opts.reason.trim();

  return prisma.$transaction(
    async (tx) => {
      const person = await tx.person.findUnique({ where: { id } });
      if (!person) return null;

      // ---------- 1. ЧИТАЄМО ВСЕ ДО БУДЬ-ЯКОГО DELETE ----------
      const bookings = await tx.booking.findMany({ where: { personId: id } });
      const viberListings = await tx.viberListing.findMany({ where: { personId: id } });
      const listingIds = viberListings.map((l) => l.id);
      const viberRideEvents = await tx.viberRideEvent.findMany({ where: { personId: id } });
      const rideCompletionProofs = await tx.rideCompletionProof.findMany({ where: { personId: id } });
      const referralInvites = await tx.referralInvite.findMany({
        where: { OR: [{ referrerId: id }, { referredPersonId: id }] },
      });
      const referralRewards = await tx.referralReward.findMany({
        where: { OR: [{ referrerId: id }, { referredPersonId: id }] },
      });

      // Діти оголошень: зникнуть каскадом, але у знімок мають потрапити ДО видалення
      const listingChildWhere = { OR: [{ passengerListingId: { in: listingIds } }, { driverListingId: { in: listingIds } }] };
      const rideShareRequests = listingIds.length
        ? await tx.rideShareRequest.findMany({ where: listingChildWhere })
        : [];
      const matchNotifications = listingIds.length
        ? await tx.viberMatchPairNotification.findMany({ where: listingChildWhere })
        : [];

      // Прив'язані рядком, без FK
      const smsSendLogs = await tx.smsSendLog.findMany({ where: { phoneNormalized: person.phoneNormalized } });
      const telegramUsernameVariants = person.telegramUsername
        ? [person.telegramUsername, `@${person.telegramUsername.replace(/^@/, '')}`]
        : [];
      const telegramUserSendErrors = await tx.telegramUserSendError.findMany({
        where: { contact: { in: [person.phoneNormalized, ...telegramUsernameVariants] } },
      });
      const pendingReferralCodes = await tx.pendingReferralCode.findMany({
        where: {
          OR: [
            ...(person.telegramChatId ? [{ telegramChatId: person.telegramChatId }] : []),
            { referrerPersonId: id },
          ],
        },
      });

      // ---------- 2. ЗНІМОК ----------
      // Prisma.InputJsonValue не приймає Date — прогін через JSON робить з них ISO-рядки.
      const payload = JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          reason,
          person,
          bookings,
          viberListings,
          viberRideEvents,
          rideCompletionProofs,
          referralInvites,
          referralRewards,
          rideShareRequests,
          matchNotifications,
          smsSendLogs,
          telegramUserSendErrors,
          pendingReferralCodes,
        }),
      ) as Prisma.InputJsonValue;

      // ---------- 3. ВИДАЛЕННЯ: діти → батьки ----------
      // 3a. Гроші. Виплачені нарахування лишаються в робочій таблиці, щоб звіт
      //     /admin/referrals і payouts.csv не змінювалися заднім числом.
      const ownRewards = referralRewards.filter((r) => r.referrerId === id);
      const ownPaid = ownRewards.filter((r) => r.status === 'paid');
      const ownUnpaidIds = ownRewards.filter((r) => r.status !== 'paid').map((r) => r.id);

      if (ownPaid.length > 0) {
        // Знеособлюємо: payoutNote містить реквізити («картка Приват 04.08»).
        await tx.referralReward.updateMany({
          where: { id: { in: ownPaid.map((r) => r.id) } },
          data: { payoutNote: null, flagReason: null },
        });
      }
      if (ownUnpaidIds.length > 0) {
        await tx.referralReward.deleteMany({ where: { id: { in: ownUnpaidIds } } });
      }

      // Нарахування, де ця людина лише «приведений друг», — це гаманець ІНШОЇ людини.
      // Не видаляємо: виплачені лишаємо як є, невиплачені позначаємо.
      const othersUnpaidIds = referralRewards
        .filter((r) => r.referredPersonId === id && r.referrerId !== id && r.status !== 'paid')
        .map((r) => r.id);
      let flaggedCount = 0;
      if (othersUnpaidIds.length > 0) {
        const flagged = await tx.referralReward.updateMany({
          where: { id: { in: othersUnpaidIds } },
          data: { status: 'flagged', flagReason: `Дані запрошеного заархівовано: ${reason}` },
        });
        flaggedCount = flagged.count;
      }

      // 3b. Запрошення: свої видаляємо, чужі знеособлюємо (це чийсь чужий список).
      const ownInviteIds = referralInvites.filter((i) => i.referrerId === id).map((i) => i.id);
      const othersInviteIds = referralInvites
        .filter((i) => i.referredPersonId === id && i.referrerId !== id)
        .map((i) => i.id);
      if (ownInviteIds.length > 0) {
        await tx.referralInvite.deleteMany({ where: { id: { in: ownInviteIds } } });
      }
      if (othersInviteIds.length > 0) {
        await tx.referralInvite.updateMany({
          where: { id: { in: othersInviteIds } },
          data: { referredPersonId: null, inviteContact: '—', invitePhoneNorm: null, inviteUsername: null },
        });
      }

      // 3c. Cascade на Person не спрацює — Person лишається живим.
      await tx.rideCompletionProof.deleteMany({ where: { personId: id } });

      // ⚠ Booking СТРОГО перед ViberListing: Booking.viberListingId — onDelete: SetNull,
      // тож видалення оголошень першим мовчки обнулило б посилання ще до видалення бронювань.
      await tx.booking.deleteMany({ where: { personId: id } });
      // RideShareRequest і ViberMatchPairNotification підуть каскадом від оголошень.
      await tx.viberListing.deleteMany({ where: { personId: id } });
      await tx.viberRideEvent.deleteMany({ where: { personId: id } });

      await tx.smsSendLog.deleteMany({ where: { phoneNormalized: person.phoneNormalized } });
      if (telegramUserSendErrors.length > 0) {
        await tx.telegramUserSendError.deleteMany({
          where: { id: { in: telegramUserSendErrors.map((e) => e.id) } },
        });
      }
      if (pendingReferralCodes.length > 0) {
        await tx.pendingReferralCode.deleteMany({
          where: { id: { in: pendingReferralCodes.map((c) => c.id) } },
        });
      }

      // ---------- 4. PERSON: вичистити, НЕ видаляти ----------
      const now = new Date();
      await tx.person.update({
        where: { id },
        data: {
          fullName: null,
          telegramChatId: null,
          telegramUserId: null,
          telegramUsername: null,
          telegramPromoSentAt: null,
          telegramReminderSentAt: null,
          referralCode: null,
          referredByPersonId: null,
          referralRegistrationBonusEligible: null,
          dataArchivedAt: now,
          // Архівація завжди означає заборону — інакше людина просто почала б заново.
          phoneBlockedAt: person.phoneBlockedAt ?? now,
          phoneBlockReason: person.phoneBlockReason ?? reason,
          smsOptOut: true,
        },
      });

      const counts: PersonArchiveCounts = {
        bookings: bookings.length,
        viberListings: viberListings.length,
        viberRideEvents: viberRideEvents.length,
        rideShareRequests: rideShareRequests.length,
        matchNotifications: matchNotifications.length,
        rideCompletionProofs: rideCompletionProofs.length,
        referralInvites: ownInviteIds.length,
        referralRewardsDeleted: ownUnpaidIds.length,
        referralRewardsKeptPaid: ownPaid.length,
        referralRewardsFlagged: flaggedCount,
        smsSendLogs: smsSendLogs.length,
        telegramUserSendErrors: telegramUserSendErrors.length,
        pendingReferralCodes: pendingReferralCodes.length,
      };

      // Архів пишемо в тій самій транзакції: якщо видалення впаде, знімок теж відкотиться.
      const archive = await tx.personDataArchive.create({
        data: {
          personId: id,
          phoneNormalized: person.phoneNormalized,
          fullName: person.fullName,
          reason,
          payload,
          deletedCounts: counts as unknown as Prisma.InputJsonValue,
        },
      });

      console.log(
        `🗄️ Заархівовано персону #${id} (${person.phoneNormalized}): архів #${archive.id}, ` +
          `бронювань ${counts.bookings}, оголошень ${counts.viberListings}, ViberRide ${counts.viberRideEvents}`,
      );

      return {
        archiveId: archive.id,
        personId: id,
        phoneNormalized: person.phoneNormalized,
        archivedAt: now,
        counts,
      };
    },
    // Дефолтні 5с/2с замалі для людини з сотнями оголошень і SMS-логів.
    { timeout: 30_000, maxWait: 10_000 },
  );
}
