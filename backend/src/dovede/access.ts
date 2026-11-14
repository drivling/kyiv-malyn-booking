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
import { createHmac } from 'crypto';
import type { Request, RequestHandler } from 'express';
import { isAdminRequest, safeEqual } from '../middleware/require-admin';

export const DOVEDE_TOKEN_HEADER = 'x-dovede-token';
const DOVEDE_TOKEN_SALT = 'dovede-access-v1';

/** Скільки невдалих паролів поспіль приймаємо за вікно, далі 429 (одна лічилка на всіх: за проксі Railway IP однаковий) */
export const DOVEDE_LOGIN_MAX_FAILURES = 20;
export const DOVEDE_LOGIN_WINDOW_MS = 15 * 60_000;

export interface DovedeAccessConfig {
  isPublic: () => boolean;
  /** null — вхід за паролем вимкнено */
  password: () => string | null;
}

/** `ON` (і `1` / `true` / `yes`, без огляду на регістр) — сторінка відкрита всім */
export function isDovedePublic(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DOVEDE_PUBLIC ?? '').trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

export function dovedePassword(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.DOVEDE_PASSWORD ?? '';
  return v.trim() ? v : null;
}

export function dovedeAccessFromEnv(): DovedeAccessConfig {
  return { isPublic: () => isDovedePublic(), password: () => dovedePassword() };
}

/** Значення `X-Dovede-Token` після успішного POST /dovede/login */
export function dovedeAccessToken(password: string): string {
  return createHmac('sha256', password).update(DOVEDE_TOKEN_SALT).digest('hex');
}

export function hasDovedeAccess(req: Request, cfg: DovedeAccessConfig): boolean {
  if (cfg.isPublic() || isAdminRequest(req)) return true;
  const password = cfg.password();
  return password !== null && safeEqual(req.headers[DOVEDE_TOKEN_HEADER], dovedeAccessToken(password));
}

export function requireDovedeAccess(cfg: DovedeAccessConfig): RequestHandler {
  return (req, res, next) => {
    if (hasDovedeAccess(req, cfg)) next();
    else res.status(401).json({ error: 'Unauthorized' });
  };
}

/** Лічилка невдалих паролів: `blocked()` — вікно вичерпано; успішний вхід її не скидає (інакше підбір чергувався б із правильним) */
export function createLoginFailures(now: () => number = Date.now, max = DOVEDE_LOGIN_MAX_FAILURES, windowMs = DOVEDE_LOGIN_WINDOW_MS) {
  let windowStart = 0;
  let failures = 0;
  const roll = () => {
    if (now() - windowStart >= windowMs) {
      windowStart = now();
      failures = 0;
    }
  };
  return {
    blocked(): boolean {
      roll();
      return failures >= max;
    },
    fail(): void {
      roll();
      failures++;
    },
  };
}
