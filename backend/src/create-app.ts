import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createPoputkyRouter } from './routes/poputky';
import { createPublicRoutesRouter } from './routes/public-routes';
import { createAdminSessionRouter } from './routes/admin-session';
import { createAdminMaintenanceRouter } from './routes/admin-maintenance';
import { createSchedulesBookingsRouter } from './routes/schedules-bookings';
import { createTripPointsRouter } from './routes/trip-points';
import { createTripRoutesRouter } from './routes/trip-routes';
import { createUserProfileRouter } from './routes/user-profile';
import { sendAdminAlertHtml } from './telegram';
import { createViberListingsUserRouter } from './routes/viber-listings-user';
import { createTelegramRoutesRouter } from './routes/telegram-routes';
import { createRideshareRouter } from './routes/rideshare';
import { createViberListingsRouter } from './routes/viber-listings';
import { createAdminPersonsRouter } from './routes/admin-persons';
import { createAdminMessagingRouter } from './routes/admin-messaging';
import { createAdminViberAnalyticsRouter } from './routes/admin-viber-analytics';
import { createAdminReferralsRouter } from './routes/admin-referrals';
import { createAdminLunchRouter } from './routes/admin-lunch';
import { createAdminDzhuraRouter } from './routes/admin-dzhura';
import { createAdminNotificationSettingsRouter } from './routes/admin-notification-settings';
import { createTransportRouter } from './routes/transport';
import { requestTiming } from './middleware/request-timing';
import { materializeTelegramUserSession } from './telegram-user-session';
import { resolveAdminPassword, setAdminPassword } from './middleware/require-admin';

export type CreateAppDeps = {
  prisma: PrismaClient;
  /** Якщо не задано — `process.env.ADMIN_PASSWORD` або dev-fallback */
  adminPassword?: string;
  /**
   * Ключ перевірки підпису Telegram Login на `/user/*` і на решті особистих маршрутів
   * (`DELETE /bookings/:id/by-user`, `PATCH /viber-listings/:id/(deactivate/)by-user`, `POST /rideshare/request`;
   * telegram-login-auth.ts). Якщо не задано — `process.env.TELEGRAM_BOT_TOKEN`; без токена ці маршрути
   * відповідають 503, а не пропускають без перевірки.
   */
  telegramBotToken?: string | null;
};

// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
export const CODE_VERSION = 'viber-v2-2026';

// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));

// Telethon-сесія акаунта власника: зі змінної TELEGRAM_USER_SESSION_BASE64 (Railway) у файл
// telegram-user/session_telegram_user.session. У git файлу немає — див. src/telegram-user-session.ts.
const userSession = materializeTelegramUserSession();
if (userSession.status === 'written') {
  console.log(`[KYIV-MALYN-BACKEND] Telegram user session written from TELEGRAM_USER_SESSION_BASE64 (${userSession.bytes} bytes)`);
} else if (userSession.status === 'invalid') {
  console.error(`[KYIV-MALYN-BACKEND] TELEGRAM_USER_SESSION_BASE64 ignored: ${userSession.error}`);
}
// Локально (без змінної): файл сесії, створений auth_session.py поруч зі скриптами
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
  const defaultSessionPath = path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
  const defaultSessionFile = defaultSessionPath + '.session';
  if (fs.existsSync(defaultSessionFile)) {
    process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
    console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from local file telegram-user/session_telegram_user.session');
  }
}

