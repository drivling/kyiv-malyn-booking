"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeSlots = exports.CAMPAIGN_PRESETS = exports.reserveFor = exports.ASKS_PER_TICK = exports.MAX_PLACES = exports.MAX_SEED_PLACES = exports.MAX_DAILY_BUDGET = exports.MAX_BUDGET = exports.MAX_DEPTH = exports.CampaignInputError = void 0;
exports.buildPlan = buildPlan;
exports.expandSeeds = expandSeeds;
exports.campaignQuery = campaignQuery;
exports.estimateCost = estimateCost;
exports.leaderOf = leaderOf;
exports.createCityCampaigns = createCityCampaigns;
/**
 * «Доведе» · кампанії навчання міста на сервері (Docs/dovede-admin-roadmap.md, крок 6).
 *
 * Власник в адмінці каже «навчи Житомир» (заготовка), бачить оцінку — скільки запитів до Google це коштуватиме — і
 * погоджує або міняє число (бюджет — кількість запитів до Google). Далі сервер сам, щохвилини (`tick`, фонова задача
 * `dovede-city-campaign`), обходить місця в ширину так само, як локальна команда `npm run dovede:crawl`: питає дорогу
 * від точки висадки до кожного місця (і назад), а зупинки й кінцеві з відповідей стають новими місцями до глибини
 * `maxDepth`. Логіка обходу спільна — `crawl-core.ts`.
 *
 * Межі: увесь бюджет кампанії, її денна частка (`dailyBudget`) і запас для людей — Google питаємо лише поки за день
 * витрачено менше ніж ліміт мінус `reserveFor(ліміт)`. Відмова Google (429 / 403), наш ліміт, вимкнений пошук —
 * кампанія чекає (`waiting` з причиною), питання лишається в черзі. Збережена свіжа відповідь і власні дані Житомира
 * Google не коштують, але теж ведуть обхід далі.
 *
 * Одночасно веде одну кампанію один контейнер (оренда `leaseUntil`): під час деплою їх два. Нічого не видаляється:
 * кампанія з питаннями — журнал, завершену можна лише сховати (`archivedAt`).
 */
