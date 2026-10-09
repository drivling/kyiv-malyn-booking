import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Application, NextFunction, Request, Response } from 'express';

/**
 * Адмін-токен — HMAC від ADMIN_PASSWORD: без пароля його не вгадати, а зміна пароля відкликає
 * всі видані токени (і в браузері, і в cron / Viber-парсері). Раніше тут була загальновідома
 * константа `admin-authenticated` — тепер вона не приймається.
 * Сіль відрізняється від ключа віджета (`sticker-wall.ts`), тож ключ стіни не відкриває адмінку.
 */
const ADMIN_TOKEN_SALT = 'admin-session-v1';
const DEV_ADMIN_PASSWORD = 'admin123';

/** Явний пароль → `ADMIN_PASSWORD` → dev-fallback (той самий порядок, що й раніше в create-app) */
export function resolveAdminPassword(explicit?: string): string {
  return explicit ?? process.env.ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
}

/** Значення `Authorization` після успішного POST /admin/login */
export function adminAuthToken(adminPassword: string): string {
  return createHmac('sha256', adminPassword).update(ADMIN_TOKEN_SALT).digest('hex');
}

/** Порівняння рядків за сталий час (через SHA-256, щоб довжина теж не протікала) */
export function safeEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Прив'язати пароль до застосунку: requireAdmin бере очікуваний токен з `app.locals` */
export function setAdminPassword(app: Application, adminPassword: string): void {
  app.locals.adminAuthToken = adminAuthToken(adminPassword);
}

function expectedToken(req: Request): string {
  const token: unknown = req.app?.locals?.adminAuthToken;
  return typeof token === 'string' ? token : adminAuthToken(resolveAdminPassword());
}

export function isAdminRequest(req: Request): boolean {
  return safeEqual(req.headers.authorization, expectedToken(req));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdminRequest(req)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
