"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEED_PAIRS = exports.MODE_PAIRS = exports.CITY_NAME = exports.isValidDailyCap = exports.CITY_DAILY_CAP_MAX = exports.CITY_DAILY_CAP_MIN = exports.DEFAULT_CITY_DAILY_CAP = exports.isValidFreshDays = exports.QUOTA_BACKOFF_MS = exports.REFRESH_RETRY_DAYS = exports.refreshLeadDays = exports.CITY_FRESH_DAYS_MAX = exports.CITY_FRESH_DAYS_MIN = exports.CITY_FRESH_DAYS = exports.normalizeKey = exports.dayTypeOf = void 0;
exports.resolveCityPoint = resolveCityPoint;
exports.storedPoint = storedPoint;
exports.nextSlot = nextSlot;
exports.parseGoogleRoute = parseGoogleRoute;
exports.cityRoutesEnabled = cityRoutesEnabled;
exports.cityStoreEnabled = cityStoreEnabled;
exports.cityRefreshEnabled = cityRefreshEnabled;
exports.cityDailyCap = cityDailyCap;
exports.createCityRoutes = createCityRoutes;
exports.nextWeekdayMorning = nextWeekdayMorning;
exports.cityRoutesFromEnv = cityRoutesFromEnv;
// ключ пари й тип дня — спільні з обходом (`crawl-core.ts`): журнал обходу й база рахують їх однаково
const crawl_core_1 = require("./crawl-core");
Object.defineProperty(exports, "dayTypeOf", { enumerable: true, get: function () { return crawl_core_1.dayTypeOf; } });
Object.defineProperty(exports, "normalizeKey", { enumerable: true, get: function () { return crawl_core_1.normalizeKey; } });
const kyivMetroData_1 = require("./kyivMetroData");
const guard_1 = require("./guard");
const viber_listing_expiry_1 = require("../viber-listing-expiry");
/** Скільки днів збережена відповідь свіжа, поки власник не задав свого в адмінці */
exports.CITY_FRESH_DAYS = 30;
exports.CITY_FRESH_DAYS_MIN = 1;
exports.CITY_FRESH_DAYS_MAX = 365;
/** Налаштування з бази тримаємо в памʼяті хвилину: читати їх на кожен запит людини зайве */
const SETTINGS_TTL_MS = 60000;
/** За скільки днів до кінця строку свіжості навчання оновлює відповідь, щоб людина не натрапила на застарілу */
const refreshLeadDays = (freshDays) => Math.min(2, Math.floor(freshDays / 4));
exports.refreshLeadDays = refreshLeadDays;
/**
 * Пару чи рядок, де Google дороги не знайшов, навчання не чіпає стільки днів — щоб не палити ліміт щогодини на те
 * саме. Лише «дороги немає»: збій Google чи вичерпана квота — не вина пари, позначок не ставимо, крок навчання спиняємо.
 */
exports.REFRESH_RETRY_DAYS = 7;
/**
 * Google відмовив усім одразу — 429 (квоту проєкту в Google Cloud вичерпано) або 401 / 403 (ключ, вимкнений API,
 * білінг): стільки часу не питаємо зовсім і відповідаємо «ліміт» / «відмовлено».
 */