export function createApp(deps: CreateAppDeps): express.Application {
const prisma = deps.prisma;
const app = express();

// CORS: дозволяємо фронт (malin.kiev.ua, korosten.kiev.ua + Railway preview)
const allowedOrigins = [
  'https://malin.kiev.ua',
  'https://www.malin.kiev.ua',
  'https://korosten.kiev.ua',
  'https://www.korosten.kiev.ua',
  'http://localhost:5173',
  'http://localhost:3000',
];
const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some((o) => origin === o || origin.endsWith('.railway.app'))) {
      cb(null, true);
    } else {
      cb(null, true); // для зручності залишаємо приймати всі; за потреби звужте
    }
  },
  credentials: true,
};
app.use(requestTiming());
// gzip для JSON (каталоги/оголошення стискаються в 5–10×); маленькі відповіді не чіпаємо
app.use(compression({ threshold: 1024 }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use('/poputky', createPoputkyRouter({ prisma }));

const ADMIN_PASSWORD = resolveAdminPassword(deps.adminPassword);
if (!deps.adminPassword && !process.env.ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  console.warn('[KYIV-MALYN-BACKEND] ADMIN_PASSWORD не задано — адмінка відкрита dev-паролем');
}
setAdminPassword(app, ADMIN_PASSWORD);

app.use(createPublicRoutesRouter({ codeVersion: CODE_VERSION }));
app.use(createAdminSessionRouter({ adminPassword: ADMIN_PASSWORD }));
app.use(createAdminMaintenanceRouter({ prisma }));
// Один ключ підпису Telegram Login для всіх особистих маршрутів
const telegramBotToken = deps.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN ?? null;

app.use(createSchedulesBookingsRouter({ prisma, telegramBotToken }));
app.use(createTripPointsRouter({ prisma }));
app.use(createTripRoutesRouter({ prisma }));

app.use(
  createUserProfileRouter({
    prisma,
    telegramBotToken,
    notifyAdmin: sendAdminAlertHtml,
  }),
);
app.use(createViberListingsUserRouter({ prisma, telegramBotToken }));
app.use(createTelegramRoutesRouter({ prisma }));
app.use(createRideshareRouter({ prisma, telegramBotToken }));
app.use(createViberListingsRouter({ prisma }));
app.use(createAdminPersonsRouter({ prisma }));
app.use(createAdminMessagingRouter({ prisma }));
app.use(createAdminViberAnalyticsRouter({ prisma }));
app.use(createAdminReferralsRouter({ prisma }));
app.use(createAdminLunchRouter({ prisma }));
app.use(createAdminDzhuraRouter({ prisma }));
app.use(createAdminNotificationSettingsRouter({ prisma }));
app.use(createTransportRouter({ prisma, adminPassword: ADMIN_PASSWORD }));

// Глобальний обробник помилок — завжди повертаємо JSON
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Помилка сервера' });
});

  return app;
}

/** Список зареєстрованих роутів для логів (Express 4) */
export function getRegisteredRoutes(app: express.Application): string[] {
  const routes: string[] = [];
  try {
    const router = (app as any)._router;
    const stack = router?.stack ?? [];
    // Express 4 не зберігає шлях монтування роутера (`app.use('/poputky', r)`) — лише regexp виду
    // /^\/poputky\/?(?=\/|$)/i; відновлюємо префікс із нього, інакше `/poputky/search` виглядав би як `/search`
    function mountPath(layer: any): string {
      if (layer.route?.path) return layer.route.path;
      if (typeof layer.path === 'string') return layer.path;
      const m = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp?.source ?? '');
      return m ? '/' + m[1].replace(/\\\//g, '/') : '';
    }
    function walk(layer: any, prefix = '') {
      if (!layer) return;
      const path = (prefix + mountPath(layer)).replace(/\/\//g, '/') || '/';
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter((m: string) => layer.route.methods[m]);
        methods.forEach((m: string) => routes.push(`${m.toUpperCase()} ${path}`));
      }
      if (layer.name === 'router' && layer.handle?.stack) {
        layer.handle.stack.forEach((l: any) => walk(l, path));
      }
    }
    stack.forEach((layer: any) => walk(layer));
  } catch (e) {
    console.warn('[KYIV-MALYN-BACKEND] Could not list routes:', e);
  }
  return [...new Set(routes)].sort();
}

export { getSupportPhoneForRoute } from './support-phone-route';
