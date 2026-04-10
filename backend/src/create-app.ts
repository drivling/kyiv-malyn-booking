import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createPoputkyRouter } from './routes/poputky';
import { createPublicRoutesRouter } from './routes/public-routes';
import { createAdminSessionRouter } from './routes/admin-session';
import { createAdminMaintenanceRouter } from './routes/admin-maintenance';
import { createSchedulesBookingsRouter } from './routes/schedules-bookings';
import { createUserProfileRouter } from './routes/user-profile';
import { createViberListingsUserRouter } from './routes/viber-listings-user';
import { createTelegramRoutesRouter } from './routes/telegram-routes';
import { createRideshareRouter } from './routes/rideshare';
import { createViberListingsRouter } from './routes/viber-listings';
import { createAdminPersonsRouter } from './routes/admin-persons';
import { createAdminMessagingRouter } from './routes/admin-messaging';
import { createAdminViberAnalyticsRouter } from './routes/admin-viber-analytics';

export type CreateAppDeps = {
  prisma: PrismaClient;
  /** Якщо не задано — `process.env.ADMIN_PASSWORD` або dev-fallback */
  adminPassword?: string;
};

// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
export const CODE_VERSION = 'viber-v2-2026';

// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));

// Сесія для одноразового промо: якщо TELEGRAM_USER_SESSION_PATH не задано — шукаємо файл у репо (telegram-user/session_telegram_user.session)
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
  const defaultSessionPath = path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
  const defaultSessionFile = defaultSessionPath + '.session';
  if (fs.existsSync(defaultSessionFile)) {
    process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
    console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session');
  }
}

export function createApp(deps: CreateAppDeps): express.Application {
const prisma = deps.prisma;
const app = express();

// CORS: дозволяємо фронт (malin.kiev.ua + Railway preview)
const allowedOrigins = [
  'https://malin.kiev.ua',
  'https://www.malin.kiev.ua',
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
app.use(cors(corsOptions));
app.use(express.json());
app.use('/poputky', createPoputkyRouter());

const ADMIN_PASSWORD = deps.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin123';

app.use(createPublicRoutesRouter({ codeVersion: CODE_VERSION }));
app.use(createAdminSessionRouter({ adminPassword: ADMIN_PASSWORD }));
app.use(createAdminMaintenanceRouter({ prisma }));
app.use(createSchedulesBookingsRouter({ prisma }));

app.use(createUserProfileRouter({ prisma }));
app.use(createViberListingsUserRouter({ prisma }));
app.use(createTelegramRoutesRouter({ prisma }));
app.use(createRideshareRouter({ prisma }));
app.use(createViberListingsRouter({ prisma }));
app.use(createAdminPersonsRouter({ prisma }));
app.use(createAdminMessagingRouter({ prisma }));
app.use(createAdminViberAnalyticsRouter({ prisma }));

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
    function walk(layer: any, prefix = '') {
      if (!layer) return;
      const path = (prefix + (layer.route?.path ?? layer.path ?? '')).replace(/\/\//g, '/') || '/';
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
