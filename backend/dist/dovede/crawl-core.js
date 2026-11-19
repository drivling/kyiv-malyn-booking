"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUT_TAIL = exports.GENERIC = exports.SLOT_PRESETS = exports.DEFAULT_FRESH_DAYS = exports.DAY_TYPES = exports.POINT_LABEL = exports.ARRIVAL_POINTS = void 0;
exports.normalizeKey = normalizeKey;
exports.resolveOrigins = resolveOrigins;
exports.dayTypeOf = dayTypeOf;
exports.kyivToday = kyivToday;
exports.slotDate = slotDate;
exports.parseSlots = parseSlots;
exports.seedFromIntent = seedFromIntent;
exports.compactSteps = compactSteps;
exports.looksLikeMetro = looksLikeMetro;
exports.usableName = usableName;
exports.siteForm = siteForm;
exports.candidates = candidates;
exports.describeSteps = describeSteps;
exports.askOf = askOf;
exports.taskKey = taskKey;
exports.seedsFromUnanswered = seedsFromUnanswered;
exports.rootsFromRecords = rootsFromRecords;
exports.createCrawl = createCrawl;
exports.summarizeRecords = summarizeRecords;
/**
 * «Доведе» · обхід у ширину для наповнення бази доріг містом — чиста логіка без мережі й диска. Одне джерело для
 * локальної команди `npm run dovede:crawl` (frontend/scripts/dovede-crawl.mjs збирає цей файл esbuild-ом) і для
 * навчання на сервері (Docs/dovede-admin-roadmap.md, трек B). Тест — `crawl-core.test.ts`.
 *
 * Вузол — «місце словами» від точки висадки (або до точки посадки). Сервер відповів — із кроків беремо нові
 * назви: зупинки пересадок і висадки та кінцеві ліній (`headsign`). Вони стають вузлами наступного рівня з тією
 * самою точкою. Google не повертає проміжних зупинок, тож саме кінцеві ліній розносять обхід містом.
 *
 * `normalizeKey` і `dayTypeOf` живуть тут, а `city-route.ts` бере їх звідси: ключ пари в журналі обходу й у базі
 * має бути тим самим, а ядро — без залежностей від сервера, щоб його можна було зібрати в локальну команду.
 */
