"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = exports.getRegisteredRoutes = exports.createApp = exports.CODE_VERSION = void 0;
const client_1 = require("@prisma/client");
const create_app_1 = require("./create-app");
const lunch_listener_1 = require("./lunch-listener");
const telegram_session_lease_1 = require("./telegram-session-lease");
const telegram_1 = require("./telegram");
const telegram_dzhura_source_1 = require("./telegram-dzhura-source");
const interval_job_1 = require("./interval-job");
const viber_listing_expiry_1 = require("./viber-listing-expiry");
const viber_listing_archive_1 = require("./viber-listing-archive");
const booking_reminders_1 = require("./booking-reminders");
const listing_match_jobs_1 = require("./listing-match-jobs");
var create_app_2 = require("./create-app");
Object.defineProperty(exports, "CODE_VERSION", { enumerable: true, get: function () { return create_app_2.CODE_VERSION; } });
Object.defineProperty(exports, "createApp", { enumerable: true, get: function () { return create_app_2.createApp; } });
Object.defineProperty(exports, "getRegisteredRoutes", { enumerable: true, get: function () { return create_app_2.getRegisteredRoutes; } });
Object.defineProperty(exports, "getSupportPhoneForRoute", { enumerable: true, get: function () { return create_app_2.getSupportPhoneForRoute; } });
function main() {
    const prisma = new client_1.PrismaClient();
    let worker = null;
    let importScheduler = null;
    let cleanupJob = null;
    let archiveJob = null;
    let reminderJob = null;
    const app = (0, create_app_1.createApp)({ prisma });
    // Одна Telethon-сесія — один процес: новий контейнер чекає, поки старий звільнить оренду
    let lease = null;
    if (process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.DATABASE_URL) {
        lease = new telegram_session_lease_1.TelegramSessionLease((0, telegram_session_lease_1.createPrismaTelegramSessionLeaseStore)(prisma), {
            onLost: lunch_listener_1.interruptLunchListenerForLeaseLoss,
        });
        (0, telegram_session_lease_1.setTelegramSessionLease)(lease);
        lease.start();
    }
    (0, lunch_listener_1.setLunchListenerFatalHandler)((error) => {
        void (0, telegram_1.sendAdminAlertHtml)(`⛔️ <b>Сесію Telegram вашого акаунта відкликано</b> (${error}).\n` +
            'Не працюють: імпорт PoDoroguem, слухач обідів і «Джура», повідомлення від вашого акаунта.\n' +
            'Створіть нову: <code>python3 auth_session.py --fresh --qr --export</code> у backend/telegram-user, ' +
            'вставте результат у Railway → TELEGRAM_USER_SESSION_BASE64.');
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        const routes = (0, create_app_1.getRegisteredRoutes)(app);
        const hasViber = routes.some((r) => r.includes('viber-listings'));
        console.log('========================================');
        console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${create_app_1.CODE_VERSION}`);
        console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
        console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
        console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
        console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
        if (!hasViber)
            console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
        console.log('========================================');
        console.log(`API on http://localhost:${PORT} [${create_app_1.CODE_VERSION}]`);
        (0, lunch_listener_1.startLunchListener)();
        // Фонові сповіщення про перетини (NotificationJob) — один воркер на процес
        if (process.env.NOTIFICATION_WORKER_DISABLED !== '1') {
            worker = (0, listing_match_jobs_1.startListingMatchWorker)(prisma);
        }
        // Імпорт груп попуток з Джури замість зовнішнього cron-job.org (TELEGRAM_IMPORT_INTERVAL_MIN, 0 = вимкнено)
        if (process.env.DATABASE_URL) {
            importScheduler = (0, telegram_dzhura_source_1.startTelegramImportScheduler)(telegram_1.fetchAndImportTelegramGroupMessages);
            // Деактивація протермінованих оголошень замість cron-job.org (VIBER_CLEANUP_INTERVAL_MIN, 0 = вимкнено).
            // Сайт і так фільтрує за endsAt при читанні — таймер потрібен матчингу, сповіщенням і адмінці.
            cleanupJob = (0, interval_job_1.startIntervalJob)('viber-cleanup', async () => {
                const r = await (0, viber_listing_expiry_1.deactivateExpiredListings)(prisma);
                if (r.deactivated || r.expiredRequests) {
                    console.log(`🧹 Деактивовано ${r.deactivated} оголошень, протерміновано запитів: ${r.expiredRequests}`);
                }
            }, { intervalMin: Number(process.env.VIBER_CLEANUP_INTERVAL_MIN ?? 5), firstDelayMs: 30000 });
            // Архів старих оголошень (аналітика + видалення неактивних > 90 дн.) замість щомісячного cron-job.org;
            // ідемпотентний, тому щодоби (VIBER_ARCHIVE_INTERVAL_MIN, 0 = вимкнено)
            archiveJob = (0, interval_job_1.startIntervalJob)('viber-archive', async () => {
                const r = await (0, viber_listing_archive_1.archiveOldListings)(prisma);
                if (r.importedNow || r.deleted) {
                    console.log(`🗄️ Архів: в аналітику ${r.importedNow}, видалено неактивних > ${r.days} дн.: ${r.deleted}`);
                }
            }, { intervalMin: Number(process.env.VIBER_ARCHIVE_INTERVAL_MIN ?? 1440), firstDelayMs: 10 * 60000 });
            // Нагадування про поїздки (вечір 20:00, ранок 08:00, одне «перед поїздкою») замість cron-job.org;
            // BOOKING_REMINDERS_INTERVAL_MIN (за замовч. 1, 0 = вимкнено)
            reminderJob = (0, interval_job_1.startIntervalJob)('booking-reminders', async () => {
                const c = await (0, booking_reminders_1.runDueBookingReminders)(prisma, booking_reminders_1.defaultReminderDeps);
                if (c.total) {
                    console.log(`🔔 Нагадування: бот ${c.sent}, SMS ${c.smsSent}, помилок ${c.failed}, без каналу ${c.skipped}, дублів ${c.duplicate}`);
                }
            }, { intervalMin: Number(process.env.BOOKING_REMINDERS_INTERVAL_MIN ?? 1), firstDelayMs: 45000 });
        }
    });
    const shutdown = async (signal) => {
        console.log(`[KYIV-MALYN-BACKEND] ${signal} — stopping lunch listener and notification worker`);
        worker?.stop();
        importScheduler?.stop();
        cleanupJob?.stop();
        archiveJob?.stop();
        reminderJob?.stop();
        // Спершу Telethon має зникнути, лише потім звільняємо оренду для нового контейнера
        await (0, lunch_listener_1.stopLunchListenerAndWait)(3000);
        await lease?.stop();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
if (require.main === module) {
    main();
}
