"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_WATCH_USER_AGENT = exports.SOURCE_FAIL_ALERT_AFTER = exports.WATCHED_SOURCES = exports.MALYN_MEDIA_KEYWORDS = exports.ZHYTOMYR_BOARD_ATTRIBUTION = exports.ZHYTOMYR_BOARD_URL = void 0;
exports.normalizeHtmlText = normalizeHtmlText;
exports.snapshotHtmlTables = snapshotHtmlTables;
exports.stationTableItems = stationTableItems;
exports.snapshotCkanPackage = snapshotCkanPackage;
exports.snapshotBusBoard = snapshotBusBoard;
exports.parseRssEntries = parseRssEntries;
exports.snapshotRssFeed = snapshotRssFeed;
exports.mergeRssSnapshot = mergeRssSnapshot;
exports.changedParts = changedParts;
exports.takeSnapshot = takeSnapshot;
exports.describeChanges = describeChanges;
exports.describeSourceChanges = describeSourceChanges;
exports.fetchSourceText = fetchSourceText;
exports.prismaScheduleLoader = prismaScheduleLoader;
exports.runSourceWatch = runSourceWatch;
exports.listWatchedSources = listWatchedSources;
exports.boardSourceView = boardSourceView;
exports.acknowledgeWatchedSource = acknowledgeWatchedSource;
/**
 * Стеження за зовнішніми джерелами розкладу (Docs/korosten-transport-2026-11.md, фаза 1; ціни міжміських маршруток —
 * Docs/fare-source-watch-2026-11.md).
 *
 * Раз на TRANSPORT_SOURCE_WATCH_INTERVAL_MIN бекенд робить по одному запиту на джерело, рахує відбиток
 * вмісту й порівнює з останнім збереженим (WatchedSource). Змінився — власник отримує одне повідомлення в
 * адмін-чат: яке джерело і які його частини (таблиці маршрутів, файли набору, рейси табло, записи стрічки). Перший
 * запуск лише запам'ятовує стан. Відбиток — це вміст, а не дата зміни сторінки: пересохранення без правок сповіщення не
 * дає. Табло автовокзалу (`group: 'board'`) ходить окремим, рідшим таймером TRANSPORT_BOARD_WATCH_INTERVAL_MIN.
 * Нагляд лише сигналізує — нічого не пише в `Schedule`.
 */
