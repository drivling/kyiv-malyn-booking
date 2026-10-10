"use strict";
/** Запуск Python lunch.listener як дочірнього процесу backend (авторозбір замовлень). */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LUNCH_LISTENER_FATAL_SESSION_EXIT = void 0;
exports.setLunchListenerFatalHandler = setLunchListenerFatalHandler;
exports.lunchListenerFatalSessionError = lunchListenerFatalSessionError;
exports.resetLunchListenerStateForTests = resetLunchListenerStateForTests;
exports.isLunchListenerWanted = isLunchListenerWanted;
exports.startLunchListener = startLunchListener;
exports.pauseLunchListenerForExclusiveSession = pauseLunchListenerForExclusiveSession;
exports.resumeLunchListenerAfterExclusiveSession = resumeLunchListenerAfterExclusiveSession;
exports.stopLunchListener = stopLunchListener;
exports.stopLunchListenerAndWait = stopLunchListenerAndWait;
exports.interruptLunchListenerForLeaseLoss = interruptLunchListenerForLeaseLoss;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const telegram_session_lease_1 = require("./telegram-session-lease");
let child = null;
let stopping = false;
/** >0 — тимчасово зупинили listener, щоб інший Telethon (fetch/send) міг відкрити ту саму .session */
let exclusivePauseDepth = 0;
let restartTimer = null;
let restartAttempt = 0;
/** Процес, що прожив стільки, вважаємо стабільним: наступний збій знову «перший» (4 с паузи) */
const STABLE_RUN_MS = 60000;
/** Код виходу lunch.listener, коли Telegram відкликав сесію: перезапуск не допоможе */
exports.LUNCH_LISTENER_FATAL_SESSION_EXIT = 78;
/** Сесію відкликано — більше не стартуємо до нового деплою з новою сесією */
let fatalSessionError = null;
let onFatalSession = null;
let waitingForLease = false;
/** Скільки чекати оренду за раз; потім — новий цикл очікування (з рядком у логах) */
const LEASE_WAIT_MS = 10 * 60000;
/** index.ts: сповістити власника (адмін-чат бота), що сесію треба створити заново */
function setLunchListenerFatalHandler(fn) {
    onFatalSession = fn;
}
function lunchListenerFatalSessionError() {
    return fatalSessionError;
}
/** Тести: скинути стан модуля */
function resetLunchListenerStateForTests() {
    fatalSessionError = null;
    onFatalSession = null;
    waitingForLease = false;
    stopping = false;
    exclusivePauseDepth = 0;
    restartAttempt = 0;
    child = null;
}
/**
 * Після exclusive-сесії не піднімаємо listener миттєво: серія коротких Telethon-скриптів
 * (send_message / resolve) йде впритул, і кожен рестарт listener'а тільки б знову ловив
 * "database is locked". Тримаємо паузу ще кілька секунд після останньої операції.
 */