exports.QUOTA_BACKOFF_MS = 10 * 60000;
const isValidFreshDays = (v) => typeof v === 'number' && Number.isInteger(v) && v >= exports.CITY_FRESH_DAYS_MIN && v <= exports.CITY_FRESH_DAYS_MAX;
exports.isValidFreshDays = isValidFreshDays;
exports.DEFAULT_CITY_DAILY_CAP = 150;
/** Межі денного ліміту з адмінки: 0 — Google не питати зовсім; угорі — квота проєкту в Google Cloud (5000 на день) */
exports.CITY_DAILY_CAP_MIN = 0;
exports.CITY_DAILY_CAP_MAX = 5000;
const isValidDailyCap = (v) => typeof v === 'number' && Number.isInteger(v) && v >= exports.CITY_DAILY_CAP_MIN && v <= exports.CITY_DAILY_CAP_MAX;
exports.isValidDailyCap = isValidDailyCap;
const TIMEOUT_MS = 4000;
const zhytomyr_own_1 = require("./zhytomyr-own");
const settings_1 = require("./settings");
const zhytomyr_own_data_1 = require("./zhytomyr-own-data");
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
    'routes.duration',
    'routes.legs.steps.travelMode',
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.transitDetails.stopCount',
    'routes.legs.steps.transitDetails.headway',
    'routes.legs.steps.transitDetails.headsign',
    'routes.legs.steps.transitDetails.stopDetails.departureStop',
    'routes.legs.steps.transitDetails.stopDetails.arrivalStop',
    'routes.legs.steps.transitDetails.transitLine.name',
    'routes.legs.steps.transitDetails.transitLine.nameShort',
    'routes.legs.steps.transitDetails.transitLine.color',
    'routes.legs.steps.transitDetails.transitLine.vehicle.type',
    'routes.legs.steps.transitDetails.transitLine.agencies.name',
].join(',');
exports.CITY_NAME = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
const DAY_TYPES = ['weekday', 'saturday', 'sunday'];
/** Точки, які «Доведе» знає за id: куди привозять міжміські рейси */
const KNOWN_POINTS = {
    'zhytomyr.avtovokzal': { label: 'автовокзал Житомир-1', address: 'Автовокзал Житомир-1, вул. Київська 93, Житомир, Україна', city: 'Zhytomyr' },
    'kyiv.pas': { label: 'вокзал Київ-Пасажирський', address: 'Приміський вокзал, Київ, Україна', city: 'Kyiv' },
    'kyiv.borshch': { label: 'платформа «Борщагівка»', address: 'зупинний пункт Борщагівка, Київ, Україна', city: 'Kyiv' },
};
/** Точка за id (автовокзал, станція метро) або словами людини («Польова 12», «Охматдит»); null — порожньо чи сміття */
function resolveCityPoint(city, raw) {
    const value = raw.trim();
    if (!value || value.length > 120)
        return null;
    const known = KNOWN_POINTS[value];
    if (known)
        return known.city === city ? { key: value, label: known.label, address: known.address } : null;
    const metro = kyivMetroData_1.METRO_STATIONS.find((s) => s.id === value);
    if (metro)
        return city === 'Kyiv' ? { key: value, label: `метро «${metro.name}»`, address: `станція метро ${metro.name}, Київ, Україна` } : null;
    // id якогось іншого словника сюди не має потрапляти
    if (/^[a-z]+\.[a-z0-9.:-]+$/i.test(value) || /^st_\d+$/.test(value))
        return null;
    const key = (0, crawl_core_1.normalizeKey)(value);
    if (key.length < 2)
        return null;
    return { key, label: value.replace(/\s+/g, ' '), address: `${value}, ${exports.CITY_NAME[city]}, Україна` };
}
/** id точки, яку «Доведе» знає сам (місце висадки, станція метро), — на відміну від слів людини */
const isKnownPointId = (value) => Boolean(KNOWN_POINTS[value]) || kyivMetroData_1.METRO_STATIONS.some((s) => s.id === value);
/** Що питати для збереженої пари: id лишається id, слова — як їх написала людина (підпис), а не ключ малими літерами */
function storedPoint(key, label) {
    return isKnownPointId(key) || (0, crawl_core_1.normalizeKey)(label) !== key ? key : label;
}
/** Найближча (не раніше ніж завтра за Києвом) дата потрібного типу дня й година — коли оновлювати збережену відповідь */
function nextSlot(now, dayType, hour) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const [y, m, d] = today.split('-').map(Number);
    for (let i = 1; i <= 7; i++) {
        const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
        if ((0, crawl_core_1.dayTypeOf)(date) !== dayType)
            continue;
        const [yy, mm, dd] = date.split('-').map(Number);
        return { date, time: `${String(hour).padStart(2, '0')}:00`, utc: (0, viber_listing_expiry_1.kyivWallToUtc)(yy, mm - 1, dd, hour, 0) };
    }
    throw new Error(`Невідомий тип дня: ${dayType}`);
}
const seconds = (v) => Number(String(v ?? '').replace(/s$/, '')) || 0;
/** Відповідь Google → наші кроки: сусідні піші відрізки зливаються, дрібні (< 1 хв і < 60 м) відкидаються */
function parseGoogleRoute(body) {
    const route = body?.routes?.[0];
    const raw = route?.legs?.flatMap((l) => l.steps ?? []) ?? [];
    if (!route || !raw.length)
        return null;
    const steps = [];
    const stops = [];
    for (const s of raw) {
        const t = s.transitDetails;
        if (t) {
            const dep = t.stopDetails?.departureStop;
            const arr = t.stopDetails?.arrivalStop;
            for (const st of [dep, arr]) {
                if (st?.name)
                    stops.push({ name: st.name.trim(), lat: st.location?.latLng?.latitude ?? null, lng: st.location?.latLng?.longitude ?? null });
            }
            const headway = seconds(t.headway);
            steps.push({
                kind: 'transit',
                minutes: Math.max(1, Math.round(seconds(s.staticDuration) / 60)),
                mode: t.transitLine?.vehicle?.type ?? 'BUS',
                line: (t.transitLine?.nameShort ?? t.transitLine?.name ?? '').trim(),
                agency: t.transitLine?.agencies?.[0]?.name?.trim() || undefined,
                color: t.transitLine?.color || undefined,
                headsign: t.headsign?.trim() || undefined,
                fromStop: dep?.name?.trim(),
                toStop: arr?.name?.trim(),
                stops: t.stopCount,
                ...(headway ? { headwayMin: Math.round(headway / 60) } : {}),
            });
            continue;
        }
        const secs = seconds(s.staticDuration);
        const meters = s.distanceMeters ?? 0;
        const last = steps[steps.length - 1];
        if (last?.kind === 'walk') {
            last.minutes += secs / 60;
            last.meters = (last.meters ?? 0) + meters;
        }
        else {
            steps.push({ kind: 'walk', minutes: secs / 60, meters });
        }
    }
    const cleaned = steps
        .map((s) => (s.kind === 'walk' ? { ...s, minutes: Math.round(s.minutes), meters: Math.round((s.meters ?? 0) / 10) * 10 } : s))
        .filter((s) => s.kind === 'transit' || s.minutes >= 1 || (s.meters ?? 0) >= 60);
    if (!cleaned.length)
        return null;
    const total = seconds(route.duration);
    const minutes = total ? Math.round(total / 60) : cleaned.reduce((n, s) => n + s.minutes, 0);
    // межі здорового глузду для дороги в межах одного міста
    if (minutes < 1 || minutes > 240)
        return null;
    return { steps: cleaned, minutes, stops };
}
function cityRoutesEnabled(env = process.env) {
    return (env.DOVEDE_CITY_ROUTES ?? 'google').trim().toLowerCase() !== 'off';
}
function cityStoreEnabled(env = process.env) {
    return (env.DOVEDE_CITY_STORE ?? '1').trim() !== '0';
}
function cityRefreshEnabled(env = process.env) {
    return (env.DOVEDE_CITY_REFRESH ?? '1').trim() !== '0';
}
function cityDailyCap(env = process.env) {
    const raw = (env.DOVEDE_CITY_DAILY_CAP ?? '').trim();
    if (!raw)
        return exports.DEFAULT_CITY_DAILY_CAP;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : exports.DEFAULT_CITY_DAILY_CAP;
}
/**
 * Пари, у відповідях на які є кожен вид транспорту Києва (2026-11-18): фунікулер угору й униз, трамвай №12, трамвай
 * Подолом після метро, швидкісний трамвай, тролейбус, автобус, кільцева, маршрутка + автобус, автобус + приміська.
 * Навчання тримає їх свіжими — так у базі завжди є справжня відповідь для картки кожного виду. Той самий перелік —
 * `ask` у frontend/src/pages/DovedePage/compose/fixtures/kyiv-city-modes.json (тест звіряє обидва).
 */
