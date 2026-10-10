import os from 'os';
import { randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Оренда Telethon-сесії акаунта власника: лише один процес бекенду може тримати її відкритою.
 *
 * Під час деплою Railway новий контейнер стартує раніше, ніж зупиняється старий. Якщо обидва
 * підключаються до Telegram з одним файлом сесії з різних IP, Telegram анулює ключ назавжди
 * (`AuthKeyDuplicatedError`, 2026-10-10) — потрібен новий вхід в акаунт. Тому кожен запуск Telethon
 * (lunch.listener, fetch/send/resolve, post_text, reparse) спершу чекає на оренду.
 *
 * Запис у `TelegramSessionLease` (id=1) з серцебиттям: новий процес бере його, коли попередній
 * звільнив (SIGTERM) або не оновлював довше за `staleMs`. Час — лише бази даних, без годинників
 * контейнерів. Після захоплення — ще `settleMs` паузи, щоб процеси старого контейнера встигли зникнути.
 */

export type TelegramSessionLeaseStore = {
  /** true — запис тепер наш (вставили, оновили свій або забрали застарілий) */
  tryAcquire(holder: string, staleMs: number): Promise<boolean>;
  /** true — запис досі наш і серцебиття оновлено */
  heartbeat(holder: string): Promise<boolean>;
  release(holder: string): Promise<void>;
};

export function createPrismaTelegramSessionLeaseStore(prisma: PrismaClient): TelegramSessionLeaseStore {
  return {
    async tryAcquire(holder, staleMs) {
      const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
        INSERT INTO "TelegramSessionLease" ("id", "holder", "heartbeatAt")
        VALUES (1, ${holder}, CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO UPDATE
          SET "holder" = EXCLUDED."holder", "heartbeatAt" = CURRENT_TIMESTAMP
          WHERE "TelegramSessionLease"."holder" = EXCLUDED."holder"
             OR "TelegramSessionLease"."heartbeatAt" < CURRENT_TIMESTAMP - make_interval(secs => ${staleMs / 1000}::float8)
        RETURNING "holder"`;
      return rows.length > 0 && rows[0].holder === holder;
    },
    async heartbeat(holder) {
      const n = await prisma.$executeRaw`
        UPDATE "TelegramSessionLease" SET "heartbeatAt" = CURRENT_TIMESTAMP
        WHERE "id" = 1 AND "holder" = ${holder}`;
      return n === 1;
    },
    async release(holder) {
      await prisma.$executeRaw`DELETE FROM "TelegramSessionLease" WHERE "id" = 1 AND "holder" = ${holder}`;
    },
  };
}

export type TelegramSessionLeaseOptions = {
  holder?: string;
  /** Запис без серцебиття довше — покинутий (контейнер упав без SIGTERM) */
  staleMs?: number;
  heartbeatMs?: number;
  retryMs?: number;
  /** Пауза після захоплення перед першим запуском Telethon */
  settleMs?: number;
  /** Оренду втрачено (хтось забрав запис або база недоступна) — зупинити Telethon */
  onLost?: () => void;
  log?: (line: string) => void;
};

export function defaultLeaseHolder(): string {
  const host = process.env.RAILWAY_DEPLOYMENT_ID?.trim() || os.hostname();
  return `${host}:${process.pid}:${randomBytes(3).toString('hex')}`;
}

export class TelegramSessionLease {
  readonly holder: string;
  private readonly staleMs: number;
  private readonly heartbeatMs: number;
  private readonly retryMs: number;
  private readonly settleMs: number;
  private readonly onLost?: () => void;
  private readonly log: (line: string) => void;
  private held = false;
  private stopped = false;
  private lastBeatOk = 0;
  /** Номер захоплення: відкладене «held» від старого захоплення не спрацює після втрати */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters = new Set<() => void>();
  private waitingLogged = false;
  private lastAcquireError = '';

  constructor(
    private readonly store: TelegramSessionLeaseStore,
    options: TelegramSessionLeaseOptions = {}
  ) {
    this.holder = options.holder ?? defaultLeaseHolder();
    this.staleMs = options.staleMs ?? 45_000;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.retryMs = options.retryMs ?? 5_000;
    this.settleMs = options.settleMs ?? 5_000;
    this.onLost = options.onLost;
    this.log = options.log ?? ((line) => console.log(line));
  }

  isHeld(): boolean {
    return this.held;
  }

  start(): void {
    this.stopped = false;
    this.schedule(0, () => this.acquireLoop());
  }

  /** Чекати оренду не довше timeoutMs; true — можна запускати Telethon */
  waitUntilHeld(timeoutMs: number): Promise<boolean> {
    if (this.held) return Promise.resolve(true);
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(t);
        this.waiters.delete(onHeld);
        resolve(ok);
      };
      const onHeld = () => done(true);
      const t = setTimeout(() => done(this.held), timeoutMs);
      t.unref?.();
      this.waiters.add(onHeld);
    });
  }

  /** Зупинити серцебиття й звільнити запис (викликати, коли Telethon-процеси вже зупинені) */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const wasHeld = this.held;
    this.held = false;
    if (!wasHeld) return;
    try {
      await this.store.release(this.holder);
      this.log(`[telegram-session] lease released holder=${this.holder}`);
    } catch (e) {
      this.log(`[telegram-session] lease release failed: ${(e as Error).message}`);
    }
  }

  private schedule(ms: number, fn: () => Promise<void>): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void fn();
    }, ms);
    this.timer.unref?.();
  }

  private async acquireLoop(): Promise<void> {
    let acquired = false;
    try {
      acquired = await this.store.tryAcquire(this.holder, this.staleMs);
    } catch (e) {
      // база недоступна або міграцію ще не застосовано — пишемо лише нову помилку, не кожні 5 с
      const msg = (e as Error).message;
      if (msg !== this.lastAcquireError) this.log(`[telegram-session] lease acquire error: ${msg}`);
      this.lastAcquireError = msg;
    }
    if (this.stopped) return;
    if (!acquired) {
      if (!this.waitingLogged) {
        this.log('[telegram-session] waiting: the session is held by another instance (previous deploy?)');
        this.waitingLogged = true;
      }
      this.schedule(this.retryMs, () => this.acquireLoop());
      return;
    }
    this.lastBeatOk = Date.now();
    this.waitingLogged = false;
    this.lastAcquireError = '';
    const generation = ++this.generation;
    this.log(`[telegram-session] lease acquired holder=${this.holder}; settle ${this.settleMs}ms`);
    // Серцебиття йде і під час паузи: інакше довгий settle міг би зробити запис застарілим
    this.schedule(Math.min(this.heartbeatMs, this.settleMs || this.heartbeatMs), () => this.beat());
    setTimeout(() => {
      if (this.stopped || generation !== this.generation || this.lastBeatOk === 0) return;
      this.held = true;
      for (const w of [...this.waiters]) w();
    }, this.settleMs).unref?.();
  }

  private async beat(): Promise<void> {
    let ok = false;
    let errored = false;
    try {
      ok = await this.store.heartbeat(this.holder);
    } catch (e) {
      errored = true;
      this.log(`[telegram-session] heartbeat error: ${(e as Error).message}`);
    }
    if (this.stopped) return;
    if (ok) {
      this.lastBeatOk = Date.now();
      this.schedule(this.heartbeatMs, () => this.beat());
      return;
    }
    // База тимчасово недоступна — тримаємо, поки запис точно не став застарілим для інших
    if (errored && Date.now() - this.lastBeatOk < this.staleMs * 0.6) {
      this.schedule(Math.min(this.heartbeatMs, this.retryMs), () => this.beat());
      return;
    }
    this.log('[telegram-session] lease lost — stopping Telethon until it is re-acquired');
    this.held = false;
    this.lastBeatOk = 0;
    this.generation += 1;
    this.onLost?.();
    this.schedule(this.retryMs, () => this.acquireLoop());
  }
}

/* Процесний реєстр: index.ts ставить оренду; у тестах і без бази її немає — тоді Telethon не чекає. */
let activeLease: TelegramSessionLease | null = null;

export function setTelegramSessionLease(lease: TelegramSessionLease | null): void {
  activeLease = lease;
}

export function getTelegramSessionLease(): TelegramSessionLease | null {
  return activeLease;
}

/** Таймаут для коротких скриптів (fetch/send/post): перекриття деплою зазвичай секунди */
export const TELETHON_SCRIPT_LEASE_WAIT_MS = 45_000;

export const TELEGRAM_SESSION_BUSY_ERROR =
  'Сесія Telegram зайнята іншим екземпляром бекенду (триває деплой) — спробуйте за хвилину';

/** Дочекатися права відкрити Telethon-сесію. Без налаштованої оренди — одразу true. */
export async function awaitTelegramSession(timeoutMs = TELETHON_SCRIPT_LEASE_WAIT_MS): Promise<boolean> {
  if (!activeLease) return true;
  return activeLease.waitUntilHeld(timeoutMs);
}

/** Помилки Telethon, після яких сесія мертва: допоможе лише новий вхід (auth_session.py) */
export const FATAL_TELEGRAM_SESSION_ERRORS = [
  'AuthKeyDuplicatedError',
  'AuthKeyUnregisteredError',
  'SessionRevokedError',
  'SessionExpiredError',
  'UserDeactivatedError',
  'UserDeactivatedBanError',
  // lunch.listener: файл сесії є, але вхід не виконано
  'SessionNotAuthorized',
];

export function fatalTelegramSessionError(text: string): string | null {
  for (const name of FATAL_TELEGRAM_SESSION_ERRORS) {
    if (text.includes(name)) return name;
  }
  return null;
}
