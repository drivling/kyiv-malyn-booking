"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_MAX_TEXT = void 0;
exports.intentsAgree = intentsAgree;
exports.pickupNote = pickupNote;
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
const settings_1 = require("../dovede/settings");
const log_1 = require("../dovede/log");
const intent_1 = require("../dovede/intent");
const synonyms_1 = require("../dovede/synonyms");
const understand_1 = require("../dovede/understand");
const korosten_prompt_1 = require("../dovede/korosten-prompt");
const stopPlaces_1 = require("../dovede/stopPlaces");
const transport_city_1 = require("../transport-city");
const drive_time_1 = require("../drive-time");
const city_route_1 = require("../dovede/city-route");
const viber_listing_expiry_1 = require("../viber-listing-expiry");
const city_campaign_1 = require("../dovede/city-campaign");
const city_quality_1 = require("../dovede/city-quality");
const page_data_1 = require("../dovede/page-data");
exports.DOVEDE_MAX_TEXT = 300;
/** Як довго тримаємо список зупинок міста в памʼяті: нова зупинка з адмінки стає відомою Claude за цей час */
const STOPS_TTL_MS = 5 * 60000;
/** Чи два розбори ведуть до тієї самої відповіді: місця, день, час, транспорт */
function intentsAgree(a, b) {
    const modes = (m) => [...m].sort().join(',');
    return (a.intent === b.intent &&
        (a.from?.id ?? null) === (b.from?.id ?? null) &&
        (a.to?.id ?? null) === (b.to?.id ?? null) &&
        // місце в іншому місті словами: словник і Claude пишуть його в різних відмінках — звіряємо лише, чи воно є
        Boolean(a.from?.detail) === Boolean(b.from?.detail) &&
        Boolean(a.to?.detail) === Boolean(b.to?.detail) &&
        a.when.day === b.when.day &&
        (a.when.time ?? null) === (b.when.time ?? null) &&
        (a.when.part ?? null) === (b.when.part ?? null) &&
        (a.when.time ? a.when.kind === b.when.kind : true) &&
        modes(a.modes) === modes(b.modes) &&
        modes(a.routes ?? []) === modes(b.routes ?? []) &&
        modes(a.avoidRoutes ?? []) === modes(b.avoidRoutes ?? []));
}
/**
 * Примітка для підрахунку «Звідки забирають»: без чужих контактів — посилань, ніків Telegram і телефонів.
 * Порожні після цього частини («; ;») прибираємо.
 */