const node_crypto_1 = require("node:crypto");
const korosten_source_parser_1 = require("./korosten-source-parser");
const zhytomyr_board_parser_1 = require("./zhytomyr-board-parser");
const CKAN = 'https://data.gov.ua/api/3/action/package_show?id=';
const ckanSource = (key, id, label, cityCode = 'Korosten') => ({
    key,
    kind: 'ckan',
    cityCode,
    label,
    url: `https://data.gov.ua/dataset/${id}`,
    fetchUrl: CKAN + id,
});
const KOROSTEN_TIMETABLE_URL = 'https://korosten-rada.gov.ua/miska-rada/upravlinnya-ta-viddily/upravlinnya-ekonomiky/viddil-misczevogo-ekonomichnogo-rozvytku/transport/miskyj-transport/rozklad-ruhu-miskogo-transportu-rozklad-ruhu-avtobusiv-na-period-vijskovogo-stanu/';
/** Табло АС Житомир-1: лише HTTP (TLS у них нема); `bus.com.ua/cgi-bin/tablo.pl?as=180100` — запасний адрес для людини, не для робота */
exports.ZHYTOMYR_BOARD_URL = 'http://tablo.bus-ua.info/zhytomyr';
exports.ZHYTOMYR_BOARD_ATTRIBUTION = 'за даними табло автовокзалу Житомир-1 (МПП «ВПІ»)';
const MALYN_MEDIA_STATION_URL = 'https://malyn.media/statti/korysne/avtostantsiia-malyn-rozklad-avtobusiv-telefony-ta-rezhym-roboty/';
/** Так оголошують тариф «Зубастика»: слова шукаються в заголовку й описі запису стрічки */
exports.MALYN_MEDIA_KEYWORDS = ['подорожча', 'маршрутк', 'тариф', 'зубастик'];
/** Джерела — у коді; опис кожного в data/korosten-transport/SOURCES.md і Docs/fare-source-watch-2026-11.md */
exports.WATCHED_SOURCES = [
    {
        key: 'korosten-rada-timetable',
        kind: 'html-tables',
        cityCode: 'Korosten',
        label: 'Коростень: розклад автобусів на сайті ради',
        url: KOROSTEN_TIMETABLE_URL,
        fetchUrl: KOROSTEN_TIMETABLE_URL,
        parser: 'korosten-timetable',
    },
    ckanSource('korosten-routes', 'd8a2158e-5ee4-48cf-a2b7-1532336ce563', 'Коростень: перевізники й маршрути (data.gov.ua)'),
    ckanSource('korosten-stops', 'c8bfaca6-97d6-451a-9dbc-68d2b745ddd3', 'Коростень: зупинки (data.gov.ua)'),
    ckanSource('korosten-trips', '9b85050b-175b-4e51-a149-a6cb1fcb815e', 'Коростень: розклад руху (data.gov.ua)'),
    ckanSource('korosten-realtime', 'e8e28884-1158-4a01-b975-04f2b4e167e7', 'Коростень: транспорт у реальному часі (data.gov.ua)'),
    {
        key: 'zhytomyr-board-malyn',
        kind: 'bus-board',
        cityCode: 'Malyn',
        label: 'Табло АС Житомир-1: рейси через Малин (ціни Житомир → Малин)',
        url: exports.ZHYTOMYR_BOARD_URL,
        fetchUrl: exports.ZHYTOMYR_BOARD_URL,
        group: 'board',
        minGapMin: 60,
        place: 'Малин',
        scheduleRoute: 'Zhytomyr-Malyn',
        attribution: exports.ZHYTOMYR_BOARD_ATTRIBUTION,
    },
    ckanSource('ukrtransbezpeka-interregional-routes', '6ca93112-18a1-48a5-b85c-1e112163faba', 'Укртрансбезпека: реєстр міжобласних маршрутів (data.gov.ua)', 'Malyn'),
    ckanSource('ukrtransbezpeka-interregional-network', '1b428b3e-d613-43a2-9781-94c26959db06', 'Укртрансбезпека: мережа міжобласних маршрутів (data.gov.ua)', 'Malyn'),
    ckanSource('malyn-rada-timetable', 'e8cc5430-6833-4f8c-9a9d-693be847f79f', 'Малин: розклад міського транспорту (data.gov.ua)', 'Malyn'),
    ckanSource('malyn-rada-stops', '8fdbb2c4-156c-496d-91e9-0510b1641685', 'Малин: зупинки міського транспорту (data.gov.ua)', 'Malyn'),
    ckanSource('malyn-rada-carriers', 'f61d2487-11eb-43bf-8f81-43db0130d657', 'Малин: перевізники (data.gov.ua)', 'Malyn'),
    {
        key: 'malyn-media-station',
        kind: 'html-tables',
        cityCode: 'Malyn',
        label: 'malyn.media: стаття «Автостанція Малин» (розклад відправлень)',
        url: MALYN_MEDIA_STATION_URL,
        fetchUrl: MALYN_MEDIA_STATION_URL,
        parser: 'station-table',
    },
    {
        key: 'malyn-media-feed',
        kind: 'rss',
        cityCode: 'Malyn',
        label: 'malyn.media: новини про маршрутки й тарифи (стрічка)',
        url: 'https://malyn.media/',
        fetchUrl: 'https://malyn.media/feed/',
        keywords: exports.MALYN_MEDIA_KEYWORDS,
    },
];
/** Скільки невдалих перевірок поспіль до одного сповіщення «джерело не відповідає» */
exports.SOURCE_FAIL_ALERT_AFTER = 4;
const FETCH_TIMEOUT_MS = 25000;
const ADMIN_PAGE_URL = 'https://malin.kiev.ua/admin/route-schedule';
/** Запити нагляду називають сайт і де нас знайти — за правилами ввічливого робота */
exports.SOURCE_WATCH_USER_AGENT = 'malin.kiev.ua transport-source-watch/1.1 (+https://malin.kiev.ua/about)';
/** Скільки раніше бачених записів стрічки пам'ятати (щоб запис, що випав з 20 останніх, не дав «зникло») */
const RSS_SEEN_LIMIT = 300;
const sha = (text) => (0, node_crypto_1.createHash)('sha256').update(text).digest('hex').slice(0, 16);
function fingerprintOf(parts) {
    return sha(Object.keys(parts)
        .sort()
        .map((k) => `${k}=${parts[k]}`)
        .join('\n'));
}
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '-', mdash: '-', lt: '<', gt: '>' };
/** Текст фрагмента HTML: курсив лишається позначкою «_» (у розкладі ради курсив = інший шлях рейсу) */
function normalizeHtmlText(html) {
    return html
        .replace(/<\s*\/?\s*(em|i)\b[^>]*>/gi, '_')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')
        .replace(/_\s*_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const ROUTE_HEADING_RE = /Маршрут\s*№\s*([0-9]+(?:\s*-\s*[А-ЯІЇЄҐа-яіїєґA-Za-z])?)/g;
/** Таблиці сторінки з назвою кожної: номер маршруту із заголовка перед таблицею («№2-Б») або «таблиця N» */
function htmlTables(html) {
    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    const tables = [...html.matchAll(tableRe)];
    const used = new Set();
    return tables.map((m, i) => {
        const start = m.index ?? 0;
        const prevEnd = i > 0 ? (tables[i - 1].index ?? 0) + tables[i - 1][0].length : 0;
        const before = normalizeHtmlText(html.slice(prevEnd, start));
        const headings = [...before.matchAll(ROUTE_HEADING_RE)];
        const no = headings.length ? headings[headings.length - 1][1].replace(/\s+/g, '') : '';
        let label = no ? `№${no}` : `таблиця ${i + 1}`;
        while (used.has(label))
            label += '′';
        used.add(label);
        return { label, html: m[0], start, end: start + m[0].length };
    });
}
/**
 * Сторінка з таблицями розкладу: частина = таблиця + примітки «* …» під нею, назва — номер маршруту із
 * заголовка перед таблицею («№2-Б»). Сторінка без таблиць — помилка (заглушка, капча), а не «зміна».
 */
function snapshotHtmlTables(html) {
    const parts = {};
    const tables = htmlTables(html);
    if (!tables.length)
        throw new Error('на сторінці немає таблиць');
    tables.forEach((t, i) => {
        // Примітки між цією таблицею й наступним заголовком; після останньої — лише найближчий текст
        const nextStart = i + 1 < tables.length ? tables[i + 1].start : Math.min(html.length, t.end + 600);
        const after = normalizeHtmlText(html.slice(t.end, nextStart)).split(/Маршрут\s*№/)[0];
        const notes = (after.match(/\*[^*]{3,300}/g) ?? []).map((s) => s.trim()).join(' ');
        parts[t.label] = sha(`${normalizeHtmlText(t.html)}\n${notes}`);
    });
    const modified = html.match(/article:modified_time"\s+content="([^"]+)"/)?.[1] ?? null;
    return { fingerprint: fingerprintOf(parts), parts, modified };
}
/** Парсер `station-table`: рядки кожної таблиці як текст («06:30 Малин — Житомир через Радомишль»), без шапки */
function stationTableItems(html) {
    const out = {};
    for (const t of htmlTables(html)) {
        const rows = [...t.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
            .map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => normalizeHtmlText(c[1])).filter(Boolean).join(' '))
            .filter((line) => line && /\d/.test(line));
        out[t.label] = rows;
    }
    return out;
}
/** Набір data.gov.ua (CKAN package_show): частина = файл набору, відбиток — дата зміни файлу й адреса */
function snapshotCkanPackage(json) {
    const body = JSON.parse(json);
    if (body?.success !== true || !body.result || !Array.isArray(body.result.resources)) {
        throw new Error('data.gov.ua: неочікувана відповідь');
    }
    const parts = {};
    for (const res of body.result.resources) {
        let label = String(res.name || res.id || 'файл').slice(0, 80);
        while (label in parts)
            label += '′';
        parts[label] = sha(`${res.last_modified ?? ''}|${res.url ?? ''}|${res.size ?? ''}`);
    }
    return { fingerprint: fingerprintOf(parts), parts, modified: body.result.metadata_modified ?? null };
}
/**
 * Табло автовокзалу: частина = напрямок («Житомир → Малин»), відбиток — набір (час, ціна, перевізник) його рейсів.
 * Місця, статус продажу й модель автобуса міняються щодня і у відбиток не входять.
 */
function snapshotBusBoard(html, place) {
    const board = (0, zhytomyr_board_parser_1.parseZhytomyrBoard)(html, place);
    const items = (0, zhytomyr_board_parser_1.boardItems)(board.trips);
    const parts = {};
    for (const [label, lines] of Object.entries(items))
        parts[label] = sha([...lines].sort().join('\n'));
    return { fingerprint: fingerprintOf(parts), parts, modified: null, items, board: board.trips, boardDate: board.date };
}
const RSS_PART = 'записи';
const cdata = (s) => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
const tag = (xml, name) => cdata(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '');
/** Записи стрічки RSS 2.0 / Atom-подібної: заголовок, посилання, дата, і чи є в заголовку або описі одне зі слів */
function parseRssEntries(xml, keywords = []) {
    const items = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
    if (!items.length)
        throw new Error('у стрічці немає записів');
    const all = [];
    const matching = [];
    const words = keywords.map((w) => w.toLocaleLowerCase('uk-UA'));
    for (const m of items) {
        const body = m[1];
        const title = tag(body, 'title');
        const link = tag(body, 'link') || body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || tag(body, 'guid');
        if (!title && !link)
            continue;
        const entry = { title, link, pubDate: tag(body, 'pubDate') || tag(body, 'updated') || tag(body, 'published') };
        all.push(entry);
        const haystack = `${title} ${tag(body, 'description')} ${tag(body, 'summary')}`.toLocaleLowerCase('uk-UA');
        if (!words.length || words.some((w) => haystack.includes(w)))
            matching.push(entry);
    }
    return { all, matching };
}
/** Стрічка новин: частина = запис зі словами з фільтра (ключ — посилання), рядок — «заголовок · посилання» */
function snapshotRssFeed(xml, keywords = []) {
    const { matching } = parseRssEntries(xml, keywords);
    const parts = {};
    const lines = [];
    for (const e of matching) {
        const key = (e.link || e.title).slice(0, 200);
        if (key in parts)
            continue;
        parts[key] = sha(e.title);
        lines.push(e.link ? `${e.title} · ${e.link}` : e.title);
    }
    const modified = xml.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/i)?.[1]?.trim() ?? null;
    return { fingerprint: fingerprintOf(parts), parts, modified, items: { [RSS_PART]: lines } };
}
/**
 * Стрічка показує лише останні записи: раніше бачені збіги лишаються в деталях рядка, тож запис, що випав зі стрічки,
 * не дає «зникло», а новий збіг — єдина можлива зміна.
 */
function mergeRssSnapshot(prev, snap) {
    const prevParts = prev.parts ?? {};
    const prevLines = prev.items?.[RSS_PART] ?? [];
    const parts = { ...prevParts, ...snap.parts };
    const keys = Object.keys(parts);
    for (const k of keys.slice(0, Math.max(0, keys.length - RSS_SEEN_LIMIT)))
        delete parts[k];
    const lines = [...prevLines, ...(snap.items?.[RSS_PART] ?? []).filter((l) => !prevLines.includes(l))].slice(-RSS_SEEN_LIMIT);
    return { ...snap, parts, fingerprint: fingerprintOf(parts), items: { [RSS_PART]: lines } };
}
/** Які частини відрізняються: змінені, нові («… (нове)») і зниклі («… (зникло)») */
function changedParts(prev, next) {
    const out = [];
    for (const k of Object.keys(next)) {
        if (!(k in prev))
            out.push(`${k} (нове)`);
        else if (prev[k] !== next[k])
            out.push(k);
    }
    for (const k of Object.keys(prev))
        if (!(k in next))
            out.push(`${k} (зникло)`);
    return out;
}
function takeSnapshot(def, body) {
    if (def.kind === 'ckan')
        return snapshotCkanPackage(body);
    if (def.kind === 'bus-board')
        return snapshotBusBoard(body, def.place);
    if (def.kind === 'rss')
        return snapshotRssFeed(body, def.keywords);
    const snap = snapshotHtmlTables(body);
    if (def.parser === 'korosten-timetable') {
        try {
            snap.items = (0, korosten_source_parser_1.timetableItems)((0, korosten_source_parser_1.parseKorostenTimetable)(body));
        }
        catch {
            // Верстку змінили так, що парсер не впорався: стеження лишається на хешах таблиць
        }
    }
    else if (def.parser === 'station-table') {
        snap.items = stationTableItems(body);
    }
    return snap;
}
const CHANGE_LINES_PER_PART = 8;
/**
 * Що саме змінилось у частинах: «№6: − 07:00–07:25 …» / «№6: + 07:05–07:30 …». Частини без рядків
 * (не було парсера або це перше порівняння після його появи) пропускаються — їх називає changedParts.
 */
function describeChanges(prev, next) {
    if (!prev || !next)
        return [];
    const out = [];
    for (const part of Object.keys(next)) {
        const before = prev[part];
        if (!before)
            continue;
        const after = next[part];
        const removed = before.filter((line) => !after.includes(line)).map((line) => `− ${line}`);
        const added = after.filter((line) => !before.includes(line)).map((line) => `+ ${line}`);
        const lines = [...removed, ...added];
        if (!lines.length)
            continue;
        lines.slice(0, CHANGE_LINES_PER_PART).forEach((line) => out.push(`${part}: ${line}`));
        if (lines.length > CHANGE_LINES_PER_PART)
            out.push(`${part}: … ще ${lines.length - CHANGE_LINES_PER_PART}`);
    }
    return out;
}
/** Опис зміни за видом джерела: табло — по рейсах (ціна була → стала), решта — рядки «−/+» по частинах */
function describeSourceChanges(def, prev, next) {
    if (def.kind === 'bus-board')
        return (0, zhytomyr_board_parser_1.describeBoardChanges)(prev.items, next.items);
    return describeChanges(prev.items, next.items);
}
/** Один звичайний GET із User-Agent, що називає сайт; не-200 — помилка */
async function fetchSourceText(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': exports.SOURCE_WATCH_USER_AGENT, Accept: 'text/html,application/xml,application/rss+xml,application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return res.text();
}
/** Рядки `Schedule` одного маршруту (маршрутки) з Prisma — для звірки табло з базою */
function prismaScheduleLoader(prisma) {
    return async (routeSlug) => prisma.schedule.findMany({
        where: { route: routeSlug, vehicleType: 'marshrutka' },
        select: { id: true, departureTime: true, priceUah: true },
        orderBy: { departureTime: 'asc' },
    });
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ALERT_TITLE = {
    'html-tables': '🚌 <b>Джерело розкладу змінилось</b>',
    ckan: '🚌 <b>Джерело розкладу змінилось</b>',
    'bus-board': '💸 <b>Табло автовокзалу змінилось</b>',
    rss: '📰 <b>Новина про маршрутки чи тариф</b>',
};
function changeAlertHtml(def, changed, lines = [], dbLines = []) {
    return (`${ALERT_TITLE[def.kind]}\n${esc(def.label)}\n` +
        (changed.length && def.kind !== 'rss' ? `Змінилось: ${esc(changed.join(', '))}\n` : '') +
        (lines.length ? `${esc(lines.join('\n')).slice(0, 2500)}\n` : '') +
        (dbLines.length ? `База (${esc(def.scheduleRoute ?? '')}):\n${esc(dbLines.join('\n')).slice(0, 1200)}\n` : '') +
        (def.attribution ? `${esc(def.attribution)}\n` : '') +
        `<a href="${esc(def.url)}">Відкрити джерело</a>\n` +
        `Після перевірки — «Переглянуто»: ${ADMIN_PAGE_URL}`);
}
function failAlertHtml(def, error) {
    return (`⚠️ <b>Джерело розкладу не відповідає</b> (${exports.SOURCE_FAIL_ALERT_AFTER} перевірки поспіль)\n${esc(def.label)}\n` +
        `Помилка: ${esc(error)}\n<a href="${esc(def.url)}">Відкрити джерело</a>`);
}
const detailsOf = (value) => (value && typeof value === 'object' ? value : {});
const snapshotDetails = (snap) => ({
    parts: snap.parts,
    modified: snap.modified,
    items: snap.items,
    ...(snap.board ? { board: snap.board, boardDate: snap.boardDate ?? null } : {}),
});
/** Розходження табло з базою для сповіщення; без завантажувача або без маршруту — порожньо */
async function boardVsDbLines(def, snap, deps) {
    if (def.kind !== 'bus-board' || !def.scheduleRoute || !deps.loadSchedules || !snap.board)
        return [];
    try {
        const schedules = await deps.loadSchedules(def.scheduleRoute);
        return (0, zhytomyr_board_parser_1.describeBoardVsSchedules)((0, zhytomyr_board_parser_1.compareBoardWithSchedules)(snap.board, schedules, def.place));
    }
    catch (e) {
        console.error(`[source-watch] ${def.key}: schedules`, e);
        return [];
    }
}
/**
 * Одна перевірка всіх джерел. Сповіщення — не більше одного на зміну: рядок переводиться на новий відбиток
 * умовним updateMany за старим відбитком, тож таймер, ручний запуск і два контейнери під час деплою не дублюють.
 * Джерело з `minGapMin`, перевірене нещодавно, пропускається (`skipped`) — табло не запитується частіше ніж раз на годину.
 */
async function runSourceWatch(prisma, deps) {
    const results = [];
    for (const def of deps.sources) {
        const now = deps.now();
        const row = await prisma.watchedSource.findUnique({ where: { key: def.key } });
        if (def.minGapMin && row?.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < def.minGapMin * 60000) {
            results.push({ key: def.key, status: 'skipped' });
            continue;
        }
        let snap;
        try {
            snap = takeSnapshot(def, await deps.fetchText(def.fetchUrl));
        }
        catch (e) {
            const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
            const prevFails = row?.failCount ?? 0;
            let claimed = false;
            if (row) {
                const r = await prisma.watchedSource.updateMany({
                    where: { key: def.key, failCount: prevFails },
                    data: { failCount: prevFails + 1, lastError: error, lastCheckedAt: now },
                });
                claimed = r.count === 1;
            }
            else {
                await prisma.watchedSource.upsert({
                    where: { key: def.key },
                    create: { key: def.key, failCount: 1, lastError: error, lastCheckedAt: now },
                    update: { lastError: error, lastCheckedAt: now },
                });
            }
            let notified = false;
            if (claimed && prevFails + 1 === exports.SOURCE_FAIL_ALERT_AFTER) {
                notified = Boolean(await deps.notify(failAlertHtml(def, error)));
            }
            results.push({ key: def.key, status: 'error', error, notified });
            continue;
        }
        const ok = { lastCheckedAt: now, failCount: 0, lastError: null };
        if (!row || row.fingerprint == null) {
            const details = snapshotDetails(snap);
            await prisma.watchedSource.upsert({
                where: { key: def.key },
                create: { key: def.key, fingerprint: snap.fingerprint, details, ...ok },
                update: { fingerprint: snap.fingerprint, details, ...ok },
            });
            results.push({ key: def.key, status: 'baseline' });
            continue;
        }
        const prev = detailsOf(row.details);
        if (def.kind === 'rss')
            snap = mergeRssSnapshot(prev, snap);
        if (row.fingerprint === snap.fingerprint) {
            await prisma.watchedSource.update({
                where: { key: def.key },
                data: { ...ok, details: { ...prev, ...snapshotDetails(snap), items: snap.items ?? prev.items } },
            });
            results.push({ key: def.key, status: 'unchanged' });
            continue;
        }
        const changed = changedParts(prev.parts ?? {}, snap.parts);
        const changeLines = describeSourceChanges(def, prev, snap);
        const claim = await prisma.watchedSource.updateMany({
            where: { key: def.key, fingerprint: row.fingerprint },
            data: {
                ...ok,
                fingerprint: snap.fingerprint,
                details: { ...snapshotDetails(snap), changed, changeLines },
                lastChangedAt: now,
                acknowledgedAt: null,
            },
        });
        let notified = false;
        if (claim.count === 1) {
            const dbLines = await boardVsDbLines(def, snap, deps);
            notified = Boolean(await deps.notify(changeAlertHtml(def, changed, changeLines, dbLines)));
        }
        results.push({ key: def.key, status: 'changed', changed, notified });
    }
    return results;
}
/** Адмінка: усі джерела з коду + їхній стан із бази */
async function listWatchedSources(prisma, sources = exports.WATCHED_SOURCES) {
    const rows = await prisma.watchedSource.findMany({ where: { key: { in: sources.map((s) => s.key) } } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return sources.map((def) => {
        const row = byKey.get(def.key);
        const details = detailsOf(row?.details);
        const changedAt = row?.lastChangedAt ?? null;
        const ackAt = row?.acknowledgedAt ?? null;
        return {
            key: def.key,
            kind: def.kind,
            cityCode: def.cityCode,
            label: def.label,
            url: def.url,
            group: def.group ?? null,
            attribution: def.attribution ?? null,
            modified: details.modified ?? null,
            lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
            lastChangedAt: changedAt?.toISOString() ?? null,
            acknowledgedAt: ackAt?.toISOString() ?? null,
            pending: Boolean(changedAt && (!ackAt || ackAt < changedAt)),
            changed: Array.isArray(details.changed) ? details.changed : [],
            changeLines: Array.isArray(details.changeLines) ? details.changeLines : [],
            parts: Object.keys(details.parts ?? {}).length,
            failCount: row?.failCount ?? 0,
            lastError: row?.lastError ?? null,
        };
    });
}
/** Адмінка: останній знімок табло таблицею рейсів і звірка з базою; null — джерело не табло або ще не перевірялось */
async function boardSourceView(prisma, def, loadSchedules) {
    if (def.kind !== 'bus-board')
        return null;
    const row = await prisma.watchedSource.findUnique({ where: { key: def.key } });
    const details = detailsOf(row?.details);
    const trips = Array.isArray(details.board) ? details.board : [];
    const schedules = def.scheduleRoute && loadSchedules ? await loadSchedules(def.scheduleRoute) : [];
    return {
        key: def.key,
        label: def.label,
        url: def.url,
        attribution: def.attribution ?? null,
        boardDate: details.boardDate ?? null,
        lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
        trips,
        scheduleRoute: def.scheduleRoute ?? null,
        comparison: def.scheduleRoute ? (0, zhytomyr_board_parser_1.compareBoardWithSchedules)(trips, schedules, def.place) : [],
    };
}
/** «Переглянуто»: власник подивився зміну. false — джерела з таким ключем немає в базі */
async function acknowledgeWatchedSource(prisma, key, now = new Date()) {
    const r = await prisma.watchedSource.updateMany({ where: { key }, data: { acknowledgedAt: now } });
    return r.count > 0;
}
