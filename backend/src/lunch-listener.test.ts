/**
 * lunch.listener як дочірній процес: мертва сесія Telegram зупиняє перезапуски (і кличе обробник),
 * пауза між перезапусками росте, поки процес падає одразу, і скидається після стабільної роботи;
 * без оренди сесії процес не стартує.
 */
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'child_process';
import {
  LUNCH_LISTENER_FATAL_SESSION_EXIT,
  lunchListenerFatalSessionError,
  resetLunchListenerStateForTests,
  setLunchListenerFatalHandler,
  startLunchListener,
  stopLunchListenerAndWait,
} from './lunch-listener';
import { setTelegramSessionLease, type TelegramSessionLease } from './telegram-session-lease';

type FakeChild = EventEmitter & {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exit: (code: number | null, signal?: string | null) => void;
};

let pid = 100;
const children: FakeChild[] = [];
function fakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.pid = ++pid;
  c.killed = false;
  c.exitCode = null;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.exit = (code, signal = null) => {
    c.exitCode = code ?? 0;
    c.emit('exit', code, signal);
  };
  c.kill = vi.fn((signal: string) => {
    c.killed = true;
    setTimeout(() => c.exit(null, signal), 0);
    return true;
  });
  children.push(c);
  return c;
}

const ENV_KEYS = ['NODE_ENV', 'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'DATABASE_URL', 'TELEGRAM_USER_SESSION_PATH', 'LUNCH_LISTENER_ENABLED'];
let savedEnv: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  vi.useFakeTimers();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunch-listener-'));
  fs.writeFileSync(path.join(dir, 's.session'), 'x');
  Object.assign(process.env, {
    NODE_ENV: 'production',
    TELEGRAM_API_ID: '1',
    TELEGRAM_API_HASH: 'h',
    DATABASE_URL: 'postgres://x',
    TELEGRAM_USER_SESSION_PATH: path.join(dir, 's'),
    LUNCH_LISTENER_ENABLED: '1',
  });
  children.length = 0;
  vi.mocked(spawn).mockReset().mockImplementation(() => fakeChild() as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetLunchListenerStateForTests();
});

afterEach(async () => {
  const stopping = stopLunchListenerAndWait(10);
  await vi.advanceTimersByTimeAsync(20);
  await stopping;
  setTelegramSessionLease(null);
  resetLunchListenerStateForTests();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('lunch-listener', () => {
  it('AuthKeyDuplicatedError — більше не перезапускаємо, обробник отримує назву помилки', async () => {
    const onFatal = vi.fn();
    setLunchListenerFatalHandler(onFatal);
    startLunchListener();
    expect(spawn).toHaveBeenCalledTimes(1);
    children[0].stderr.emit(
      'data',
      Buffer.from('telethon.errors.rpcerrorlist.AuthKeyDuplicatedError: The authorization key (session file) was used under two different IP addresses\n')
    );
    children[0].exit(1);
    expect(onFatal).toHaveBeenCalledWith('AuthKeyDuplicatedError');
    expect(lunchListenerFatalSessionError()).toBe('AuthKeyDuplicatedError');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spawn).toHaveBeenCalledTimes(1);
    startLunchListener();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('код 78 від listener.py — теж мертва сесія', () => {
    const onFatal = vi.fn();
    setLunchListenerFatalHandler(onFatal);
    startLunchListener();
    children[0].exit(LUNCH_LISTENER_FATAL_SESSION_EXIT);
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it('пауза росте 4 → 8 → 16 с, поки процес падає одразу; після хвилини роботи — знову 4 с', async () => {
    startLunchListener();
    children[0].exit(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(2);

    children[1].exit(1);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(3);

    children[2].exit(1);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(spawn).toHaveBeenCalledTimes(4);

    // стабільна робота понад хвилину — наступний збій знову «перший»
    await vi.advanceTimersByTimeAsync(61_000);
    children[3].exit(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(spawn).toHaveBeenCalledTimes(5);
  });

  it('без оренди сесії не стартує; стартує, щойно оренду отримано', async () => {
    let held = false;
    let release: (ok: boolean) => void = () => {};
    const lease = {
      isHeld: () => held,
      waitUntilHeld: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    } as unknown as TelegramSessionLease;
    setTelegramSessionLease(lease);
    startLunchListener();
    startLunchListener();
    expect(spawn).not.toHaveBeenCalled();
    held = true;
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
