"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAdminPassword = resolveAdminPassword;
exports.adminAuthToken = adminAuthToken;
exports.safeEqual = safeEqual;
exports.setAdminPassword = setAdminPassword;
exports.isAdminRequest = isAdminRequest;
exports.requireAdmin = requireAdmin;
const crypto_1 = require("crypto");
/**
 * Адмін-токен — HMAC від ADMIN_PASSWORD: без пароля його не вгадати, а зміна пароля відкликає
 * всі видані токени (і в браузері, і в cron / Viber-парсері). Раніше тут була загальновідома
 * константа `admin-authenticated` — тепер вона не приймається.
 * Сіль відрізняється від ключа віджета (`sticker-wall.ts`), тож ключ стіни не відкриває адмінку.
 */
const ADMIN_TOKEN_SALT = 'admin-session-v1';
const DEV_ADMIN_PASSWORD = 'admin123';
/** Явний пароль → `ADMIN_PASSWORD` → dev-fallback (той самий порядок, що й раніше в create-app) */
function resolveAdminPassword(explicit) {
    return explicit ?? process.env.ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
}
/** Значення `Authorization` після успішного POST /admin/login */
function adminAuthToken(adminPassword) {
    return (0, crypto_1.createHmac)('sha256', adminPassword).update(ADMIN_TOKEN_SALT).digest('hex');
}
/** Порівняння рядків за сталий час (через SHA-256, щоб довжина теж не протікала) */
function safeEqual(given, expected) {
    if (typeof given !== 'string')
        return false;
    const a = (0, crypto_1.createHash)('sha256').update(given).digest();
    const b = (0, crypto_1.createHash)('sha256').update(expected).digest();
    return (0, crypto_1.timingSafeEqual)(a, b);
}
/** Прив'язати пароль до застосунку: requireAdmin бере очікуваний токен з `app.locals` */
function setAdminPassword(app, adminPassword) {
    app.locals.adminAuthToken = adminAuthToken(adminPassword);
}
function expectedToken(req) {
    const token = req.app?.locals?.adminAuthToken;
    return typeof token === 'string' ? token : adminAuthToken(resolveAdminPassword());
}
function isAdminRequest(req) {
    return safeEqual(req.headers.authorization, expectedToken(req));
}
function requireAdmin(req, res, next) {
    if (isAdminRequest(req)) {
        next();
    }
    else {
        res.status(401).json({ error: 'Unauthorized' });
    }
}
