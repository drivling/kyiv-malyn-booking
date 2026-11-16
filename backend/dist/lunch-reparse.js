"use strict";
/** Запуск / черга повторного розбору дня обідів. */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LunchJobError = exports.LUNCH_OCR_COMPARE_MODELS = void 0;
exports.parseOcrCompareRequest = parseOcrCompareRequest;
exports.createOcrCompareJob = createOcrCompareJob;
exports.getOcrCompareJob = getOcrCompareJob;
exports.reparseLunchToday = reparseLunchToday;
exports.reparseLunchPerson = reparseLunchPerson;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const telegram_session_lease_1 = require("./telegram-session-lease");
const lunch_listener_1 = require("./lunch-listener");
// ---------- порівняння моделей розпізнавання (задача ocr_compare) ----------
/** Моделі, які можна порівнювати: від дорогої (еталон) до дешевої — як COMPARE_MODELS у lunch/ocr_menu.py */
exports.LUNCH_OCR_COMPARE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
class LunchJobError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.LunchJobError = LunchJobError;
function parseJson(raw) {
    if (!raw)
        return null;
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    }
    catch {
        return null;
    }
}
function serializeOcrCompareJob(row) {
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
function parseOcrCompareRequest(body, todayIso) {
    const b = (body ?? {});
    const date = b.date === undefined || b.date === null || b.date === '' ? todayIso : String(b.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
        throw new LunchJobError(400, 'date — дата у форматі YYYY-MM-DD');
    }
    if (date > todayIso)
        throw new LunchJobError(400, 'Дата в майбутньому');
    let models = [...exports.LUNCH_OCR_COMPARE_MODELS];
    if (b.models !== undefined) {
        if (!Array.isArray(b.models) || b.models.some((m) => typeof m !== 'string')) {
            throw new LunchJobError(400, 'models — список назв моделей');
        }
        const allowed = new Set(exports.LUNCH_OCR_COMPARE_MODELS);
        const unknown = b.models.filter((m) => !allowed.has(m));
        if (unknown.length)
            throw new LunchJobError(400, `Невідома модель: ${unknown.join(', ')}`);
        // порядок — як у дозволеному списку: перша (найдорожча) стає еталоном
        models = exports.LUNCH_OCR_COMPARE_MODELS.filter((m) => b.models.includes(m));
        if (models.length < 2)
            throw new LunchJobError(400, 'Для порівняння потрібні щонайменше дві моделі');
    }
    return { date, models };
}
/**
 * Поставити слухачеві задачу: ті самі фото й PDF дня через кілька моделей. Нічого не змінює в обідах.
 * Працює лише через слухача (потрібні Telegram-сесія і ключ Claude); результат — getOcrCompareJob.
 */
async function createOcrCompareJob(prisma, req, opts = {}) {
    const env = opts.env ?? process.env;
    if (!(opts.listenerWanted ?? lunch_listener_1.isLunchListenerWanted)()) {
        throw new LunchJobError(409, 'Слухач обідів вимкнений — порівняти нема чим');
    }
    if (!(env.ANTHROPIC_API_KEY ?? '').trim())
        throw new LunchJobError(409, 'У бекенда немає ANTHROPIC_API_KEY');
    const active = await prisma.lunchAdminJob.findFirst({
        where: { type: 'ocr_compare', status: { in: ['pending', 'running'] } },
        orderBy: { id: 'desc' },
    });
    if (active)
        throw new LunchJobError(409, `Порівняння вже виконується (№${active.id})`);
    const row = await prisma.lunchAdminJob.create({
        data: { type: 'ocr_compare', status: 'pending', paramsJson: JSON.stringify(req) },
    });
    return serializeOcrCompareJob(row);
}
async function getOcrCompareJob(prisma, id) {
    const row = await prisma.lunchAdminJob.findUnique({ where: { id } });
    if (!row || row.type !== 'ocr_compare')
        throw new LunchJobError(404, 'Порівняння не знайдено');
    return serializeOcrCompareJob(row);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function sessionPathBase() {
    const env = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    if (env)
        return env.replace(/\.session$/, '');
    return path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
}
/** Telethon стартує лише з орендою сесії (див. telegram-session-lease.ts) */
async function spawnReparse(extraArgs = []) {
    if (!(await (0, telegram_session_lease_1.awaitTelegramSession)()))
        return { ok: false, error: telegram_session_lease_1.TELEGRAM_SESSION_BUSY_ERROR };
    return spawnReparseNow(extraArgs);
}
function spawnReparseNow(extraArgs = []) {
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
        const child = (0, child_process_1.spawn)(pythonCmd, ['-m', 'lunch.reparse', ...extraArgs], {
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
                    resolve({ ...parsed, ok: true });
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
async function runLunchJob(prisma, type, params, spawnArgs, timeoutMs) {
    if (!(0, lunch_listener_1.isLunchListenerWanted)()) {
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
async function reparseLunchToday(prisma, opts) {
    return runLunchJob(prisma, 'reparse_today', null, [], opts?.timeoutMs ?? 90000);
}
/** Розібрати повідомлення однієї людини за сьогодні; чужі замовлення й ручні правки не чіпає. */
async function reparseLunchPerson(prisma, opts) {
    const notify = opts.notify !== false;
    return runLunchJob(prisma, 'reparse_person', { tgUserId: opts.tgUserId, notify }, ['--user-id', opts.tgUserId, ...(notify ? [] : ['--no-notify'])], opts.timeoutMs ?? 90000);
}
