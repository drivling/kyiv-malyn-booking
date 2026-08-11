"use strict";
/** Запуск Python lunch.listener як дочірнього процесу backend (авторозбір замовлень). */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLunchListenerWanted = isLunchListenerWanted;
exports.startLunchListener = startLunchListener;
exports.pauseLunchListenerForExclusiveSession = pauseLunchListenerForExclusiveSession;
exports.resumeLunchListenerAfterExclusiveSession = resumeLunchListenerAfterExclusiveSession;
exports.stopLunchListener = stopLunchListener;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
let child = null;
let stopping = false;
/** >0 — тимчасово зупинили listener, щоб інший Telethon (fetch/send) міг відкрити ту саму .session */
let exclusivePauseDepth = 0;
let restartTimer = null;
let restartAttempt = 0;
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
    if (child && !child.killed) {
        console.log('[lunch-listener] already running pid=' + child.pid);
        return;
    }
    const dir = telegramUserDir();
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    const session = sessionPathBase();
    const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();
    console.log('[lunch-listener] starting python -m lunch.listener cwd=' + dir);
    child = (0, child_process_1.spawn)(pythonCmd, ['-m', 'lunch.listener'], {
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
    child.stdout?.on('data', (buf) => {
        const lines = buf.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines)
            console.log('[lunch-listener]', line);
    });
    child.stderr?.on('data', (buf) => {
        const lines = buf.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines)
            console.error('[lunch-listener]', line);
    });
    child.on('exit', (code, signal) => {
        console.warn(`[lunch-listener] exited code=${code} signal=${signal} pid=${pid}`);
        child = null;
        if (stopping || exclusivePauseDepth > 0)
            return;
        restartAttempt += 1;
        const delay = Math.min(60000, 2000 * Math.pow(2, Math.min(restartAttempt, 5)));
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
async function pauseLunchListenerForExclusiveSession() {
    exclusivePauseDepth += 1;
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
    console.log('[lunch-listener] resume after exclusive session');
    startLunchListener();
}
function stopLunchListener() {
    stopping = true;
    exclusivePauseDepth = 0;
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
