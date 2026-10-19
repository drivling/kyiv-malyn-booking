"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEGRAM_LOGIN_MAX_AGE_SEC = exports.TELEGRAM_LOGIN_HEADER = void 0;
exports.telegramLoginSecret = telegramLoginSecret;
exports.telegramLoginCheckString = telegramLoginCheckString;
exports.signTelegramLogin = signTelegramLogin;
exports.verifyTelegramLogin = verifyTelegramLogin;
exports.encodeTelegramLoginHeader = encodeTelegramLoginHeader;
exports.decodeTelegramLoginHeader = decodeTelegramLoginHeader;
exports.requireTelegramLogin = requireTelegramLogin;
exports.telegramLoginFromRes = telegramLoginFromRes;
/**
 * Перевірка підпису Telegram Login Widget для `/user/*` (Docs/transport-open-data-2026-10.md, фаза 4,
 * передумова): https://core.telegram.org/widgets/login#checking-authorization.
 *
 * Фронтенд тримає відповідь віджета (`userState.getTelegramUser()`) і шле її цілком у заголовку
 * `X-Telegram-Login` як base64url(JSON). Бекенд рахує HMAC-SHA256 рядка `key=value\n…` (поля віджета без
 * `hash`, відсортовані) з ключем sha256(TELEGRAM_BOT_TOKEN) і порівнює з `hash`; `auth_date` має бути не
 * старшим за TELEGRAM_LOGIN_MAX_AGE_SEC. Голому `telegramUserId` з query/body більше не віримо.
 */
const crypto_1 = require("crypto");
exports.TELEGRAM_LOGIN_HEADER = 'x-telegram-login';
/** Доба — як радить документація віджета (старіші дані = повторний вхід) */
exports.TELEGRAM_LOGIN_MAX_AGE_SEC = 24 * 60 * 60;
/** Допуск на розбіжність годинників: auth_date «з майбутнього» не далі ніж на 5 хв */
const FUTURE_SKEW_SEC = 5 * 60;
/** Поля, які підписує Telegram. Усе інше (наш `phone`) у рядок перевірки не входить. */
const SIGNED_FIELDS = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'];
function telegramLoginSecret(botToken) {
    return (0, crypto_1.createHash)('sha256').update(botToken).digest();
}
/** Рядок перевірки за документацією: `key=value` відсортованих підписаних полів через `\n` */
function telegramLoginCheckString(payload) {
    return SIGNED_FIELDS.filter((k) => payload[k] !== undefined && payload[k] !== null && payload[k] !== '')
        .sort()
        .map((k) => `${k}=${String(payload[k])}`)
        .join('\n');
}
/** Підпис для тестів і для перевірки: hex HMAC-SHA256(sha256(botToken), checkString) */
function signTelegramLogin(payload, botToken) {
    return (0, crypto_1.createHmac)('sha256', telegramLoginSecret(botToken)).update(telegramLoginCheckString(payload)).digest('hex');
}
function verifyTelegramLogin(raw, botToken, nowSec = Math.floor(Date.now() / 1000)) {
    if (!raw || typeof raw !== 'object')
        return { ok: false, reason: 'malformed' };
    const payload = raw;
    const id = typeof payload.id === 'number' || typeof payload.id === 'string' ? String(payload.id).trim() : '';
    const hash = typeof payload.hash === 'string' ? payload.hash.trim().toLowerCase() : '';
    const authDate = Number(payload.auth_date);
    if (!/^\d+$/.test(id) || id === '0' || !/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(authDate) || authDate <= 0) {
        return { ok: false, reason: 'malformed' };
    }
    const expected = Buffer.from(signTelegramLogin(payload, botToken), 'hex');
    const given = Buffer.from(hash, 'hex');
    if (expected.length !== given.length || !(0, crypto_1.timingSafeEqual)(expected, given)) {
        return { ok: false, reason: 'invalid' };
    }
    if (authDate > nowSec + FUTURE_SKEW_SEC || nowSec - authDate > exports.TELEGRAM_LOGIN_MAX_AGE_SEC) {
        return { ok: false, reason: 'expired' };
    }
    return {
        ok: true,
        user: {
            id,
            firstName: typeof payload.first_name === 'string' ? payload.first_name : '',
            lastName: typeof payload.last_name === 'string' ? payload.last_name : null,
            username: typeof payload.username === 'string' ? payload.username : null,
            authDate,
        },
    };
}
function encodeTelegramLoginHeader(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
function decodeTelegramLoginHeader(value) {
    if (!value || typeof value !== 'string')
        return null;
    try {
        return JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf8'));
    }
    catch {
        return null;
    }
}
const FAILURE_MESSAGE = {
    missing: 'Потрібен вхід через Telegram',
    malformed: 'Потрібен вхід через Telegram',
    invalid: 'Дані входу через Telegram не підтверджено — увійдіть ще раз',
    expired: 'Сесія входу через Telegram застаріла — увійдіть ще раз',
};
/**
 * Express-guard: без/з поганим підписом — 401 `{ error, reason }`; без токена бота на сервері — 503
 * (перевірити підпис нема чим; мовчазного пропуску не буває). Успіх → `res.locals.telegramLogin`.
 */
function requireTelegramLogin(opts) {
    const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    return (req, res, next) => {
        if (!opts.botToken) {
            return res.status(503).json({ error: 'Вхід через Telegram на сервері не налаштовано', reason: 'unavailable' });
        }
        const header = req.get(exports.TELEGRAM_LOGIN_HEADER);
        if (!header)
            return res.status(401).json({ error: FAILURE_MESSAGE.missing, reason: 'missing' });
        const check = verifyTelegramLogin(decodeTelegramLoginHeader(header), opts.botToken, now());
        if (!check.ok)
            return res.status(401).json({ error: FAILURE_MESSAGE[check.reason], reason: check.reason });
        res.locals.telegramLogin = check.user;
        next();
    };
}
function telegramLoginFromRes(res) {
    const user = res.locals.telegramLogin;
    if (!user)
        throw new Error('requireTelegramLogin must run before this handler');
    return user;
}
