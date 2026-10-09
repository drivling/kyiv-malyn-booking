"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneBlockedError = exports.BLOCKED_ATTEMPT_THROTTLE_MS = exports.PHONE_BLOCKED_ADMIN_MESSAGE = exports.PHONE_BLOCKED_BOT_MESSAGE = exports.PHONE_BLOCKED_MESSAGE = void 0;
exports.isPhoneBlockedError = isPhoneBlockedError;
exports.isPhoneBlocked = isPhoneBlocked;
exports.recordBlockedAttempt = recordBlockedAttempt;
exports.assertPhoneNotBlocked = assertPhoneNotBlocked;
/**
 * Same normalization rules as `normalizePhone` in telegram.ts (digits only, 0XXXXXXXXX → 38…).
 * Копія, а не імпорт: telegram.ts імпортує цей модуль, а це 7600 рядків, які на імпорті
 * піднімають бота — circular dependency. Той самий прийом, що в revoke-telegram-bot.ts.
 */
function normalizePhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '38' + cleaned;
    }
    return cleaned;
}
/** Текст відмови для користувача (сайт і бот). */
exports.PHONE_BLOCKED_MESSAGE = 'Цей номер заблоковано адміністратором. Якщо це помилка — зверніться до підтримки.';
/** Те саме для бота — з розміткою й переносами. */
exports.PHONE_BLOCKED_BOT_MESSAGE = '🚫 <b>Цей номер заблоковано адміністратором за скаргою.</b>\n\n' +
    'Створювати бронювання та оголошення з нього не можна.\n' +
    'Якщо це помилка — зверніться до підтримки.';
/** Для адмінських ендпоінтів: пояснює, де зняти заборону. */
exports.PHONE_BLOCKED_ADMIN_MESSAGE = 'Номер заблоковано («Заборонено використовувати номер»). Зніміть заборону у вкладці «Дані», щоб створити запис.';
/** Не записуємо спробу частіше, ніж раз на 10 хв, щоб натискання в боті не робили write-storm. */
exports.BLOCKED_ATTEMPT_THROTTLE_MS = 10 * 60 * 1000;
/** Кидається там, де відмова має піднятися вгору по стеку (створення оголошення). */
class PhoneBlockedError extends Error {
    constructor(phoneNormalized) {
        super(exports.PHONE_BLOCKED_MESSAGE);
        this.name = 'PhoneBlockedError';
        this.phoneNormalized = phoneNormalized;
    }
}
exports.PhoneBlockedError = PhoneBlockedError;
function isPhoneBlockedError(err) {
    return err instanceof PhoneBlockedError || err?.name === 'PhoneBlockedError';
}
/**
 * Чи заборонений номер. Порожній/нерозбірливий номер вважається незаблокованим —
 * валідація формату не наша справа.
 */
async function isPhoneBlocked(prisma, phone) {
    const normalized = phone ? normalizePhone(phone) : '';
    if (!normalized)
        return false;
    try {
        // try/catch, а не лише .catch(): у вузьких стабах prisma.person може бути undefined,
        // і тоді звертання до .findUnique кидає синхронно, ще до появи проміса.
        const person = await prisma.person.findUnique({
            where: { phoneNormalized: normalized },
            select: { phoneBlockedAt: true },
        });
        return person?.phoneBlockedAt != null;
    }
    catch (e) {
        // Fail-open, як і smsOptOut у sms-fallback.ts: збій БД не має паралізувати створення
        // оголошень для всіх. Заборона — модерація, а не безпековий контур.
        console.error('isPhoneBlocked:', e);
        return false;
    }
}
/**
 * Зафіксувати, що заблокований номер намагався скористатися сервісом.
 * Троттлиться; ніколи не кидає — це телеметрія, а не частина бізнес-логіки.
 */
async function recordBlockedAttempt(prisma, phone) {
    const normalized = normalizePhone(phone);
    if (!normalized)
        return;
    try {
        const person = await prisma.person.findUnique({
            where: { phoneNormalized: normalized },
            select: { id: true, phoneBlockedAt: true, blockedAttemptAt: true },
        });
        if (!person?.phoneBlockedAt)
            return;
        const last = person.blockedAttemptAt?.getTime() ?? 0;
        if (Date.now() - last < exports.BLOCKED_ATTEMPT_THROTTLE_MS)
            return;
        await prisma.person.update({
            where: { id: person.id },
            data: { blockedAttemptAt: new Date(), blockedAttemptCount: { increment: 1 } },
        });
        console.log(`🚫 Заблокований номер ${normalized} намагався скористатися сервісом`);
    }
    catch (e) {
        console.error('recordBlockedAttempt:', e);
    }
}
/**
 * Перевірити номер і кинути `PhoneBlockedError`, якщо він заборонений.
 * Попутно фіксує спробу.
 */
async function assertPhoneNotBlocked(prisma, phone) {
    if (!phone)
        return;
    if (!(await isPhoneBlocked(prisma, phone)))
        return;
    await recordBlockedAttempt(prisma, phone);
    throw new PhoneBlockedError(normalizePhone(phone));
}
