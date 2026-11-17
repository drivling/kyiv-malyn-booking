import { cityRoutesFromEnv } from './dovede/city-route';
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
import { ensureInitialTransportRevision } from './transport-revisions';
import { deactivateExpiredListings } from './viber-listing-expiry';
import { archiveOldListings } from './viber-listing-archive';
import { defaultReminderDeps, runDueBookingReminders } from './booking-reminders';
import { startListingMatchWorker } from './listing-match-jobs';
import { WATCHED_SOURCES, fetchSourceText, runSourceWatch } from './transport-source-watch';
import { fetchGpsFeedText, recordGpsPositions } from './transport-gps';

export { CODE_VERSION, createApp, getRegisteredRoutes, getSupportPhoneForRoute } from './create-app';

function main(): void {
  const prisma = new PrismaClient();
  let worker: ReturnType<typeof startListingMatchWorker> | null = null;
  let importScheduler: TelegramImportScheduler | null = null;
  let cleanupJob: IntervalJob | null = null;
  let archiveJob: IntervalJob | null = null;
  let reminderJob: IntervalJob | null = null;
  let sourceWatchJob: IntervalJob | null = null;
  let gpsJob: IntervalJob | null = null;
  let cityLearnJob: IntervalJob | null = null;
  const app = createApp({ prisma });
  // Журнал ревізій транспорту: порожній журнал при наявному датасеті → перший рядок із поточного стану (без diff)
  void ensureInitialTransportRevision(prisma).then((row) => {
    if (row) console.log(`[transport-revisions] initial row ${row.revision}`);
  });

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
      // Архів старих оголошень (аналітика + видалення неактивних > 90 дн.) замість щомісячного cron-job.org;
      // ідемпотентний, тому щодоби (VIBER_ARCHIVE_INTERVAL_MIN, 0 = вимкнено)
      archiveJob = startIntervalJob(
        'viber-archive',
        async () => {
          const r = await archiveOldListings(prisma);
          if (r.importedNow || r.deleted) {
            console.log(`🗄️ Архів: в аналітику ${r.importedNow}, видалено неактивних > ${r.days} дн.: ${r.deleted}`);
          }
        },
        { intervalMin: Number(process.env.VIBER_ARCHIVE_INTERVAL_MIN ?? 1440), firstDelayMs: 10 * 60_000 },
      );
      // Нагадування про поїздки (вечір 20:00, ранок 08:00, одне «перед поїздкою») замість cron-job.org;
      // BOOKING_REMINDERS_INTERVAL_MIN (за замовч. 1, 0 = вимкнено)
      reminderJob = startIntervalJob(
        'booking-reminders',
        async () => {
          const c = await runDueBookingReminders(prisma, defaultReminderDeps);
          if (c.total) {
            console.log(`🔔 Нагадування: бот ${c.sent}, SMS ${c.smsSent}, помилок ${c.failed}, без каналу ${c.skipped}, дублів ${c.duplicate}`);
          }
        },
        { intervalMin: Number(process.env.BOOKING_REMINDERS_INTERVAL_MIN ?? 1), firstDelayMs: 45_000 },
      );
      // Стеження за джерелами розкладу (сторінка ради Коростеня, data.gov.ua): зміна → повідомлення в адмін-чат;
      // TRANSPORT_SOURCE_WATCH_INTERVAL_MIN (за замовч. 360, 0 = вимкнено)
      sourceWatchJob = startIntervalJob(
        'transport-source-watch',
        async () => {
          const results = await runSourceWatch(prisma, {
            fetchText: fetchSourceText,
            notify: sendAdminAlertHtml,
            now: () => new Date(),
            sources: WATCHED_SOURCES,
          });
          const notable = results.filter((r) => r.status !== 'unchanged');
          if (notable.length) {
            console.log(`🛰️ Джерела розкладу: ${notable.map((r) => `${r.key}=${r.status}`).join(', ')}`);
          }
        },
        { intervalMin: Number(process.env.TRANSPORT_SOURCE_WATCH_INTERVAL_MIN ?? 360), firstDelayMs: 5 * 60_000 },
      );
      // GPS-треки міського транспорту з публічного фіду (Коростень) — для звірки шляхів і зупинок;
      // TRANSPORT_GPS_INTERVAL_MIN (за замовч. 1, 0 = вимкнено), точки старші за TRANSPORT_GPS_RETENTION_DAYS (30) — геть
      gpsJob = startIntervalJob(
        'transport-gps',
        async () => {
          const results = await recordGpsPositions(prisma, {
            fetchText: fetchGpsFeedText,
            now: () => new Date(),
            retentionDays: Number(process.env.TRANSPORT_GPS_RETENTION_DAYS ?? 30),
          });
          for (const r of results) if (r.error) console.log(`🛰️ GPS ${r.cityCode}: ${r.error}`);
        },
        { intervalMin: Number(process.env.TRANSPORT_GPS_INTERVAL_MIN ?? 1), firstDelayMs: 90_000 },
      );
      // «Доведе»: поступове навчання дороги містом (Київ, Житомир) — найзапитуваніші пари без свіжої відповіді,
      // у межах половини денного ліміту Google; DOVEDE_CITY_LEARN_INTERVAL_MIN (за замовч. 60, 0 = вимкнено)
      const cityRoutes = cityRoutesFromEnv(prisma);
      cityLearnJob = startIntervalJob(
        'dovede-city-learn',
        async () => {
          const r = await cityRoutes.learnTick();
          if (r.asked) console.log(`🧭 Доведе · місто: спитано ${r.asked}, вивчено ${r.learned}`);
        },
        { intervalMin: Number(process.env.DOVEDE_CITY_LEARN_INTERVAL_MIN ?? 60), firstDelayMs: 15 * 60_000 },
      );
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[KYIV-MALYN-BACKEND] ${signal} — stopping lunch listener and notification worker`);
    worker?.stop();
    importScheduler?.stop();
    cleanupJob?.stop();
    archiveJob?.stop();
    reminderJob?.stop();
    sourceWatchJob?.stop();
    gpsJob?.stop();
    cityLearnJob?.stop();
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
