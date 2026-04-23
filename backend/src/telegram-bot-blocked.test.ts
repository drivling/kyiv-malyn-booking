import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramBotBlockedByUserError } from './telegram-bot-blocked';

test('isTelegramBotBlockedByUserError: bot blocked phrasing', () => {
  assert.equal(isTelegramBotBlockedByUserError(new Error('403 Forbidden: bot was blocked by the user')), true);
});

test('isTelegramBotBlockedByUserError: deactivated user', () => {
  assert.equal(isTelegramBotBlockedByUserError(new Error('403 Forbidden: user is deactivated')), true);
});

test('isTelegramBotBlockedByUserError: unrelated 403', () => {
  assert.equal(isTelegramBotBlockedByUserError(new Error('403 Forbidden: some other reason')), false);
});
