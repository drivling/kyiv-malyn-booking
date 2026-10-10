/**
 * Сесія Telethon зі змінної TELEGRAM_USER_SESSION_BASE64 (як друкує auth_session.py --export) — у файл
 * поруч зі скриптами telegram-user, з правами лише для власника.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeTelegramUserSession, materializeTelegramUserSession } from './telegram-user-session';

const FAKE_SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(64, 7)]);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-session-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('materializeTelegramUserSession', () => {
  it('без змінної — нічого не робить', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(materializeTelegramUserSession(env, dir)).toEqual({ status: 'skipped' });
    expect(env.TELEGRAM_USER_SESSION_PATH).toBeUndefined();
  });

  it('gzip+base64 з переносами рядків — файл у telegram-user/, 0600, шлях без .session', () => {
    const b64 = gzipSync(FAKE_SQLITE).toString('base64');
    const wrapped = b64.replace(/(.{20})/g, '$1\n');
    fs.mkdirSync(path.join(dir, 'telegram-user'));
    fs.writeFileSync(path.join(dir, 'telegram-user', 'session_telegram_user.session-journal'), 'stale');
    const env: NodeJS.ProcessEnv = { TELEGRAM_USER_SESSION_BASE64: wrapped };
    const res = materializeTelegramUserSession(env, dir);
    const base = path.join(dir, 'telegram-user', 'session_telegram_user');
    expect(res).toEqual({ status: 'written', sessionPath: base, bytes: FAKE_SQLITE.length });
    expect(env.TELEGRAM_USER_SESSION_PATH).toBe(base);
    expect(fs.readFileSync(base + '.session').equals(FAKE_SQLITE)).toBe(true);
    expect(fs.statSync(base + '.session').mode & 0o777).toBe(0o600);
    expect(fs.existsSync(base + '.session-journal')).toBe(false);
  });

  it('звичайний base64 без gzip і явний TELEGRAM_USER_SESSION_PATH теж приймаються', () => {
    const custom = path.join(dir, 'custom', 'acc.session');
    const env: NodeJS.ProcessEnv = {
      TELEGRAM_USER_SESSION_BASE64: FAKE_SQLITE.toString('base64'),
      TELEGRAM_USER_SESSION_PATH: custom,
    };
    const res = materializeTelegramUserSession(env, dir);
    expect(res.status).toBe('written');
    expect(env.TELEGRAM_USER_SESSION_PATH).toBe(path.join(dir, 'custom', 'acc'));
    expect(fs.existsSync(custom)).toBe(true);
  });

  it('не сесія (не SQLite) — invalid, файл не пишемо', () => {
    const env: NodeJS.ProcessEnv = { TELEGRAM_USER_SESSION_BASE64: Buffer.from('hello world').toString('base64') };
    const res = materializeTelegramUserSession(env, dir);
    expect(res.status).toBe('invalid');
    expect(env.TELEGRAM_USER_SESSION_PATH).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'telegram-user'))).toBe(false);
    expect(() => decodeTelegramUserSession('')).toThrow(/not a Telethon/);
  });
});
