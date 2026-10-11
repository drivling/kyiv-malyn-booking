"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FATAL_TELEGRAM_SESSION_ERRORS = exports.TELEGRAM_SESSION_BUSY_ERROR = exports.TELETHON_SCRIPT_LEASE_WAIT_MS = exports.TelegramSessionLease = void 0;
exports.createPrismaTelegramSessionLeaseStore = createPrismaTelegramSessionLeaseStore;
exports.defaultLeaseHolder = defaultLeaseHolder;
exports.setTelegramSessionLease = setTelegramSessionLease;
exports.getTelegramSessionLease = getTelegramSessionLease;
exports.awaitTelegramSession = awaitTelegramSession;
exports.fatalTelegramSessionError = fatalTelegramSessionError;
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
function createPrismaTelegramSessionLeaseStore(prisma) {
    return {
        async tryAcquire(holder, staleMs) {
            const rows = await prisma.$queryRaw `
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
            const n = await prisma.$executeRaw `
        UPDATE "TelegramSessionLease" SET "heartbeatAt" = CURRENT_TIMESTAMP
        WHERE "id" = 1 AND "holder" = ${holder}`;
            return n === 1;
        },
        async release(holder) {
            await prisma.$executeRaw `DELETE FROM "TelegramSessionLease" WHERE "id" = 1 AND "holder" = ${holder}`;
        },
    };
}
function defaultLeaseHolder() {
    const host = process.env.RAILWAY_DEPLOYMENT_ID?.trim() || os_1.default.hostname();
    return `${host}:${process.pid}:${(0, crypto_1.randomBytes)(3).toString('hex')}`;
}
class TelegramSessionLease {
    constructor(store, options = {}) {
        this.store = store;
        this.held = false;
        this.stopped = false;
        this.lastBeatOk = 0;
        /** Номер захоплення: відкладене «held» від старого захоплення не спрацює після втрати */
        this.generation = 0;
        this.timer = null;
        this.waiters = new Set();
        this.waitingLogged = false;
        this.lastAcquireError = '';
        this.holder = options.holder ?? defaultLeaseHolder();
        this.staleMs = options.staleMs ?? 45000;
        this.heartbeatMs = options.heartbeatMs ?? 15000;
        this.retryMs = options.retryMs ?? 5000;
        this.settleMs = options.settleMs ?? 5000;
        this.onLost = options.onLost;
        this.log = options.log ?? ((line) => console.log(line));
    }
    isHeld() {
        return this.held;
    }
    start() {
        this.stopped = false;
        this.schedule(0, () => this.acquireLoop());
    }
    /** Чекати оренду не довше timeoutMs; true — можна запускати Telethon */
    waitUntilHeld(timeoutMs) {
        if (this.held)
            return Promise.resolve(true);
        if (this.stopped)
            return Promise.resolve(false);
        return new Promise((resolve) => {
            const done = (ok) => {
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
    async stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const wasHeld = this.held;
        this.held = false;
        if (!wasHeld)
            return;
        try {
            await this.store.release(this.holder);
            this.log(`[telegram-session] lease released holder=${this.holder}`);
        }
        catch (e) {
            this.log(`[telegram-session] lease release failed: ${e.message}`);
        }
    }
    schedule(ms, fn) {
        if (this.stopped)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void fn();
        }, ms);
        this.timer.unref?.();
    }
    async acquireLoop() {
        let acquired = false;
        try {
            acquired = await this.store.tryAcquire(this.holder, this.staleMs);
        }
        catch (e) {
            // база недоступна або міграцію ще не застосовано — пишемо лише нову помилку, не кожні 5 с
            const msg = e.message;
            if (msg !== this.lastAcquireError)
                this.log(`[telegram-session] lease acquire error: ${msg}`);
            this.lastAcquireError = msg;
        }
        if (this.stopped)
            return;
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
            if (this.stopped || generation !== this.generation || this.lastBeatOk === 0)
                return;
            this.held = true;
            for (const w of [...this.waiters])
                w();
        }, this.settleMs).unref?.();
    }
    async beat() {
        let ok = false;
        let errored = false;
        try {
            ok = await this.store.heartbeat(this.holder);
        }
        catch (e) {
            errored = true;
            this.log(`[telegram-session] heartbeat error: ${e.message}`);
        }
        if (this.stopped)
            return;
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
exports.TelegramSessionLease = TelegramSessionLease;
/* Процесний реєстр: index.ts ставить оренду; у тестах і без бази її немає — тоді Telethon не чекає. */
let activeLease = null;
function setTelegramSessionLease(lease) {
    activeLease = lease;
}
function getTelegramSessionLease() {
    return activeLease;
}
/** Таймаут для коротких скриптів (fetch/send/post): перекриття деплою зазвичай секунди */
exports.TELETHON_SCRIPT_LEASE_WAIT_MS = 45000;
exports.TELEGRAM_SESSION_BUSY_ERROR = 'Сесія Telegram зайнята іншим екземпляром бекенду (триває деплой) — спробуйте за хвилину';
/** Дочекатися права відкрити Telethon-сесію. Без налаштованої оренди — одразу true. */
async function awaitTelegramSession(timeoutMs = exports.TELETHON_SCRIPT_LEASE_WAIT_MS) {
    if (!activeLease)
        return true;
    return activeLease.waitUntilHeld(timeoutMs);
}
/** Помилки Telethon, після яких сесія мертва: допоможе лише новий вхід (auth_session.py) */
exports.FATAL_TELEGRAM_SESSION_ERRORS = [
    'AuthKeyDuplicatedError',
    'AuthKeyUnregisteredError',
    'SessionRevokedError',
    'SessionExpiredError',
    'UserDeactivatedError',
    'UserDeactivatedBanError',
    // lunch.listener: файл сесії є, але вхід не виконано
    'SessionNotAuthorized',
];
function fatalTelegramSessionError(text) {
    for (const name of exports.FATAL_TELEGRAM_SESSION_ERRORS) {
        if (text.includes(name))
            return name;
    }
    return null;
}