function pickupNote(raw) {
    return (raw ?? '')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\b(t\.me|telegram\.me|viber\.me)\/\S+/gi, ' ')
        .replace(/(^|\s)@[A-Za-z0-9_]{3,}/g, ' ')
        .replace(/\+?\d[\d\s()-]{8,}\d/g, ' ')
        .split(';')
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter((part) => part && !/^[\s().,:-]*$/.test(part))
        .join('; ');
}
function createAdminDovedeRouter(deps) {
    const { prisma } = deps;
    const understand = deps.understand === undefined ? (0, understand_1.understandFromEnv)() : deps.understand;
    const clock = deps.now ?? (() => new Date());
    const settings = deps.settings ?? (0, settings_1.createDovedeSettings)({ prisma, now: clock });
    // ШІ-розбір і його денний ліміт — з налаштувань адмінки (головний вимикач DOVEDE_ENABLED — там же); у тестах — заглушки
    const enabled = async () => (deps.enabled ? deps.enabled() : settings.bool('ai.enabled'));
    const dailyCap = async () => (deps.dailyCap ? deps.dailyCap() : settings.int('ai.dailyCap'));
    const access = deps.access ?? (0, access_1.dovedeAccessFromEnv)();
    const loginFailures = (0, access_1.createLoginFailures)(() => clock().getTime());
    const driveTime = deps.driveTime ?? (0, drive_time_1.createDriveTime)({ key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null, dailyCap: () => settings.int('drive.dailyCap') });
    const cityRoutes = deps.cityRoutes ?? (0, city_route_1.cityRoutesFromEnv)(prisma, settings);
    const campaigns = deps.campaigns ?? (0, city_campaign_1.createCityCampaigns)({ prisma, cityRoutes, settings, now: clock });
    const quality = deps.quality ?? (0, city_quality_1.createCityQuality)(prisma);
    const pageData = deps.pageData ?? (0, page_data_1.createDovedePageData)({ prisma, now: clock });
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
    // окремо для кожного міста питань: Малин (з коридорами) і Коростень (етап 2)
    const cityCaches = new Map();
    const cityData = async (at, city = 'Malyn') => {
        const cityCache = cityCaches.get(city) ?? null;
        if (cityCache && at.getTime() - cityCache.at < STOPS_TTL_MS)
            return cityCache;
        const cityCode = city === 'Korosten' ? 'Korosten' : transport_city_1.DEFAULT_TRANSPORT_CITY;
        try {
            const [stopRows, routeRows] = await Promise.all([
                prisma.transportStop.findMany({ where: { cityCode }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
                // «ненадійні» маршрути сайт не показує — і Claude про них не знає
                prisma.transportRoute.findMany({
                    where: { cityCode, unreliable: false },
                    select: { id: true, shortName: true, fromName: true, toName: true },
                    orderBy: { id: 'asc' },
                }),
            ]);
            const routes = routeRows.map((r) => ({ id: r.id, no: r.shortName.trim() || r.id, fromName: r.fromName.trim(), toName: r.toName.trim() }));
            const key = JSON.stringify([stopRows, routes]);
            if (cityCache && cityCache.key === key) {
                cityCache.at = at.getTime();
                return cityCache;
            }
            const ids = city === 'Korosten' ? (0, korosten_prompt_1.korostenPlaceIds)(stopRows) : new Set((0, stopPlaces_1.buildStopPlaces)(stopRows).map((e) => e.place.id));
            const next = { at: at.getTime(), key, stops: stopRows, ids, routes, routeIds: new Set(routes.map((r) => r.id)) };
            cityCaches.set(city, next);
            return next;
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
    /** Дані сторінки, змінені в адмінці (крок 11): лише змінені ключі; решта — типові з коду сторінки */
    r.get('/dovede/page-data', (0, access_1.requireDovedeAccess)(access), async (_req, res) => {
        res.set('Cache-Control', 'private, no-store');
        res.json({ values: await pageData.values() });
    });
    r.get('/admin/dovede/page-data', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json({ items: await pageData.list() });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/page-data:', e);
            res.status(500).json({ error: 'Не вдалося прочитати дані сторінки' });
        }
    });
    /** `{ key, value }` — змінити; `{ key, reset: true }` — повернути типове з коду */
    r.put('/admin/dovede/page-data', require_admin_1.requireAdmin, async (req, res) => {
        const b = (req.body ?? {});
        if (typeof b.key !== 'string' || (b.reset !== true && !('value' in b))) {
            res.status(400).json({ error: 'потрібні key і value (або reset: true)' });
            return;
        }
        try {
            res.json(await pageData.set(b.key, b.value, b.reset === true));
        }
        catch (e) {
            if (e instanceof RangeError) {
                res.status(400).json({ error: e.message });
                return;
            }
            console.error('❌ PUT /admin/dovede/page-data:', e);
            res.status(500).json({ error: 'Не вдалося зберегти' });
        }
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
     * Дорога містом між двома точками (Київ, Житомир): з нашої бази, а коли там немає — від Google, і тоді відповідь
     * лягає в базу. `from` / `to` — id відомої точки («zhytomyr.avtovokzal», «kyiv.akadem») або слова людини.
     * Будь-яка невдача — 200 з `{ ok: false, fallback: 'maps' }`: сторінка показує посилання Google Maps.
     * `learn=1` з токеном адміна — навчання (`npm run dovede:crawl`): відповідь та сама й так само лягає в базу, але
     * попит людей не рахується. Без токена адміна прапорець нічого не міняє.
     */
    r.get('/dovede/city-route', (0, access_1.requireDovedeAccess)(access), async (req, res) => {
        const city = String(req.query.city ?? '').trim();
        const from = String(req.query.from ?? '').trim();
        const to = String(req.query.to ?? '').trim();
        const date = String(req.query.date ?? '').trim();
        const time = String(req.query.time ?? '').trim();
        if ((city !== 'Kyiv' && city !== 'Zhytomyr') || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            res.status(400).json({ error: 'city (Kyiv | Zhytomyr), from, to, date (YYYY-MM-DD) і time (HH:MM) обовʼязкові' });
            return;
        }
        const [y, m, d] = date.split('-').map(Number);
        const [hh, mm] = time.split(':').map(Number);
        res.set('Cache-Control', 'private, no-store');
        try {
            const learn = String(req.query.learn ?? '') === '1' && (0, require_admin_1.isAdminRequest)(req);
            res.json(await cityRoutes.find({ city: city, from, to, date, time, departAt: (0, viber_listing_expiry_1.kyivWallToUtc)(y, m - 1, d, hh, mm) }, learn));
        }
        catch (e) {
            console.error('❌ GET /dovede/city-route:', e);
            res.json({ ok: false, fallback: 'maps', reason: 'error' });
        }
    });
    /** Адмінка «Місто: що вже знаємо»: лічильники, попит, архів */
    r.get('/admin/dovede/city', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json(await cityRoutes.stats());
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city:', e);
            res.status(500).json({ error: 'Не вдалося прочитати дані міста' });
        }
    });
    /** Один крок навчання зараз (той самий, що робить таймер) */
    r.post('/admin/dovede/city/learn', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.json(await cityRoutes.learnTick(5));
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/learn:', e);
            res.status(500).json({ error: 'Не вдалося оновити' });
        }
    });
    /** Обнуляє лічильник попиту «Що питають найчастіше» (після прогону самонавчання). Рядки й збережені дороги лишаються */
    // ── Кампанії навчання міста (Docs/dovede-admin-roadmap.md, крок 6) ─────────────────────────────────────────────
    // Заготовки → оцінка (скільки запитів до Google) → власник погоджує бюджет → сервер обходить сам (city-campaign.ts)
    r.get('/admin/dovede/city/campaigns/presets', require_admin_1.requireAdmin, (_req, res) => {
        res.json({ presets: campaigns.presets() });
    });
    const campaignInput = (body) => {
        const b = (body ?? {});
        return {
            preset: String(b.preset ?? ''),
            city: String(b.city ?? ''),
            ...(b.options && typeof b.options === 'object' ? { options: b.options } : {}),
            ...(b.budget !== undefined ? { budget: b.budget } : {}),
            ...(b.dailyBudget !== undefined ? { dailyBudget: b.dailyBudget } : {}),
        };
    };
    r.post('/admin/dovede/city/campaigns/preview', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.json(await campaigns.preview(campaignInput(req.body)));
        }
        catch (e) {
            if (e instanceof city_campaign_1.CampaignInputError) {
                res.status(400).json({ error: e.message });
                return;
            }
            console.error('❌ POST /admin/dovede/city/campaigns/preview:', e);
            res.status(500).json({ error: 'Не вдалося оцінити' });
        }
    });
    r.post('/admin/dovede/city/campaigns', require_admin_1.requireAdmin, async (req, res) => {
        try {
            res.status(201).json(await campaigns.create(campaignInput(req.body)));
        }
        catch (e) {
            if (e instanceof city_campaign_1.CampaignInputError) {
                res.status(400).json({ error: e.message });
                return;
            }
            console.error('❌ POST /admin/dovede/city/campaigns:', e);
            res.status(500).json({ error: 'Не вдалося запустити' });
        }
    });
    r.get('/admin/dovede/city/campaigns', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.json(await campaigns.list());
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/campaigns:', e);
            res.status(500).json({ error: 'Не вдалося завантажити' });
        }
    });
    r.get('/admin/dovede/city/campaigns/:id', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) {
            res.status(400).json({ error: 'Невірний id' });
            return;
        }
        try {
            const c = await campaigns.get(id);
            if (!c) {
                res.status(404).json({ error: 'Такої кампанії немає' });
                return;
            }
            res.json(c);
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/campaigns/:id:', e);
            res.status(500).json({ error: 'Не вдалося завантажити' });
        }
    });
    r.post('/admin/dovede/city/campaigns/:id/action', require_admin_1.requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        const b = (req.body ?? {});
        const act = b.action;
        if (!Number.isInteger(id) || id < 1 || !(act === 'pause' || act === 'resume' || act === 'cancel' || act === 'extend' || act === 'archive')) {
            res.status(400).json({ error: 'action: pause | resume | cancel | extend | archive' });
            return;
        }
        try {
            const r2 = await campaigns.action(id, act, { budget: b.budget, dailyBudget: b.dailyBudget });
            if (r2 === null)
                res.status(404).json({ error: 'Такої кампанії немає' });
            else if (typeof r2 === 'string')
                res.status(409).json({ error: r2 });
            else
                res.json(r2);
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/campaigns/:id/action:', e);
            res.status(500).json({ error: 'Не вдалося' });
        }
    });
    /** Звіт якості (крок 8): підозрілі дороги в базі; `?city=Kyiv|Zhytomyr`, без нього — обидва міста */
    r.get('/admin/dovede/city/quality', require_admin_1.requireAdmin, async (req, res) => {
        const raw = String(req.query.city ?? '');
        if (raw && raw !== 'Kyiv' && raw !== 'Zhytomyr') {
            res.status(400).json({ error: 'city: Kyiv або Zhytomyr' });
            return;
        }
        try {
            res.json(await quality.report(raw ? raw : undefined));
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/quality:', e);
            res.status(500).json({ error: 'Не вдалося зібрати звіт' });
        }
    });
    /** «Нормально» у звіті якості: `{ city, key, ok }` — місце більше не показується серед підозрілих (ok: false — знову) */
    r.post('/admin/dovede/city/place/ok', require_admin_1.requireAdmin, async (req, res) => {
        const b = (req.body ?? {});
        if ((b.city !== 'Kyiv' && b.city !== 'Zhytomyr') || typeof b.key !== 'string' || !b.key.trim() || typeof b.ok !== 'boolean') {
            res.status(400).json({ error: 'city (Kyiv | Zhytomyr), key і ok (true | false) обовʼязкові' });
            return;
        }
        try {
            const done = await quality.markOk(b.city, b.key.trim(), b.ok);
            if (!done) {
                res.status(404).json({ error: 'Такого місця серед збережених доріг немає' });
                return;
            }
            res.json({ city: b.city, key: b.key.trim(), ok: b.ok });
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/place/ok:', e);
            res.status(500).json({ error: 'Не вдалося' });
        }
    });
    r.post('/admin/dovede/city/demand/reset', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.json(await cityRoutes.resetDemand());
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/demand/reset:', e);
            res.status(500).json({ error: 'Не вдалося скинути лічильник' });
        }
    });
    /** Скільки днів збережена відповідь вважається свіжою (далі сервер питає Google знову) */
    r.put('/admin/dovede/city/settings', require_admin_1.requireAdmin, async (req, res) => {
        const body = (req.body ?? {});
        const hasFresh = 'freshDays' in body;
        const hasCap = 'dailyCap' in body;
        if (!hasFresh && !hasCap) {
            res.status(400).json({ error: 'потрібне freshDays або dailyCap' });
            return;
        }
        if (hasFresh && !(0, city_route_1.isValidFreshDays)(body.freshDays)) {
            res.status(400).json({ error: `freshDays: ціле число від ${city_route_1.CITY_FRESH_DAYS_MIN} до ${city_route_1.CITY_FRESH_DAYS_MAX}` });
            return;
        }
        // dailyCap: null — повернути ліміт зі змінної середовища
        if (hasCap && body.dailyCap !== null && !(0, city_route_1.isValidDailyCap)(body.dailyCap)) {
            res.status(400).json({ error: `dailyCap: ціле число від ${city_route_1.CITY_DAILY_CAP_MIN} до ${city_route_1.CITY_DAILY_CAP_MAX} або null` });
            return;
        }
        try {
            const out = {};
            if (hasFresh)
                out.freshDays = await cityRoutes.setFreshDays(body.freshDays);
            if (hasCap)
                out.dailyCap = await cityRoutes.setDailyCap(body.dailyCap);
            res.json(out);
        }
        catch (e) {
            console.error('❌ PUT /admin/dovede/city/settings:', e);
            res.status(500).json({ error: 'Не вдалося зберегти' });
        }
    });
    /**
     * Розділ «Налаштування»: усі налаштування «Доведе» з тим, що діє зараз, типовим (змінна середовища чи код), що задав
     * власник і чи вимкнено вмикач на сервері. Ключів і паролів тут немає.
     */
    r.get('/admin/dovede/settings', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json({ items: await settings.all(), groups: settings_1.SETTING_GROUP_LABEL });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/settings:', e);
            res.status(500).json({ error: 'Не вдалося прочитати налаштування' });
        }
    });
    /** Одне налаштування: `{ key, value }`; `value: null` — повернути типове. Межі — з переліку `DOVEDE_SETTINGS` */
    r.put('/admin/dovede/settings', require_admin_1.requireAdmin, async (req, res) => {
        const body = (req.body ?? {});
        const def = typeof body.key === 'string' ? settings_1.DOVEDE_SETTINGS.find((d) => d.key === body.key) : undefined;
        if (!def) {
            res.status(400).json({ error: 'key: невідоме налаштування' });
            return;
        }
        if (!('value' in body) || (body.value !== null && !(0, settings_1.validSettingValue)(def, body.value))) {
            res.status(400).json({ error: def.kind === 'bool' ? 'value: true, false або null' : `value: ціле від ${def.min} до ${def.max} або null` });
            return;
        }
        try {
            res.json(await settings.set(def.key, body.value));
        }
        catch (e) {
            console.error('❌ PUT /admin/dovede/settings:', e);
            res.status(500).json({ error: 'Не вдалося зберегти' });
        }
    });
    /** Архівує все, що з Google, або повертає з архіву. Нічого не видаляє; дані власника не чіпає */
    r.post('/admin/dovede/city/archive', require_admin_1.requireAdmin, async (req, res) => {
        const action = String(req.body?.action ?? '');
        if (action !== 'archive' && action !== 'restore') {
            res.status(400).json({ error: 'action: archive | restore' });
            return;
        }
        try {
            res.json({ action, ...(action === 'archive' ? await cityRoutes.archiveGoogle() : await cityRoutes.restoreGoogle()) });
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/archive:', e);
            res.status(500).json({ error: 'Не вдалося' });
        }
    });
    /** Місця словами зі збереженими дорогами й місця в архіві — щоб прибрати одне місце з неправильною відповіддю */
    /** Дороги одного місця: `?city=Kyiv|Zhytomyr&key=<ключ місця>` (розгортка в «Місця») */
    r.get('/admin/dovede/city/place/routes', require_admin_1.requireAdmin, async (req, res) => {
        const city = String(req.query.city ?? '');
        const key = String(req.query.key ?? '').trim();
        if ((city !== 'Kyiv' && city !== 'Zhytomyr') || !key || key.length > 200) {
            res.status(400).json({ error: 'city (Kyiv | Zhytomyr) і key обовʼязкові' });
            return;
        }
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json({ routes: await cityRoutes.placeRouteList(city, key) });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/place/routes:', e);
            res.status(500).json({ error: 'Не вдалося прочитати дороги місця' });
        }
    });
    /** Що питають люди: `?city=Kyiv|Zhytomyr&only=unanswered` — усі пари (до 500), найчастіші першими */
    r.get('/admin/dovede/city/demand', require_admin_1.requireAdmin, async (req, res) => {
        const city = String(req.query.city ?? '');
        const only = String(req.query.only ?? '');
        if ((city && city !== 'Kyiv' && city !== 'Zhytomyr') || (only && only !== 'unanswered')) {
            res.status(400).json({ error: 'city: Kyiv | Zhytomyr; only: unanswered' });
            return;
        }
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json({ demand: await cityRoutes.demandList(city ? city : null, only === 'unanswered') });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/demand:', e);
            res.status(500).json({ error: 'Не вдалося прочитати попит' });
        }
    });
    r.get('/admin/dovede/city/places', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            res.set('Cache-Control', 'private, no-store');
            res.json({ places: await cityRoutes.places() });
        }
        catch (e) {
            console.error('❌ GET /admin/dovede/city/places:', e);
            res.status(500).json({ error: 'Не вдалося прочитати місця' });
        }
    });
    /**
     * Архів одного місця або повернення з нього: `{ city, key, action: archive | restore }`. Дороги цього місця не
     * видаляються; поки воно в архіві, сервер про нього не відповідає й Google не питає.
     */
    r.post('/admin/dovede/city/place/archive', require_admin_1.requireAdmin, async (req, res) => {
        const city = String(req.body?.city ?? '');
        const key = typeof req.body?.key === 'string' ? req.body.key : '';
        const action = String(req.body?.action ?? '');
        if ((city !== 'Kyiv' && city !== 'Zhytomyr') || (action !== 'archive' && action !== 'restore')) {
            res.status(400).json({ error: 'city: Kyiv | Zhytomyr, action: archive | restore' });
            return;
        }
        try {
            const done = action === 'archive' ? await cityRoutes.archivePlace(city, key) : await cityRoutes.restorePlace(city, key);
            if (!done) {
                res.status(400).json({ error: 'key: місце словами (не id точки посадки чи станції метро)' });
                return;
            }
            res.json({ action, ...done });
        }
        catch (e) {
            console.error('❌ POST /admin/dovede/city/place/archive:', e);
            res.status(500).json({ error: 'Не вдалося' });
        }
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
                const note = pickupNote(row.notes);
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
        // Коростень (етап 2): свій промпт і свої зупинки; будь-що інше — Малин, як і раніше
        const askCity = body.city === 'Korosten' ? 'Korosten' : 'Malyn';
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
        const city = await cityData(at, askCity);
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
            if (!(await enabled())) {
                await log({ text, localIntent, status: 'disabled' });
                res.status(503).json({ fallback: 'local', reason: 'disabled' });
                return;
            }
            if (!understand) {
                await log({ text, localIntent, status: 'no_key' });
                res.status(503).json({ fallback: 'local', reason: 'no_key' });
                return;
            }
            if ((await (0, guard_1.aiCallsToday)(prisma, at)) >= (await dailyCap())) {
                await log({ text, localIntent, status: 'cap' });
                res.status(429).json({ fallback: 'local', reason: 'cap' });
                return;
            }
            // синоніми з адмінки ведуть до місць Малина — Коростеню вони не потрібні
            const result = await understand(text, (0, arrival_reports_1.kyivClock)(at), city.stops, city.routes, askCity === 'Korosten' ? [] : await synonyms(at), askCity);
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
                enabled: await enabled(),
                hasKey: understand != null,
                dailyCap: await dailyCap(),
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
