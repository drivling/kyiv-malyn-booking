"use strict";
/** Запуск / черга повторного розбору дня обідів. */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reparseLunchToday = reparseLunchToday;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const lunch_listener_1 = require("./lunch-listener");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function sessionPathBase() {
    const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    if (env)
        return env.replace(/\.session$/, '');
    return path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}
function spawnReparse() {
    const sessionPath = sessionPathBase();
    const sessionFile = sessionPath + '.session';
    const apiId = process.env.TELEGRAM_API_ID?.trim();
    const apiHash = process.env.TELEGRAM_API_HASH?.trim();
    if (!apiId || !apiHash || !fs_1.default.existsSync(sessionFile)) {
        return Promise.resolve({ ok: false, error: 'Немає TELEGRAM_* / файлу сесії' });
    }
    const telegramUserDir = path_1.default.join(process.cwd(), 'telegram-user');
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, ['-m', 'lunch.reparse'], {
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
        child.stdout?.on('data', (c) => {
            stdout += c.toString();
        });
        child.stderr?.on('data', (c) => {
            stderr += c.toString();
        });
        child.on('close', (code) => {
            try {
                const line = stdout.trim().split(/\n/).filter(Boolean).pop() || '';
                const parsed = JSON.parse(line);
                if (parsed.ok === false) {
                    resolve({ ok: false, error: String(parsed.error || 'reparse failed') });
                }
                else {
                    resolve({
                        ok: true,
                        scanned: parsed.scanned,
                        orders: parsed.orders,
                        payments: parsed.payments,
                        cards: parsed.cards,
                        summaries: parsed.summaries,
                        skipped: parsed.skipped,
                        errors: parsed.errors,
                    });
                }
            }
            catch {
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
async function reparseLunchToday(prisma, opts) {
    const timeoutMs = opts?.timeoutMs ?? 90000;
    if (!(0, lunch_listener_1.isLunchListenerWanted)()) {
        return spawnReparse();
    }
    const job = await prisma.lunchAdminJob.create({
        data: { type: 'reparse_today', status: 'pending' },
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(800);
        const row = await prisma.lunchAdminJob.findUnique({ where: { id: job.id } });
        if (!row) {
            return { ok: false, error: 'Job зник' };
        }
        if (row.status === 'done') {
            let stats = {};
            try {
                stats = row.resultJson ? JSON.parse(row.resultJson) : {};
            }
            catch {
                /* ignore */
            }
            return { ok: true, queued: false, ...stats };
        }
        if (row.status === 'failed') {
            return { ok: false, error: row.errorText || 'Reparse failed' };
        }
    }
    return {
        ok: false,
        error: 'Таймаут очікування listener. Перевір логи [lunch-listener] / чи запущений python -m lunch.listener',
    };
}
