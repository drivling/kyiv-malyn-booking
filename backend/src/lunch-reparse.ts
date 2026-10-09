/** Запуск / черга повторного розбору дня обідів. */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { isLunchListenerWanted } from './lunch-listener';

/** Що сталося з одним повідомленням під час розбору (для діагностики «чому проігноровано»). */
export type LunchReparseDetail = {
  messageId: number | null;
  name: string;
  text: string;
  /** order | payment | card | summary | skipped */
  outcome: string;
  reason: string;
};

export type LunchReparseResult = {
  ok: boolean;
  queued?: boolean;
  scanned?: number;
  orders?: number;
  payments?: number;
  cards?: number;
  summaries?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
  details?: LunchReparseDetail[];
  /** лише reparse_person */
  person?: { tgUserId: string; name: string };
  source?: 'telegram' | 'dzhura' | 'none';
  messages?: number;
  warnings?: string[];
  replaced?: boolean;
  placeholder?: boolean;
  notified?: boolean;
};

export type LunchJobType = 'reparse_today' | 'reparse_person';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sessionPathBase(): string {
  const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  if (env) return env.replace(/\.session$/, '');
  return path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}

function spawnReparse(extraArgs: string[] = []): Promise<LunchReparseResult> {
  const sessionPath = sessionPathBase();
  const sessionFile = sessionPath + '.session';
  const apiId = process.env.TELEGRAM_API_ID?.trim();
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  if (!apiId || !apiHash || !fs.existsSync(sessionFile)) {
    return Promise.resolve({ ok: false, error: 'Немає TELEGRAM_* / файлу сесії' });
  }
  const telegramUserDir = path.join(process.cwd(), 'telegram-user');
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();

  return new Promise((resolve) => {
    const child = spawn(pythonCmd, ['-m', 'lunch.reparse', ...extraArgs], {
      cwd: telegramUserDir,
      env: {
        ...process.env,
        TELEGRAM_USER_SESSION_PATH: sessionPath,
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
        LUNCH_GROUP_ID: groupId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('close', (code) => {
      try {
        const line = stdout.trim().split(/\n/).filter(Boolean).pop() || '';
        const parsed = JSON.parse(line) as LunchReparseResult & Record<string, unknown>;
        if (parsed.ok === false) {
          resolve({ ok: false, error: String(parsed.error || 'reparse failed') });
        } else {
          resolve({ ...(parsed as LunchReparseResult), ok: true });
        }
      } catch {
        resolve({
          ok: false,
          error: stderr.trim() || stdout.trim() || `reparse exit ${code}`,
        });
      }
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

/**
 * Якщо listener працює — ставимо LunchAdminJob і чекаємо результат.
 * Інакше — spawn lunch.reparse (окрема сесія Telethon).
 */
async function runLunchJob(
  prisma: PrismaClient,
  type: LunchJobType,
  params: Record<string, unknown> | null,
  spawnArgs: string[],
  timeoutMs: number
): Promise<LunchReparseResult> {
  if (!isLunchListenerWanted()) {
    return spawnReparse(spawnArgs);
  }

  const job = await prisma.lunchAdminJob.create({
    data: { type, status: 'pending', paramsJson: params ? JSON.stringify(params) : null },
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(800);
    const row = await prisma.lunchAdminJob.findUnique({ where: { id: job.id } });
    if (!row) {
      return { ok: false, error: 'Job зник' };
    }
    if (row.status === 'done') {
      let stats: Record<string, unknown> = {};
      try {
        stats = row.resultJson ? JSON.parse(row.resultJson) : {};
      } catch {
        /* ignore */
      }
      return { ok: true, queued: false, ...(stats as object) } as LunchReparseResult;
    }
    if (row.status === 'failed') {
      return { ok: false, error: row.errorText || 'Reparse failed' };
    }
  }

  return {
    ok: false,
    error:
      'Таймаут очікування listener. Перевір логи [lunch-listener] / чи запущений python -m lunch.listener',
  };
}

export async function reparseLunchToday(
  prisma: PrismaClient,
  opts?: { timeoutMs?: number }
): Promise<LunchReparseResult> {
  return runLunchJob(prisma, 'reparse_today', null, [], opts?.timeoutMs ?? 90_000);
}

/** Розібрати повідомлення однієї людини за сьогодні; чужі замовлення й ручні правки не чіпає. */
export async function reparseLunchPerson(
  prisma: PrismaClient,
  opts: { tgUserId: string; notify?: boolean; timeoutMs?: number }
): Promise<LunchReparseResult> {
  const notify = opts.notify !== false;
  return runLunchJob(
    prisma,
    'reparse_person',
    { tgUserId: opts.tgUserId, notify },
    ['--user-id', opts.tgUserId, ...(notify ? [] : ['--no-notify'])],
    opts.timeoutMs ?? 90_000
  );
}