exports.MODE_PAIRS = [
    { city: 'Kyiv', from: 'kyiv.m.poshtova', to: 'Михайлівська площа' },
    { city: 'Kyiv', from: 'Михайлівська площа', to: 'Контрактова площа' },
    { city: 'Kyiv', from: 'kyiv.m.kontraktova', to: 'Пуща-Водиця' },
    { city: 'Kyiv', from: 'kyiv.sviatoshyn', to: 'Інститут нейрохірургії' },
    { city: 'Kyiv', from: 'Інститут Шалімова', to: 'kyiv.pas' },
    { city: 'Kyiv', from: 'kyiv.pas', to: 'Національний військово-медичний клінічний центр' },
    { city: 'Kyiv', from: 'kyiv.m.kontraktova', to: 'вулиця Глибочицька 40' },
    { city: 'Kyiv', from: 'kyiv.pas', to: 'вулиця Сім’ї Сосніних 9' },
    { city: 'Kyiv', from: 'Платформа Куренівка', to: 'Платформа Русанівка' },
    { city: 'Kyiv', from: 'Райдужний масив, вулиця Каштанова', to: 'Київ-Деміївський вокзал' },
];
/** Пари, з яких навчання починає, поки людей ще не питали (2026-11-17): куди найчастіше їдуть від місця висадки */
exports.SEED_PAIRS = [
    { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Залізничний вокзал' },
    { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'майдан Соборний' },
    { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Обласна клінічна лікарня' },
    { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Житній ринок' },
    { city: 'Kyiv', from: 'kyiv.akadem', to: 'Охматдит' },
    { city: 'Kyiv', from: 'kyiv.akadem', to: 'Центральний автовокзал' },
    // Житомир: від автовокзалу до кінцевих усіх маршрутів міста — щоб база наповнювалась сама, не чекаючи питань
    ...[...new Set(zhytomyr_own_data_1.ZT_OWN.dirs.map((d) => d.stops[d.stops.length - 1][0]))].sort().map((to) => ({ city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to })),
    // Київ: по парі на кожен вид транспорту — щоб картки мали свіжу справжню відповідь
    ...exports.MODE_PAIRS,
];
function createCityRoutes(deps) {
    const { prisma } = deps;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? (() => new Date());
    const settingsStore = deps.settings ?? (0, settings_1.createDovedeSettings)({ prisma, now });
    // Вмикачі й числа — з налаштувань адмінки (там же головний вимикач зі змінної середовища); у тестах — заглушки
    const enabled = async () => (deps.enabled ? deps.enabled() : settingsStore.bool('city.enabled'));
    const store = deps.store ?? (() => cityStoreEnabled());
    const ownRoute = deps.ownRoute ?? zhytomyr_own_1.ownZhytomyrRoute;
    // Власні дані Житомира: маршрути й зупинки із сайту власника, хвилини виправлено за Google
    const ownEnabled = async () => (deps.ownEnabled ? deps.ownEnabled() : settingsStore.bool('city.own'));
    // Лічильник і пауза — у базі (`DovedeCityGoogleDay`), спільні для всіх контейнерів. Памʼять — лише запас, коли база
    // не відповідає: тоді рахуємо в цьому процесі, як раніше
    let memoDay = '';
    let memoCalls = 0;
    let blockedUntil = 0;
    let blockedReason = 'cap';
    /**
     * Остання відмова Google з її текстом (для адмінки й журналу): у ньому названо квоту («…requests per day») або
     * причину відмови в доступі — за ним видно, що лагодити в Google Cloud. Ключа в тексті Google не повторює.
     */
    let googleError = null;
    const refresh = async () => (deps.refresh ? deps.refresh() : settingsStore.bool('learn.refresh'));
    // стартові пари, які Google не знайшов: рядка в базі для позначки в них немає, тож памʼятаємо тут (до перезапуску)
    const seedFailed = new Map();
    /** Строк свіжості збереженої відповіді, днів: з адмінки, інакше типовий (30) */
    async function freshDays() {
        return settingsStore.int('city.freshDays');
    }
    /** Ліміт без адмінки: заглушка тесту або змінна `DOVEDE_CITY_DAILY_CAP`, інакше 150 */
    async function defaultCap() {
        return deps.dailyCap ? deps.dailyCap() : (await settingsStore.view('city.dailyCap')).default;
    }
    /** Денний ліміт запитів до Google: з адмінки, інакше змінна середовища (`DOVEDE_CITY_DAILY_CAP`), інакше 150 */
    async function capNow() {
        const v = await settingsStore.view('city.dailyCap');
        return v.stored ?? (await defaultCap());
    }
    /** Скільки з денного ліміту може взяти фонове навчання (типово половину) */
    async function learnCap() {
        return Math.floor(((await capNow()) * (await settingsStore.int('learn.sharePct'))) / 100);
    }
    const retryMs = async () => (await settingsStore.int('learn.retryDays')) * 24 * 3600000;
    const backoffMs = async () => (await settingsStore.int('google.backoffMin')) * 60000;
    async function setFreshDays(days) {
        if (!(0, exports.isValidFreshDays)(days))
            throw new RangeError(`freshDays: ціле від ${exports.CITY_FRESH_DAYS_MIN} до ${exports.CITY_FRESH_DAYS_MAX}`);
        await settingsStore.set('city.freshDays', days);
        return days;
    }
    /** null — повернути ліміт зі змінної середовища */
    async function setDailyCap(cap) {
        if (cap !== null && !(0, exports.isValidDailyCap)(cap))
            throw new RangeError(`dailyCap: ціле від ${exports.CITY_DAILY_CAP_MIN} до ${exports.CITY_DAILY_CAP_MAX} або null`);
        await settingsStore.set('city.dailyCap', cap);
        return capNow();
    }
    // Місця в архіві («місто|ключ»): власник прибрав їх із відповідей. Памʼять на хвилину; архів і повернення скидають її
    let archivedMemo = null;
    async function archivedPlaces() {
        const at = now().getTime();
        if (archivedMemo && at - archivedMemo.at >= 0 && at - archivedMemo.at < SETTINGS_TTL_MS)
            return archivedMemo.keys;
        try {
            const rows = await prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } }, select: { cityCode: true, key: true } });
            archivedMemo = { at, keys: new Set(rows.map((r) => `${r.cityCode}|${r.key}`)) };
            return archivedMemo.keys;
        }
        catch (e) {
            console.error('❌ city-route: архів місць не прочитано, беру попередній:', e instanceof Error ? e.message : e);
            return archivedMemo?.keys ?? new Set();
        }
    }
    const freshSince = async () => new Date(now().getTime() - (await freshDays()) * 24 * 3600000);
    /** Київська дата 'YYYY-MM-DD' — ключ рядка обліку */
    const kyivDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    async function dayRow() {
        return prisma.dovedeCityGoogleDay.findUnique({ where: { day: kyivDay(now()) } }).catch((e) => {
            console.error('❌ city-route: облік Google не прочитано:', e instanceof Error ? e.message : e);
            return null;
        });
    }
    /**
     * Запитів до Google сьогодні: облік у базі; не менше за кількість сьогоднішніх записаних відповідей (у день
     * переходу на облік рядок порожній, а відповіді вже є) і за лічильник цього процесу (якщо база не відповідала).
     */
    async function callsToday() {
        const today = (0, guard_1.kyivDayStart)(now());
        const key = today.toISOString();
        if (key !== memoDay) {
            memoDay = key;
            memoCalls = 0;
        }
        const [row, stored] = await Promise.all([dayRow(), prisma.dovedeCityRoute.count({ where: { source: 'google', fetchedAt: { gte: today } } }).catch(() => 0)]);
        return Math.max(row?.calls ?? 0, stored, memoCalls);
    }
    /** Записати запит у облік до виклику; `undo` — Google відмовив усім (429 / 401 / 403), запит не рахується */
    async function countCall(purpose, delta) {
        const day = kyivDay(now());
        try {
            const row = await prisma.dovedeCityGoogleDay.upsert({
                where: { day },
                create: { day, calls: Math.max(0, delta), [purpose]: Math.max(0, delta) },
                update: { calls: { increment: delta }, [purpose]: { increment: delta } },
            });
            return row.calls;
        }
        catch (e) {
            console.error('❌ city-route: облік Google не записано:', e instanceof Error ? e.message : e);
            memoCalls += delta;
            return null;
        }
    }
    /** Людині не дали дорогу через ліміт чи квоту — видно в адмінці («людям відмовили») */
    async function noteRefused() {
        const day = kyivDay(now());
        await prisma.dovedeCityGoogleDay
            .upsert({ where: { day }, create: { day, refused: 1 }, update: { refused: { increment: 1 } } })
            .catch((e) => console.error('❌ city-route: облік відмов:', e instanceof Error ? e.message : e));
    }
    /** Відмова Google: текст (і пауза для 429 / 401 / 403) — у базу, щоб бачили всі контейнери й адмінка після перезапуску */
    async function noteGoogleError(status, message, block) {
        const at = now();
        const day = kyivDay(at);
        const data = {
            lastErrorStatus: status,
            lastErrorMessage: message || null,
            lastErrorAt: at,
            ...(block ? { blockedUntil: new Date(at.getTime() + (await backoffMs())), blockedReason: block } : {}),
        };
        await prisma.dovedeCityGoogleDay.upsert({ where: { day }, create: { day, ...data }, update: data }).catch((e) => console.error('❌ city-route: відмову Google не записано:', e instanceof Error ? e.message : e));
    }
    /** Пауза після відмови Google — з бази (спільна), інакше з памʼяті цього процесу */
    async function blockedNow() {
        const row = await dayRow();
        const until = row?.blockedUntil ? row.blockedUntil.getTime() : 0;
        if (until > now().getTime())
            return row?.blockedReason === 'denied' ? 'denied' : 'cap';
        if (now().getTime() < blockedUntil)
            return blockedReason;
        return null;
    }
    async function findStored(q, from, to, hour) {
        const freshFrom = await freshSince();
        const rows = await prisma.dovedeCityRoute.findMany({
            where: { cityCode: q.city, fromKey: from.key, toKey: to.key, dayType: (0, crawl_core_1.dayTypeOf)(q.date), hour: { in: [hour - 1, hour, hour + 1] }, archivedAt: null, fetchedAt: { gte: freshFrom } },
        });
        if (!rows.length)
            return null;
        // власні дані сильніші за збережені з Google; серед рівних — ближча година
        const rank = (r) => (r.source === 'own' ? 0 : 1) * 10 + Math.abs(r.hour - hour);
        return rows.sort((a, b) => rank(a) - rank(b))[0];
    }
    async function noteDemand(city, from, to, answered) {
        const at = now();
        await prisma.dovedeCityDemand
            .upsert({
            where: { cityCode_fromKey_toKey: { cityCode: city, fromKey: from.key, toKey: to.key } },
            create: { cityCode: city, fromKey: from.key, toKey: to.key, fromLabel: from.label, toLabel: to.label, answered, lastAskedAt: at },
            update: { asked: { increment: 1 }, lastAskedAt: at, ...(answered ? { answered: true } : {}) },
        })
            .catch((e) => console.error('❌ city-route: журнал попиту:', e));
    }
    /** Навчання знайшло дорогу для пари, яку питали люди: у списку попиту вона більше не «без відповіді». Лічильник не чіпаємо */
    async function markAnswered(city, from, to) {
        await prisma.dovedeCityDemand
            .updateMany({ where: { cityCode: city, fromKey: from.key, toKey: to.key, answered: false }, data: { answered: true } })
            .catch((e) => console.error('❌ city-route: журнал попиту:', e));
    }
    async function remember(q, from, to, hour, parsed) {
        const at = now();
        const dayType = (0, crawl_core_1.dayTypeOf)(q.date);
        await prisma.dovedeCityRoute.upsert({
            where: { cityCode_fromKey_toKey_dayType_hour_source: { cityCode: q.city, fromKey: from.key, toKey: to.key, dayType, hour, source: 'google' } },
            create: { cityCode: q.city, fromKey: from.key, toKey: to.key, fromLabel: from.label, toLabel: to.label, dayType, hour, steps: parsed.steps, minutes: parsed.minutes, source: 'google', fetchedAt: at },
            // оновлення повертає рядок і з архіву: людина щойно отримала цю відповідь
            update: { steps: parsed.steps, minutes: parsed.minutes, fetchedAt: at, fromLabel: from.label, toLabel: to.label, archivedAt: null, refreshFailedAt: null },
        });
        for (const s of parsed.steps) {
            if (s.kind !== 'transit' || !s.line)
                continue;
            await prisma.dovedeCityLine.upsert({
                where: { cityCode_mode_name_agency: { cityCode: q.city, mode: s.mode ?? 'BUS', name: s.line, agency: s.agency ?? '' } },
                create: { cityCode: q.city, mode: s.mode ?? 'BUS', name: s.line, agency: s.agency ?? '', color: s.color ?? null, source: 'google', lastSeenAt: at },
                update: { seenCount: { increment: 1 }, lastSeenAt: at, ...(s.color ? { color: s.color } : {}) },
            });
        }
        const seen = new Set();
        for (const st of parsed.stops) {
            if (seen.has(st.name))
                continue;
            seen.add(st.name);
            await prisma.dovedeCityStop.upsert({
                where: { cityCode_name: { cityCode: q.city, name: st.name } },
                create: { cityCode: q.city, name: st.name, lat: st.lat, lng: st.lng, source: 'google', lastSeenAt: at },
                update: { seenCount: { increment: 1 }, lastSeenAt: at, ...(st.lat != null && st.lng != null ? { lat: st.lat, lng: st.lng } : {}) },
            });
        }
    }
    async function askGoogle(q, from, to, purpose) {
        const key = deps.key();
        if (!key)
            return 'no_key';
        const blocked = await blockedNow();
        if (blocked)
            return blocked;
        const cap = await capNow();
        if ((await callsToday()) >= cap)
            return 'cap';
        // записуємо запит до виклику: два контейнери, що питають одночасно, разом ліміту не перейдуть
        const counted = await countCall(purpose, 1);
        if (counted != null && counted > cap) {
            await countCall(purpose, -1);
            return 'cap';
        }
        try {
            // Google приймає лише майбутній час; для «вже зараз» — без нього
            const future = q.departAt.getTime() > now().getTime() + 60000;
            const res = await fetchImpl(ROUTES_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
                body: JSON.stringify({ origin: { address: from.address }, destination: { address: to.address }, travelMode: 'TRANSIT', languageCode: 'uk', ...(future ? { departureTime: q.departAt.toISOString() } : {}) }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (res.ok)
                return parseGoogleRoute(await res.json()) ?? 'no_route';
            const said = (await res.json().catch(() => null));
            const message = typeof said?.error?.message === 'string' ? said.error.message.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
            googleError = { at: now(), status: res.status, message };
            const tail = message ? `: ${message}` : '';
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                // 429 — квота в Google Cloud менша за наш денний ліміт або її вибрали інші скрипти з тим самим ключем;
                // 401 / 403 — ключ, вимкнений API або білінг. Не вина пари й не наш ліміт: спроба не рахується
                await countCall(purpose, -1);
                blockedUntil = now().getTime() + (await backoffMs());
                blockedReason = res.status === 429 ? 'cap' : 'denied';
                await noteGoogleError(res.status, message, res.status === 429 ? 'quota' : 'denied');
                console.error(`⛔ city-route: Google Routes ${res.status} — ${res.status === 429 ? 'квоту вичерпано' : 'відмовлено в доступі'}, 10 хв не питаємо${tail}`);
                return blockedReason;
            }
            await noteGoogleError(res.status, message, null);
            // 400 / 404 — Google не прийняв саме цю пару (адресу): для неї дороги немає
            if (res.status === 400 || res.status === 404)
                return 'no_route';
            throw new Error(`Routes API ${res.status}${tail}`);
        }
        catch (e) {
            console.error('❌ city-route: Google Routes не відповів:', e instanceof Error ? e.message : e);
            return 'error';
        }
    }
    /**
     * Дорога містом для людини. `background` — навчання (фоновий таймер або `learn=1` з токеном адміна, так питає
     * `npm run dovede:crawl`): лічильник попиту й «скільки разів віддано» не рахує.
     */
    const find = (q, background = false) => answer(q, background, false);
    /** `force` — оновлення збереженої відповіді: базу не читаємо, одразу питаємо Google */
    async function answer(q, background, force) {
        if (!(await enabled()))
            return { ok: false, fallback: 'maps', reason: 'disabled' };
        const from = resolveCityPoint(q.city, q.from);
        const to = resolveCityPoint(q.city, q.to);
        const hour = Number(q.time.slice(0, 2));
        if (!from || !to || from.key === to.key || !Number.isInteger(hour))
            return { ok: false, fallback: 'maps', reason: 'no_route' };
        // Житомир: спершу пряма поїздка за власним розкладом (zt.rozklad.in.ua), звіреним з Google, — без запитів назовні
        if (q.city === 'Zhytomyr' && (await ownEnabled())) {
            const own = ownRoute({ from: q.from.trim(), to: q.to.trim(), date: q.date, time: q.time }, { from: from.label, to: to.label });
            if (own) {
                if (background)
                    await markAnswered(q.city, from, to);
                else
                    await noteDemand(q.city, from, to, true);
                return own;
            }
        }
        // Місце в архіві (власник прибрав: Google показує для цих слів не те): ні збереженого, ні нового запиту —
        // сторінка дасть кнопку карти. Попит не рахуємо. Власні дані Житомира вище від архіву не залежать
        const hidden = await archivedPlaces();
        if (hidden.has(`${q.city}|${from.key}`) || hidden.has(`${q.city}|${to.key}`))
            return { ok: false, fallback: 'maps', reason: 'archived' };
        const stored = force
            ? null
            : await findStored(q, from, to, hour).catch((e) => {
                console.error('❌ city-route: читання з бази:', e);
                return null;
            });
        if (stored) {
            if (!background) {
                await prisma.dovedeCityRoute.update({ where: { id: stored.id }, data: { hits: { increment: 1 }, lastAskedAt: now() } }).catch(() => undefined);
                await noteDemand(q.city, from, to, true);
            }
            else {
                await markAnswered(q.city, from, to);
            }
            return { ok: true, source: stored.source === 'own' ? 'own' : 'stored', city: q.city, fromLabel: stored.fromLabel, toLabel: stored.toLabel, steps: stored.steps, minutes: stored.minutes, fetchedAt: stored.fetchedAt.toISOString() };
        }
        const got = await askGoogle(q, from, to, background ? 'learn' : 'people');
        if (typeof got === 'string') {
            if (!background)
                await noteDemand(q.city, from, to, false);
            if (!background && (got === 'cap' || got === 'denied'))
                await noteRefused();
            return { ok: false, fallback: 'maps', reason: got };
        }
        if (store()) {
            await remember(q, from, to, hour, got).catch((e) => console.error('❌ city-route: запис у базу:', e));
        }
        if (background)
            await markAnswered(q.city, from, to);
        else
            await noteDemand(q.city, from, to, true);
        return { ok: true, source: 'google', city: q.city, fromLabel: from.label, toLabel: to.label, steps: got.steps, minutes: got.minutes, fetchedAt: now().toISOString() };
    }
    /**
     * Один крок фонового навчання: найзапитуваніші пари без свіжої відповіді (і стартовий набір, поки попиту немає),
     * далі — збережені відповіді, що застаріли або застаріють за `refreshLeadDays` (спершу ті, які віддавали людям).
     * Не більше `batch` за раз і лише поки денний ліміт використано менше ніж наполовину — решта для людей.
     */
    async function learnTick(batchArg) {
        if (!(await enabled()) || !store() || !deps.key())
            return { asked: 0, learned: 0 };
        // скільки пар за крок — з налаштувань (кнопка «Оновити зараз» в адмінці задає своє)
        const batch = batchArg ?? (await settingsStore.int('learn.batch'));
        // обнулені кнопкою «Скинути лічильник попиту» пари навчання не бере, поки їх знову не спитає людина
        // …і пари, на які навчання вже питало Google без успіху, — тиждень (інакше кілька «мертвих» пар зʼїдали б кожен крок)
        const retryFrom = new Date(now().getTime() - (await retryMs()));
        const demand = await prisma.dovedeCityDemand.findMany({
            where: { asked: { gt: 0 }, OR: [{ learnFailedAt: null }, { learnFailedAt: { lt: retryFrom } }] },
            orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }],
            take: 40,
        });
        const freshFrom = await freshSince();
        const queue = [
            ...demand
                .filter((d) => d.cityCode === 'Kyiv' || d.cityCode === 'Zhytomyr')
                .map((d) => ({ city: d.cityCode, from: storedPoint(d.fromKey, d.fromLabel), to: storedPoint(d.toKey, d.toLabel), demandId: d.id })),
            ...exports.SEED_PAIRS,
        ];
        // навчаємось на «звичайний ранок»: найближчий будень, 09:00 за Києвом
        const at = nextWeekdayMorning(now());
        let asked = 0;
        let learned = 0;
        // ліміт, квота, немає ключа, збій Google — не вина пари: позначок не ставимо, решту кроку не питаємо
        let halted = false;
        for (const pair of queue) {
            if (asked >= batch)
                break;
            if ((await callsToday()) >= (await learnCap()))
                break;
            const from = resolveCityPoint(pair.city, pair.from);
            const to = resolveCityPoint(pair.city, pair.to);
            if (!from || !to)
                continue;
            const q = { city: pair.city, from: pair.from, to: pair.to, date: at.date, time: '09:00', departAt: at.utc };
            // будь-який рядок цієї пари (і заархівований) — навчання її вже не чіпає: архів — рішення власника
            const known = await prisma.dovedeCityRoute.findFirst({ where: { cityCode: pair.city, fromKey: from.key, toKey: to.key, OR: [{ archivedAt: { not: null } }, { fetchedAt: { gte: freshFrom } }] } });
            if (known)
                continue;
            const seedKey = `${pair.city}|${from.key}|${to.key}`;
            if (pair.demandId === undefined && (seedFailed.get(seedKey) ?? 0) > retryFrom.getTime())
                continue;
            const r = await find(q, true);
            // місце в архіві — рішення власника: Google не питали, пара навчанню не потрібна
            if (!r.ok && r.reason === 'archived')
                continue;
            if (!r.ok && r.reason !== 'no_route') {
                if (r.reason === 'error')
                    asked++;
                halted = true;
                break;
            }
            asked++;
            if (r.ok) {
                learned++;
            }
            else if (pair.demandId !== undefined) {
                await prisma.dovedeCityDemand.update({ where: { id: pair.demandId }, data: { learnFailedAt: now() } }).catch((e) => console.error('❌ city-route: позначка невдалого навчання:', e));
            }
            else {
                seedFailed.set(seedKey, now().getTime());
            }
        }
        // Оновлення збереженого: той самий тип дня й година, що в рядку, — людина з тим самим питанням і далі отримає
        // відповідь із бази. Архів не чіпаємо (рішення власника); власні дані оновлює їхній генератор.
        if ((await refresh()) && !halted) {
            const days = await freshDays();
            const edge = new Date(now().getTime() - (days - (0, exports.refreshLeadDays)(days)) * 24 * 3600000);
            const retryFrom = new Date(now().getTime() - (await retryMs()));
            const rows = await prisma.dovedeCityRoute.findMany({
                where: { source: 'google', archivedAt: null, fetchedAt: { lt: edge }, OR: [{ refreshFailedAt: null }, { refreshFailedAt: { lt: retryFrom } }] },
                orderBy: [{ hits: 'desc' }, { fetchedAt: 'asc' }],
                take: batch * 4,
            });
            // не вдалося — позначаємо рядок: повторимо за тиждень, а не щогодини (людина з цим питанням усе одно спитає Google)
            const giveUp = (id) => prisma.dovedeCityRoute.update({ where: { id }, data: { refreshFailedAt: now() } }).catch((e) => console.error('❌ city-route: позначка невдалого оновлення:', e));
            for (const row of rows) {
                if (asked >= batch)
                    break;
                if ((await callsToday()) >= (await learnCap()))
                    break;
                if ((row.cityCode !== 'Kyiv' && row.cityCode !== 'Zhytomyr') || !DAY_TYPES.includes(row.dayType)) {
                    await giveUp(row.id);
                    continue;
                }
                const slot = nextSlot(now(), row.dayType, row.hour);
                const q = { city: row.cityCode, from: storedPoint(row.fromKey, row.fromLabel), to: storedPoint(row.toKey, row.toLabel), date: slot.date, time: slot.time, departAt: slot.utc };
                const r = await answer(q, true, true);
                if (r.ok && r.source === 'google') {
                    asked++;
                    learned++;
                    continue;
                }
                // ліміт, квота, немає ключа, збій Google — рядок ні до чого, спробуємо наступного разу
                if (!r.ok && r.reason !== 'no_route' && r.reason !== 'archived') {
                    if (r.reason === 'error')
                        asked++;
                    break;
                }
                await giveUp(row.id);
                // `r.ok` тут — пару тепер закривають власні дані, `archived` — місце в архіві: Google не питали, лічити нічого
                if (!r.ok && r.reason === 'no_route')
                    asked++;
            }
        }
        return { asked, learned };
    }
    /** Зведення для адмінки */
    async function stats() {
        const fresh = await freshDays();
        const [routes, lines, stops, archived, today, demand, unanswered, stale] = await Promise.all([
            prisma.dovedeCityRoute.groupBy({ by: ['cityCode', 'source'], where: { archivedAt: null }, _count: { _all: true } }),
            prisma.dovedeCityLine.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
            prisma.dovedeCityStop.groupBy({ by: ['cityCode'], where: { archivedAt: null }, _count: { _all: true } }),
            prisma.dovedeCityRoute.count({ where: { archivedAt: { not: null } } }),
            callsToday(),
            prisma.dovedeCityDemand.findMany({ where: { asked: { gt: 0 } }, orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 30 }),
            prisma.dovedeCityDemand.findMany({ where: { asked: { gt: 0 }, answered: false }, orderBy: [{ asked: 'desc' }, { lastAskedAt: 'desc' }], take: 100 }),
            prisma.dovedeCityRoute.count({ where: { source: 'google', archivedAt: null, fetchedAt: { lt: new Date(now().getTime() - fresh * 24 * 3600000) } } }),
        ]);
        const [day, lastError] = await Promise.all([
            dayRow(),
            prisma.dovedeCityGoogleDay.findFirst({ where: { lastErrorAt: { not: null } }, orderBy: { lastErrorAt: 'desc' } }).catch(() => null),
        ]);
        // остання відмова: з бази (переживає перезапуск, спільна для контейнерів), інакше — з памʼяті цього процесу
        const fromDb = lastError?.lastErrorAt && lastError.lastErrorStatus != null ? { at: lastError.lastErrorAt, status: lastError.lastErrorStatus, message: lastError.lastErrorMessage ?? '' } : null;
        const lastRefusal = [fromDb, googleError].filter((x) => x != null).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
        const blockedTill = day?.blockedUntil && day.blockedUntil.getTime() > now().getTime() ? day.blockedUntil : null;
        return {
            enabled: await enabled(),
            store: store(),
            hasKey: Boolean(deps.key()),
            // остання відмова Google (статус і його власний текст); null — не відмовляв
            googleError: lastRefusal ? { at: lastRefusal.at.toISOString(), status: lastRefusal.status, message: lastRefusal.message } : null,
            callsToday: today,
            // з чого склались сьогоднішні запити: люди, навчання; скільки людям відмовили через ліміт чи квоту
            today: { people: day?.people ?? 0, learn: day?.learn ?? 0, refused: day?.refused ?? 0 },
            // пауза після відмови Google (429 — квота, 401 / 403 — доступ): до цього часу Google не питаємо
            blocked: blockedTill ? { until: blockedTill.toISOString(), reason: day?.blockedReason === 'denied' ? 'denied' : 'quota' } : null,
            dailyCap: await capNow(),
            // без значення з адмінки — ліміт зі змінної середовища (або 150 з коду); `dailyCapFromAdmin` — власник задав свій
            dailyCapDefault: await defaultCap(),
            dailyCapFromAdmin: (await settingsStore.view('city.dailyCap')).stored != null,
            freshDays: fresh,
            freshDaysDefault: exports.CITY_FRESH_DAYS,
            // збережені відповіді з Google, старші за строк свіжості: людям їх не віддаємо; `refresh` — навчання оновлює їх саме
            staleRoutes: stale,
            refresh: await refresh(),
            archivedRoutes: archived,
            routes: routes.map((r) => ({ city: r.cityCode, source: r.source, count: r._count._all })),
            lines: lines.map((r) => ({ city: r.cityCode, count: r._count._all })),
            stops: stops.map((r) => ({ city: r.cityCode, count: r._count._all })),
            demand: demand.map((d) => ({ city: d.cityCode, from: d.fromLabel, to: d.toLabel, asked: d.asked, answered: d.answered, lastAskedAt: d.lastAskedAt.toISOString() })),
            // питання людей, на які відповіді не знайшлось (ліміт, збій, Google не знає місця): з ключами — для повторної спроби обходом
            unanswered: unanswered.map((d) => ({ city: d.cityCode, fromKey: d.fromKey, toKey: d.toKey, from: d.fromLabel, to: d.toLabel, asked: d.asked })),
        };
    }
    /** Архівує все, що прийшло з Google (маршрути, лінії, зупинки). Нічого не видаляє; дані власника не чіпає */
    async function archiveGoogle() {
        const at = now();
        const where = { source: 'google', archivedAt: null };
        const [routes, lines, stops] = await prisma.$transaction([
            prisma.dovedeCityRoute.updateMany({ where, data: { archivedAt: at } }),
            prisma.dovedeCityLine.updateMany({ where, data: { archivedAt: at } }),
            prisma.dovedeCityStop.updateMany({ where, data: { archivedAt: at } }),
        ]);
        return { routes: routes.count, lines: lines.count, stops: stops.count };
    }
    async function restoreGoogle() {
        const where = { source: 'google', archivedAt: { not: null } };
        const [routes, lines, stops] = await prisma.$transaction([
            prisma.dovedeCityRoute.updateMany({ where, data: { archivedAt: null } }),
            prisma.dovedeCityLine.updateMany({ where, data: { archivedAt: null } }),
            prisma.dovedeCityStop.updateMany({ where, data: { archivedAt: null } }),
        ]);
        // місця, які власник прибрав окремо, лишаються в архіві: їхні дороги повертає лише «Повернути» біля самого місця
        let kept = 0;
        const at = now();
        for (const m of await prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } } })) {
            const again = await prisma.dovedeCityRoute.updateMany({ where: { cityCode: m.cityCode, source: 'google', archivedAt: null, OR: [{ toKey: m.key }, { fromKey: m.key }] }, data: { archivedAt: at } });
            kept += again.count;
        }
        return { routes: routes.count - kept, lines: lines.count, stops: stops.count };
    }
    /** Ключ місця для архіву: слова людини; id точки посадки чи станції метро архівувати не можна — це наші власні точки */
    function placeKey(raw) {
        const value = raw.trim();
        if (!value || value.length > 120 || isKnownPointId(value))
            return null;
        const key = (0, crawl_core_1.normalizeKey)(value);
        return key.length >= 2 ? key : null;
    }
    const placeRoutes = (city, key) => ({ cityCode: city, source: 'google', OR: [{ toKey: key }, { fromKey: key }] });
    /**
     * Архів одного місця: усі збережені з Google дороги до нього й від нього йдуть в архів, а саме місце — у
     * `DovedeCityPlace`: далі про нього не віддаємо збереженого й не питаємо Google (людина отримує кнопку карти),
     * навчання й оновлення його не чіпають. Нічого не видаляється. null — це не місце словами (порожньо, id точки).
     */
    async function archivePlace(city, raw) {
        const key = placeKey(raw);
        if (!key)
            return null;
        const at = now();
        const sample = await prisma.dovedeCityRoute.findFirst({ where: placeRoutes(city, key) });
        const label = sample ? (sample.toKey === key ? sample.toLabel : sample.fromLabel) : raw.trim().replace(/\s+/g, ' ');
        await prisma.dovedeCityPlace.upsert({ where: { cityCode_key: { cityCode: city, key } }, create: { cityCode: city, key, label, archivedAt: at }, update: { label, archivedAt: at } });
        const done = await prisma.dovedeCityRoute.updateMany({ where: { ...placeRoutes(city, key), archivedAt: null }, data: { archivedAt: at } });
        archivedMemo = null;
        return { city, key, label, routes: done.count };
    }
    /** Повертає місце з архіву разом із його збереженими дорогами (застарілі за цей час навчання оновить саме) */
    async function restorePlace(city, raw) {
        const key = placeKey(raw);
        if (!key)
            return null;
        await prisma.dovedeCityPlace.updateMany({ where: { cityCode: city, key, archivedAt: { not: null } }, data: { archivedAt: null } });
        const done = await prisma.dovedeCityRoute.updateMany({ where: { ...placeRoutes(city, key), archivedAt: { not: null } }, data: { archivedAt: null } });
        archivedMemo = null;
        return { city, key, routes: done.count };
    }
    /**
     * Місця словами, про які є збережені дороги з Google (кінець пари, що не є нашою точкою), і місця в архіві.
     * Для адмінки: знайти місце з неправильною відповіддю й прибрати саме його.
     */
    async function places() {
        const [rows, marks] = await Promise.all([
            prisma.dovedeCityRoute.findMany({ where: { source: 'google' }, select: { cityCode: true, fromKey: true, toKey: true, fromLabel: true, toLabel: true, minutes: true, archivedAt: true } }),
            prisma.dovedeCityPlace.findMany({ where: { archivedAt: { not: null } } }),
        ]);
        const byKey = new Map();
        const entry = (city, key, label) => {
            const id = `${city}|${key}`;
            let p = byKey.get(id);
            if (!p) {
                p = { city, key, label, routes: 0, archivedRoutes: 0, minMinutes: null, maxMinutes: null, archivedAt: null };
                byKey.set(id, p);
            }
            return p;
        };
        const add = (city, key, label, minutes, archived) => {
            if (isKnownPointId(key))
                return;
            const p = entry(city, key, label);
            if (archived)
                p.archivedRoutes++;
            else
                p.routes++;
            p.minMinutes = p.minMinutes == null ? minutes : Math.min(p.minMinutes, minutes);
            p.maxMinutes = p.maxMinutes == null ? minutes : Math.max(p.maxMinutes, minutes);
        };
        for (const r of rows) {
            add(r.cityCode, r.toKey, r.toLabel, r.minutes, r.archivedAt != null);
            add(r.cityCode, r.fromKey, r.fromLabel, r.minutes, r.archivedAt != null);
        }
        for (const m of marks)
            entry(m.cityCode, m.key, m.label).archivedAt = m.archivedAt.toISOString();
        return [...byKey.values()].sort((a, b) => a.city.localeCompare(b.city) || a.label.localeCompare(b.label, 'uk'));
    }
    /**
     * Обнуляє лічильник попиту (після прогону самонавчання, щоб його пари не стояли поруч із питаннями людей).
     * Рядки лишаються: ці таблиці не видаляються. Збережені дороги, лінії й зупинки не зачеплено.
     */
    async function resetDemand() {
        const r = await prisma.dovedeCityDemand.updateMany({ where: { asked: { gt: 0 } }, data: { asked: 0 } });
        return { reset: r.count };
    }
    return { find, learnTick, stats, archiveGoogle, restoreGoogle, archivePlace, restorePlace, places, resetDemand, setFreshDays, setDailyCap };
}
/** Найближчий будень о 09:00 за Києвом (взимку UTC+2, влітку UTC+3 — похибка в годину для навчання неважлива) */
function nextWeekdayMorning(now) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 7, 0, 0));
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
        d.setUTCDate(d.getUTCDate() + 1);
    return { date: d.toISOString().slice(0, 10), utc: d };
}
function cityRoutesFromEnv(prisma, settings) {
    return createCityRoutes({ prisma, key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null, ...(settings ? { settings } : {}) });
}
