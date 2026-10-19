"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERASED_PERSON_NAME = void 0;
exports.technicalPhoneForErased = technicalPhoneForErased;
exports.erasePerson = erasePerson;
exports.describeEraseResult = describeEraseResult;
/**
 * «Видалити акаунт» на запит самої людини (Docs/transport-open-data-2026-10.md, фаза 4.2) — для
 * `DELETE /user` і `/deleteme` у боті. Відрізняється від адмінської архівації (`person-archive.ts`):
 * знімка не лишаємо, номер не забороняємо (людина може повернутися з тим самим номером — це буде новий
 * Person), рядки з FK на Person не видаляємо, а знеособлюємо.
 *
 * Що робить, в одній транзакції:
 *  - Person: телефон → технічний `3800000` + id (унікальний, не SMS-адресований, як `380010000000+` у
 *    `findOrCreatePersonByTelegramUsername`), ім'я / Telegram / реферальний код → null, `smsOptOut`,
 *    `telegramBotBlockedAt = now` (бот більше не пише), `dataArchivedAt = now` (мітка «вичищено»);
 *  - Booking (за personId або telegramUserId): майбутні — видалити (як /cancel; нагадування каскадом),
 *    минулі — знеособити (ім'я, телефон, telegram*), лишити для статистики;
 *  - ViberListing: усі `isActive = false`, ім'я / телефон / сирий текст знеособлено; відкриті
 *    RideShareRequest на них → `expired`;
 *  - ViberRideEvent: телефон → технічний, `personId = null` (аналітика без прив'язки);
 *  - рефералка: свої запрошення видалити, чужі на мене — знеособити; нарахування НЕ зникають
 *    (гаманець: виплачені як є без `payoutNote`, невиплачені другові — `flagged` для перевірки адміном);
 *    фото-підтвердження поїздок — видалити; PendingReferralCode / TelegramUserSendError / SmsSendLog — видалити;
 *  - «Джура»: власні повідомлення → `text = ''`, без `rawJson`/історії правок, `deletedAt = now`;
 *    DzhuraPerson — ім'я, username, телефон → null (сам рядок лишається: ключ `tgUserId` для нових повідомлень);
 *  - обідній бот: LunchParticipant → «Видалений користувач», username → null; замовлення лишаються (гроші).
 *
 * Пастка: Prisma `onDelete: Cascade` на Person не спрацює — Person живий, тож діти чистяться явно.
 */
const client_1 = require("@prisma/client");
exports.ERASED_PERSON_NAME = 'Видалений користувач';
/** 12 цифр, не справжній номер (380 00 …) — `isTechnicalPhone` у sms-fallback теж його не шле */
function technicalPhoneForErased(personId) {
    const digits = String(Math.max(0, Math.floor(personId)));
    return `380${'0'.repeat(Math.max(0, 9 - digits.length))}${digits}`;
}
const emptyCounts = () => ({
    futureBookingsDeleted: 0,
    pastBookingsAnonymized: 0,
    listingsDeactivated: 0,
    rideShareRequestsExpired: 0,
    rideEventsAnonymized: 0,
    referralInvitesDeleted: 0,
    referralRewardsKept: 0,
    rideProofsDeleted: 0,
    capturedMessagesErased: 0,
    lunchParticipantAnonymized: false,
});
function startOfDay(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
}
/**
 * Знеособлює все, що прив'язане до `telegramUserId` (Person за ним + рядки без FK). Повертає `null`, якщо
 * нема ані Person, ані жодного рядка — тоді й видаляти нічого.
 */
