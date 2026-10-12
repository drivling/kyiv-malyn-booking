import { PrismaClient } from '@prisma/client';
import { CODE_VERSION, createApp, getRegisteredRoutes } from './create-app';
import {
  interruptLunchListenerForLeaseLoss,
  setLunchListenerFatalHandler,
  startLunchListener,
  stopLunchListenerAndWait,
} from './lunch-listener';
import {
  TelegramSessionLease,
  createPrismaTelegramSessionLeaseStore,
  setTelegramSessionLease,
} from './telegram-session-lease';
import { fetchAndImportTelegramGroupMessages, sendAdminAlertHtml } from './telegram';
import { startTelegramImportScheduler, type TelegramImportScheduler } from './telegram-dzhura-source';
import { startIntervalJob, type IntervalJob } from './interval-job';
import { deactivateExpiredListings } from './viber-listing-expiry';
import { startListingMatchWorker } from './listing-match-jobs';

export { CODE_VERSION, createApp, getRegisteredRoutes, getSupportPhoneForRoute } from './create-app';

function main(): void {
  const prisma = new PrismaClient();
  let worker: ReturnType<typeof startListingMatchWorker> | null = null;
  let importScheduler: TelegramImportScheduler | null = null;
  let cleanupJob: IntervalJob | null = null;
  const app = createApp({ prisma });

  // Одна Telethon-сесія — один процес: новий контейнер чекає, поки старий звільнить оренду
  let lease: TelegramSessionLease | null = null;
  if (process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.DATABASE_URL) {
    lease = new TelegramSessionLease(createPrismaTelegramSessionLeaseStore(prisma), {
      onLost: interruptLunchListenerForLeaseLoss,
    });
    setTelegramSessionLease(lease);
    lease.start();
  }
  setLunchListenerFatalHandler((error) => {
    void sendAdminAlertHtml(
      `⛔️ <b>Сесію Telegram вашого акаунта відкликано</b> (${error}).\n` +
        'Не працюють: імпорт PoDoroguem, слухач обідів і «Джура», повідомлення від вашого акаунта.\n' +
        'Створіть нову: <code>python3 auth_session.py --fresh --qr --export</code> у backend/telegram-user, ' +
        'вставте результат у Railway → TELEGRAM_USER_SESSION_BASE64.'
    );
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    const routes = getRegisteredRoutes(app);
    const hasViber = routes.some((r) => r.includes('viber-listings'));
    console.log('========================================');
    console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${CODE_VERSION}`);
    console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
    console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
    console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
    console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
    if (!hasViber) console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
    console.log('========================================');
    console.log(`API on http://localhost:${PORT} [${CODE_VERSION}]`);
    startLunchListener();
    // Фонові сповіщення про перетини (NotificationJob) — один воркер на процес
    if (process.env.NOTIFICATION_WORKER_DISABLED !== '1') {
      worker = startListingMatchWorker(prisma);
    }
    // Імпорт груп попуток з Джури замість зовнішнього cron-job.org (TELEGRAM_IMPORT_INTERVAL_MIN, 0 = вимкнено)
    if (process.env.DATABASE_URL) {
      importScheduler = startTelegramImportScheduler(fetchAndImportTelegramGroupMessages);
      // Деактивація протермінованих оголошень замість cron-job.org (VIBER_CLEANUP_INTERVAL_MIN, 0 = вимкнено).
      // Сайт і так фільтрує за endsAt при читанні — таймер потрібен матчингу, сповіщенням і адмінці.
      cleanupJob = startIntervalJob(
        'viber-cleanup',
        async () => {
          const r = await deactivateExpiredListings(prisma);
          if (r.deactivated || r.expiredRequests) {
            console.log(`🧹 Деактивовано ${r.deactivated} оголошень, протерміновано запитів: ${r.expiredRequests}`);
          }
        },
        { intervalMin: Number(process.env.VIBER_CLEANUP_INTERVAL_MIN ?? 5), firstDelayMs: 30_000 },
      );
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[KYIV-MALYN-BACKEND] ${signal} — stopping lunch listener and notification worker`);
    worker?.stop();
    importScheduler?.stop();
    cleanupJob?.stop();
    // Спершу Telethon має зникнути, лише потім звільняємо оренду для нового контейнера
    await stopLunchListenerAndWait(3000);
    await lease?.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main();
}
