"use strict";
/**
 * Парсер сторінки «Розклад руху міського транспорту» Коростенської міської ради
 * (Docs/korosten-transport-2026-11.md, фаза 2; опис джерела — data/korosten-transport/SOURCES.md).
 *
 * Сторінка — дев'ять HTML-таблиць ручної верстки. Рядок = пара кінцевих + час відправлення й прибуття
 * («6-20») для одного або двох графіків (автобусів). «Перерва» — обід графіка, «*» — рейс із приміткою
 * (зазвичай «не виконуються в суботу та неділю»), курсив — рейс іншим шляхом (№6 по вул. Південній).
 * Чиста функція: HTML → структура; мережі й бази не торкається.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitTermini = splitTermini;
exports.extractTimetableFragment = extractTimetableFragment;
exports.parseKorostenTimetable = parseKorostenTimetable;
exports.describeRun = describeRun;
exports.timetableItems = timetableItems;
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '–', mdash: '—', lt: '<', gt: '>' };
/** Текст фрагмента: курсив → «_», теги геть, сутності розкодовано, пробіли зведено; тире лишаються як є */
function text(html) {
    return html
        .replace(/<\s*\/?\s*(em|i)\b[^>]*>/gi, '_')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
        .replace(/[  -​ ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const plain = (s) => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
/** Відомі описки джерела в назвах кінцевих */
const NAME_FIXES = [[/^с\s+танція(?=\s|$)/i, 'станція']];
function stopName(raw) {
    let name = plain(raw);
    for (const [re, to] of NAME_FIXES)
        name = name.replace(re, to);
    return name ? name[0].toUpperCase() + name.slice(1) : name;
}
/**
 * «Залізничний вокзал- Поліське водосховище», «Романа Шухевича–Залізничний вокзал», «Коростень-Грозине – Київська»:
 * роздільник — довге тире або дефіс із пробілом хоча б з одного боку; голий дефіс ділить лише тоді, коли іншого
 * роздільника в рядку нема (інакше він частина назви).
 */
function splitTermini(label) {
    let note = null;
    const withoutNote = plain(label).replace(/\(([^)]*)\)/g, (_m, inner) => {
        note = plain(inner);
        return ' ';
    });
    let parts = withoutNote.split(/\s*[–—]\s*|\s+-\s*|\s*-\s+/);
    if (parts.filter((p) => p.trim()).length < 2)
        parts = withoutNote.split('-');
    return { stops: parts.map(stopName).filter(Boolean), note };
}
const TIME_RE = /(\d{1,2})\s*-\s*(\d{2})/;
function parseTime(cell) {
    const m = cell.match(TIME_RE);
    if (!m)
        return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 29 || min > 59)
        return null;
    return { time: `${String(h).padStart(2, '0')}:${m[2]}`, starred: cell.includes('*'), italic: cell.includes('_') };
}
function tableRows(tableHtml) {
    return [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((c) => ({
        text: text(c[2]),
        span: Math.max(1, Number(c[1].match(/colspan\s*=\s*"?(\d+)/i)?.[1] ?? 1)),
    })));
}
const expand = (row) => row.flatMap((c) => Array.from({ length: c.span }, () => c.text));
const WEEKDAYS_ONLY_RE = /не\s+викону\S+\s+в\s+суботу\s+та\s+неділю/i;
const HEADING_RE = /Маршрут\s*№\s*([0-9]+(?:\s*-\s*[А-ЯІЇЄҐа-яіїєґA-Za-z])?)\s*[«"“„]?([^»"”(]*)/g;
function readNotes(noteTexts) {
    let starNote = null;
    let italicNote = null;
    for (const raw of noteTexts) {
        const t = plain(raw);
        const italic = t.match(/Рейси\s+помічені\s+курсивом\s+(.+)$/i);
        if (italic)
            italicNote = italic[1].trim();
        const star = t.replace(/Рейси\s+помічені\s+курсивом.*$/i, '').match(/\*\s*(Рейс[^*]*)/i);
        if (star && !starNote)
            starNote = star[1].trim();
    }
    return { starNote, starWeekdaysOnly: starNote ? WEEKDAYS_ONLY_RE.test(starNote) : false, italicNote };
}
function parseTable(tableHtml, outsideNotes) {
    const rows = tableRows(tableHtml);
    const blocks = Math.max(1, ...rows.map((r) => r.filter((c) => /^Відправ/i.test(c.text)).length));
    const noteTexts = [...outsideNotes];
    const raw = [];
    const breaks = [];
    const runsInBlock = new Map();
    for (const row of rows) {
        const cells = expand(row);
        if (!cells.length || cells.some((c) => /^(Назва кінцевих|Відправ|Графік)/i.test(c)))
            continue;
        // Примітка рядком на всю ширину таблиці
        if (row.length === 1 && row[0].span > 1 && !/^Перерва$/i.test(plain(row[0].text))) {
            noteTexts.push(row[0].text);
            continue;
        }
        const termini = splitTermini(cells[0]);
        for (let b = 0; b < blocks; b += 1) {
            const dep = cells[1 + b * 2] ?? '';
            const arr = cells[2 + b * 2] ?? '';
            const block = b + 1;
            if (/Перерва/i.test(dep)) {
                const afterRun = runsInBlock.get(block) ?? 0;
                if (!breaks.some((x) => x.block === block && x.afterRun === afterRun))
                    breaks.push({ block, afterRun });
                continue;
            }
            const d = parseTime(dep);
            const a = parseTime(arr);
            if (!d || !a || termini.stops.length < 2)
                continue;
            runsInBlock.set(block, (runsInBlock.get(block) ?? 0) + 1);
            raw.push({
                block,
                from: termini.stops[0],
                to: termini.stops[termini.stops.length - 1],
                via: termini.stops.slice(1, -1),
                departure: d.time,
                arrival: a.time,
                starred: d.starred || a.starred,
                italic: d.italic || a.italic,
                note: termini.note,
            });
        }
    }
    const notes = readNotes(noteTexts);
    const runs = raw.map((r) => ({ ...r, days: r.starred && notes.starWeekdaysOnly ? 'weekdays' : 'everyday' }));
    // Спершу весь графік 1, потім графік 2; усередині графіка — порядок рядків таблиці (sort стабільний)
    runs.sort((x, y) => x.block - y.block);
    return { blocks, runs, breaks, ...notes };
}
/**
 * Частина сторінки з розкладом — від заголовка першого маршруту до приміток під останньою таблицею, без
 * шапки, меню й скриптів сайту; дата зміни сторінки лишається в <meta>. Це й зберігається в репозиторії
 * (data/korosten-transport/source/rada-timetable.html): парсер дає з фрагмента те саме, що з повної сторінки.
 */
function extractTimetableFragment(pageHtml) {
    const html = pageHtml.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
    if (!tables.length)
        throw new Error('на сторінці немає таблиць розкладу');
    const first = tables[0].index ?? 0;
    const heading = html.lastIndexOf('Маршрут', first);
    const start = heading >= 0 ? Math.max(0, html.lastIndexOf('<', heading)) : first;
    const last = tables[tables.length - 1];
    const end = Math.min(html.length, (last.index ?? 0) + last[0].length + 600);
    const modified = pageHtml.match(/article:modified_time"\s+content="([^"]+)"/)?.[1];
    const meta = modified ? `<meta property="article:modified_time" content="${modified}" />\n` : '';
    // Атрибути оформлення не несуть змісту й роздувають файл; colspan/rowspan лишаються
    const body = html
        .slice(start, end)
        .replace(/\s(?:style|class|width|height|valign|align|data-[\w-]+|id)\s*=\s*"[^"]*"/gi, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    return `${meta}${body.replace(/<[^<]*$/, '')}\n`;
}
/** Уся сторінка → маршрути. Сторінка без жодної таблиці розкладу — помилка. */
function parseKorostenTimetable(pageHtml) {
    const html = pageHtml.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
    const routes = [];
    tables.forEach((m, i) => {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const prevEnd = i > 0 ? (tables[i - 1].index ?? 0) + tables[i - 1][0].length : 0;
        const headings = [...text(html.slice(prevEnd, start)).matchAll(HEADING_RE)];
        if (!headings.length)
            return;
        const heading = headings[headings.length - 1];
        // Примітки під таблицею — до заголовка наступного маршруту
        const nextStart = i + 1 < tables.length ? (tables[i + 1].index ?? html.length) : Math.min(html.length, end + 600);
        const after = text(html.slice(end, nextStart)).split(/Маршрут\s*№/)[0];
        const outsideNotes = (after.match(/\*\s*Рейс[^*]{3,300}/g) ?? []).map((s) => s.trim());
        const parsed = parseTable(m[0], outsideNotes);
        if (!parsed.runs.length)
            return;
        routes.push({ number: heading[1].replace(/\s+/g, ''), title: plain(heading[2]), ...parsed });
    });
    if (!routes.length)
        throw new Error('на сторінці немає таблиць розкладу');
    const modified = pageHtml.match(/article:modified_time"\s+content="([^"]+)"/)?.[1] ?? null;
    return { modified, routes };
}
/** Рядок рейсу для людини й для порівняння: «06:20–06:45 Залізничний вокзал → Поліське водосховище · графік 2 *» */
function describeRun(run, blocks) {
    const path = [run.from, ...run.via, run.to].join(' → ');
    return (`${run.departure}–${run.arrival} ${path}` +
        (blocks > 1 ? ` · графік ${run.block}` : '') +
        (run.note ? ` (${run.note})` : '') +
        (run.italic ? ' · курсив' : '') +
        (run.starred ? ' *' : ''));
}
/** Для стеження: частина «№N» → рядки рейсів і приміток цього маршруту */
function timetableItems(timetable) {
    const out = {};
    for (const route of timetable.routes) {
        const lines = route.runs.map((r) => describeRun(r, route.blocks));
        if (route.starNote)
            lines.push(`примітка *: ${route.starNote}`);
        if (route.italicNote)
            lines.push(`курсив: ${route.italicNote}`);
        out[`№${route.number}`] = lines;
    }
    return out;
}
