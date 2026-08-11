/**
 * Юніт-тести реферальної програми (чиста логіка + мок Prisma для нарахувань).
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  detectTimeConflict,
  generateReferralCode,
  getReferralBotLink,
  isPersonConnectedToBot,
  isReverseRoute,
  maxRewardUahPerReferred,
  MIN_RIDE_DURATION_MINUTES,
  parseDepartureMinutes,
  parseInviteContact,
  processReferralRewardsAfterPassengerProof,
  unlockRegistrationReward,
  buildPayoutBalancesFromRewards,
  buildRideFacebookShareCaption,
  flagUnpaidReferralRewardsForBotBlocked,
  buildBotBlockedPayoutsFrozenMessage,
  withAdminManualFlagReason,
  isProtectedFlagReason,
  BOT_BLOCKED_REWARD_FLAG_REASON,
  ADMIN_MANUAL_FLAG_PREFIX,
  REFERRAL_REWARD_UAH,
  MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED,
  markReferralPayout,
  isSameTelegramAccount,
  createReferralInvite,
  linkReferralOnRegistration,
  flagUnpaidRewardsForSelfReferral,
  SELF_REFERRAL_FLAG_REASON,
  REFERRAL_BUDGET_HOLD_REASON,
  buildTelegramShareUrl,
  buildReferralProgramInlineKeyboard,
  buildReferralShareInlineQueryResult,
  buildReferralShareMessageText,
  isReferralInlineShareQuery,
  REFERRAL_INLINE_QUERY_PREFIX,
  REFERRAL_SHARE_TEXT,
  type RideTimeSlot,
} from './referral';
import {
  cleanupExpiredPendingReferralCodes,
  handleReferralStartParam,
  storePendingReferralCode,
  takePendingReferralCode,
} from './telegram-referral';

describe('referral pure helpers', () => {
  it('parseInviteContact: phone and username', () => {
    const phone = parseInviteContact('0501234567');
    assert.equal(phone?.type, 'phone');
    if (phone?.type === 'phone') assert.equal(phone.phoneNormalized, '380501234567');

    const tg = parseInviteContact('@SomeUser_1');
    assert.equal(tg?.type, 'telegram');
    if (tg?.type === 'telegram') assert.equal(tg.username, 'SomeUser_1');

    assert.equal(parseInviteContact('abc'), null);
    assert.equal(parseInviteContact(''), null);
  });

  it('parseDepartureMinutes', () => {
    assert.equal(parseDepartureMinutes('08:30'), 8 * 60 + 30);
    assert.equal(parseDepartureMinutes('18:00-18:30'), 18 * 60);
    assert.equal(parseDepartureMinutes(null), null);
    assert.equal(parseDepartureMinutes('bad'), null);
  });

  it('isReverseRoute', () => {
    assert.equal(isReverseRoute('Kyiv-Malyn', 'Malyn-Kyiv'), true);
    assert.equal(isReverseRoute('Kyiv-Malyn', 'Kyiv-Malyn'), false);
    assert.equal(isReverseRoute('Malyn-Zhytomyr', 'Zhytomyr-Malyn'), true);
  });

  it('detectTimeConflict: impossible reverse same day', () => {
    const slots: RideTimeSlot[] = [
      { route: 'Kyiv-Malyn', dateKey: '2026-08-04', startMin: 8 * 60, endMin: 8 * 60 + MIN_RIDE_DURATION_MINUTES, source: 'a' },
      { route: 'Malyn-Kyiv', dateKey: '2026-08-04', startMin: 8 * 60 + 30, endMin: 8 * 60 + 30 + MIN_RIDE_DURATION_MINUTES, source: 'b' },
    ];
    const reason = detectTimeConflict(slots);
    assert.ok(reason);
    assert.match(reason!, /Неможливий розклад/);
  });

  it('detectTimeConflict: reverse OK with enough gap', () => {
    const slots: RideTimeSlot[] = [
      { route: 'Kyiv-Malyn', dateKey: '2026-08-04', startMin: 8 * 60, endMin: 8 * 60 + MIN_RIDE_DURATION_MINUTES, source: 'a' },
      { route: 'Malyn-Kyiv', dateKey: '2026-08-04', startMin: 8 * 60 + MIN_RIDE_DURATION_MINUTES + 5, endMin: 12 * 60, source: 'b' },
    ];
    assert.equal(detectTimeConflict(slots), null);
  });

  it('detectTimeConflict: duplicate same route overlapping', () => {
    const slots: RideTimeSlot[] = [
      { route: 'Kyiv-Malyn', dateKey: '2026-08-04', startMin: 10 * 60, endMin: 11 * 60 + 15, source: 'a' },
      { route: 'Kyiv-Malyn', dateKey: '2026-08-04', startMin: 10 * 60 + 30, endMin: 12 * 60, source: 'b' },
    ];
    assert.match(detectTimeConflict(slots)!, /Дубль маршруту/);
  });

  it('referral link and max payout', () => {
    const code = generateReferralCode(8);
    assert.equal(code.length, 8);
    assert.equal(getReferralBotLink('malin_kiev_ua_bot', 'ABCD1234'), 'https://t.me/malin_kiev_ua_bot?start=ref_ABCD1234');
    assert.equal(
      maxRewardUahPerReferred(),
      REFERRAL_REWARD_UAH.registration +
        REFERRAL_REWARD_UAH.driver_qualified +
        REFERRAL_REWARD_UAH.passenger_completed_ride * MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED
    );
    assert.equal(maxRewardUahPerReferred(), 10 + 40 + 60);
  });

  it('isPersonConnectedToBot', () => {
    assert.equal(isPersonConnectedToBot({}), false);
    assert.equal(isPersonConnectedToBot({ telegramChatId: null, telegramUserId: null }), false);
    assert.equal(isPersonConnectedToBot({ telegramChatId: '1', telegramUserId: null }), true);
    assert.equal(isPersonConnectedToBot({ telegramChatId: null, telegramUserId: '99' }), true);
    assert.equal(isPersonConnectedToBot({ telegramChatId: '  ', telegramUserId: '' }), false);
  });
});

describe('referral sharing buttons', () => {
  it('share url fallback for external links (t.me/share)', () => {
    const link = 'https://t.me/malin_kiev_ua_bot?start=ref_TESTCODE';
    const url = buildTelegramShareUrl(link);
    assert.ok(url.startsWith('https://t.me/share/url?'));
    assert.ok(url.includes(encodeURIComponent(link)));
    assert.ok(url.includes(encodeURIComponent(REFERRAL_SHARE_TEXT)));
  });

  it('program keyboard uses switch_inline_query for share, then copy', () => {
    const link = 'https://t.me/malin_kiev_ua_bot?start=ref_TESTCODE';
    const plain = buildReferralProgramInlineKeyboard(link);
    assert.equal(plain.inline_keyboard.length, 2);
    assert.equal(plain.inline_keyboard[0][0].switch_inline_query, REFERRAL_INLINE_QUERY_PREFIX);
    assert.equal(plain.inline_keyboard[1][0].copy_text?.text, link);

    const withActions = buildReferralProgramInlineKeyboard(link, { withInviteActions: true });
    const callbacks = withActions.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
    assert.deepEqual(callbacks, ['referral_invite_contact', 'referral_my_stats']);
  });

  it('inline query matcher and share message', () => {
    const link = 'https://t.me/malin_kiev_ua_bot?start=ref_ABCD';
    assert.equal(isReferralInlineShareQuery(''), false);
    assert.equal(isReferralInlineShareQuery('ref_share'), true);
    assert.equal(isReferralInlineShareQuery('allrides'), false);
    assert.ok(buildReferralShareMessageText(link).includes(link));
    const result = buildReferralShareInlineQueryResult(link);
    assert.equal(result.type, 'article');
    assert.equal(result.input_message_content.message_text, buildReferralShareMessageText(link));
  });
});

describe('pending referral code survives a restart', () => {
  type PendingRow = { telegramChatId: string; code: string; referrerPersonId: number; expiresAt: Date };

  function createPendingPrismaMock(rows: PendingRow[] = []) {
    return {
      pendingReferralCode: {
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { telegramChatId: string };
          create: PendingRow;
          update: Omit<PendingRow, 'telegramChatId'>;
        }) => {
          const existing = rows.find((r) => r.telegramChatId === where.telegramChatId);
          if (existing) Object.assign(existing, update);
          else rows.push(create);
          return {};
        },
        findUnique: async ({ where }: { where: { telegramChatId: string } }) =>
          rows.find((r) => r.telegramChatId === where.telegramChatId) ?? null,
        delete: async ({ where }: { where: { telegramChatId: string } }) => {
          const i = rows.findIndex((r) => r.telegramChatId === where.telegramChatId);
          if (i >= 0) rows.splice(i, 1);
          return {};
        },
        deleteMany: async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].expiresAt < where.expiresAt.lt) rows.splice(i, 1);
          }
          return { count: before - rows.length };
        },
      },
      person: {
        findFirst: async ({ where }: { where: { referralCode: string } }) =>
          where.referralCode === 'TESTCODE' ? { id: 7 } : null,
      },
      _rows: rows,
    } as unknown as PrismaClient & { _rows: PendingRow[] };
  }

  it('handleReferralStartParam stores the code in the database', async () => {
    const prisma = createPendingPrismaMock();
    const ok = await handleReferralStartParam(prisma, '555', 'ref_TESTCODE');
    assert.equal(ok, true);
    assert.equal(prisma._rows.length, 1);
    assert.equal(prisma._rows[0].code, 'TESTCODE');
    assert.equal(prisma._rows[0].referrerPersonId, 7);
    assert.ok(prisma._rows[0].expiresAt.getTime() > Date.now());
  });

  it('unknown code is not stored', async () => {
    const prisma = createPendingPrismaMock();
    assert.equal(await handleReferralStartParam(prisma, '555', 'ref_NOPE'), false);
    assert.equal(prisma._rows.length, 0);
  });

  it('takePendingReferralCode returns the code once', async () => {
    const prisma = createPendingPrismaMock();
    await storePendingReferralCode(prisma, '555', 7, 'TESTCODE');

    assert.equal(await takePendingReferralCode(prisma, '555'), 'TESTCODE');
    // другий раз — уже нічого
    assert.equal(await takePendingReferralCode(prisma, '555'), null);
  });

  it('expired code is dropped, not applied', async () => {
    const prisma = createPendingPrismaMock([
      {
        telegramChatId: '555',
        code: 'OLDCODE',
        referrerPersonId: 7,
        expiresAt: new Date(Date.now() - 1000),
      },
    ]);
    assert.equal(await takePendingReferralCode(prisma, '555'), null);
    assert.equal(prisma._rows.length, 0, 'протермінований рядок має видалятись');
  });

  it('cleanup removes only expired rows', async () => {
    const prisma = createPendingPrismaMock([
      { telegramChatId: '1', code: 'A', referrerPersonId: 7, expiresAt: new Date(Date.now() - 1000) },
      { telegramChatId: '2', code: 'B', referrerPersonId: 7, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    assert.equal(await cleanupExpiredPendingReferralCodes(prisma), 1);
    assert.deepEqual(prisma._rows.map((r) => r.telegramChatId), ['2']);
  });
});

describe('self-referral guard (same Telegram account)', () => {
  it('isSameTelegramAccount matches by chat or user, ignores empty and "0"', () => {
    assert.equal(
      isSameTelegramAccount({ telegramChatId: '555', telegramUserId: null }, { telegramChatId: '555', telegramUserId: null }),
      true
    );
    assert.equal(
      isSameTelegramAccount({ telegramChatId: null, telegramUserId: '77' }, { telegramChatId: null, telegramUserId: '77' }),
      true
    );
    assert.equal(
      isSameTelegramAccount({ telegramChatId: '555', telegramUserId: null }, { telegramChatId: '666', telegramUserId: null }),
      false
    );
    // порожні та '0' не роблять людей однаковими
    assert.equal(
      isSameTelegramAccount({ telegramChatId: '0', telegramUserId: '' }, { telegramChatId: '0', telegramUserId: null }),
      false
    );
    assert.equal(
      isSameTelegramAccount({ telegramChatId: null, telegramUserId: null }, { telegramChatId: null, telegramUserId: null }),
      false
    );
  });

  it('createReferralInvite rejects a second phone of the same Telegram account', async () => {
    const referrer = { id: 1, telegramChatId: '555', telegramUserId: '555' };
    const secondPhonePerson = {
      id: 2,
      phoneNormalized: '380502222222',
      telegramChatId: '555',
      telegramUserId: '555',
      referredByPersonId: null,
    };
    const created: unknown[] = [];
    const prisma = {
      person: {
        findUnique: async ({ where }: { where: { phoneNormalized?: string; id?: number } }) => {
          if (where.id === 1) return referrer;
          if (where.phoneNormalized === '380502222222') return secondPhonePerson;
          return null;
        },
        findFirst: async () => null,
      },
      referralInvite: {
        findFirst: async () => null,
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return { id: 1 };
        },
      },
    } as unknown as PrismaClient;

    const result = await createReferralInvite(prisma, 1, '0502222222');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.selfReferral, true);
    assert.equal(created.length, 0, 'запрошення не має створюватись');
  });

  it('linkReferralOnRegistration blocks the link and marks the invite', async () => {
    const invites = [
      {
        id: 9,
        referrerId: 1,
        status: 'pending',
        invitePhoneNorm: '380502222222',
        inviteUsername: null,
        registrationBonusEligible: true,
      },
    ];
    const personUpdates: unknown[] = [];
    const prisma = {
      person: {
        findUnique: async ({ where }: { where: { id: number } }) => {
          if (where.id === 2) {
            return {
              referredByPersonId: null,
              referralRegistrationBonusEligible: null,
              telegramChatId: '555',
              telegramUserId: '555',
            };
          }
          return { telegramChatId: '555', telegramUserId: '555' };
        },
        findFirst: async () => null,
        update: async ({ data }: { data: unknown }) => {
          personUpdates.push(data);
          return {};
        },
      },
      referralInvite: {
        findFirst: async () => invites[0],
        update: async ({ where, data }: { where: { id: number }; data: { status: string } }) => {
          const inv = invites.find((i) => i.id === where.id)!;
          inv.status = data.status;
          return inv;
        },
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaClient;

    const result = await linkReferralOnRegistration(prisma, 2, '380502222222', null, null, true);
    assert.equal(result.linked, false);
    assert.equal(result.selfReferralBlocked, true);
    assert.equal(result.referrerId, 1);
    assert.equal(invites[0].status, 'blocked_self_referral');
    assert.equal(personUpdates.length, 0, 'referredByPersonId не має проставлятись');
  });

  it('flagUnpaidRewardsForSelfReferral freezes unpaid rewards of both persons', async () => {
    const calls: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      referralReward: {
        updateMany: async ({ where, data }: { where: unknown; data: unknown }) => {
          calls.push({ where, data });
          return { count: 3 };
        },
      },
    } as unknown as PrismaClient;

    const n = await flagUnpaidRewardsForSelfReferral(prisma, [1, 2, 2]);
    assert.equal(n, 3);
    assert.deepEqual(calls[0].where, {
      referrerId: { in: [1, 2] },
      status: { in: ['hold', 'pending', 'approved'] },
    });
    assert.deepEqual(calls[0].data, {
      status: 'flagged',
      flagReason: SELF_REFERRAL_FLAG_REASON,
    });
    // причина захищена — схвалення фото не розморозить
    assert.equal(isProtectedFlagReason(SELF_REFERRAL_FLAG_REASON), true);
  });
});

type RewardRow = {
  id: number;
  referrerId: number;
  referredPersonId: number;
  rewardType: string;
  amountUah: number;
  status: string;
  flagReason?: string | null;
  rideProofId?: number | null;
  viberListingId?: number | null;
};

function createRewardPrismaMock(opts: {
  passengerId: number;
  passengerReferrerId: number | null;
  /** водій = passengerReferrerId; його реферер */
  driverReferrerId?: number | null;
  driverHasListing?: boolean;
  existingRewards?: RewardRow[];
  proofRoute?: string;
  proofTime?: string;
  /** false = уже був у базі клієнтів → без 10 грн */
  passengerRegistrationBonusEligible?: boolean | null;
  driverRegistrationBonusEligible?: boolean | null;
  /** Бюджет акції; за замовчуванням вистачає на все */
  budgetUah?: number;
}) {
  let nextRewardId = 1;
  const rewards: RewardRow[] = [...(opts.existingRewards ?? [])];
  const proofsUpdated: Array<{ id: number; status: string; flagReason?: string }> = [];

  const prisma = {
    rideCompletionProof: {
      findUnique: async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        personId: opts.passengerId,
        route: opts.proofRoute ?? 'Kyiv-Malyn',
        rideDate: new Date('2026-08-04T00:00:00.000Z'),
        departureTime: opts.proofTime ?? '10:00',
        person: { id: opts.passengerId, referredByPersonId: opts.passengerReferrerId },
      }),
      findMany: async () => [],
      update: async ({ where, data }: { where: { id: number }; data: { status: string; flagReason?: string } }) => {
        proofsUpdated.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      },
    },
    viberListing: {
      findMany: async () => [],
      findFirst: async ({ where }: { where: { personId: number; listingType: string } }) => {
        if (where.listingType === 'driver' && opts.driverHasListing && where.personId === opts.passengerReferrerId) {
          return { id: 77 };
        }
        return null;
      },
    },
    person: {
      findUnique: async ({ where }: { where: { id: number }; select?: Record<string, boolean> }) => {
        // unlockRegistration / getReferrer for passenger
        if (where.id === opts.passengerId) {
          return {
            referredByPersonId: opts.passengerReferrerId,
            referralRegistrationBonusEligible: opts.passengerRegistrationBonusEligible ?? true,
          };
        }
        // getReferrer for driver (passengerReferrer)
        if (where.id === opts.passengerReferrerId) {
          return {
            referredByPersonId: opts.driverReferrerId ?? null,
            referralRegistrationBonusEligible: opts.driverRegistrationBonusEligible ?? true,
          };
        }
        return { referredByPersonId: null, referralRegistrationBonusEligible: true };
      },
    },
    referralReward: {
      findFirst: async ({
        where,
      }: {
        where: {
          referrerId: number;
          referredPersonId: number;
          rewardType: string;
          rideProofId?: number;
          status?: { not: string };
        };
      }) => {
        return (
          rewards.find(
            (r) =>
              r.referrerId === where.referrerId &&
              r.referredPersonId === where.referredPersonId &&
              r.rewardType === where.rewardType &&
              (where.rideProofId == null || r.rideProofId === where.rideProofId)
          ) ?? null
        );
      },
      count: async ({
        where,
      }: {
        where: { referrerId: number; referredPersonId: number; rewardType: string; status?: { not: string } };
      }) =>
        rewards.filter(
          (r) =>
            r.referrerId === where.referrerId &&
            r.referredPersonId === where.referredPersonId &&
            r.rewardType === where.rewardType &&
            (where.status?.not ? r.status !== where.status.not : true)
        ).length,
      create: async ({ data }: { data: Omit<RewardRow, 'id'> }) => {
        const row = { id: nextRewardId++, ...data };
        rewards.push(row);
        return row;
      },
      aggregate: async ({ where }: { where?: { referrerId?: number } }) => {
        const matching = rewards.filter(
          (r) => r.status !== 'flagged' && (where?.referrerId == null || r.referrerId === where.referrerId)
        );
        return {
          _sum: { amountUah: matching.reduce((s, r) => s + r.amountUah, 0) },
          _count: { _all: matching.length },
        };
      },
    },
    referralProgramSettings: {
      findFirst: async () => ({ id: 1, budgetUah: opts.budgetUah ?? 1_000_000 }),
      create: async () => ({ id: 1, budgetUah: opts.budgetUah ?? 1_000_000 }),
    },
    _rewards: rewards,
    _proofsUpdated: proofsUpdated,
  };

  return prisma as unknown as PrismaClient & { _rewards: RewardRow[]; _proofsUpdated: typeof proofsUpdated };
}

