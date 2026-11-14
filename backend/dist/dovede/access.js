"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_LOGIN_WINDOW_MS = exports.DOVEDE_LOGIN_MAX_FAILURES = exports.DOVEDE_TOKEN_HEADER = void 0;
exports.isDovedePublic = isDovedePublic;
exports.dovedePassword = dovedePassword;
exports.dovedeAccessFromEnv = dovedeAccessFromEnv;
exports.dovedeAccessToken = dovedeAccessToken;
exports.hasDovedeAccess = hasDovedeAccess;
exports.requireDovedeAccess = requireDovedeAccess;
exports.createLoginFailures = createLoginFailures;
/**
 * Хто може користуватися «Доведе»: сторінка /dovede і POST /dovede/understand (Docs/dovede-roadmap.md, «Доступ»).
 *
 * - `DOVEDE_PUBLIC=ON` — усі (публічний запуск). Поки не ON — лише ті, хто знає пароль, і адмін.
 * - `DOVEDE_PASSWORD` — окремий від ADMIN_PASSWORD пароль для запрошених: його можна дати людям, не віддаючи
 *   адмінку. POST /dovede/login повертає токен HMAC-SHA256(DOVEDE_PASSWORD, 'dovede-access-v1'), браузер шле
 *   його в `X-Dovede-Token`. Зміна пароля відкликає всі видані токени. Не задано — вхід за паролем вимкнено.
 * - Токен адміна (`Authorization`) теж відкриває: власник не вводить другий пароль.
 * Сіль відрізняється від адмінської й від ключа стіни: жоден із цих токенів не підходить замість іншого.
 */
const crypto_1 = require("crypto");
const require_admin_1 = require("../middleware/require-admin");
exports.DOVEDE_TOKEN_HEADER = 'x-dovede-token';
const DOVEDE_TOKEN_SALT = 'dovede-access-v1';
/** Скільки невдалих паролів поспіль приймаємо за вікно, далі 429 (одна лічилка на всіх: за проксі Railway IP однаковий) */
exports.DOVEDE_LOGIN_MAX_FAILURES = 20;
exports.DOVEDE_LOGIN_WINDOW_MS = 15 * 60000;
/** `ON` (і `1` / `true` / `yes`, без огляду на регістр) — сторінка відкрита всім */
function isDovedePublic(env = process.env) {
    const v = (env.DOVEDE_PUBLIC ?? '').trim().toLowerCase();
    return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}
function dovedePassword(env = process.env) {
    const v = env.DOVEDE_PASSWORD ?? '';
    return v.trim() ? v : null;
}
function dovedeAccessFromEnv() {
    return { isPublic: () => isDovedePublic(), password: () => dovedePassword() };
}
/** Значення `X-Dovede-Token` після успішного POST /dovede/login */
function dovedeAccessToken(password) {
    return (0, crypto_1.createHmac)('sha256', password).update(DOVEDE_TOKEN_SALT).digest('hex');
}
function hasDovedeAccess(req, cfg) {
    if (cfg.isPublic() || (0, require_admin_1.isAdminRequest)(req))
        return true;
    const password = cfg.password();
    return password !== null && (0, require_admin_1.safeEqual)(req.headers[exports.DOVEDE_TOKEN_HEADER], dovedeAccessToken(password));
}
function requireDovedeAccess(cfg) {
    return (req, res, next) => {
        if (hasDovedeAccess(req, cfg))
            next();
        else
            res.status(401).json({ error: 'Unauthorized' });
    };
}
/** Лічилка невдалих паролів: `blocked()` — вікно вичерпано; успішний вхід її не скидає (інакше підбір чергувався б із правильним) */
function createLoginFailures(now = Date.now, max = exports.DOVEDE_LOGIN_MAX_FAILURES, windowMs = exports.DOVEDE_LOGIN_WINDOW_MS) {
    let windowStart = 0;
    let failures = 0;
    const roll = () => {
        if (now() - windowStart >= windowMs) {
            windowStart = now();
            failures = 0;
        }
    };
    return {
        blocked() {
            roll();
            return failures >= max;
        },
        fail() {
            roll();
            failures++;
        },
    };
}