const node_crypto_1 = require("node:crypto");
const node_os_1 = require("node:os");
const crawl_core_1 = require("./crawl-core");
const learn_places_1 = require("./learn-places");
const learn_cities_1 = require("./learn-cities");
const city_route_1 = require("./city-route");
const zhytomyr_own_data_1 = require("./zhytomyr-own-data");
const site_domains_1 = require("../site-domains");
const guard_1 = require("./guard");
class CampaignInputError extends Error {
}
exports.CampaignInputError = CampaignInputError;
exports.MAX_DEPTH = 3;
exports.MAX_BUDGET = 20000;
exports.MAX_DAILY_BUDGET = 5000;
/** місць рівня 0 і всього в одній кампанії — запобіжник від обходу, що розрісся */
exports.MAX_SEED_PLACES = 2000;
exports.MAX_PLACES = 5000;
const MAX_SLOTS = 12;
/** за одну хвилину — не більше стількох питань і не довше ніж стільки */
exports.ASKS_PER_TICK = 20;
const TICK_MS = 50000;
const LEASE_MS = 2 * 60000;
/** питання «в роботі» довше за це — контейнер зник посеред питання, повертаємо в чергу */
const STUCK_MS = 5 * 60000;
const WAIT_MS = 30 * 60000;
const ERROR_WAIT_MS = 15 * 60000;
const MAX_ATTEMPTS = 3;
const ERRORS_IN_ROW = 3;
/** Скільки з денного ліміту Google кампанії не чіпають — людям: п'ята частина, не менше 50 */
const reserveFor = (cap) => Math.min(cap, Math.max(50, Math.ceil(cap * 0.2)));
exports.reserveFor = reserveFor;
const ACTIVE = ['running', 'waiting'];
/** Кінцеві всіх маршрутів Житомира з власних даних */
const zhytomyrTerminals = () => [...new Set(zhytomyr_own_data_1.ZT_OWN.dirs.map((d) => d.stops[d.stops.length - 1][0]))].sort();
const DEFAULT_ORIGINS = (0, learn_cities_1.byLearnCity)((c) => [...c.defaultOrigins]);
/** Точка висадки або станція метро (`MODE_PAIRS`) — кінець пари, від якого навчаємось */
const isPointKey = (city, key) => crawl_core_1.ARRIVAL_POINTS[city].includes(key) || key.startsWith('kyiv.m.');
/** Скільки застарілих відповідей бере «Освіжити застаріле» за раз */
const STALE_LIMIT = 2000;
/** Відповіді Google, старші за строк свіжості, — місце з точкою, напрямком і своїми годинами (тип дня й година рядка) */
async function staleSeeds(prisma, city, now, freshDays) {
    const rows = await prisma.dovedeCityRoute.findMany({
        where: { cityCode: city, source: 'google', archivedAt: null, fetchedAt: { lt: new Date(now.getTime() - freshDays * 24 * 3600000) } },
        select: { fromKey: true, toKey: true, fromLabel: true, toLabel: true, dayType: true, hour: true },
        orderBy: { hits: 'desc' },
        take: STALE_LIMIT,
    });
    const byPlace = new Map();
    for (const r of rows) {
        const fromPoint = isPointKey(city, r.fromKey);
        if (fromPoint === isPointKey(city, r.toKey))
            continue;
        if (!crawl_core_1.DAY_TYPES.includes(r.dayType) || !Number.isInteger(r.hour))
            continue;
        const seed = fromPoint
            ? { place: (0, city_route_1.storedPoint)(r.toKey, r.toLabel), origin: r.fromKey, dir: 'to' }
            : { place: (0, city_route_1.storedPoint)(r.fromKey, r.fromLabel), origin: r.toKey, dir: 'from' };
        const id = `${seed.origin}|${seed.dir}|${(0, crawl_core_1.normalizeKey)(seed.place)}`;
        const cur = byPlace.get(id) ?? { ...seed, via: 'stale', slots: [] };
        if (!cur.slots.some((x) => x.dayType === r.dayType && x.hour === r.hour))
            cur.slots.push({ dayType: r.dayType, hour: r.hour });
        byPlace.set(id, cur);
    }
    return [...byPlace.values()];
}
/** Питання людей без відповіді — місце з точкою й напрямком, як питали */
async function unansweredSeeds(prisma, city) {
    const rows = await prisma.dovedeCityDemand.findMany({ where: { cityCode: city, answered: false, asked: { gt: 0 } }, orderBy: [{ asked: 'desc' }], take: 500 });
    return (0, crawl_core_1.seedsFromUnanswered)(rows.map((d) => ({ city: d.cityCode, fromKey: d.fromKey, toKey: d.toKey, from: d.fromLabel, to: d.toLabel }))).map((s) => ({ place: s.place, origin: s.origin, dir: s.dir, via: 'people' }));
}
/** Місця, про які в базі вже є дорога з Google від / до точки висадки, — для «дообучити» інші години */
async function knownSeeds(prisma, city) {
    const rows = await prisma.dovedeCityRoute.findMany({
        where: { cityCode: city, source: 'google', archivedAt: null },
        select: { fromKey: true, toKey: true, fromLabel: true, toLabel: true },
        distinct: ['fromKey', 'toKey'],
    });
    const out = [];
    for (const r of rows) {
        const fromPoint = isPointKey(city, r.fromKey);
        if (fromPoint === isPointKey(city, r.toKey))
            continue;
        out.push(fromPoint ? { place: (0, city_route_1.storedPoint)(r.toKey, r.toLabel), origin: r.fromKey, dir: 'to', via: 'known' } : { place: (0, city_route_1.storedPoint)(r.fromKey, r.fromLabel), origin: r.toKey, dir: 'from', via: 'known' });
    }
    return out;
}
const refill = (id, title, help, main) => ({
    id,
    title,
    help,
    cities: learn_cities_1.LEARN_CITY_CODES,
    defaults: (city) => ({ origins: crawl_core_1.ARRIVAL_POINTS[city], dirs: ['to', 'from'], main, extra: '', maxDepth: 0 }),
    seeds: ({ prisma, city }) => knownSeeds(prisma, city),
});
exports.CAMPAIGN_PRESETS = [
    {
        id: 'learn',
        title: 'Навчити місто',
        help: 'Від точки висадки до місць, куди їдуть найчастіше (лікарні, вокзали, ринки…), і назад; для Житомира — ще й до кінцевих усіх маршрутів. Питання людей без відповіді — теж. Зупинки й кінцеві з відповідей стають новими місцями.',
        cities: learn_cities_1.LEARN_CITY_CODES,
        defaults: (city) => ({ origins: DEFAULT_ORIGINS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: (0, learn_cities_1.learnCity)(city).maxDepth }),
        seeds: async ({ prisma, city }) => [
            ...learn_places_1.LEARN_PLACES[city].map((place) => ({ place, via: 'list' })),
            ...(city === 'Zhytomyr' ? zhytomyrTerminals().map((place) => ({ place, via: 'terminal' })) : []),
            ...(await unansweredSeeds(prisma, city)),
        ],
    },
    refill('refill-evening', 'Дообучити: вечір', 'Місця, які вже знаємо, — на вечірні години буднього дня (дорога додому).', 'weekday@18,weekday@21'),
    refill('refill-weekend', 'Дообучити: вихідні', 'Місця, які вже знаємо, — на суботу й неділю.', 'saturday@11,saturday@17,sunday@11,sunday@17'),
    refill('refill-morning', 'Дообучити: ранок', 'Місця, які вже знаємо, — на ранок буднього дня.', 'weekday@07'),
    {
        id: 'refresh',
        title: 'Освіжити застаріле',
        help: 'Відповіді Google, старші за строк свіжості, — питаємо знову на той самий тип дня й годину. Нових місць не додає.',
        cities: learn_cities_1.LEARN_CITY_CODES,
        ownSlots: true,
        defaults: (city) => ({ origins: crawl_core_1.ARRIVAL_POINTS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 0 }),
        seeds: ({ prisma, city, now, freshDays }) => staleSeeds(prisma, city, now, freshDays),
    },
    {
        id: 'unanswered',
        title: 'Питання людей без відповіді',
        help: 'Лише пари, які питали люди й не отримали дороги. Новими місцями обхід іде на один крок.',
        cities: learn_cities_1.LEARN_CITY_CODES,
        defaults: (city) => ({ origins: crawl_core_1.ARRIVAL_POINTS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 1 }),
        seeds: ({ prisma, city }) => unansweredSeeds(prisma, city),
    },
    {
        id: 'modes',
        title: 'Види транспорту',
        help: 'Пари, у відповідях на які є кожен вид транспорту Києва (фунікулер, трамвай, тролейбус, кільцева…), — щоб картки мали свіжу справжню відповідь.',
        cities: ['Kyiv'],
        defaults: () => ({ origins: [], dirs: ['to'], main: 'weekday@09', extra: '', maxDepth: 0 }),
        seeds: async () => city_route_1.MODE_PAIRS.map((p) => ({ place: p.to, origin: p.from, dir: 'to', via: 'modes' })),
    },
    {
        id: 'custom',
        title: 'Свій список',
        help: 'Місця, які ви напишете, — по одному в рядку, так, як написала б людина після «до Києва до …».',
        cities: learn_cities_1.LEARN_CITY_CODES,
        custom: true,
        defaults: (city) => ({ origins: DEFAULT_ORIGINS[city], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 0 }),
        seeds: async ({ options }) => String(options.places ?? '')
            .split('\n')
            .map((l) => l.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .map((place) => ({ place, via: 'custom' })),
    },
];
const PRESET_BY_ID = new Map(exports.CAMPAIGN_PRESETS.map((p) => [p.id, p]));
function toSlots(spec, label) {
    if (!String(spec ?? '').trim())
        return [];
    let parsed;
    try {
        parsed = (0, crawl_core_1.parseSlots)(spec);
    }
    catch (e) {
        throw new CampaignInputError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const out = parsed.map((s) => ({ dayType: s.dayType, hour: Number(s.time.slice(0, 2)) }));
    const unique = out.filter((s, i) => out.findIndex((o) => o.dayType === s.dayType && o.hour === s.hour) === i);
    if (unique.length > MAX_SLOTS)
        throw new CampaignInputError(`${label}: не більше ${MAX_SLOTS} годин`);
    return unique;
}
const slotSpec = (slots) => slots.map((s) => `${s.dayType}@${String(s.hour).padStart(2, '0')}`).join(',');
/** План кампанії із заготовки й змін власника; кидає `CampaignInputError` */
async function buildPlan(prisma, input, ctx = {}) {
    const preset = PRESET_BY_ID.get(String(input.preset ?? ''));
    if (!preset)
        throw new CampaignInputError(`Невідома заготовка: ${input.preset}`);
    const city = input.city;
    if (!preset.cities.includes(city))
        throw new CampaignInputError(`Заготовка «${preset.title}» — лише для: ${preset.cities.map((c) => city_route_1.CITY_NAME[c]).join(', ')}`);
    const options = input.options ?? {};
    const d = preset.defaults(city);
    const origins = options.origins ?? d.origins;
    if (!Array.isArray(origins) || origins.some((o) => !crawl_core_1.ARRIVAL_POINTS[city].includes(o)))
        throw new CampaignInputError(`Точки висадки: ${crawl_core_1.ARRIVAL_POINTS[city].join(', ')}`);
    const dirs = options.dirs ?? d.dirs;
    if (!Array.isArray(dirs) || !dirs.length || dirs.some((x) => x !== 'to' && x !== 'from'))
        throw new CampaignInputError('Напрямок: to і / або from');
    const main = toSlots(options.main ?? d.main, 'Години');
    if (!main.length)
        throw new CampaignInputError('Потрібна хоч одна година');
    const extra = toSlots(options.extra ?? d.extra, 'Додаткові години').filter((s) => !main.some((m) => m.dayType === s.dayType && m.hour === s.hour));
    const maxDepth = options.maxDepth ?? d.maxDepth;
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > exports.MAX_DEPTH)
        throw new CampaignInputError(`Глибина: від 0 до ${exports.MAX_DEPTH}`);
    const seeds = await preset.seeds({ prisma, city, options, now: ctx.now ?? new Date(), freshDays: ctx.freshDays ?? 30 });
    if (!seeds.length)
        throw new CampaignInputError(preset.custom ? 'Напишіть хоч одне місце' : 'Для цієї заготовки зараз немає місць');
    const own = Boolean(preset.ownSlots);
    return {
        preset,
        plan: { city, origins: [...new Set(origins)], dirs: [...new Set(dirs)], main, extra: own ? [] : extra, maxDepth: own ? 0 : maxDepth, seeds, ...(own ? { ownSlots: true } : {}) },
    };
}
/** Години, які питаємо про місце рівня 0 */
const placeSlots = (plan, p) => (plan.ownSlots && p.slots?.length ? p.slots : plan.main);
exports.placeSlots = placeSlots;
/** Місця рівня 0: кожне місце без своєї точки — на кожну точку й напрямок; повтори відкидаємо */
function expandSeeds(plan) {
    const out = [];
    const seen = new Set();
    const add = (origin, dir, place, via, slots) => {
        const placeKey = (0, crawl_core_1.normalizeKey)(place);
        if (!placeKey || placeKey === (0, crawl_core_1.normalizeKey)(origin))
            return;
        const k = `${origin}|${dir}|${placeKey}`;
        if (seen.has(k))
            return;
        seen.add(k);
        out.push({ origin, dir, place, placeKey, via, ...(slots?.length ? { slots } : {}) });
    };
    for (const s of plan.seeds) {
        if (s.origin)
            add(s.origin, s.dir ?? 'to', s.place, s.via, s.slots);
        else
            for (const origin of plan.origins)
                for (const dir of plan.dirs)
                    add(origin, dir, s.place, s.via, s.slots);
    }
    return out;
}
/** Питання до сервера: від точки до місця (`to`) чи від місця до точки (`from`) — на найближчий день цього типу */
function campaignQuery(city, p, slot, now) {
    const at = (0, city_route_1.nextSlot)(now, slot.dayType, slot.hour);
    const [from, to] = p.dir === 'from' ? [p.place, p.origin] : [p.origin, p.place];
    return { city, from, to, date: at.date, time: at.time, departAt: at.utc };
}
/** Частка питань, на які є дорога (крок обходу 2026-11-18: ~80 %), і нових місць на одну відповідь — від і до */
const OK_RATE = 0.8;
const GROWTH_LOW = 0.2;
const GROWTH_HIGH = 1.2;
/** Скільки запитів до Google коштуватиме план: рівень 0 — точно (що вже є в базі), глибші — оцінкою від і до */
function estimateCost(plan, level0) {
    const answered = (level0.google + level0.free) * OK_RATE;
    const extraHigh = Math.ceil(answered * plan.extra.length);
    const perNewPlace = plan.main.length + OK_RATE * plan.extra.length;
    const deeper = (g) => {
        let total = 0;
        let wave = answered;
        for (let depth = 1; depth <= plan.maxDepth; depth++) {
            const places = wave * g;
            total += places * perNewPlace;
            wave = places * plan.main.length * OK_RATE;
        }
        return total;
    };
    const low = level0.google + Math.ceil(extraHigh * 0.5) + Math.ceil(deeper(GROWTH_LOW));
    const high = level0.google + extraHigh + Math.ceil(deeper(GROWTH_HIGH));
    return { low, high: Math.max(low, high) };
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LEARN_URL = (0, site_domains_1.siteUrl)(site_domains_1.PRIMARY_SITE, '/admin/dovede/learning');
const pct = (part, all) => (all ? Math.round((part / all) * 100) : 0);
/** Яку кампанію сервер веде зараз: найстаріша активна, що не чекає (або її очікування минуло) */
function leaderOf(activeById, at) {
    return activeById.find((c) => c.status === 'running' || !c.waitUntil || c.waitUntil.getTime() <= at.getTime()) ?? null;
}
function createCityCampaigns(deps) {
    const { prisma, cityRoutes } = deps;
    const now = deps.now ?? (() => new Date());
    const holder = deps.holder ?? `${(0, node_os_1.hostname)()}-${process.pid}-${(0, node_crypto_1.randomBytes)(3).toString('hex')}`;
    const log = deps.log ?? ((m) => console.log(m));
    const kyivDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    const nextMidnight = (at) => new Date((0, guard_1.kyivDayStart)(at).getTime() + 24 * 3600000 + 60000);
    async function sharePct() {
        return deps.settings ? deps.settings.int('learn.sharePct') : 50;
    }
    const planCtx = async () => ({ now: now(), freshDays: deps.settings ? await deps.settings.int('city.freshDays') : 30 });
    /** Оцінка без запису: рівень 0 — за базою (`peekMany`), глибше — від і до; пропонований бюджет і денна частка */
    async function preview(input) {
        const { preset, plan } = await buildPlan(prisma, input, await planCtx());
        const places = expandSeeds(plan);
        if (places.length > exports.MAX_SEED_PLACES)
            throw new CampaignInputError(`Забагато місць: ${places.length} (можна до ${exports.MAX_SEED_PLACES}) — менше точок чи напрямків`);
        const at = now();
        const qs = places.flatMap((p) => (0, exports.placeSlots)(plan, p).map((slot) => campaignQuery(plan.city, p, slot, at)));
        const peeks = await cityRoutes.peekMany(qs);
        const google = peeks.filter((p) => p === 'none').length;
        const free = peeks.filter((p) => p === 'fresh' || p === 'own').length;
        const { low, high } = estimateCost(plan, { places: places.length, google, free });
        const budgetNow = await cityRoutes.googleBudget();
        const reserve = (0, exports.reserveFor)(budgetNow.cap);
        const dailyDefault = Math.max(10, Math.floor(((budgetNow.cap - reserve) * (await sharePct())) / 100));
        const budget = Math.min(exports.MAX_BUDGET, Math.max(1, Math.ceil(high / 10) * 10));
        const dailyBudget = Math.min(budget, dailyDefault);
        return {
            title: titleOf(preset, plan.city),
            plan: planView(plan),
            estimate: {
                places: places.length,
                asks: qs.length,
                google,
                free,
                skipped: qs.length - google - free,
                extraSlots: plan.extra.length,
                maxDepth: plan.maxDepth,
                low,
                high,
                budget,
                dailyBudget,
                days: Math.max(1, Math.ceil(budget / Math.max(1, dailyBudget))),
                cap: budgetNow.cap,
                callsToday: budgetNow.calls,
                reserve,
            },
        };
    }
    const titleOf = (preset, city) => `${preset.title} — ${city_route_1.CITY_NAME[city]}`;
    /** Створити й запустити: бюджет — погоджене власником число запитів до Google */
    async function create(input) {
        const budget = Number(input.budget);
        const dailyBudget = Number(input.dailyBudget);
        if (!Number.isInteger(budget) || budget < 1 || budget > exports.MAX_BUDGET)
            throw new CampaignInputError(`Бюджет: ціле від 1 до ${exports.MAX_BUDGET} запитів до Google`);
        if (!Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > exports.MAX_DAILY_BUDGET)
            throw new CampaignInputError(`На добу: ціле від 1 до ${exports.MAX_DAILY_BUDGET}`);
        const { preset, plan } = await buildPlan(prisma, input, await planCtx());
        const places = expandSeeds(plan);
        if (places.length > exports.MAX_SEED_PLACES)
            throw new CampaignInputError(`Забагато місць: ${places.length} (можна до ${exports.MAX_SEED_PLACES})`);
        const at = now();
        const campaign = await prisma.dovedeCityCampaign.create({
            data: {
                cityCode: plan.city,
                preset: preset.id,
                title: titleOf(preset, plan.city),
                plan: plan,
                budget,
                dailyBudget: Math.min(dailyBudget, budget),
                status: 'running',
                places: places.length,
                startedAt: at,
                spentDay: kyivDay(at),
            },
        });
        await prisma.dovedeCityCampaignPlace.createMany({
            data: places.map((p) => ({ campaignId: campaign.id, cityCode: plan.city, origin: p.origin, dir: p.dir, place: p.place, placeKey: p.placeKey, depth: 0, via: p.via })),
            skipDuplicates: true,
        });
        const rows = await prisma.dovedeCityCampaignPlace.findMany({ where: { campaignId: campaign.id }, select: { id: true, origin: true, dir: true, placeKey: true }, orderBy: { id: 'asc' } });
        const planned = new Map(places.map((p) => [`${p.origin}|${p.dir}|${p.placeKey}`, p]));
        const queued = await prisma.dovedeCityCampaignAsk.createMany({
            data: rows.flatMap((r) => (0, exports.placeSlots)(plan, planned.get(`${r.origin}|${r.dir}|${r.placeKey}`) ?? {}).map((s) => ({ campaignId: campaign.id, placeId: r.id, dayType: s.dayType, hour: s.hour, phase: 0 }))),
            skipDuplicates: true,
        });
        log(`🎓 Доведе · кампанія #${campaign.id} «${campaign.title}»: місць ${places.length}, бюджет ${budget} (на добу ${campaign.dailyBudget})`);
        return view(campaign, queued.count);
    }
    /** Обхід далі від відповіді: нові місця на крок глибше (з основними годинами) і додаткові години для цього місця */
    async function expand(c, plan, place, phase, steps) {
        if (phase === 0 && plan.extra.length) {
            await prisma.dovedeCityCampaignAsk.createMany({
                data: plan.extra.map((s) => ({ campaignId: c.id, placeId: place.id, dayType: s.dayType, hour: s.hour, phase: 1 })),
                skipDuplicates: true,
            });
        }
        if (place.depth >= plan.maxDepth || c.places >= exports.MAX_PLACES)
            return { added: 0, filtered: [] };
        const dir = place.dir === 'from' ? 'from' : 'to';
        const opts = { dir, siteForm: (n) => (0, crawl_core_1.siteForm)(plan.city, n), exclude: [place.place, crawl_core_1.POINT_LABEL[place.origin] ?? place.origin] };
        const compact = (0, crawl_core_1.compactSteps)(steps);
        const filtered = (0, crawl_core_1.rejectedNames)(compact, opts);
        const found = (0, crawl_core_1.candidates)(compact, opts).slice(0, exports.MAX_PLACES - c.places);
        if (!found.length)
            return { added: 0, filtered };
        const depth = place.depth + 1;
        const made = await prisma.dovedeCityCampaignPlace.createMany({
            data: found.map((f) => ({ campaignId: c.id, cityCode: plan.city, origin: place.origin, dir, place: f.name, placeKey: (0, crawl_core_1.normalizeKey)(f.name), depth, via: f.via })),
            skipDuplicates: true,
        });
        if (!made.count)
            return { added: 0, filtered };
        const fresh = await prisma.dovedeCityCampaignPlace.findMany({
            where: { campaignId: c.id, origin: place.origin, dir, depth, placeKey: { in: found.map((f) => (0, crawl_core_1.normalizeKey)(f.name)) } },
            select: { id: true },
        });
        await prisma.dovedeCityCampaignAsk.createMany({
            data: fresh.flatMap((r) => plan.main.map((s) => ({ campaignId: c.id, placeId: r.id, dayType: s.dayType, hour: s.hour, phase: 0 }))),
            skipDuplicates: true,
        });
        return { added: made.count, filtered };
    }
    async function wait(c, reason, until, error) {
        // Google відмовив у доступі (ключ, API, білінг) — само не минеться: пишемо власнику один раз, до першої вдалої відповіді
        const alert = reason === 'denied' && c.alertedReason !== reason;
        const r = await prisma.dovedeCityCampaign.updateMany({
            where: { id: c.id, status: { in: ACTIVE } },
            data: { status: 'waiting', waitReason: reason, waitUntil: until, ...(error !== undefined ? { lastError: error } : {}), ...(alert ? { alertedReason: reason } : {}) },
        });
        if (alert && r.count && deps.notify) {
            const g = await cityRoutes.googleBudget().catch(() => null);
            const said = g?.lastError ? `\nGoogle (HTTP ${g.lastError.status}): «${esc(g.lastError.message)}»` : '';
            await deps
                .notify(`⛔ <b>Навчання «${esc(c.title)}» чекає</b>: Google відмовив у доступі — ключ, Routes API або білінг у Google Cloud.${said}\nПитання лишаються в черзі; продовжить сама, щойно Google відповідатиме.\n${LEARN_URL}`)
                .catch((e) => console.error('❌ кампанія: сповіщення не надіслано:', e instanceof Error ? e.message : e));
        }
    }
    async function finish(c, reason) {
        const [byDepth, noRoute] = await Promise.all([
            prisma.dovedeCityCampaignPlace.groupBy({ by: ['depth'], where: { campaignId: c.id }, _count: { _all: true } }),
            prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: c.id, status: 'no_route' }, select: { placeId: true }, take: 200 }),
        ]);
        const names = noRoute.length
            ? (await prisma.dovedeCityCampaignPlace.findMany({ where: { id: { in: [...new Set(noRoute.map((a) => a.placeId))] } }, select: { place: true } })).map((p) => p.place)
            : [];
        const counts = new Map();
        for (const a of await prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: c.id, status: 'ok' }, select: { filtered: true } })) {
            for (const name of Array.isArray(a.filtered) ? a.filtered : [])
                if (typeof name === 'string')
                    counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const plan = c.plan;
        const suspicious = deps.suspicious ? await deps.suspicious(plan.city).catch(() => null) : null;
        const report = {
            byDepth: byDepth.map((d) => ({ depth: d.depth, places: d._count._all })).sort((a, b) => a.depth - b.depth),
            noRoute: [...new Set(names)].slice(0, 50),
            noRoutePct: pct(c.noRoute, c.asked),
            filtered: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'uk')).slice(0, 30),
            suspicious,
        };
        const r = await prisma.dovedeCityCampaign.updateMany({
            where: { id: c.id, status: { in: ACTIVE } },
            data: { status: 'done', stopReason: reason, finishedAt: now(), waitUntil: null, waitReason: null, report: report },
        });
        log(`🎓 Доведе · кампанія #${c.id} завершена (${reason}): питань ${c.asked}, з відповіддю ${c.ok}, запитів до Google ${c.googleCalls}`);
        if (r.count && deps.notify) {
            const head = reason === 'budget' ? `💸 <b>Навчання «${esc(c.title)}»: бюджет вичерпано</b>` : `🎓 <b>Навчання «${esc(c.title)}» завершено</b>`;
            const lines = [
                head,
                `Питань ${c.asked}: з дорогою ${c.ok}${c.fromDb ? ` (з бази ${c.fromDb})` : ''}, без дороги ${c.noRoute} (${report.noRoutePct} %). Запитів до Google ${c.googleCalls} з ${c.budget}.`,
                reason === 'budget' ? 'У черзі ще є питання — у розділі «Навчання» можна додати бюджету.' : null,
                suspicious ? `Підозрілих доріг у місті: ${suspicious} — перевірте в розділі «Навчання» → «Якість».` : null,
                LEARN_URL,
            ];
            await deps.notify(lines.filter(Boolean).join('\n')).catch((e) => console.error('❌ кампанія: сповіщення не надіслано:', e instanceof Error ? e.message : e));
        }
    }
    /** Продовжити оренду (і перевірити, що кампанію не поставили на паузу посеред кроку) */
    async function renew(id) {
        const r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ACTIVE }, leaseHolder: holder }, data: { leaseUntil: new Date(now().getTime() + LEASE_MS) } });
        return r.count === 1;
    }
    /**
     * Крок фонової задачі: найстаріша активна кампанія, яку зараз можна вести, — до `ASKS_PER_TICK` питань.
     * Повертає, скільки питань поставлено (для журналу).
     */
    async function tick() {
        const at = now();
        const list = await prisma.dovedeCityCampaign.findMany({ where: { status: { in: ACTIVE }, archivedAt: null }, orderBy: { id: 'asc' } });
        const c0 = leaderOf(list, at);
        if (!c0)
            return { campaignId: null, asked: 0 };
        const claimed = await prisma.dovedeCityCampaign.updateMany({
            where: { id: c0.id, status: { in: ACTIVE }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: at } }, { leaseHolder: holder }] },
            data: { leaseHolder: holder, leaseUntil: new Date(at.getTime() + LEASE_MS), status: 'running', waitUntil: null, waitReason: null },
        });
        if (!claimed.count)
            return { campaignId: null, asked: 0 };
        let asked = 0;
        try {
            asked = await run(c0.id);
        }
        finally {
            await prisma.dovedeCityCampaign.updateMany({ where: { id: c0.id, leaseHolder: holder }, data: { leaseHolder: null, leaseUntil: null } });
        }
        return { campaignId: c0.id, asked };
    }
    async function run(id) {
        const started = now().getTime();
        // питання, яке контейнер узяв і зник (деплой посеред запиту), — назад у чергу
        await prisma.dovedeCityCampaignAsk.updateMany({ where: { campaignId: id, status: 'asking', claimedAt: { lt: new Date(started - STUCK_MS) } }, data: { status: 'queued' } });
        let done = 0;
        while (done < exports.ASKS_PER_TICK && now().getTime() - started < TICK_MS) {
            let c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
            if (!c || !ACTIVE.includes(c.status))
                break;
            const at = now();
            const day = kyivDay(at);
            if (c.spentDay !== day)
                c = await prisma.dovedeCityCampaign.update({ where: { id }, data: { spentDay: day, spentToday: 0 } });
            const plan = c.plan;
            if (c.googleCalls >= c.budget) {
                await finish(c, 'budget');
                break;
            }
            const g = await cityRoutes.googleBudget();
            if (!g.enabled || !g.hasKey) {
                await wait(c, 'disabled', new Date(at.getTime() + WAIT_MS));
                break;
            }
            if (g.blocked) {
                await wait(c, g.blocked === 'denied' ? 'denied' : 'quota', new Date(at.getTime() + WAIT_MS));
                break;
            }
            if (c.spentToday >= c.dailyBudget) {
                await wait(c, 'daily', nextMidnight(at));
                break;
            }
            if (g.calls >= g.cap - (0, exports.reserveFor)(g.cap)) {
                await wait(c, 'cap', new Date(Math.min(nextMidnight(at).getTime(), at.getTime() + WAIT_MS)));
                break;
            }
            const ask = await prisma.dovedeCityCampaignAsk.findFirst({ where: { campaignId: id, status: 'queued' }, orderBy: [{ phase: 'asc' }, { id: 'asc' }] });
            if (!ask) {
                const busy = await prisma.dovedeCityCampaignAsk.count({ where: { campaignId: id, status: 'asking' } });
                if (!busy)
                    await finish(c, 'finished');
                break;
            }
            const took = await prisma.dovedeCityCampaignAsk.updateMany({ where: { id: ask.id, status: 'queued' }, data: { status: 'asking', claimedAt: at, attempts: { increment: 1 } } });
            if (!took.count)
                continue;
            const place = await prisma.dovedeCityCampaignPlace.findUnique({ where: { id: ask.placeId } });
            if (!place) {
                await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: 'failed', error: 'місця немає', doneAt: at } });
                continue;
            }
            const { answer, googleCalled } = await cityRoutes.campaignAsk(campaignQuery(plan.city, place, { dayType: ask.dayType, hour: ask.hour }, at));
            const spent = googleCalled ? 1 : 0;
            const counters = { googleCalls: { increment: spent }, spentToday: { increment: spent } };
            if (answer.ok) {
                const { added, filtered } = await expand(c, plan, place, ask.phase, answer.steps);
                await prisma.dovedeCityCampaignAsk.update({
                    where: { id: ask.id },
                    data: { status: 'ok', source: answer.source, minutes: answer.minutes, steps: (0, crawl_core_1.compactSteps)(answer.steps), googleCalled, added, doneAt: now(), error: null, ...(filtered.length ? { filtered } : {}) },
                });
                await prisma.dovedeCityCampaign.update({
                    where: { id },
                    data: { ...counters, asked: { increment: 1 }, ok: { increment: 1 }, fromDb: { increment: googleCalled ? 0 : 1 }, places: { increment: added }, errorsInRow: 0, ...(googleCalled ? { alertedReason: null } : {}) },
                });
            }
            else if (answer.reason === 'no_route' || answer.reason === 'archived') {
                await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: answer.reason, googleCalled, doneAt: now() } });
                await prisma.dovedeCityCampaign.update({
                    where: { id },
                    data: { ...counters, asked: { increment: 1 }, ...(answer.reason === 'no_route' ? { noRoute: { increment: 1 } } : {}), errorsInRow: 0, ...(googleCalled ? { alertedReason: null } : {}) },
                });
            }
            else if (answer.reason === 'error') {
                const last = ask.attempts + 1 >= MAX_ATTEMPTS;
                await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: last ? 'failed' : 'queued', googleCalled, error: 'Google не відповів', ...(last ? { doneAt: now() } : {}) } });
                c = await prisma.dovedeCityCampaign.update({
                    where: { id },
                    data: { ...counters, ...(last ? { asked: { increment: 1 }, failed: { increment: 1 } } : {}), errorsInRow: { increment: 1 }, lastError: 'Google не відповів' },
                });
                done++;
                if (c.errorsInRow >= ERRORS_IN_ROW) {
                    await wait(c, 'errors', new Date(now().getTime() + ERROR_WAIT_MS));
                    break;
                }
                if (!(await renew(id)))
                    break;
                continue;
            }
            else {
                // ліміт, квота, відмова, вимкнено — не вина питання: назад у чергу, кампанія чекає
                await prisma.dovedeCityCampaignAsk.update({ where: { id: ask.id }, data: { status: 'queued', attempts: { decrement: 1 } } });
                if (spent)
                    await prisma.dovedeCityCampaign.update({ where: { id }, data: counters });
                // «cap» від сервера — і наш ліміт, і квота Google (429): після 429 сервер ставить паузу
                const blockedAfter = answer.reason === 'cap' ? (await cityRoutes.googleBudget()).blocked : null;
                const reason = answer.reason === 'cap' ? (blockedAfter ? 'quota' : 'cap') : answer.reason === 'denied' ? 'denied' : 'disabled';
                await wait(c, reason, new Date(now().getTime() + WAIT_MS));
                break;
            }
            done++;
            if (!(await renew(id)))
                break;
        }
        return done;
    }
    /**
     * Черга: сервер веде одну кампанію за раз — найстарішу, яку зараз можна вести (`leaderOf`, той самий вибір, що в
     * `tick`). Решта зі станом «running» стоять за нею — адмінка показує «У черзі після …», а не «Іде».
     */
    async function queue() {
        const active = await prisma.dovedeCityCampaign.findMany({ where: { status: { in: ACTIVE }, archivedAt: null }, orderBy: { id: 'asc' }, select: { id: true, title: true, status: true, waitUntil: true } });
        const l = leaderOf(active, now());
        return { leader: l ? { id: l.id, title: l.title } : null };
    }
    const behind = (c, leader) => (c.status === 'running' && leader && leader.id !== c.id ? leader : null);
    /** Список для адмінки: кампанії (без схованих), новіші вгорі, і стан денного обліку Google */
    async function list() {
        const [rows, { leader }] = await Promise.all([prisma.dovedeCityCampaign.findMany({ where: { archivedAt: null }, orderBy: { id: 'desc' }, take: 50 }), queue()]);
        const queued = rows.length
            ? await prisma.dovedeCityCampaignAsk.groupBy({ by: ['campaignId'], where: { campaignId: { in: rows.map((r) => r.id) }, status: { in: ['queued', 'asking'] } }, _count: { _all: true } })
            : [];
        const left = new Map(queued.map((q) => [q.campaignId, q._count._all]));
        const g = await cityRoutes.googleBudget();
        return { campaigns: rows.map((r) => view(r, left.get(r.id) ?? 0, behind(r, leader))), google: { calls: g.calls, cap: g.cap, reserve: (0, exports.reserveFor)(g.cap) } };
    }
    /** Одна кампанія: стан, питання за станами, місця за глибиною, останні відповіді */
    async function get(id) {
        const c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
        if (!c)
            return null;
        const [byStatus, byDepth, recent] = await Promise.all([
            prisma.dovedeCityCampaignAsk.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }),
            prisma.dovedeCityCampaignPlace.groupBy({ by: ['depth'], where: { campaignId: id }, _count: { _all: true } }),
            prisma.dovedeCityCampaignAsk.findMany({ where: { campaignId: id, doneAt: { not: null } }, orderBy: { doneAt: 'desc' }, take: 30 }),
        ]);
        const places = recent.length ? await prisma.dovedeCityCampaignPlace.findMany({ where: { id: { in: recent.map((a) => a.placeId) } } }) : [];
        const placeById = new Map(places.map((p) => [p.id, p]));
        const count = (s) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
        const { leader } = await queue();
        return {
            ...view(c, count('queued') + count('asking'), behind(c, leader)),
            asks: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
            byDepth: byDepth.map((d) => ({ depth: d.depth, places: d._count._all })).sort((a, b) => a.depth - b.depth),
            recent: recent.map((a) => {
                const p = placeById.get(a.placeId);
                return {
                    place: p?.place ?? '',
                    origin: p ? crawl_core_1.POINT_LABEL[p.origin] ?? p.origin : '',
                    dir: p?.dir ?? 'to',
                    depth: p?.depth ?? 0,
                    slot: `${a.dayType}@${String(a.hour).padStart(2, '0')}`,
                    status: a.status,
                    source: a.source,
                    minutes: a.minutes,
                    google: a.googleCalled,
                    added: a.added,
                    at: a.doneAt?.toISOString() ?? null,
                };
            }),
        };
    }
    /** Керування з адмінки; null — такої кампанії немає, рядок — дія зараз неможлива (чому) */
    async function action(id, act, body = {}) {
        const c = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
        if (!c)
            return null;
        const at = now();
        let r = { count: 0 };
        if (act === 'pause') {
            r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status: 'paused', waitUntil: null, waitReason: null } });
            if (!r.count)
                return 'Кампанія не йде';
        }
        else if (act === 'resume') {
            r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ['paused', 'waiting', 'blocked'] } }, data: { status: 'running', waitUntil: null, waitReason: null, errorsInRow: 0 } });
            if (!r.count)
                return 'Відновити можна лише кампанію на паузі чи в очікуванні';
        }
        else if (act === 'cancel') {
            r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { notIn: ['done', 'cancelled'] } }, data: { status: 'cancelled', stopReason: 'cancelled', finishedAt: at, waitUntil: null, waitReason: null } });
            if (!r.count)
                return 'Кампанію вже завершено';
        }
        else if (act === 'extend') {
            const budget = body.budget === undefined ? c.budget : Number(body.budget);
            const daily = body.dailyBudget === undefined ? c.dailyBudget : Number(body.dailyBudget);
            if (!Number.isInteger(budget) || budget <= c.googleCalls || budget > exports.MAX_BUDGET)
                return `Бюджет: більше ніж уже витрачено (${c.googleCalls}) і до ${exports.MAX_BUDGET}`;
            if (!Number.isInteger(daily) || daily < 1 || daily > exports.MAX_DAILY_BUDGET)
                return `На добу: ціле від 1 до ${exports.MAX_DAILY_BUDGET}`;
            if (c.status === 'cancelled')
                return 'Кампанію скасовано';
            const reopen = c.status === 'done' && c.stopReason === 'budget';
            if (c.status === 'done' && !reopen)
                return 'Кампанію завершено: місць більше немає';
            const newDaily = Math.min(daily, budget);
            // Чекала саме на завтра через денну частку, а її підняли понад уже витрачене сьогодні — іде далі одразу.
            // Очікування з іншої причини (квота Google, ліміт дня, помилки) не чіпаємо: частка його не знімає
            const spentToday = c.spentDay === kyivDay(at) ? c.spentToday : 0;
            const goOn = c.status === 'waiting' && c.waitReason === 'daily' && newDaily > spentToday;
            r = await prisma.dovedeCityCampaign.updateMany({
                where: { id, updatedAt: c.updatedAt },
                data: {
                    budget,
                    dailyBudget: newDaily,
                    ...(reopen ? { status: 'running', stopReason: null, finishedAt: null } : {}),
                    ...(goOn ? { status: 'running', waitUntil: null, waitReason: null } : {}),
                },
            });
            if (!r.count)
                return 'Кампанію щойно змінено — оновіть сторінку';
        }
        else if (act === 'archive') {
            r = await prisma.dovedeCityCampaign.updateMany({ where: { id, status: { in: ['done', 'cancelled'] }, archivedAt: null }, data: { archivedAt: at } });
            if (!r.count)
                return 'Сховати можна лише завершену чи скасовану кампанію';
        }
        else {
            return 'Невідома дія';
        }
        const fresh = await prisma.dovedeCityCampaign.findUnique({ where: { id } });
        const left = await prisma.dovedeCityCampaignAsk.count({ where: { campaignId: id, status: { in: ['queued', 'asking'] } } });
        const { leader } = await queue();
        return fresh ? view(fresh, left, behind(fresh, leader)) : null;
    }
    function view(c, left = 0, queuedBehind = null) {
        const plan = c.plan;
        return {
            id: c.id,
            city: c.cityCode,
            preset: c.preset,
            title: c.title,
            status: c.status,
            waitReason: c.waitReason,
            waitUntil: c.waitUntil?.toISOString() ?? null,
            stopReason: c.stopReason,
            budget: c.budget,
            dailyBudget: c.dailyBudget,
            googleCalls: c.googleCalls,
            spentToday: c.spentDay === kyivDay(now()) ? c.spentToday : 0,
            asked: c.asked,
            ok: c.ok,
            fromDb: c.fromDb,
            noRoute: c.noRoute,
            failed: c.failed,
            places: c.places,
            left,
            queuedBehind,
            lastError: c.lastError,
            plan: planView(plan),
            report: c.report ?? null,
            createdAt: c.createdAt.toISOString(),
            startedAt: c.startedAt?.toISOString() ?? null,
            finishedAt: c.finishedAt?.toISOString() ?? null,
        };
    }
    function presets() {
        return exports.CAMPAIGN_PRESETS.map((p) => ({
            id: p.id,
            title: p.title,
            help: p.help,
            custom: Boolean(p.custom),
            ownSlots: Boolean(p.ownSlots),
            cities: p.cities.map((city) => {
                const d = p.defaults(city);
                return { city, name: city_route_1.CITY_NAME[city], origins: d.origins, dirs: d.dirs, main: d.main, extra: d.extra, maxDepth: d.maxDepth, points: crawl_core_1.ARRIVAL_POINTS[city].map((id) => ({ id, label: crawl_core_1.POINT_LABEL[id] ?? id })) };
            }),
        }));
    }
    return { presets, preview, create, list, get, action, tick, holder };
}
function planView(plan) {
    return {
        city: plan.city,
        origins: plan.origins.map((id) => ({ id, label: crawl_core_1.POINT_LABEL[id] ?? id })),
        dirs: plan.dirs,
        main: slotSpec(plan.main),
        extra: slotSpec(plan.extra),
        maxDepth: plan.maxDepth,
        seeds: plan.seeds.length,
        ownSlots: Boolean(plan.ownSlots),
    };
}
