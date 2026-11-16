/** Запуск / черга повторного розбору дня обідів. */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TELEGRAM_SESSION_BUSY_ERROR, awaitTelegramSession } from './telegram-session-lease';
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
  /** підтвердження — правка нашої попередньої відповіді в групі, а не нова */
  notifiedEdit?: boolean;
};

export type LunchJobType = 'reparse_today' | 'reparse_person';

// ---------- порівняння моделей розпізнавання (задача ocr_compare) ----------

/** Моделі, які можна порівнювати: від дорогої (еталон) до дешевої — як COMPARE_MODELS у lunch/ocr_menu.py */
export const LUNCH_OCR_COMPARE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

export class LunchJobError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type LunchOcrCompareJob = {
  id: number;
  /** pending — чекає слухача | running — моделі працюють | done | failed */
  status: string;
  params: Record<string, unknown> | null;
  /** звіт слухача (evidence.compare_day): media[], summary[], baseline */
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function serializeOcrCompareJob(row: {
  id: number;
  status: string;
  paramsJson: string | null;
  resultJson: string | null;
  errorText: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): LunchOcrCompareJob {
  return {
    id: row.id,
    status: row.status,
    params: parseJson(row.paramsJson),
    result: row.status === 'done' ? parseJson(row.resultJson) : null,
    error: row.status === 'failed' ? row.errorText || 'Помилка слухача' : null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/** Розбір тіла запиту: date — день (за Києвом, не майбутній), models — підмножина дозволених, щонайменше дві. */
export function parseOcrCompareRequest(body: unknown, todayIso: string): { date: string; models: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const date = b.date === undefined || b.date === null || b.date === '' ? todayIso : String(b.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new LunchJobError(400, 'date — дата у форматі YYYY-MM-DD');
  }
  if (date > todayIso) throw new LunchJobError(400, 'Дата в майбутньому');
  let models: string[] = [...LUNCH_OCR_COMPARE_MODELS];
  if (b.models !== undefined) {
    if (!Array.isArray(b.models) || b.models.some((m) => typeof m !== 'string')) {
      throw new LunchJobError(400, 'models — список назв моделей');
    }
    const allowed = new Set<string>(LUNCH_OCR_COMPARE_MODELS);
    const unknown = (b.models as string[]).filter((m) => !allowed.has(m));
    if (unknown.length) throw new LunchJobError(400, `Невідома модель: ${unknown.join(', ')}`);
    // порядок — як у дозволеному списку: перша (найдорожча) стає еталоном
    models = LUNCH_OCR_COMPARE_MODELS.filter((m) => (b.models as string[]).includes(m));
    if (models.length < 2) throw new LunchJobError(400, 'Для порівняння потрібні щонайменше дві моделі');
  }
  return { date, models };
}

/**
 * Поставити слухачеві задачу: ті самі фото й PDF дня через кілька моделей. Нічого не змінює в обідах.
 * Працює лише через слухача (потрібні Telegram-сесія і ключ Claude); результат — getOcrCompareJob.
 */
export async function createOcrCompareJob(
  prisma: PrismaClient,
  req: { date: string; models: string[] },
  opts: { listenerWanted?: () => boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<LunchOcrCompareJob> {
  const env = opts.env ?? process.env;
  if (!(opts.listenerWanted ?? isLunchListenerWanted)()) {
    throw new LunchJobError(409, 'Слухач обідів вимкнений — порівняти нема чим');
  }
  if (!(env.ANTHROPIC_API_KEY ?? '').trim()) throw new LunchJobError(409, 'У бекенда немає ANTHROPIC_API_KEY');
  const active = await prisma.lunchAdminJob.findFirst({
    where: { type: 'ocr_compare', status: { in: ['pending', 'running'] } },
    orderBy: { id: 'desc' },
  });
  if (active) throw new LunchJobError(409, `Порівняння вже виконується (№${active.id})`);
  const row = await prisma.lunchAdminJob.create({
    data: { type: 'ocr_compare', status: 'pending', paramsJson: JSON.stringify(req) },
  });
  return serializeOcrCompareJob(row);
}

export async function getOcrCompareJob(prisma: PrismaClient, id: number): Promise<LunchOcrCompareJob> {
  const row = await prisma.lunchAdminJob.findUnique({ where: { id } });
  if (!row || row.type !== 'ocr_compare') throw new LunchJobError(404, 'Порівняння не знайдено');
  return serializeOcrCompareJob(row);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sessionPathBase(): string {
  const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  if (env) return env.replace(/\.session$/, '');
  return path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}

/** Telethon стартує лише з орендою сесії (див. telegram-session-lease.ts) */
async function spawnReparse(extraArgs: string[] = []): Promise<LunchReparseResult> {
  if (!(await awaitTelegramSession())) return { ok: false, error: TELEGRAM_SESSION_BUSY_ERROR };
  return spawnReparseNow(extraArgs);
}

function spawnReparseNow(extraArgs: string[] = []): Promise<LunchReparseResult> {
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
