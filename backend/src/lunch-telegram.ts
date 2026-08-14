/** Відправка тексту в групу обідів: черга в БД (listener) або прямий spawn (без listener). */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { isLunchListenerWanted } from './lunch-listener';

export type PostLunchResult = {
  ok: boolean;
  queued: boolean;
  error?: string;
};

export type LunchOutboundKind = 'send' | 'edit';

export type PostLunchOpts = {
  kind?: LunchOutboundKind;
  telegramMessageId?: string | number | bigint | null;
  replyToMessageId?: string | number | bigint | null;
};

function toBigIntOrNull(v: string | number | bigint | null | undefined): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function sessionPathBase(): string {
  const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  if (env) return env.replace(/\.session$/, '');
  return path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}

function spawnPostText(text: string): Promise<boolean> {
  const sessionPath = sessionPathBase();
  const sessionFile = sessionPath + '.session';
  const apiId = process.env.TELEGRAM_API_ID?.trim();
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  if (!apiId || !apiHash || !fs.existsSync(sessionFile)) {
    console.warn('[lunch-telegram] missing session or TELEGRAM_API_*');
    return Promise.resolve(false);
  }

  const telegramUserDir = fs.existsSync(path.join(process.cwd(), 'telegram-user'))
    ? path.join(process.cwd(), 'telegram-user')
    : path.dirname(sessionPath);
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();

  return new Promise((resolve) => {
    const child = spawn(pythonCmd, ['-m', 'lunch.post_text'], {
      cwd: telegramUserDir,
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
        LUNCH_GROUP_ID: groupId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdin?.end(text, 'utf8');
    child.on('close', (code) => {
      if (code !== 0) {
        console.error('[lunch-telegram] post_text failed', code, stderr);
        resolve(false);
        return;
      }
      resolve(true);
    });
    child.on('error', (err) => {
      console.error('[lunch-telegram] spawn error', err);
      resolve(false);
    });
  });
}

/**
 * Якщо listener увімкнений — ставимо в чергу LunchOutboundMessage (listener відправить).
 * Інакше — одноразовий spawn post_text.py.
 */
export async function postTextToLunchGroup(
  prisma: PrismaClient,
  text: string,
  opts: PostLunchOpts = {}
): Promise<PostLunchResult> {
  const kind: LunchOutboundKind = opts.kind || 'send';
  if (isLunchListenerWanted()) {
    await prisma.lunchOutboundMessage.create({
      data: {
        text,
        status: 'pending',
        kind,
        telegramMessageId: toBigIntOrNull(opts.telegramMessageId),
        replyToMessageId: toBigIntOrNull(opts.replyToMessageId),
      },
    });
    return { ok: true, queued: true };
  }
  if (kind === 'edit') {
    return {
      ok: false,
      queued: false,
      error: 'Правка повідомлення в групі потребує увімкненого lunch-listener',
    };
  }
  const ok = await spawnPostText(text);
  return ok
    ? { ok: true, queued: false }
    : { ok: false, queued: false, error: 'Не вдалося надіслати (TELEGRAM_* / сесія)' };
}
