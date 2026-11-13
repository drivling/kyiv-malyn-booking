"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_MAX_TEXT = void 0;
exports.intentsAgree = intentsAgree;
exports.createAdminDovedeRouter = createAdminDovedeRouter;
/**
 * Адмін-API «Доведе» (Docs/dovede-roadmap.md, фаза 2): POST /admin/dovede/understand — текст питання →
 * TripIntent від Claude. Таємність сторінки тримає саме цей requireAdmin. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить.
 */
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const arrival_reports_1 = require("../arrival-reports");
const guard_1 = require("../dovede/guard");
const intent_1 = require("../dovede/intent");
const understand_1 = require("../dovede/understand");
exports.DOVEDE_MAX_TEXT = 300;
/** Чи два розбори ведуть до тієї самої відповіді: місця, день, час, транспорт */
function intentsAgree(a, b) {
    const modes = (m) => [...m].sort().join(',');
    return (a.intent === b.intent &&
        (a.from?.id ?? null) === (b.from?.id ?? null) &&
        (a.to?.id ?? null) === (b.to?.id ?? null) &&
        a.when.day === b.when.day &&
        (a.when.time ?? null) === (b.when.time ?? null) &&
        (a.when.part ?? null) === (b.when.part ?? null) &&
        (a.when.time ? a.when.kind === b.when.kind : true) &&
        modes(a.modes) === modes(b.modes));
}
function createAdminDovedeRouter(deps) {
    const { prisma } = deps;
    const understand = deps.understand === undefined ? (0, understand_1.understandFromEnv)() : deps.understand;
    const enabled = deps.enabled ?? (() => (0, guard_1.isDovedeEnabled)());
    const dailyCap = deps.dailyCap ?? (() => (0, guard_1.dovedeDailyCap)());
    const clock = deps.now ?? (() => new Date());
    const r = express_1.default.Router();
    /** Журнал не має права зламати відповідь */
    const log = async (data) => {
        try {
            await prisma.dovedeQuery.create({ data });
        }
        catch (e) {
            console.error('❌ DovedeQuery log:', e);
        }
    };
    r.post('/admin/dovede/understand', require_admin_1.requireAdmin, async (req, res) => {
        const body = (req.body ?? {});
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) {
            res.status(400).json({ error: 'Порожнє питання' });
            return;
        }
        if (text.length > exports.DOVEDE_MAX_TEXT) {
            res.status(400).json({ error: `Питання задовге (до ${exports.DOVEDE_MAX_TEXT} символів)` });
            return;
        }
        let local = null;
        if (body.local != null) {
            try {
                local = (0, intent_1.validateIntent)(body.local);
            }
            catch (e) {
                if (!(e instanceof intent_1.IntentShapeError))
                    throw e;
            }
        }
        const localIntent = local ? local : undefined;
        const at = clock();
        try {
            if (!enabled()) {
                await log({ text, localIntent, status: 'disabled' });
                res.status(503).json({ fallback: 'local', reason: 'disabled' });
                return;
            }
            if (!understand) {
                await log({ text, localIntent, status: 'no_key' });
                res.status(503).json({ fallback: 'local', reason: 'no_key' });
                return;
            }
            if ((await (0, guard_1.aiCallsToday)(prisma, at)) >= dailyCap()) {
                await log({ text, localIntent, status: 'cap' });
                res.status(429).json({ fallback: 'local', reason: 'cap' });
                return;
            }
            const result = await understand(text, (0, arrival_reports_1.kyivClock)(at));
            const agree = result.ok && local ? intentsAgree(local, result.intent) : null;
            await log({
                text,
                localIntent,
                aiIntent: result.ok ? result.intent : undefined,
                agree,
                status: result.ok ? 'ok' : result.failure,
                aiCalled: true,
                model: result.model,
                promptVersion: result.promptVersion,
                latencyMs: result.latencyMs,
                inputTokens: result.usage?.inputTokens,
                outputTokens: result.usage?.outputTokens,
                cacheReadTokens: result.usage?.cacheReadTokens,
                cacheWriteTokens: result.usage?.cacheWriteTokens,
                error: result.ok ? undefined : result.message,
            });
            if (!result.ok) {
                res.status(503).json({ fallback: 'local', reason: result.failure });
                return;
            }
            res.json({ intent: result.intent, agree, model: result.model, latencyMs: result.latencyMs });
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/understand:', e);
            res.status(503).json({ fallback: 'local', reason: 'api_error' });
        }
    });
    return r;
}
