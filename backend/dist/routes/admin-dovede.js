"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_MAX_TEXT = void 0;
exports.intentsAgree = intentsAgree;
exports.createAdminDovedeRouter = createAdminDovedeRouter;
/**
 * API «Доведе» (Docs/dovede-roadmap.md, фаза 2 і «Доступ»): POST /dovede/understand — текст питання →
 * TripIntent від Claude. Доступ тримає сервер (`dovede/access.ts`): `DOVEDE_PUBLIC=ON` — усім, інакше пароль
 * `DOVEDE_PASSWORD` (GET /dovede/access, POST /dovede/login) або токен адміна. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить. GET /admin/dovede/queries — журнал цих питань (лише адмін).
 */
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const access_1 = require("../dovede/access");
const arrival_reports_1 = require("../arrival-reports");
const guard_1 = require("../dovede/guard");
const log_1 = require("../dovede/log");
const intent_1 = require("../dovede/intent");
const synonyms_1 = require("../dovede/synonyms");
const understand_1 = require("../dovede/understand");
const stopPlaces_1 = require("../dovede/stopPlaces");
const transport_city_1 = require("../transport-city");
const drive_time_1 = require("../drive-time");
const viber_listing_expiry_1 = require("../viber-listing-expiry");
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
        modes(a.routes ?? []) === modes(b.routes ?? []) &&
        modes(a.avoidRoutes ?? []) === modes(b.avoidRoutes ?? []));
}
function createAdminDovedeRouter(deps) {
    const { prisma } = deps;
    const understand = deps.understand === undefined ? (0, understand_1.understandFromEnv)() : deps.understand;
    const enabled = deps.enabled ?? (() => (0, guard_1.isDovedeEnabled)());
    const dailyCap = deps.dailyCap ?? (() => (0, guard_1.dovedeDailyCap)());
    const clock = deps.now ?? (() => new Date());
    const access = deps.access ?? (0, access_1.dovedeAccessFromEnv)();
    const loginFailures = (0, access_1.createLoginFailures)(() => clock().getTime());
    const driveTime = deps.driveTime ?? (0, drive_time_1.driveTimeFromEnv)();
    const r = express_1.default.Router();
    /** Чи відкривати сторінку: `open` — відкрита всім, `allowed` — цьому браузеру (токен пароля чи адміна) */
    r.get('/dovede/access', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ open: access.isPublic(), allowed: (0, access_1.hasDovedeAccess)(req, access) });
    });
    /** Пароль запрошених → токен для `X-Dovede-Token` */
    r.post('/dovede/login', (req, res) => {
        const password = access.password();
        if (!password) {
            res.status(503).json({ error: 'Вхід за паролем вимкнено' });
            return;
        }
        if (loginFailures.blocked()) {
            res.status(429).json({ error: 'Забагато спроб. Спробуйте за кілька хвилин.' });
            return;
        }
        const given = (req.body ?? {}).password;
        if (!(0, require_admin_1.safeEqual)(given, password)) {
            loginFailures.fail();
            res.status(401).json({ error: 'Невірний пароль' });
            return;
        }
        res.json({ token: (0, access_1.dovedeAccessToken)(password) });
    });
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
    /** Синоніми з адмінки; кеш на хвилину, запис в адмінці скидає його одразу */
    let synCache = null;
    const synonyms = async (at) => {
        if (synCache && at.getTime() - synCache.at < 60000)
            return synCache.list;
        try {
            const rows = await prisma.dovedeSynonym.findMany({ select: { phrase: true, placeId: true }, orderBy: { phrase: 'asc' }, take: synonyms_1.SYNONYM_LIMIT });
            const list = rows.map((x) => ({ phrase: x.phrase, placeId: x.placeId }));
            synCache = { at: at.getTime(), list };
            return list;
        }
        catch (e) {
            // без синонімів сторінка працює, як до них
            console.error('❌ Dovede: не вдалося прочитати синоніми:', e);
            return synCache?.list ?? [];
        }
    };
    /** Синоніми для сторінки: браузер розбирає з ними питання сам */
    r.get('/dovede/synonyms', (0, access_1.requireDovedeAccess)(access), async (_req, res) => {
        res.set('Cache-Control', 'private, no-store');
        res.json({ synonyms: await synonyms(clock()) });
    });
    r.get('/admin/dovede/synonyms', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const rows = await prisma.dovedeSynonym.findMany({ orderBy: { id: 'desc' } });
            res.set('Cache-Control', 'private, no-store');
            res.json({ synonyms: rows.map((s) => ({ id: s.id, phrase: s.phrase, placeId: s.placeId, createdAt: s.createdAt.toISOString() })) });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/synonyms:', e);
            res.status(500).json({ error: 'Не вдалося прочитати синоніми' });
        }
    });
    /** Навчити: фраза → місце. Та сама фраза вдруге — міняє місце (одна фраза не може вести у два місця) */
    r.post('/admin/dovede/synonyms', require_admin_1.requireAdmin, async (req, res) => {
        const body = (req.body ?? {});
        const phrase = (0, synonyms_1.normalizePhrase)(body.phrase);
        const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : '';
        const problem = (0, synonyms_1.phraseProblem)(phrase);
        if (problem) {
            res.status(400).json({ error: problem });
            return;
        }
        try {
            const city = await cityData(clock());
            if (!(0, intent_1.isKnownPlaceId)(placeId, city.ids)) {
                res.status(400).json({ error: 'Такого місця немає у словнику' });
                return;
            }
            const saved = await prisma.dovedeSynonym.upsert({ where: { phrase }, create: { phrase, placeId }, update: { placeId } });
            synCache = null;
            res.json({ id: saved.id, phrase: saved.phrase, placeId: saved.placeId, createdAt: saved.createdAt.toISOString() });
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/synonyms:', e);
            res.status(500).json({ error: 'Не вдалося зберегти синонім' });
        }
    });
    r.delete('/admin/dovede/synonyms/:id', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: 'Невірний id' });
            return;
        }
        try {
            await prisma.dovedeSynonym.deleteMany({ where: { id } });
            synCache = null;
            res.json({ ok: true });
        }
        catch (e) {
            console.error('❌ DELETE /admin/dovede/synonyms/:id:', e);
            res.status(500).json({ error: 'Не вдалося видалити синонім' });
        }
    });
    /**
     * Скільки їде попутка: `times` — години виїзду за Києвом (до шести). За доступом «Доведе», бо за ним стоїть
     * платний сервіс. Сталий час — з маршруту в адмінці; `source` каже, чи врахувано затори.
     */
    r.get('/dovede/drive-time', (0, access_1.requireDovedeAccess)(access), async (req, res) => {
        const from = String(req.query.from ?? '').trim();
        const to = String(req.query.to ?? '').trim();
        const date = String(req.query.date ?? '').trim();
        const times = [...new Set(String(req.query.times ?? '').split(',').map((t) => t.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].slice(0, 6);
        if (!/^[A-Za-z]{2,20}$/.test(from) || !/^[A-Za-z]{2,20}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.status(400).json({ error: 'from, to та date (YYYY-MM-DD) обовʼязкові' });
            return;
        }
        let fixedMinutes = drive_time_1.DEFAULT_CAR_MINUTES;
        try {
            const route = await prisma.tripRoute.findUnique({ where: { slug: `${from}-${to}` }, select: { carDurationMinutes: true } });
            if (route?.carDurationMinutes)
                fixedMinutes = route.carDurationMinutes;
        }
        catch (e) {
            console.error('❌ GET /dovede/drive-time: маршрут не прочитано, беру типовий час:', e);
        }
        const [y, m, d] = date.split('-').map(Number);
        // години питаємо разом: кожна має свій тайм-аут, людина не чекає їх по черзі
        const got = await Promise.all(times.map((t) => {
            const [hh, mm] = t.split(':').map(Number);
            return driveTime({ fromCode: from, toCode: to, departAt: (0, viber_listing_expiry_1.kyivWallToUtc)(y, m - 1, d, hh, mm), fixedMinutes });
        }));
        const minutes = {};
        times.forEach((t, i) => (minutes[t] = got[i].minutes));
        const source = got.some((g) => g.source === 'traffic') ? 'traffic' : 'fixed';
        res.set('Cache-Control', 'private, no-store');
        res.json({ fixedMinutes, source, minutes });
    });
    /**
     * «Звідки забирають попутки»: примітки оголошень водіїв за період, згруповані за напрямком і текстом.
     * Без імен і телефонів; місця в примітках розбирає адмінка тим самим словником, що й сторінка.
     */
    r.get('/admin/dovede/pickups', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const days = (0, log_1.parseLogDays)(req.query.days ?? 90);
            const since = new Date(clock().getTime() - days * 24 * 60 * 60000);
            const rows = await prisma.viberListing.findMany({ where: { listingType: 'driver', createdAt: { gte: since } }, select: { route: true, notes: true }, take: 20000 });
            const groups = new Map();
            const byRoute = new Map();
            for (const row of rows) {
                const note = (row.notes ?? '').replace(/\s+/g, ' ').trim();
                const r0 = byRoute.get(row.route) ?? { route: row.route, total: 0, withNote: 0 };
                r0.total++;
                if (note)
                    r0.withNote++;
                byRoute.set(row.route, r0);
                if (!note)
                    continue;
                const key = `${row.route}|${note.toLowerCase()}`;
                const g = groups.get(key);
                if (g)
                    g.count++;
                else
                    groups.set(key, { route: row.route, note, count: 1 });
            }
            res.set('Cache-Control', 'private, no-store');
            res.json({
                days,
                total: rows.length,
                routes: [...byRoute.values()].sort((a, b) => b.total - a.total),
                notes: [...groups.values()].sort((a, b) => b.count - a.count || a.note.localeCompare(b.note, 'uk')).slice(0, 1000),
            });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/pickups:', e);
            res.status(500).json({ error: 'Не вдалося прочитати оголошення' });
        }
    });
    /** Журнал не має права зламати відповідь */
    const log = async (data) => {
        try {
            await prisma.dovedeQuery.create({ data });
        }
        catch (e) {
            console.error('❌ DovedeQuery log:', e);
        }
    };
    r.post('/dovede/understand', (0, access_1.requireDovedeAccess)(access), async (req, res) => {
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
            const result = await understand(text, (0, arrival_reports_1.kyivClock)(at), city.stops, city.routes, await synonyms(at));
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
            console.error('❌ POST /dovede/understand:', e);
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
