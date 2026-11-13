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
 * тоді відповідає з місцевого розбору, людина помилки не бачить. GET /admin/dovede/queries — журнал цих питань.
 */
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const arrival_reports_1 = require("../arrival-reports");
const guard_1 = require("../dovede/guard");
const log_1 = require("../dovede/log");
const intent_1 = require("../dovede/intent");
const understand_1 = require("../dovede/understand");
const stopPlaces_1 = require("../dovede/stopPlaces");
const transport_city_1 = require("../transport-city");
exports.DOVEDE_MAX_TEXT = 300;
/** Як довго тримаємо список зупинок міста в памʼяті: нова зупинка з адмінки стає відомою Claude за цей час */
const STOPS_TTL_MS = 5 * 60000;
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
        modes(a.modes) === modes(b.modes) &&
        modes(a.routes ?? []) === modes(b.routes ?? []));
}
function createAdminDovedeRouter(deps) {
    const { prisma } = deps;
    const understand = deps.understand === undefined ? (0, understand_1.understandFromEnv)() : deps.understand;
    const enabled = deps.enabled ?? (() => (0, guard_1.isDovedeEnabled)());
    const dailyCap = deps.dailyCap ?? (() => (0, guard_1.dovedeDailyCap)());
    const clock = deps.now ?? (() => new Date());
    const r = express_1.default.Router();
    /**
     * Усі зупинки й маршрути міського транспорту з бази — Claude має знати кожну, а не лише кураторський словник.
     * Той самий масив повертається до закінчення TTL (і після нього, якщо назви не змінились): промпт стабільний.
     */
    let cityCache = null;
    const cityData = async (at) => {
        if (cityCache && at.getTime() - cityCache.at < STOPS_TTL_MS)
            return cityCache;
        try {
            const [stopRows, routeRows] = await Promise.all([
                prisma.transportStop.findMany({ where: { cityCode: transport_city_1.DEFAULT_TRANSPORT_CITY }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
                // «ненадійні» маршрути сайт не показує — і Claude про них не знає
                prisma.transportRoute.findMany({
                    where: { cityCode: transport_city_1.DEFAULT_TRANSPORT_CITY, unreliable: false },
                    select: { id: true, shortName: true, fromName: true, toName: true },
                    orderBy: { id: 'asc' },
                }),
            ]);
            const routes = routeRows.map((r) => ({ id: r.id, no: r.shortName.trim() || r.id, fromName: r.fromName.trim(), toName: r.toName.trim() }));
            const key = JSON.stringify([stopRows, routes]);
            if (cityCache && cityCache.key === key)
                cityCache.at = at.getTime();
            else {
                cityCache = { at: at.getTime(), key, stops: stopRows, ids: new Set((0, stopPlaces_1.buildStopPlaces)(stopRows).map((e) => e.place.id)), routes, routeIds: new Set(routes.map((r) => r.id)) };
            }
            return cityCache;
        }
        catch (e) {
            // без даних міста Claude знає лише кураторський словник — гірше, але відповідь буде
            console.error('❌ Dovede: не вдалося прочитати зупинки й маршрути міста:', e);
            return cityCache ?? { stops: [], ids: new Set(), routes: [], routeIds: new Set() };
        }
    };
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
        const at = clock();
        const city = await cityData(at);
        let local = null;
        if (body.local != null) {
            try {
                local = (0, intent_1.validateIntent)(body.local, city.ids, city.routeIds);
            }
            catch (e) {
                if (!(e instanceof intent_1.IntentShapeError))
                    throw e;
            }
        }
        const localIntent = local ? local : undefined;
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
            const result = await understand(text, (0, arrival_reports_1.kyivClock)(at), city.stops, city.routes);
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
    /**
     * Журнал питань: зведення за період (1 = сьогодні від київської півночі, 7 / 30 / 90 днів) і останні рядки.
     * `only=problems` лишає в таблиці лише питання з позначками (збій, розбіжність, невпізнані слова, без місця).
     */
    r.get('/admin/dovede/queries', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const days = (0, log_1.parseLogDays)(req.query.days);
            const at = clock();
            const today = (0, guard_1.kyivDayStart)(at);
            const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60000);
            const [rows, callsToday] = await Promise.all([
                prisma.dovedeQuery.findMany({ where: { createdAt: { gte: since } }, orderBy: { id: 'desc' }, take: log_1.DOVEDE_LOG_SCAN }),
                (0, guard_1.aiCallsToday)(prisma, at),
            ]);
            const flag = typeof req.query.only === 'string' ? req.query.only : '';
            const items = rows.map(log_1.toLogItem).filter((it) => {
                if (!flag)
                    return true;
                if (flag === 'problems')
                    return it.flags.length > 0;
                return it.flags.includes(flag);
            });
            res.setHeader('Cache-Control', 'private, no-store');
            res.json({
                days,
                since: since.toISOString(),
                enabled: enabled(),
                hasKey: understand != null,
                dailyCap: dailyCap(),
                callsToday,
                truncated: rows.length >= log_1.DOVEDE_LOG_SCAN,
                summary: (0, log_1.summarizeQueries)(rows),
                matched: items.length,
                items: items.slice(0, log_1.DOVEDE_LOG_ROWS),
            });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/queries:', e);
            res.status(500).json({ error: 'Не вдалося прочитати журнал' });
        }
    });
    return r;
}
