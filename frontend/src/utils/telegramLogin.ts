/**
 * Підписані дані Telegram Login Widget для `/user/*` (Docs/transport-open-data-2026-10.md, фаза 4):
 * бекенд більше не вірить голому `telegramUserId` — відповідь віджета (id, first_name, …, auth_date, hash)
 * іде цілком у заголовку `X-Telegram-Login` як base64url(JSON), і бекенд перевіряє HMAC
 * (backend/src/telegram-login-auth.ts). Підпис живе добу — далі бекенд відповідає 401 `expired`,
 * і сторінка просить увійти ще раз.
 */
import type { TelegramUser } from '@/types';
import { userState } from './userState';

export const TELEGRAM_LOGIN_HEADER = 'X-Telegram-Login';

/** base64url без доповнення, UTF-8-безпечно (ім'я кирилицею) */
export function encodeTelegramLogin(user: TelegramUser): string {
  const json = JSON.stringify(user);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Чи є в сесії справжній підпис віджета (вхід «за телефоном» дає id 0 і порожній hash — його не шлемо) */
export function hasSignedTelegramLogin(user: TelegramUser | null | undefined): user is TelegramUser {
  return !!user && typeof user.id === 'number' && user.id > 0 && typeof user.hash === 'string' && user.hash.length > 0;
}

/** Заголовки для запитів `/user/*`; порожній об'єкт, коли підпису нема (бекенд відповість 401) */
export function telegramLoginHeaders(user: TelegramUser | null = userState.getTelegramUser()): Record<string, string> {
  return hasSignedTelegramLogin(user) ? { [TELEGRAM_LOGIN_HEADER]: encodeTelegramLogin(user) } : {};
}

/** 401 від `/user/*` з причиною — сесію треба оновити входом через Telegram */
export function isTelegramLoginRejected(error: unknown): boolean {
  const e = error as { status?: number } | null;
  return !!e && e.status === 401;
}