describe('processReferralRewardsAfterPassengerProof', () => {
  it('first confirmed passenger trip → 10+20 referrer and 20 self', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      driverHasListing: false,
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 100);
    assert.equal(result.passengerRideCreated, true);
    assert.equal(result.passengerSelfCreated, true);
    assert.equal(result.passengerSelfUah, 20);
    assert.equal(result.registrationCreated, true);
    assert.equal(result.driverQualifiedCreated, false);
    assert.equal(
      result.totalNewUah,
      REFERRAL_REWARD_UAH.registration +
        REFERRAL_REWARD_UAH.passenger_completed_ride +
        REFERRAL_REWARD_UAH.passenger_self_confirm
    );
    assert.equal(result.totalNewUah, 50);

    const types = prisma._rewards.map((r) => r.rewardType).sort();
    assert.deepEqual(types, ['passenger_completed_ride', 'passenger_self_confirm', 'registration']);
    const self = prisma._rewards.find((r) => r.rewardType === 'passenger_self_confirm');
    assert.equal(self?.referrerId, 2);
    assert.equal(self?.referredPersonId, 2);
    // до модерації фото гроші не в черзі виплат
    assert.deepEqual(
      prisma._rewards.map((r) => r.status),
      ['hold', 'hold', 'hold']
    );
  });

  it('second passenger trip → +20 referrer +20 self (registration already unlocked)', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      existingRewards: [
        {
          id: 1,
          referrerId: 1,
          referredPersonId: 2,
          rewardType: 'registration',
          amountUah: 10,
          status: 'pending',
        },
        {
          id: 2,
          referrerId: 1,
          referredPersonId: 2,
          rewardType: 'passenger_completed_ride',
          amountUah: 20,
          status: 'pending',
          rideProofId: 99,
        },
        {
          id: 3,
          referrerId: 2,
          referredPersonId: 2,
          rewardType: 'passenger_self_confirm',
          amountUah: 20,
          status: 'pending',
          rideProofId: 99,
        },
      ],
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 101);
    assert.equal(result.passengerRideCreated, true);
    assert.equal(result.passengerSelfCreated, true);
    assert.equal(result.registrationCreated, false);
    assert.equal(result.totalNewUah, 40);
  });

  it('passenger limit 3 → limitReached, no more passenger rewards', async () => {
    const existing = [1, 2, 3].map((i) => ({
      id: i,
      referrerId: 1,
      referredPersonId: 2,
      rewardType: 'passenger_completed_ride',
      amountUah: 20,
      status: 'pending',
      rideProofId: 90 + i,
    }));
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      existingRewards: [
        {
          id: 10,
          referrerId: 1,
          referredPersonId: 2,
          rewardType: 'registration',
          amountUah: 10,
          status: 'pending',
        },
        ...existing,
      ],
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 200);
    assert.equal(result.limitReached, true);
    assert.equal(result.passengerRideCreated, false);
    assert.equal(result.registrationCreated, false);
  });

  it('driver path: invited passenger confirms → 10+40 for driver referrer + self 20', async () => {
    // A=10 invites driver B=20; B invites passenger C=30; C confirms
    const prisma = createRewardPrismaMock({
      passengerId: 30,
      passengerReferrerId: 20,
      driverReferrerId: 10,
      driverHasListing: true,
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 300);
    assert.equal(result.passengerRideCreated, true);
    assert.equal(result.passengerSelfCreated, true);
    assert.equal(result.registrationCreated, true);
    assert.equal(result.driverQualifiedCreated, true);
    assert.equal(result.driverReferrerId, 10);
    assert.equal(result.passengerReferrerId, 20);

    // B:10+20 + C:20 self + A:40 + A:10(registration for driver B) = 100
    assert.equal(result.totalNewUah, 10 + 20 + 20 + 40 + 10);

    const forA = prisma._rewards.filter((r) => r.referrerId === 10);
    assert.ok(forA.some((r) => r.rewardType === 'driver_qualified' && r.amountUah === 40));
    assert.ok(forA.some((r) => r.rewardType === 'registration' && r.referredPersonId === 20));

    const forB = prisma._rewards.filter((r) => r.referrerId === 20);
    assert.ok(forB.some((r) => r.rewardType === 'passenger_completed_ride'));
    assert.ok(forB.some((r) => r.rewardType === 'registration' && r.referredPersonId === 30));

    const forC = prisma._rewards.filter((r) => r.referrerId === 30);
    assert.ok(forC.some((r) => r.rewardType === 'passenger_self_confirm' && r.amountUah === 20));
  });

  it('driver registration bonus unlocks even when driver_qualified already exists', async () => {
    // A=10 колись уже отримав 40 грн за водія B=20; реєстраційні 10 грн тоді не нарахувались
    const prisma = createRewardPrismaMock({
      passengerId: 30,
      passengerReferrerId: 20,
      driverReferrerId: 10,
      driverHasListing: true,
      existingRewards: [
        {
          id: 1,
          referrerId: 10,
          referredPersonId: 20,
          rewardType: 'driver_qualified',
          amountUah: 40,
          status: 'approved',
        },
      ],
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 301);
    assert.equal(result.driverQualifiedCreated, false, 'другої нагороди водія бути не має');

    const regForA = prisma._rewards.find(
      (r) => r.referrerId === 10 && r.rewardType === 'registration' && r.referredPersonId === 20
    );
    assert.ok(regForA, 'реєстраційні 10 грн мають розблокуватись');
    assert.equal(regForA?.amountUah, REFERRAL_REWARD_UAH.registration);
  });

  it('driver without listing → no driver_qualified', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 30,
      passengerReferrerId: 20,
      driverReferrerId: 10,
      driverHasListing: false,
    });
    const result = await processReferralRewardsAfterPassengerProof(prisma, 301);
    assert.equal(result.driverQualifiedCreated, false);
    assert.equal(result.totalNewUah, 50); // B:10+20 + C:20
  });

  it('budget exhausted → rewards created on hold with a protected reason', async () => {
    // бюджет 30 грн: вистачить на 20 (друг-пасажир), решта — на утриманні
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      budgetUah: 30,
    });

    const result = await processReferralRewardsAfterPassengerProof(prisma, 100);
    assert.equal(result.budgetHeldUah > 0, true);

    const held = prisma._rewards.filter((r) => r.flagReason === REFERRAL_BUDGET_HOLD_REASON);
    assert.equal(held.length > 0, true, 'частина нагород має бути на бюджетному утриманні');
    // статус лишається hold — це не підозра у фроді
    assert.equal(held.every((r) => r.status === 'hold'), true);
    // схвалення фото не розморозить ці гроші
    assert.equal(isProtectedFlagReason(REFERRAL_BUDGET_HOLD_REASON), true);
  });

  it('no referrer → no rewards', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 5,
      passengerReferrerId: null,
    });
    const result = await processReferralRewardsAfterPassengerProof(prisma, 1);
    assert.equal(result.totalNewUah, 0);
    assert.equal(prisma._rewards.length, 0);
  });

  it('existing client (no 10 грн): only trip bonuses 20+20', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      passengerRegistrationBonusEligible: false,
    });
    const result = await processReferralRewardsAfterPassengerProof(prisma, 100);
    assert.equal(result.registrationCreated, false);
    assert.equal(result.passengerRideCreated, true);
    assert.equal(result.passengerSelfCreated, true);
    assert.equal(result.totalNewUah, 40);
    assert.ok(!prisma._rewards.some((r) => r.rewardType === 'registration'));
  });
});

