"use strict";
/**
 * Разовий аудит: кілька Person на одному Telegram-акаунті (другий номер у тому самому чаті).
 * Такі пари — база для само-реферала: реферер і «друг» це одна людина.
 *
 * Запуск: npm run find-self-referrals
 * Нічого не змінює — лише звіт у консоль.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const referral_1 = require("./referral");
const prisma = new client_1.PrismaClient();
function groupKey(p) {
    const chat = p.telegramChatId?.trim();
    if (chat && chat !== '0')
        return `chat:${chat}`;
    const user = p.telegramUserId?.trim();
    if (user && user !== '0')
        return `user:${user}`;
    return null;
}
async function findSelfReferrals() {
    console.log('🔍 Пошук кількох Person на одному Telegram-акаунті…\n');
    const persons = (await prisma.person.findMany({
        where: {
            OR: [{ telegramChatId: { not: null } }, { telegramUserId: { not: null } }],
        },
        select: {
            id: true,
            phoneNormalized: true,
            fullName: true,
            telegramChatId: true,
            telegramUserId: true,
            referredByPersonId: true,
        },
        orderBy: { id: 'asc' },
    }));
    const groups = new Map();
    for (const p of persons) {
        const key = groupKey(p);
        if (!key)
            continue;
        const arr = groups.get(key) ?? [];
        arr.push(p);
        groups.set(key, arr);
    }
    const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);
    if (duplicates.length === 0) {
        console.log('✅ Дублікатів немає — на кожному Telegram-акаунті рівно один Person.');
        return;
    }
    console.log(`⚠️  Знайдено ${duplicates.length} Telegram-акаунтів із кількома Person:\n`);
    let selfReferralPairs = 0;
    let unpaidUah = 0;
    for (const [key, rows] of duplicates) {
        console.log(`— ${key} (${rows.length} Person)`);
        for (const p of rows) {
            console.log(`    #${p.id} ${p.phoneNormalized} ${p.fullName ?? '—'}` +
                (p.referredByPersonId ? ` | запросив #${p.referredByPersonId}` : ''));
        }
        // Реферер і запрошений всередині однієї групи — це і є само-реферал
        for (const referred of rows) {
            if (!referred.referredByPersonId)
                continue;
            const referrer = rows.find((r) => r.id === referred.referredByPersonId);
            if (!referrer || !(0, referral_1.isSameTelegramAccount)(referrer, referred))
                continue;
            selfReferralPairs += 1;
            const rewards = await prisma.referralReward.findMany({
                where: {
                    referrerId: { in: [referrer.id, referred.id] },
                    status: { in: referral_1.REWARD_STATUSES_UNPAID },
                },
                select: { id: true, amountUah: true, rewardType: true, status: true, referrerId: true },
            });
            const sum = rewards.reduce((s, r) => s + r.amountUah, 0);
            unpaidUah += sum;
            console.log(`    🚨 САМО-РЕФЕРАЛ: #${referred.id} запрошений #${referrer.id} з того самого акаунта`);
            if (rewards.length > 0) {
                console.log(`       Невиплачених нагород: ${rewards.length} на ${sum} грн`);
                for (const r of rewards) {
                    console.log(`         reward #${r.id} ${r.rewardType} ${r.amountUah} грн (${r.status}) → Person #${r.referrerId}`);
                }
            }
            else {
                console.log('       Невиплачених нагород немає.');
            }
        }
        console.log('');
    }
    console.log('───────────────────────────────');
    console.log(`Telegram-акаунтів з дублями: ${duplicates.length}`);
    console.log(`Підтверджених само-рефералів: ${selfReferralPairs}`);
    console.log(`Невиплачених грошей у них: ${unpaidUah} грн`);
    if (selfReferralPairs > 0) {
        console.log('\nЩо робити: у адмінці «Реферали» знайти ці нагороди та вирішити — Flag чи схвалити.');
    }
}
findSelfReferrals()
    .catch((e) => {
    console.error('❌ find-self-referrals:', e);
    process.exitCode = 1;
})
    .finally(() => prisma.$disconnect());
