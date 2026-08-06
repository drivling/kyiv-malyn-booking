"use strict";
/** Відправка тексту в групу обідів: черга в БД (listener) або прямий spawn (без listener). */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postTextToLunchGroup = postTextToLunchGroup;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const lunch_listener_1 = require("./lunch-listener");
function sessionPathBase() {
    const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    if (env)
        return env.replace(/\.session$/, '');
    return path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}
function spawnPostText(text) {
    const sessionPath = sessionPathBase();
    const sessionFile = sessionPath + '.session';
    const apiId = process.env.TELEGRAM_API_ID?.trim();
    const apiHash = process.env.TELEGRAM_API_HASH?.trim();
    if (!apiId || !apiHash || !fs_1.default.existsSync(sessionFile)) {
        console.warn('[lunch-telegram] missing session or TELEGRAM_API_*');
        return Promise.resolve(false);
    }
    const telegramUserDir = fs_1.default.existsSync(path_1.default.join(process.cwd(), 'telegram-user'))
        ? path_1.default.join(process.cwd(), 'telegram-user')
        : path_1.default.dirname(sessionPath);
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    const groupId = (process.env.LUNCH_GROUP_ID || '-5427750954').trim();
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, ['-m', 'lunch.post_text'], {
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
        child.stderr?.on('data', (c) => {
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
async function postTextToLunchGroup(prisma, text) {
    if ((0, lunch_listener_1.isLunchListenerWanted)()) {
        await prisma.lunchOutboundMessage.create({
            data: { text, status: 'pending' },
        });
        return { ok: true, queued: true };
    }
    const ok = await spawnPostText(text);
    return ok
        ? { ok: true, queued: false }
        : { ok: false, queued: false, error: 'Не вдалося надіслати (TELEGRAM_* / сесія)' };
}