describe('unlockRegistrationReward eligibility', () => {
  it('skips when referralRegistrationBonusEligible=false', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 2,
      passengerReferrerId: 1,
      passengerRegistrationBonusEligible: false,
    });
    const r = await unlockRegistrationReward(prisma, 2);
    assert.equal(r.created, false);
    assert.equal(r.skippedExistingClient, true);
  });
});

describe('payout balances and FB caption', () => {
  it('buildPayoutBalancesFromRewards aggregates by person', () => {
    const rows = buildPayoutBalancesFromRewards([
      {
        id: 1,
        referrerId: 10,
        amountUah: 30,
        status: 'pending',
        referrer: { id: 10, fullName: 'A', phoneNormalized: '380501111111', telegramUsername: null },
      },
      {
        id: 2,
        referrerId: 10,
        amountUah: 20,
        status: 'approved',
        referrer: { id: 10, fullName: 'A', phoneNormalized: '380501111111', telegramUsername: null },
      },
      {
        id: 3,
        referrerId: 10,
        amountUah: 40,
        status: 'paid',
        referrer: { id: 10, fullName: 'A', phoneNormalized: '380501111111', telegramUsername: null },
      },
      {
        id: 4,
        referrerId: 11,
        amountUah: 20,
        status: 'flagged',
        referrer: { id: 11, fullName: 'B', phoneNormalized: '380502222222', telegramUsername: null },
      },
    ]);
    assert.equal(rows.length, 2);
    const a = rows.find((r) => r.personId === 10)!;
    // pending (legacy) не платимо — лише approved
    assert.equal(a.payableUah, 20);
    assert.equal(a.payableCount, 1);
    assert.equal(a.holdUah, 30);
    assert.equal(a.holdCount, 1);
    assert.equal(a.paidUah, 40);
    assert.deepEqual(a.rewardIds.sort(), [2]);
    const b = rows.find((r) => r.personId === 11)!;
    assert.equal(b.flaggedUah, 20);
    assert.equal(b.payableUah, 0);
  });

  it('hold rewards stay out of the payout queue', () => {
    const rows = buildPayoutBalancesFromRewards([
      {
        id: 1,
        referrerId: 10,
        amountUah: 50,
        status: 'hold',
        referrer: { id: 10, fullName: 'A', phoneNormalized: '380501111111', telegramUsername: null },
      },
    ]);
    assert.equal(rows[0].payableUah, 0);
    assert.equal(rows[0].payableCount, 0);
    assert.equal(rows[0].holdUah, 50);
    assert.deepEqual(rows[0].rewardIds, []);
  });

  it('buildRideFacebookShareCaption is share-ready', () => {
    const text = buildRideFacebookShareCaption({
      route: 'Kyiv-Malyn',
      dateKey: '2026-08-04',
      referralLink: 'https://t.me/malin_kiev_ua_bot?start=ref_TESTCODE',
    });
    assert.match(text, /Kyiv → Malyn/);
    assert.match(text, /04\.08\.2026/);
    assert.match(text, /malin\.kiev\.ua\/mizhgorodski/);
    assert.match(text, /start=ref_TESTCODE/);
    assert.match(text, /мобільний/);
    // CopyTextButton Telegram — max 256
    assert.ok([...text].length <= 256, `caption too long: ${[...text].length}`);
  });

  it('flagUnpaidReferralRewardsForBotBlocked flags only unpaid for that person', async () => {
    const calls: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      referralReward: {
        updateMany: async ({ where, data }: { where: unknown; data: unknown }) => {
          calls.push({ where, data });
          return { count: 2 };
        },
      },
    } as unknown as PrismaClient;

    const n = await flagUnpaidReferralRewardsForBotBlocked(prisma, 42);
    assert.equal(n, 2);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].where, {
      referrerId: 42,
      status: { in: ['hold', 'pending', 'approved'] },
    });
    assert.deepEqual(calls[0].data, {
      status: 'flagged',
      flagReason: BOT_BLOCKED_REWARD_FLAG_REASON,
    });
    assert.match(BOT_BLOCKED_REWARD_FLAG_REASON, /заблоковано/);
  });

  it('buildBotBlockedPayoutsFrozenMessage has no amounts, has bot link', () => {
    const text = buildBotBlockedPayoutsFrozenMessage('malin_kiev_ua_bot');
    assert.match(text, /на паузі/);
    assert.match(text, /заморожено/);
    assert.match(text, /t\.me\/malin_kiev_ua_bot/);
    assert.match(text, /\/start/);
    assert.doesNotMatch(text, /\d+\s*грн/i);
    assert.doesNotMatch(text, /\d+\s*UAH/i);
  });

  it('markReferralPayout pays only approved and never twice', async () => {
    const rows = [
      { id: 1, amountUah: 20, status: 'approved' },
      { id: 2, amountUah: 30, status: 'hold' },
      { id: 3, amountUah: 40, status: 'paid' },
    ];
    const tx = {
      referralReward: {
        findMany: async ({ where }: { where: { status?: string; id?: { in: number[] } } }) =>
          rows
            .filter((r) => (where.status ? r.status === where.status : true))
            .filter((r) => (where.id?.in ? where.id.in.includes(r.id) : true))
            .map((r) => ({ id: r.id, amountUah: r.amountUah })),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: number; status: string };
          data: { status: string };
        }) => {
          const row = rows.find((r) => r.id === where.id && r.status === where.status);
          if (!row) return { count: 0 };
          row.status = data.status;
          return { count: 1 };
        },
      },
    };
    const prisma = {
      $transaction: async (fn: (c: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaClient;

    const first = await markReferralPayout(prisma, { personId: 7, note: 'Київстар' });
    assert.equal(first.updatedCount, 1);
    assert.equal(first.amountUah, 20);
    assert.deepEqual(first.rewardIds, [1]);

    // повторний клік — платити вже нічого
    const second = await markReferralPayout(prisma, { personId: 7, note: 'Київстар' });
    assert.equal(second.updatedCount, 0);
    assert.equal(second.amountUah, 0);
    // hold лишився недоторканим
    assert.equal(rows.find((r) => r.id === 2)!.status, 'hold');
  });

  it('admin manual flag is protected from auto-unlock', () => {
    const reason = withAdminManualFlagReason('Перевірити вручну');
    assert.equal(reason.startsWith(ADMIN_MANUAL_FLAG_PREFIX), true);
    assert.equal(isProtectedFlagReason(reason), true);
    assert.equal(isProtectedFlagReason(BOT_BLOCKED_REWARD_FLAG_REASON), true);
    assert.equal(isProtectedFlagReason('Дубль маршруту того ж дня'), false);
    assert.equal(withAdminManualFlagReason(reason), reason);
  });
});