const RESUME_LINGER_MS = 4000;
let resumeTimer = null;
function clearResumeTimer() {
    if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
    }
}
function telegramUserDir() {
    return path_1.default.join(process.cwd(), 'telegram-user');
}
function sessionPathBase() {
    const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    if (env)
        return env.replace(/\.session$/, '');
    return path_1.default.join(telegramUserDir(), 'session_telegram_user');
}
function isLunchListenerWanted() {
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
    return Boolean(apiId && apiHash && db && fs_1.default.existsSync(sessionFile));
}
function startLunchListener() {
    if (!isLunchListenerWanted()) {
        console.log('[lunch-listener] skipped (set LUNCH_LISTENER_ENABLED=1 + TELEGRAM_* + DATABASE_URL + session file to enable)');
        return;
    }
    if (fatalSessionError) {
        console.warn(`[lunch-listener] not starting: the Telegram session is dead (${fatalSessionError}) — log in again`);
        return;
    }
    if (child && !child.killed) {
        console.log('[lunch-listener] already running pid=' + child.pid);
        return;
    }
    const lease = (0, telegram_session_lease_1.getTelegramSessionLease)();
    if (lease && !lease.isHeld()) {
        if (waitingForLease)
            return;
        waitingForLease = true;
        console.log('[lunch-listener] waiting for the Telegram session lease');
        void lease.waitUntilHeld(LEASE_WAIT_MS).then(() => {
            waitingForLease = false;
            if (stopping || exclusivePauseDepth > 0 || child)
                return;
            startLunchListener();
        });
        return;
    }
    spawnListener();
}
function spawnListener() {
    const dir = telegramUserDir();
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    const session = sessionPathBase();
    const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();
    console.log('[lunch-listener] starting python -m lunch.listener cwd=' + dir);
    const proc = (0, child_process_1.spawn)(pythonCmd, ['-m', 'lunch.listener'], {
        cwd: dir,
        env: {
            ...process.env,
            LUNCH_LISTENER_CHILD: '1',
            // Без цього stdout у pipe буферизується блоками: рядки [lunch] у логах Railway з'являлись
            // лише при виході процесу (раз на ~5 хв), і по логах було не відновити хід подій.
            PYTHONUNBUFFERED: '1',
            TELEGRAM_USER_SESSION_PATH: session,
            LUNCH_GROUP_ID: groupId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;
    const pid = proc.pid;
    const startedAt = Date.now();
    let fatalSeen = null;
    proc.stdout?.on('data', (buf) => {
        const lines = buf.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines)
            console.log('[lunch-listener]', line);
    });
    proc.stderr?.on('data', (buf) => {
        const lines = buf.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            console.error('[lunch-listener]', line);
            fatalSeen ?? (fatalSeen = (0, telegram_session_lease_1.fatalTelegramSessionError)(line));
        }
    });
    proc.on('exit', (code, signal) => {
        console.warn(`[lunch-listener] exited code=${code} signal=${signal} pid=${pid}`);
        if (child === proc)
            child = null;
        if (code === exports.LUNCH_LISTENER_FATAL_SESSION_EXIT || (code !== 0 && fatalSeen)) {
            fatalSessionError = fatalSeen ?? 'fatal session error';
            console.error(`[lunch-listener] the Telegram session is dead (${fatalSessionError}): not restarting. ` +
                'Create a new one with telegram-user/auth_session.py and set TELEGRAM_USER_SESSION_BASE64');
            try {
                onFatalSession?.(fatalSessionError);
            }
            catch (e) {
                console.error('[lunch-listener] fatal handler failed', e);
            }
            return;
        }
        if (stopping || exclusivePauseDepth > 0)
            return;
        // Лічильник скидаємо лише після стабільної роботи: інакше процес, що падає одразу, щоразу
        // рахувався «першою» спробою і перезапускався кожні 4 с без кінця (2026-10-10)
        if (Date.now() - startedAt >= STABLE_RUN_MS)
            restartAttempt = 0;
        restartAttempt += 1;
        const delay = Math.min(60000, 2000 * Math.pow(2, Math.min(restartAttempt, 5)));
        console.log(`[lunch-listener] restart in ${delay}ms (attempt ${restartAttempt})`);
        restartTimer = setTimeout(() => {
            restartTimer = null;
            startLunchListener();
        }, delay);
    });
    proc.on('error', (err) => {
        console.error('[lunch-listener] spawn error', err);
    });
}
/**
 * Зупиняє lunch.listener і чекає exit — щоб звільнити SQLite Telethon-сесію
 * для коротких скриптів (fetch_telegram_messages / send_message).
 */
async function pauseLunchListenerForExclusiveSession() {
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
    await new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            console.warn('[lunch-listener] pause timeout — SIGKILL');
            try {
                proc.kill('SIGKILL');
            }
            catch {
                /* ignore */
            }
            done();
        }, 8000);
        proc.once('exit', done);
        try {
            proc.kill('SIGTERM');
        }
        catch {
            done();
        }
    });
    child = null;
}
function resumeLunchListenerAfterExclusiveSession() {
    exclusivePauseDepth = Math.max(0, exclusivePauseDepth - 1);
    if (exclusivePauseDepth > 0 || stopping)
        return;
    clearResumeTimer();
    if (!isLunchListenerWanted())
        return;
    resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (exclusivePauseDepth > 0 || stopping)
            return;
        console.log('[lunch-listener] resume after exclusive session (linger elapsed)');
        startLunchListener();
    }, RESUME_LINGER_MS);
    resumeTimer.unref?.();
}
function stopLunchListener() {
    void stopLunchListenerAndWait(8000);
}
/**
 * Зупинити listener і дочекатися виходу (не довше timeoutMs, потім SIGKILL). Перед звільненням
 * оренди сесії процес має точно зникнути — інакше новий контейнер підключиться поруч із ним.
 */
async function stopLunchListenerAndWait(timeoutMs = 5000) {
    stopping = true;
    exclusivePauseDepth = 0;
    clearResumeTimer();
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    const proc = child;
    child = null;
    if (!proc || proc.killed || proc.exitCode !== null)
        return;
    console.log('[lunch-listener] stopping pid=' + proc.pid);
    await new Promise((resolve) => {
        const timer = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            }
            catch {
                /* ignore */
            }
            resolve();
        }, timeoutMs);
        proc.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        try {
            proc.kill('SIGTERM');
        }
        catch {
            clearTimeout(timer);
            resolve();
        }
    });
}
/** Оренду сесії втрачено: зупинити процес; перезапуск сам дочекається нової оренди */
function interruptLunchListenerForLeaseLoss() {
    const proc = child;
    if (!proc || proc.killed)
        return;
    console.warn('[lunch-listener] lease lost — stopping pid=' + proc.pid);
    try {
        proc.kill('SIGTERM');
    }
    catch {
        /* ignore */
    }
}
