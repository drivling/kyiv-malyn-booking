import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';

/**
 * Telethon-сесія акаунта власника приходить зі змінної Railway `TELEGRAM_USER_SESSION_BASE64`
 * (base64 від gzip файлу `.session`, як друкує `python3 auth_session.py --export`) і пишеться у
 * файл під час старту. У git файл сесії не зберігаємо: хто має доступ до репозиторію, той мав би
 * повний доступ до Telegram власника.
 *
 * Файл лягає туди ж, де й раніше лежав файл з репо (`telegram-user/session_telegram_user.session`),
 * бо Node шукає Python-скрипти поруч із сесією (`path.dirname(TELEGRAM_USER_SESSION_PATH)`).
 */

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export type MaterializeResult =
  | { status: 'skipped' }
  | { status: 'written'; sessionPath: string; bytes: number }
  | { status: 'invalid'; error: string };

export function decodeTelegramUserSession(value: string): Buffer {
  let buf = Buffer.from(value.replace(/\s+/g, ''), 'base64');
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  if (buf.length < SQLITE_HEADER.length || !buf.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new Error('not a Telethon .session file (expected SQLite, optionally gzipped, in base64)');
  }
  return buf;
}

/** Записати сесію зі змінної у файл і виставити `TELEGRAM_USER_SESSION_PATH` (без `.session`) */
export function materializeTelegramUserSession(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): MaterializeResult {
  const value = env.TELEGRAM_USER_SESSION_BASE64?.trim();
  if (!value) return { status: 'skipped' };
  let buf: Buffer;
  try {
    buf = decodeTelegramUserSession(value);
  } catch (e) {
    return { status: 'invalid', error: (e as Error).message };
  }
  const base =
    env.TELEGRAM_USER_SESSION_PATH?.trim().replace(/\.session$/, '') ||
    path.join(cwd, 'telegram-user', 'session_telegram_user');
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(base + '.session', buf, { mode: 0o600 });
  // журнал SQLite від попередньої копії файлу зіпсував би нову
  fs.rmSync(base + '.session-journal', { force: true });
  env.TELEGRAM_USER_SESSION_PATH = base;
  return { status: 'written', sessionPath: base, bytes: buf.length };
}
