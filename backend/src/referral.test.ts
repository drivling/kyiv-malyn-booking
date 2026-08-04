/**
 * Юніт-тести реферальної програми (чиста логіка + мок Prisma для нарахувань).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  detectTimeConflict,
  generateReferralCode,
  getReferralBotLink,
  isReverseRoute,
  maxRewardUahPerReferred,
  MIN_RIDE_DURATION_MINUTES,
  parseDepartureMinutes,
  parseInviteContact,
  processReferralRewardsAfterPassengerProof,
  REFERRAL_REWARD_UAH,
  MAX_PASSENGER_RIDE_REWARDS_PER_REFERRED,
  type RideTimeSlot,
} from './referral';

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
});

type RewardRow = {
  id: number;
  referrerId: number;
  referredPersonId: number;
  rewardType: string;
  amountUah: number;
  status: string;
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
      findUnique: async ({ where }: { where: { id: number }; select?: { referredByPersonId?: boolean } }) => {
        // unlockRegistration / getReferrer for passenger
        if (where.id === opts.passengerId) {
          return { referredByPersonId: opts.passengerReferrerId };
        }
        // getReferrer for driver (passengerReferrer)
        if (where.id === opts.passengerReferrerId) {
          return { referredByPersonId: opts.driverReferrerId ?? null };
        }
        return { referredByPersonId: null };
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

  it('no referrer → no rewards', async () => {
    const prisma = createRewardPrismaMock({
      passengerId: 5,
      passengerReferrerId: null,
    });
    const result = await processReferralRewardsAfterPassengerProof(prisma, 1);
    assert.equal(result.totalNewUah, 0);
    assert.equal(prisma._rewards.length, 0);
  });
});
