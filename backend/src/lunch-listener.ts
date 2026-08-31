/** Запуск Python lunch.listener як дочірнього процесу backend (авторозбір замовлень). */

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

let child: ChildProcess | null = null;
let stopping = false;
/** >0 — тимчасово зупинили listener, щоб інший Telethon (fetch/send) міг відкрити ту саму .session */
let exclusivePauseDepth = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let restartAttempt = 0;
/**
 * Після exclusive-сесії не піднімаємо listener миттєво: серія коротких Telethon-скриптів
 * (send_message / resolve) йде впритул, і кожен рестарт listener'а тільки б знову ловив
 * "database is locked". Тримаємо паузу ще кілька секунд після останньої операції.
 */
const RESUME_LINGER_MS = 4000;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function clearResumeTimer(): void {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

function telegramUserDir(): string {
  return path.join(process.cwd(), 'telegram-user');
}

function sessionPathBase(): string {
  const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
  if (env) return env.replace(/\.session$/, '');
  return path.join(telegramUserDir(), 'session_telegram_user');
}

export function isLunchListenerWanted(): boolean {
  const flag = (process.env.LUNCH_LISTENER_ENABLED || '1').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') {
    return false;
  }
  // під час тестів не стартуємо
  if (process.env.NODE_ENV === 'test' || process.env.LUNCH_LISTENER_CHILD === '1') {
    return false;
  }
  const apiId = process.env.TELEGRAM_API_ID?.trim();
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  const sessionFile = sessionPathBase() + '.session';
  const db = process.env.DATABASE_URL?.trim();
  return Boolean(apiId && apiHash && db && fs.existsSync(sessionFile));
}

export function startLunchListener(): void {
  if (!isLunchListenerWanted()) {
    console.log(
      '[lunch-listener] skipped (set LUNCH_LISTENER_ENABLED=1 + TELEGRAM_* + DATABASE_URL + session file to enable)'
    );
    return;
  }
  if (child && !child.killed) {
    console.log('[lunch-listener] already running pid=' + child.pid);
    return;
  }

  const dir = telegramUserDir();
  const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
  const session = sessionPathBase();
  const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();

  console.log('[lunch-listener] starting python -m lunch.listener cwd=' + dir);
  child = spawn(pythonCmd, ['-m', 'lunch.listener'], {
    cwd: dir,
    env: {
      ...process.env,
      LUNCH_LISTENER_CHILD: '1',
      TELEGRAM_USER_SESSION_PATH: session,
      LUNCH_GROUP_ID: groupId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pid = child.pid;
  child.stdout?.on('data', (buf: Buffer) => {
    const lines = buf.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) console.log('[lunch-listener]', line);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const lines = buf.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) console.error('[lunch-listener]', line);
  });
  child.on('exit', (code, signal) => {
    console.warn(`[lunch-listener] exited code=${code} signal=${signal} pid=${pid}`);
    child = null;
    if (stopping || exclusivePauseDepth > 0) return;
    restartAttempt += 1;
    const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(restartAttempt, 5)));
    console.log(`[lunch-listener] restart in ${delay}ms (attempt ${restartAttempt})`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startLunchListener();
    }, delay);
  });
  child.on('error', (err) => {
    console.error('[lunch-listener] spawn error', err);
  });
  restartAttempt = 0;
}

/**
 * Зупиняє lunch.listener і чекає exit — щоб звільнити SQLite Telethon-сесію
 * для коротких скриптів (fetch_telegram_messages / send_message).
 */
export async function pauseLunchListenerForExclusiveSession(): Promise<void> {
  exclusivePauseDepth += 1;
  clearResumeTimer();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const proc = child;
  if (!proc || proc.killed) {
    child = null;
    return;
  }
  console.log(`[lunch-listener] pause for exclusive session pid=${proc.pid} depth=${exclusivePauseDepth}`);
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      console.warn('[lunch-listener] pause timeout — SIGKILL');
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done();
    }, 8000);
    proc.once('exit', done);
    try {
      proc.kill('SIGTERM');
    } catch {
      done();
    }
  });
  child = null;
}

export function resumeLunchListenerAfterExclusiveSession(): void {
  exclusivePauseDepth = Math.max(0, exclusivePauseDepth - 1);
  if (exclusivePauseDepth > 0 || stopping) return;
  clearResumeTimer();
  if (!isLunchListenerWanted()) return;
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    if (exclusivePauseDepth > 0 || stopping) return;
    console.log('[lunch-listener] resume after exclusive session (linger elapsed)');
    startLunchListener();
  }, RESUME_LINGER_MS);
  resumeTimer.unref?.();
}

export function stopLunchListener(): void {
  stopping = true;
  exclusivePauseDepth = 0;
  clearResumeTimer();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child && !child.killed) {
    console.log('[lunch-listener] stopping pid=' + child.pid);
    child.kill('SIGTERM');
    child = null;
  }
}
