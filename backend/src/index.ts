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
import { sendAdminAlertHtml } from './telegram';
import { startListingMatchWorker } from './listing-match-jobs';

export { CODE_VERSION, createApp, getRegisteredRoutes, getSupportPhoneForRoute } from './create-app';

function main(): void {
  const prisma = new PrismaClient();
  let worker: ReturnType<typeof startListingMatchWorker> | null = null;
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
  });

  const shutdown = async (signal: string) => {
    console.log(`[KYIV-MALYN-BACKEND] ${signal} — stopping lunch listener and notification worker`);
    worker?.stop();
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
