"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = exports.CODE_VERSION = void 0;
exports.createApp = createApp;
exports.getRegisteredRoutes = getRegisteredRoutes;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const poputky_1 = require("./routes/poputky");
const public_routes_1 = require("./routes/public-routes");
const admin_session_1 = require("./routes/admin-session");
const admin_maintenance_1 = require("./routes/admin-maintenance");
const schedules_bookings_1 = require("./routes/schedules-bookings");
const user_profile_1 = require("./routes/user-profile");
const viber_listings_user_1 = require("./routes/viber-listings-user");
const telegram_routes_1 = require("./routes/telegram-routes");
const rideshare_1 = require("./routes/rideshare");
const viber_listings_1 = require("./routes/viber-listings");
const admin_persons_1 = require("./routes/admin-persons");
const admin_messaging_1 = require("./routes/admin-messaging");
const admin_viber_analytics_1 = require("./routes/admin-viber-analytics");
// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
exports.CODE_VERSION = 'viber-v2-2026';
// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + exports.CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));
// Сесія для одноразового промо: якщо TELEGRAM_USER_SESSION_PATH не задано — шукаємо файл у репо (telegram-user/session_telegram_user.session)
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
    const defaultSessionPath = path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
    const defaultSessionFile = defaultSessionPath + '.session';
    if (fs_1.default.existsSync(defaultSessionFile)) {
        process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
        console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session');
    }
}
function createApp(deps) {
    const prisma = deps.prisma;
    const app = (0, express_1.default)();
    // CORS: дозволяємо фронт (malin.kiev.ua + Railway preview)
    const allowedOrigins = [
        'https://malin.kiev.ua',
        'https://www.malin.kiev.ua',
        'http://localhost:5173',
        'http://localhost:3000',
    ];
    const corsOptions = {
        origin: (origin, cb) => {
            if (!origin || allowedOrigins.some((o) => origin === o || origin.endsWith('.railway.app'))) {
                cb(null, true);
            }
            else {
                cb(null, true); // для зручності залишаємо приймати всі; за потреби звужте
            }
        },
        credentials: true,
    };
    app.use((0, cors_1.default)(corsOptions));
    app.use(express_1.default.json());
    app.use('/poputky', (0, poputky_1.createPoputkyRouter)());
    const ADMIN_PASSWORD = deps.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin123';
    app.use((0, public_routes_1.createPublicRoutesRouter)({ codeVersion: exports.CODE_VERSION }));
    app.use((0, admin_session_1.createAdminSessionRouter)({ adminPassword: ADMIN_PASSWORD }));
    app.use((0, admin_maintenance_1.createAdminMaintenanceRouter)({ prisma }));
    app.use((0, schedules_bookings_1.createSchedulesBookingsRouter)({ prisma }));
    app.use((0, user_profile_1.createUserProfileRouter)({ prisma }));
    app.use((0, viber_listings_user_1.createViberListingsUserRouter)({ prisma }));
    app.use((0, telegram_routes_1.createTelegramRoutesRouter)({ prisma }));
    app.use((0, rideshare_1.createRideshareRouter)({ prisma }));
    app.use((0, viber_listings_1.createViberListingsRouter)({ prisma }));
    app.use((0, admin_persons_1.createAdminPersonsRouter)({ prisma }));
    app.use((0, admin_messaging_1.createAdminMessagingRouter)({ prisma }));
    app.use((0, admin_viber_analytics_1.createAdminViberAnalyticsRouter)({ prisma }));
    // Глобальний обробник помилок — завжди повертаємо JSON
    app.use((err, _req, res, _next) => {
        console.error('❌ Unhandled error:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    });
    return app;
}
/** Список зареєстрованих роутів для логів (Express 4) */
function getRegisteredRoutes(app) {
    const routes = [];
    try {
        const router = app._router;
        const stack = router?.stack ?? [];
        function walk(layer, prefix = '') {
            if (!layer)
                return;
            const path = (prefix + (layer.route?.path ?? layer.path ?? '')).replace(/\/\//g, '/') || '/';
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
                methods.forEach((m) => routes.push(`${m.toUpperCase()} ${path}`));
            }
            if (layer.name === 'router' && layer.handle?.stack) {
                layer.handle.stack.forEach((l) => walk(l, path));
            }
        }
        stack.forEach((layer) => walk(layer));
    }
    catch (e) {
        console.warn('[KYIV-MALYN-BACKEND] Could not list routes:', e);
    }
    return [...new Set(routes)].sort();
}
var support_phone_route_1 = require("./support-phone-route");
Object.defineProperty(exports, "getSupportPhoneForRoute", { enumerable: true, get: function () { return support_phone_route_1.getSupportPhoneForRoute; } });