async function erasePerson(prisma, opts) {
    const telegramUserId = opts.telegramUserId.trim();
    const now = opts.now ?? new Date();
    const today = startOfDay(now);
    return prisma.$transaction(async (tx) => {
        const person = await tx.person.findFirst({ where: { telegramUserId } });
        const personId = person?.id ?? null;
        const counts = emptyCounts();
        const technicalPhone = personId ? technicalPhoneForErased(personId) : '380000000000';
        // ---------- Бронювання: майбутні геть, минулі без імені й телефону ----------
        const bookingWhere = personId ? { OR: [{ personId }, { telegramUserId }] } : { telegramUserId };
        const futureBookings = await tx.booking.findMany({ where: { ...bookingWhere, date: { gte: today } }, select: { id: true } });
        if (futureBookings.length > 0) {
            const deleted = await tx.booking.deleteMany({ where: { id: { in: futureBookings.map((b) => b.id) } } });
            counts.futureBookingsDeleted = deleted.count;
        }
        const anonymized = await tx.booking.updateMany({
            where: bookingWhere,
            data: { name: exports.ERASED_PERSON_NAME, phone: technicalPhone, telegramChatId: null, telegramUserId: null },
        });
        counts.pastBookingsAnonymized = anonymized.count;
        if (personId) {
            // ---------- Оголошення попуток ----------
            const listings = await tx.viberListing.findMany({ where: { personId }, select: { id: true } });
            const listingIds = listings.map((l) => l.id);
            if (listingIds.length > 0) {
                const deactivated = await tx.viberListing.updateMany({
                    where: { id: { in: listingIds } },
                    data: { isActive: false, senderName: null, phone: technicalPhone, rawMessage: '', notes: null, authorNotifiedAt: now },
                });
                counts.listingsDeactivated = deactivated.count;
                const expired = await tx.rideShareRequest.updateMany({
                    where: { status: 'pending', OR: [{ passengerListingId: { in: listingIds } }, { driverListingId: { in: listingIds } }] },
                    data: { status: 'expired' },
                });
                counts.rideShareRequestsExpired = expired.count;
            }
            // ---------- Історія оголошень (аналітика) ----------
            const events = await tx.viberRideEvent.updateMany({
                where: { personId },
                data: { contactPhone: technicalPhone, phoneNormalized: technicalPhone, personId: null },
            });
            counts.rideEventsAnonymized = events.count;
            // ---------- «Приведи друга» ----------
            const ownInvites = await tx.referralInvite.deleteMany({ where: { referrerId: personId } });
            counts.referralInvitesDeleted = ownInvites.count;
            await tx.referralInvite.updateMany({
                where: { referredPersonId: personId },
                data: { referredPersonId: null, inviteContact: '—', invitePhoneNorm: null, inviteUsername: null },
            });
            const rewards = await tx.referralReward.findMany({
                where: { OR: [{ referrerId: personId }, { referredPersonId: personId }] },
                select: { id: true, referrerId: true, status: true },
            });
            counts.referralRewardsKept = rewards.length;
            const ownRewardIds = rewards.filter((r) => r.referrerId === personId).map((r) => r.id);
            if (ownRewardIds.length > 0) {
                await tx.referralReward.updateMany({ where: { id: { in: ownRewardIds } }, data: { payoutNote: null } });
            }
            const friendsUnpaidIds = rewards.filter((r) => r.referrerId !== personId && r.status !== 'paid').map((r) => r.id);
            if (friendsUnpaidIds.length > 0) {
                await tx.referralReward.updateMany({
                    where: { id: { in: friendsUnpaidIds } },
                    data: { status: 'flagged', flagReason: 'Запрошений видалив акаунт на свій запит' },
                });
            }
            const proofs = await tx.rideCompletionProof.deleteMany({ where: { personId } });
            counts.rideProofsDeleted = proofs.count;
            // ---------- Рядки без FK ----------
            if (person?.telegramChatId) {
                await tx.pendingReferralCode.deleteMany({ where: { telegramChatId: person.telegramChatId } });
            }
            await tx.pendingReferralCode.deleteMany({ where: { referrerPersonId: personId } });
            const contacts = [person.phoneNormalized];
            if (person?.telegramUsername) {
                const bare = person.telegramUsername.replace(/^@/, '');
                contacts.push(bare, `@${bare}`);
            }
            await tx.telegramUserSendError.deleteMany({ where: { contact: { in: contacts } } });
            await tx.smsSendLog.deleteMany({ where: { phoneNormalized: person.phoneNormalized } });
            // ---------- Person: вичистити, НЕ видаляти ----------
            await tx.person.update({
                where: { id: personId },
                data: {
                    phoneNormalized: technicalPhone,
                    fullName: null,
                    telegramChatId: null,
                    telegramUserId: null,
                    telegramUsername: null,
                    telegramPromoSentAt: null,
                    telegramReminderSentAt: null,
                    telegramBotBlockedAt: now,
                    smsOptOut: true,
                    referralCode: null,
                    referredByPersonId: null,
                    referralRegistrationBonusEligible: null,
                    dataArchivedAt: now,
                },
            });
        }
        // ---------- «Джура»: власні повідомлення без тексту ----------
        if (/^\d+$/.test(telegramUserId)) {
            const dzhuraPerson = await tx.dzhuraPerson.findUnique({ where: { tgUserId: BigInt(telegramUserId) } });
            if (dzhuraPerson) {
                const erased = await tx.dzhuraMessage.updateMany({
                    where: { senderPersonId: dzhuraPerson.id },
                    data: { text: '', rawJson: client_1.Prisma.DbNull, editHistoryJson: client_1.Prisma.DbNull, forwardFromName: null, deletedAt: now },
                });
                counts.capturedMessagesErased = erased.count;
                await tx.dzhuraPerson.update({
                    where: { id: dzhuraPerson.id },
                    data: { firstName: null, lastName: null, username: null, phone: null },
                });
            }
        }
        // ---------- Обідній бот ----------
        const lunchParticipant = await tx.lunchParticipant.findUnique({ where: { telegramUserId } });
        if (lunchParticipant) {
            await tx.lunchParticipant.update({
                where: { id: lunchParticipant.id },
                data: { displayName: exports.ERASED_PERSON_NAME, username: null },
            });
            counts.lunchParticipantAnonymized = true;
        }
        const touched = personId != null ||
            counts.futureBookingsDeleted + counts.pastBookingsAnonymized + counts.capturedMessagesErased > 0 ||
            counts.lunchParticipantAnonymized;
        if (!touched)
            return null;
        console.log(`🧹 Людина видалила акаунт: Person #${personId ?? '—'} (tg ${telegramUserId}): майбутніх бронювань ${counts.futureBookingsDeleted}, ` +
            `оголошень ${counts.listingsDeactivated}, повідомлень Джури ${counts.capturedMessagesErased}`);
        return { personId, telegramUserId, erasedAt: now, counts };
    }, { timeout: 30000, maxWait: 10000 });
}
/** Підсумок для людини (сайт і бот) — одним реченням, українською */
function describeEraseResult(r) {
    const parts = [];
    if (r.counts.futureBookingsDeleted)
        parts.push(`скасовано майбутніх бронювань: ${r.counts.futureBookingsDeleted}`);
    if (r.counts.listingsDeactivated)
        parts.push(`знято оголошень попуток: ${r.counts.listingsDeactivated}`);
    if (r.counts.pastBookingsAnonymized)
        parts.push(`знеособлено минулих бронювань: ${r.counts.pastBookingsAnonymized}`);
    if (r.counts.capturedMessagesErased)
        parts.push(`стерто текст ваших повідомлень із груп: ${r.counts.capturedMessagesErased}`);
    if (r.counts.referralRewardsKept)
        parts.push(`нарахування «Приведи друга» (${r.counts.referralRewardsKept}) лишаються в обліку`);
    return parts.length ? parts.join('; ') : 'записів про вас не лишилося';
}
