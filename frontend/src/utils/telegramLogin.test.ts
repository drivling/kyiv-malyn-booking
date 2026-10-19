import { describe, expect, it } from 'vitest';
import { encodeTelegramLogin, hasSignedTelegramLogin, isTelegramLoginRejected, telegramLoginHeaders } from './telegramLogin';
import type { TelegramUser } from '@/types';

const USER: TelegramUser = { id: 123456789, first_name: 'Іван', username: 'ivan_m', auth_date: 1760000000, hash: 'ab'.repeat(32) };

describe('telegramLogin', () => {
  it('encodes the widget answer as base64url JSON that the backend decodes back (UTF-8 names)', () => {
    const encoded = encodeTelegramLogin(USER);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    expect(decoded).toEqual(USER);
  });

  it('sends the header only for a real widget login, not for the phone-only pseudo user', () => {
    expect(telegramLoginHeaders(USER)).toEqual({ 'X-Telegram-Login': encodeTelegramLogin(USER) });
    expect(telegramLoginHeaders({ id: 0, first_name: 'User', auth_date: Date.now(), hash: '', phone: '0671234567' })).toEqual({});
    expect(telegramLoginHeaders(null)).toEqual({});
    expect(hasSignedTelegramLogin(USER)).toBe(true);
  });

  it('recognises a 401 from /user/*', () => {
    expect(isTelegramLoginRejected(Object.assign(new Error('x'), { status: 401 }))).toBe(true);
    expect(isTelegramLoginRejected(Object.assign(new Error('x'), { status: 500 }))).toBe(false);
    expect(isTelegramLoginRejected(null)).toBe(false);
  });
});