const cityDetail_1 = require("./cityDetail");
/** Куди привозять (і звідки забирають) міжміські рейси — ті самі id, що шле сторінка */
exports.ARRIVAL_POINTS = {
    Kyiv: ['kyiv.akadem', 'kyiv.sviatoshyn', 'kyiv.zhytomyrska', 'kyiv.pas', 'kyiv.borshch'],
    Zhytomyr: ['zhytomyr.avtovokzal'],
};
exports.POINT_LABEL = {
    'kyiv.akadem': 'метро «Академмістечко»',
    'kyiv.sviatoshyn': 'метро «Святошин»',
    'kyiv.zhytomyrska': 'метро «Житомирська»',
    'kyiv.pas': 'вокзал Київ-Пасажирський',
    'kyiv.borshch': 'платформа «Борщагівка»',
    'zhytomyr.avtovokzal': 'автовокзал Житомир-1',
};
exports.DAY_TYPES = ['weekday', 'saturday', 'sunday'];
exports.DEFAULT_FRESH_DAYS = 30;
/** Ключ пари в базі (`DovedeCityRoute.fromKey / toKey`) і в журналі обходу */
function normalizeKey(text) {
    return String(text)
        .toLowerCase()
        .replace(/[’ʼ`]/g, "'")
        .replace(/[«»"().,;:!?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const isPointId = (v) => /^[a-z]+\.[a-z0-9.:-]+$/i.test(v);
const pointKey = (v) => (isPointId(v) ? v : normalizeKey(v));
/** «святошино», «Академ», «вокзал», готовий id або «all» → id точок міста; невідоме слово — помилка */
function resolveOrigins(city, spec) {
    const all = exports.ARRIVAL_POINTS[city] ?? [];
    const words = String(spec ?? '')
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
    if (!words.length)
        return all.slice(0, 1);
    const out = [];
    for (const w of words) {
        const n = normalizeKey(w);
        let ids;
        if (n === 'all' || n === 'усі' || n === 'все')
            ids = all;
        else if (isPointId(w))
            ids = [w];
        else if (city === 'Zhytomyr')
            ids = all;
        else if (n.includes('академ'))
            ids = ['kyiv.akadem'];
        else if (n.includes('святош'))
            ids = ['kyiv.sviatoshyn'];
        else if (n.includes('житомирськ') || n.includes('житомирск'))
            ids = ['kyiv.zhytomyrska'];
        else if (n.includes('борщаг'))
            ids = ['kyiv.borshch'];
        else if (n.includes('вокзал') || n.includes('пасаж') || n.includes('приміськ'))
            ids = ['kyiv.pas'];
        else
            throw new Error(`Не знаю точки «${w}». Є: ${all.join(', ')} або all`);
        for (const id of ids)
            if (!out.includes(id))
                out.push(id);
    }
    return out;
}
/** Тип дня дати 'YYYY-MM-DD' — так само рахує й база (`DovedeCityRoute.dayType`) */
function dayTypeOf(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 ? 'sunday' : wd === 6 ? 'saturday' : 'weekday';
}
/** Сьогодні за Києвом, 'YYYY-MM-DD' */
function kyivToday(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Найближча дата потрібного типу дня, не раніше ніж завтра: Google приймає лише майбутній час */
function slotDate(dayType, today) {
    for (let i = 1; i <= 7; i++) {
        const d = addDays(today, i);
        if (dayTypeOf(d) === dayType)
            return d;
    }
    throw new Error(`Невідомий тип дня: ${dayType}`);
}
const DAY_ALIASES = {
    weekday: 'weekday', wd: 'weekday', будні: 'weekday', будень: 'weekday', будни: 'weekday',
    saturday: 'saturday', sat: 'saturday', субота: 'saturday', суббота: 'saturday',
    sunday: 'sunday', sun: 'sunday', неділя: 'sunday', воскресенье: 'sunday',
};
exports.SLOT_PRESETS = {
    // година ± 1 з бази: сім, десять… закривають увесь день від 6 до 23
    day: ['07', '10', '13', '16', '19'].map((h) => `weekday@${h}`).join(','),
    full: exports.DAY_TYPES.flatMap((d) => ['07', '10', '13', '16', '19', '22'].map((h) => `${d}@${h}`)).join(','),
};
/** «weekday@09:00,saturday@10», «day», «full» → [{ dayType, time }] */
function parseSlots(spec) {
    const raw = String(spec ?? '').trim() || 'weekday@09:00';
    const out = [];
    for (const part of (Object.prototype.hasOwnProperty.call(exports.SLOT_PRESETS, raw) ? exports.SLOT_PRESETS[raw] : raw).split(',')) {
        const [dayRaw, timeRaw = '09:00'] = part.trim().split('@');
        const dayType = DAY_ALIASES[dayRaw.trim().toLowerCase()];
        const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(timeRaw.trim());
        if (!dayType || !m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59)
            throw new Error(`Не розумію час «${part.trim()}». Приклад: weekday@09:00,saturday@10 або day / full`);
        const time = `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
        if (!out.some((s) => s.dayType === dayType && s.time === time))
            out.push({ dayType, time });
    }
    return out;
}
/** Розбір сторінки (`parseLocal`) → що питати: місто, місце словами і напрям; null — у фразі немає місця в Києві чи Житомирі */
function seedFromIntent(intent) {
    const refs = (intent ?? {});
    for (const [role, dir] of [['to', 'to'], ['from', 'from']]) {
        const ref = refs[role];
        const city = ref?.id === 'city.Kyiv' ? 'Kyiv' : ref?.id === 'city.Zhytomyr' ? 'Zhytomyr' : null;
        if (city && typeof ref?.detail === 'string' && ref.detail.trim())
            return { city, place: ref.detail.trim(), dir };
    }
    return null;
}
/** Кроки відповіді сервера → короткий запис для журналу (без кольорів і перевізників) */
function compactSteps(steps) {
    return (Array.isArray(steps) ? steps : []).map((s) => s.kind === 'walk'
        ? { walk: s.minutes ?? 0, ...(s.meters ? { m: s.meters } : {}) }
        : { mode: s.mode ?? 'BUS', line: s.line ?? '', from: s.fromStop ?? '', to: s.toStop ?? '', ...(s.headsign ? { head: s.headsign } : {}), ...(s.stops ? { n: s.stops } : {}), min: s.minutes ?? 0 });
}
/** Метро й залізниця — уже власні дані «Доведе»: їхні станції в обхід не беремо */
const RAIL_MODES = /^(SUBWAY|METRO_RAIL|RAIL|HEAVY_RAIL|COMMUTER_TRAIN|LONG_DISTANCE_TRAIN|HIGH_SPEED_TRAIN)$/;
const METRO_NAME_RE = /(^|[\s(«"])(ст\.?\s?м\.?|станція метро|станция метро|метро|м\.)\s/i;
exports.GENERIC = new Set(['зупинка', 'кінцева', 'школа', 'магазин', 'ринок', 'лікарня', 'поліклініка', 'церква', 'парк', 'міст', 'центр', 'вокзал', 'площа', 'завод', 'аптека', 'пошта', 'стадіон', 'гаражі', 'дачі', 'кладовище',
    // назви зупинок, яких у місті багато: Google знайде «якийсь» супермаркет, і в базу ляже дорога не туди
    'супермаркет', 'гіпермаркет', 'універмаг', 'універсам', 'авторинок', 'автостанція', 'гуртожиток', 'дитячий садок', 'дитсадок', 'банк', 'готель',
    'кінотеатр', 'музей', 'бібліотека', 'училище', 'медучилище', 'інститут', 'університет', 'технікум', 'ліцей', 'гімназія', 'будинок культури', 'басейн',
    'депо', 'амбулаторія', 'пологовий будинок', 'хлібозавод', 'молокозавод', 'кільце', 'переїзд', 'торговий центр', 'тц', 'трц', 'азс', 'ж/м', 'жм', 'станція', 'дорога', 'дитяча поліклініка']);
/** Назва обірвана на сполучнику чи прийменнику («…архітектури та») — словник сторінки її не дочитав; таке не питаємо */
exports.CUT_TAIL = /(?:^|\s)(?:та|і|й|на|в|у|до|з|із|біля|ім|імені)$/u;
/** Назва, схожа на станцію метро: таку дорогу «Доведе» рахує сам, сервер про неї не питають */
function looksLikeMetro(name) {
    return METRO_NAME_RE.test(name);
}
const plainForm = (name) => (looksLikeMetro(name) ? null : name);
/** Назва годиться для питання до сервера: не коротка, з літерами, не загальне слово, яких у місті багато */
function usableName(name) {
    const key = normalizeKey(name);
    if (key.length < 4 || name.length > 120)
        return false;
    if ((key.match(/\p{L}/gu) ?? []).length < 3)
        return false;
    return !exports.GENERIC.has(key);
}
/**
 * Як сторінка назвала б місце в питанні до сервера (`detailForm` — та сама форма, що в `parseLocal`); null — місце
 * вона знає сама (метро, вокзал, електричка), сервер про нього не питають. Назву, яку сторінка шле без змін (з
 * точністю до регістру й розділових знаків), лишаємо як є.
 */
function siteForm(city, name) {
    if (looksLikeMetro(name))
        return null;
    const form = (0, cityDetail_1.detailForm)(city, name);
    if (!form)
        return null;
    return normalizeKey(form) === normalizeKey(name) ? name : form;
}
/**
 * Нові місця з кроків відповіді: зупинки пересадок і висадки та кінцеві ліній наземного транспорту.
 * Зупинку біля самої точки (перша посадка для «від точки», остання висадка для «до точки») пропускаємо — до неї пішки.
 * `siteForm(name)` — як сторінка назвала б це місце в питанні до сервера; null — місце «Доведе» знає сам (метро,
 * вокзал), сервер про нього не питають.
 */
function candidates(steps, { dir = 'to', siteForm = plainForm, headsigns = true, exclude = [] } = {}) {
    const rides = steps.filter((s) => s.walk == null);
    const seen = new Set(exclude.map(normalizeKey));
    const out = [];
    const take = (name, via) => {
        const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
        if (!clean || !usableName(clean))
            return;
        const key = normalizeKey(clean);
        if (seen.has(key))
            return;
        seen.add(key);
        const form = siteForm(clean);
        if (!form || !usableName(form))
            return;
        const formKey = normalizeKey(form);
        if (exports.CUT_TAIL.test(formKey))
            return;
        // сторінка скоротила назву до вже баченої — це те саме місце
        if (formKey !== key && seen.has(formKey))
            return;
        seen.add(formKey);
        out.push({ name: form, via });
    };
    rides.forEach((s, i) => {
        if (RAIL_MODES.test(s.mode ?? ''))
            return;
        const nearPointBoard = dir === 'to' && i === 0;
        const nearPointAlight = dir === 'from' && i === rides.length - 1;
        if (!nearPointBoard)
            take(s.from, 'stop');
        if (!nearPointAlight)
            take(s.to, 'stop');
        if (headsigns)
            take(s.head, 'headsign');
    });
    return out;
}
const MODE_ICON = { BUS: '🚌', TROLLEYBUS: '🚎', TRAM: '🚊', LIGHT_RAIL: '🚊', SUBWAY: '🚇', METRO_RAIL: '🚇', SHARE_TAXI: '🚐', FUNICULAR: '🚡' };
/** «🚇 M1 → 🚌 118 → 5 хв пішки» */
function describeSteps(steps) {
    return steps
        .map((s) => (s.walk != null ? `${s.walk} хв пішки` : `${MODE_ICON[s.mode] ?? (RAIL_MODES.test(s.mode ?? '') ? '🚆' : '🚌')} ${s.line || '—'}`.trim()))
        .join(' → ');
}
const nodeKey = (n) => [n.city, n.origin, n.dir, normalizeKey(n.place)].join('|');
/** Що шле сторінка: `GET /dovede/city-route?city=&from=&to=&date=&time=` */
function askOf(node, slot, today) {
    const from = node.dir === 'to' ? node.origin : node.place;
    const to = node.dir === 'to' ? node.place : node.origin;
    return { city: node.city, from, to, date: slotDate(slot.dayType, today), time: slot.time };
}
/** Ключ питання в журналі: пара + тип дня + година — як у базі сервера */
function taskKey(node, dayType, hour) {
    const from = node.dir === 'to' ? node.origin : node.place;
    const to = node.dir === 'to' ? node.place : node.origin;
    return [node.city, pointKey(from), pointKey(to), dayType, hour].join('|');
}
const recNode = (r) => ({ city: r.city, origin: r.origin, dir: r.dir, place: r.place, depth: r.depth ?? 0, via: r.via ?? 'seed' });
/**
 * Питання людей, на які сервер не знайшов відповіді (`unanswered` з GET /admin/dovede/city), → з чого почати:
 * один кінець пари — id точки, другий — слова людини. Пари «слова — слова» і «точка — точка» сторінка не шле.
 */
function seedsFromUnanswered(rows) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!Object.prototype.hasOwnProperty.call(exports.ARRIVAL_POINTS, r.city ?? '') || !r.fromKey || !r.toKey)
            continue;
        const fromIsPoint = isPointId(r.fromKey);
        if (fromIsPoint === isPointId(r.toKey))
            continue;
        const place = String((fromIsPoint ? r.to : r.from) ?? '').trim();
        if (!place)
            continue;
        out.push({ city: r.city, origin: fromIsPoint ? r.fromKey : r.toKey, dir: fromIsPoint ? 'to' : 'from', place, via: 'people' });
    }
    return out;
}
/** Корені з журналу: з них обхід продовжується, коли команду запущено без фрази */
function rootsFromRecords(records) {
    const out = new Map();
    for (const r of records) {
        if ((r.depth ?? 0) !== 0 || !r.city || !r.origin || !r.place)
            continue;
        const n = recNode(r);
        if (!out.has(nodeKey(n)))
            out.set(nodeKey(n), n);
    }
    return [...out.values()];
}
/**
 * Обхід. `records` — рядки журналу минулих запусків: свіжі відповіді (і «маршруту немає») повторно не питаємо,
 * але нові місця з них беремо, тож обхід продовжується з того самого місця без жодного запиту.
 * Спершу всі місця на перший час зі списку `slots`, і лише коли черга місць спорожніла — решта часів.
 */
function createCrawl({ records = [], seeds = [], slots, maxDepth = 3, freshDays = exports.DEFAULT_FRESH_DAYS, now = () => new Date(), siteForm = (_city, name) => plainForm(name), headsigns = true, }) {
    const today = kyivToday(now());
    const freshFrom = now().getTime() - freshDays * 24 * 3600000;
    /** ключ → { ok, steps } — на що вже є свіжа відповідь */
    const memo = new Map();
    for (const r of records) {
        if (!r.at || new Date(r.at).getTime() < freshFrom)
            continue;
        const key = taskKey(recNode(r), r.dayType, r.hour);
        if (r.ok)
            memo.set(key, { ok: true, steps: r.steps ?? [] });
        else if (r.reason === 'no_route' || r.reason === 'bad_request' || r.reason === 'archived')
            memo.set(key, { ok: false, steps: [] });
        // збій (`error`) — не відповідь: Google міг відмовити всім одразу (квота, ключ), тож питання лишається в черзі
    }
    const seen = new Set();
    const main = [];
    const extra = [];
    const stats = { skipped: 0, found: 0, nodes: 0 };
    const push = (node) => {
        const key = nodeKey(node);
        if (seen.has(key))
            return false;
        seen.add(key);
        main.push(node);
        stats.nodes++;
        return true;
    };
    for (const s of seeds)
        push({ city: s.city, origin: s.origin, dir: s.dir ?? 'to', place: s.place, depth: s.depth ?? 0, via: s.via ?? 'seed' });
    const lookup = (node, slot) => {
        const hour = Number(slot.time.slice(0, 2));
        for (const h of [hour, hour - 1, hour + 1]) {
            const hit = memo.get(taskKey(node, slot.dayType, h));
            if (hit)
                return hit;
        }
        return null;
    };
    const expand = (node, steps) => {
        if (node.depth >= maxDepth)
            return 0;
        let added = 0;
        for (const c of candidates(steps, { dir: node.dir, siteForm: (name) => siteForm(node.city, name), headsigns, exclude: [node.place] })) {
            if (push({ city: node.city, origin: node.origin, dir: node.dir, place: c.name, depth: node.depth + 1, via: c.via }))
                added++;
        }
        stats.found += added;
        return added;
    };
    const settle = (node, slotIdx, ok, steps) => {
        if (!ok)
            return 0;
        if (slotIdx === 0)
            for (let i = 1; i < slots.length; i++)
                extra.push({ node, slotIdx: i });
        return expand(node, steps);
    };
    return {
        stats,
        pending: () => main.length + extra.length,
        next() {
            for (;;) {
                const head = main.shift();
                const item = head ? { node: head, slotIdx: 0 } : extra.shift();
                if (!item)
                    return null;
                const slot = slots[item.slotIdx];
                const known = lookup(item.node, slot);
                if (known) {
                    stats.skipped++;
                    settle(item.node, item.slotIdx, known.ok, known.steps);
                    continue;
                }
                return { node: item.node, slot, slotIdx: item.slotIdx, ask: askOf(item.node, slot, today) };
            }
        },
        done(task, result) {
            const hour = Number(task.slot.time.slice(0, 2));
            const steps = result.ok ? compactSteps(result.steps) : [];
            memo.set(taskKey(task.node, task.slot.dayType, hour), { ok: Boolean(result.ok), steps });
            const added = settle(task.node, task.slotIdx, Boolean(result.ok), steps);
            const record = {
                at: now().toISOString(),
                city: task.node.city,
                origin: task.node.origin,
                dir: task.node.dir,
                place: task.node.place,
                depth: task.node.depth,
                via: task.node.via,
                dayType: task.slot.dayType,
                hour,
                date: task.ask.date,
                time: task.ask.time,
                ok: Boolean(result.ok),
                ...(result.ok ? { source: result.source, minutes: result.minutes, steps } : { reason: result.reason ?? 'error' }),
            };
            return { record, added };
        },
    };
}
/**
 * Зведення журналу для `--status`. `stale` — питань, остання вдала відповідь на які вже старша за строк свіжості
 * (сервер її не віддасть — запуск без фрази спитає знову); `expiring` — застаріють за найближчі 7 днів.
 */
function summarizeRecords(records, { freshDays = exports.DEFAULT_FRESH_DAYS, now = () => new Date() } = {}) {
    const latest = new Map();
    for (const r of records) {
        if (!r.ok || !r.at)
            continue;
        const key = taskKey(recNode(r), r.dayType, r.hour);
        const at = new Date(r.at).getTime();
        if (at > (latest.get(key) ?? 0))
            latest.set(key, at);
    }
    const edge = now().getTime() - freshDays * 24 * 3600000;
    let stale = 0;
    let expiring = 0;
    for (const at of latest.values()) {
        if (at < edge)
            stale++;
        else if (at < edge + 7 * 24 * 3600000)
            expiring++;
    }
    const pairs = new Set();
    const lines = new Set();
    const stops = new Set();
    const by = { google: 0, stored: 0, own: 0, no_route: 0, error: 0 };
    for (const r of records) {
        if (r.ok) {
            const source = String(r.source);
            by[source] = (by[source] ?? 0) + 1;
            pairs.add([r.city, r.origin, r.dir, normalizeKey(r.place)].join('|'));
            for (const s of r.steps ?? []) {
                if (s.walk != null)
                    continue;
                if (s.line)
                    lines.add(`${r.city}|${s.mode}|${s.line}`);
                for (const n of [s.from, s.to])
                    if (n)
                        stops.add(`${r.city}|${normalizeKey(n)}`);
            }
        }
        else if (r.reason === 'no_route' || r.reason === 'bad_request' || r.reason === 'archived')
            by.no_route++;
        else
            by.error++;
    }
    return { total: records.length, pairs: pairs.size, lines: lines.size, stops: stops.size, by, stale, expiring };
}
