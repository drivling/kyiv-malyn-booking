/**
 * Підпис Telegram Login Widget (telegram-login-auth.ts): HMAC за документацією, строк дії, заголовок.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  TELEGRAM_LOGIN_MAX_AGE_SEC,
  decodeTelegramLoginHeader,
  encodeTelegramLoginHeader,
  signTelegramLogin,
  telegramLoginCheckString,
  verifyTelegramLogin,
} from './telegram-login-auth';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const NOW = 1_760_000_000;

function signed(overrides: Record<string, unknown> = {}) {
  const base = { id: 123456789, first_name: 'Іван', username: 'ivan_m', auth_date: NOW - 60, ...overrides };
  return { ...base, hash: signTelegramLogin(base, BOT_TOKEN) };
}

test('рядок перевірки: лише підписані поля, відсортовані, без hash і phone', () => {
  const s = telegramLoginCheckString({ username: 'u', id: 1, hash: 'x', phone: '380', auth_date: 5, first_name: 'A', last_name: '' });
  assert.equal(s, 'auth_date=5\nfirst_name=A\nid=1\nusername=u');
});

test('підпис збігається з прикладом алгоритму документації (sha256(token) → HMAC-SHA256)', () => {
  const { createHash, createHmac } = require('crypto') as typeof import('crypto');
  const payload = { id: 1, first_name: 'A', auth_date: 5 };
  const expected = createHmac('sha256', createHash('sha256').update(BOT_TOKEN).digest())
    .update('auth_date=5\nfirst_name=A\nid=1')
    .digest('hex');
  assert.equal(signTelegramLogin(payload, BOT_TOKEN), expected);
});

test('коректний підпис → ok з id рядком', () => {
  const r = verifyTelegramLogin(signed(), BOT_TOKEN, NOW);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.user.id, '123456789');
    assert.equal(r.user.firstName, 'Іван');
    assert.equal(r.user.username, 'ivan_m');
    assert.equal(r.user.authDate, NOW - 60);
  }
});

test('наш phone у payload не ламає підпис (не входить у рядок перевірки)', () => {
  const r = verifyTelegramLogin({ ...signed(), phone: '380671234567' }, BOT_TOKEN, NOW);
  assert.ok(r.ok);
});

test('підмінений id → invalid; інший токен бота → invalid', () => {
  const p = signed();
  assert.deepEqual(verifyTelegramLogin({ ...p, id: 987 }, BOT_TOKEN, NOW), { ok: false, reason: 'invalid' });
  assert.deepEqual(verifyTelegramLogin(p, 'other-token', NOW), { ok: false, reason: 'invalid' });
});

test('auth_date старший за добу → expired; з майбутнього > 5 хв → expired', () => {
  const old = signed({ auth_date: NOW - TELEGRAM_LOGIN_MAX_AGE_SEC - 1 });
  assert.deepEqual(verifyTelegramLogin(old, BOT_TOKEN, NOW), { ok: false, reason: 'expired' });
  const edge = signed({ auth_date: NOW - TELEGRAM_LOGIN_MAX_AGE_SEC });
  assert.ok(verifyTelegramLogin(edge, BOT_TOKEN, NOW).ok);
  const future = signed({ auth_date: NOW + 600 });
  assert.deepEqual(verifyTelegramLogin(future, BOT_TOKEN, NOW), { ok: false, reason: 'expired' });
});

test('без hash, id 0 (вхід за телефоном без Telegram), сміття → malformed', () => {
  assert.deepEqual(verifyTelegramLogin({ id: 0, first_name: 'User', auth_date: NOW, hash: '' }, BOT_TOKEN, NOW), { ok: false, reason: 'malformed' });
  assert.deepEqual(verifyTelegramLogin(null, BOT_TOKEN, NOW), { ok: false, reason: 'malformed' });
  assert.deepEqual(verifyTelegramLogin('x', BOT_TOKEN, NOW), { ok: false, reason: 'malformed' });
  assert.deepEqual(verifyTelegramLogin({ ...signed(), hash: 'zz' }, BOT_TOKEN, NOW), { ok: false, reason: 'malformed' });
});

test('заголовок: base64url JSON туди й назад; сміття → null', () => {
  const p = signed();
  const h = encodeTelegramLoginHeader(p);
  assert.doesNotMatch(h, /[+/=]/);
  assert.deepEqual(decodeTelegramLoginHeader(h), p);
  assert.equal(decodeTelegramLoginHeader('%%%'), null);
  assert.equal(decodeTelegramLoginHeader(undefined), null);
});
