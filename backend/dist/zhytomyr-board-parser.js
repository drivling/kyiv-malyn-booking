"use strict";
/**
 * Парсер табло автостанції Житомир-1 — система «Автовокзал-Сеть» МПП «ВПІ», `http://tablo.bus-ua.info/zhytomyr`
 * (Docs/fare-source-watch-2026-11.md, фаза 1). Єдине живе джерело цін на маршрутки Житомир → Малин.
 *
 * Сторінка — одна таблиця `tablo_table`: рядок = час | маршрут «ЖИТОМИР (ZHYTOMYR) - МАЛИН (MALYN)» | місць | статус |
 * автобус + перевізник | % регулярності | прибуття | ціна «334,80». Рядки з однією клітинкою — заголовки дат (табло показує
 * сьогодні й завтра), тому той самий рейс трапляється двічі й рахується один раз.
 * Чиста функція: HTML → структура; мережі й бази не торкається.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.directionLabel = void 0;
exports.titleCase = titleCase;
exports.normalizeCarrier = normalizeCarrier;
exports.parseBoardPrice = parseBoardPrice;
exports.formatBoardPrice = formatBoardPrice;
exports.parseZhytomyrBoard = parseZhytomyrBoard;
exports.describeBoardTrip = describeBoardTrip;
exports.boardItems = boardItems;
exports.describeBoardChanges = describeBoardChanges;
exports.compareBoardWithSchedules = compareBoardWithSchedules;
exports.describeBoardVsSchedules = describeBoardVsSchedules;
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '–', mdash: '—', lt: '<', gt: '>' };
function text(html) {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
        .replace(/[\u00a0\u2000-\u200b]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Латинські літери, що на табло стоять замість кириличних («РIМ-Богдан», «В продажi») */
const LOOKALIKES = {
    A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х',
    a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х',
};
const cyrillic = (s) => s.replace(/[A-Za-z]/g, (ch) => LOOKALIKES[ch] ?? ch);
/** «ЖИТОМИР» → «Житомир», «НОВОГРАД-ВОЛИНСЬКИЙ» → «Новоград-Волинський» */
function titleCase(name) {
    return name
        .toLocaleLowerCase('uk-UA')
        .replace(/(^|[\s\-'’])(\p{L})/gu, (_m, sep, ch) => sep + ch.toLocaleUpperCase('uk-UA'));
}
/** Одне написання перевізника: лише кирилиця (де латиниця схожа), великі літери, прості лапки */
function normalizeCarrier(raw) {
    return cyrillic(text(raw)).replace(/[«»“”„]/g, '"').toLocaleUpperCase('uk-UA').replace(/\s+/g, ' ').trim();
}
const TIME_RE = /(\d{1,2}):(\d{2})/;
const timeOf = (s) => {
    const m = s.match(TIME_RE);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
/** «334,80» → 334.8; порожня клітинка або щось інше → null */
function parseBoardPrice(s) {
    const m = text(s).replace(/\s/g, '').match(/^(\d+)(?:[.,](\d{1,2}))?$/);
    if (!m)
        return null;
    return Number(`${m[1]}.${(m[2] ?? '0').padEnd(2, '0')}`);
}
/** 334.8 → «334,80» */
function formatBoardPrice(n) {
    if (n == null)
        return 'без ціни';
    return n.toFixed(2).replace('.', ',');
}
function pointName(cellHtml, which) {
    const div = cellHtml.match(new RegExp(`point_${which}_div"[^>]*>([\\s\\S]*?)</div>`, 'i'));
    if (!div)
        return null;
    // транслітерація в дужках — окремий span; після неї лишається «ЖИТОМИР» або «- МАЛИН»
    const raw = text(div[1].replace(/<span[^>]*point_(?:from|to)_tr[^>]*>[\s\S]*?<\/span>/gi, ' '));
    const name = raw.replace(/^[\s\-–—]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return name ? titleCase(cyrillic(name)) : null;
}
function parseRow(cells) {
    const time = timeOf(text(cells[0]));
    const from = pointName(cells[1], 'from');
    const to = pointName(cells[1], 'to');
    if (!time || !from || !to)
        return null;
    const seatsText = text(cells[2]);
    const seats = /^\d+$/.test(seatsText) ? Number(seatsText) : null;
    const status = text(cells[3]) ? cyrillic(text(cells[3])) : null;
    const busMatch = cells[4].match(/class="bus_model"[^>]*>([\s\S]*?)<\/a>/i) ?? cells[4].match(/<span class="bus_model">([\s\S]*?)<\/span>/i);
    const bus = busMatch ? text(busMatch[1]).replace(/\(\s*\)/g, '').trim() || null : null;
    const carrierMatch = cells[4].match(/class="atp"[^>]*>([\s\S]*?)<\/span>/i);
    const carrier = normalizeCarrier(carrierMatch ? carrierMatch[1] : '');
    const arrival = timeOf(text(cells[6]));
    const priceUah = parseBoardPrice(cells[7]);
    return { time, from, to, arrival, priceUah, carrier, bus, status, seats };
}
/**
 * Усі рейси табло, кожен один раз (той самий час + звідки + куди з дня «завтра» не повторюється).
 * `place` — лишити тільки рейси, де це місто є кінцевою або стартом («Малин»). Сторінка без таблиці табло — помилка.
 */
function parseZhytomyrBoard(html, place) {
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    const table = body.match(/<table\b[^>]*class="[^"]*tablo_table[^"]*"[^>]*>[\s\S]*?<\/table>/i);
    if (!table)
        throw new Error('на сторінці немає таблиці табло');
    const rows = [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    let date = null;
    const seen = new Set();
    const trips = [];
    const wanted = place ? titleCase(place) : null;
    for (const row of rows) {
        const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
        if (cells.length === 1 && /tablo-date-in-table/.test(row[0])) {
            date ?? (date = text(cells[0]) || null);
            continue;
        }
        if (cells.length < 8)
            continue;
        const trip = parseRow(cells);
        if (!trip)
            continue;
        if (wanted && trip.from !== wanted && trip.to !== wanted)
            continue;
        const key = `${trip.time}|${trip.from}|${trip.to}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        trips.push(trip);
    }
    if (!trips.length && !rows.some((r) => /<td/i.test(r[0])))
        throw new Error('таблиця табло порожня');
    trips.sort((a, b) => a.time.localeCompare(b.time) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    return { date, trips };
}
const directionLabel = (t) => `${t.from} → ${t.to}`;
exports.directionLabel = directionLabel;
/** Рядок рейсу для відбитка й для людини: «08:25 · 339,30 грн · ПП "РІМ-БОГДАН"» */
function describeBoardTrip(t) {
    return `${t.time} · ${formatBoardPrice(t.priceUah)}${t.priceUah == null ? '' : ' грн'} · ${t.carrier || 'перевізник не вказаний'}`;
}
/** Для стеження: частина «Житомир → Малин» → рядки рейсів (час · ціна · перевізник) */
function boardItems(trips) {
    var _a;
    const out = {};
    for (const t of trips)
        (out[_a = (0, exports.directionLabel)(t)] ?? (out[_a] = [])).push(describeBoardTrip(t));
    return out;
}
const LINE_RE = /^(\d\d:\d\d) · (.+?)(?: грн)? · (.*)$/;
function linesByTime(lines) {
    const out = new Map();
    for (const line of lines) {
        const m = line.match(LINE_RE);
        if (m)
            out.set(m[1], { time: m[1], price: m[2], carrier: m[3] });
    }
    return out;
}
const MAX_CHANGE_LINES = 20;
/**
 * Що змінилось на табло між двома знімками: «08:25 Житомир → Малин: 299,00 → 339,30 грн (ПП "РІМ-БОГДАН")»,
 * «новий рейс 07:00 Житомир → Малин: 334,80 грн (…)», «зник рейс 11:15 Житомир → Малин (був 329,40 грн)».
 */
function describeBoardChanges(prev, next) {
    if (!prev || !next)
        return [];
    const out = [];
    const parts = [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort();
    for (const part of parts) {
        const before = linesByTime(prev[part] ?? []);
        const after = linesByTime(next[part] ?? []);
        const times = [...new Set([...before.keys(), ...after.keys()])].sort();
        for (const time of times) {
            const a = before.get(time);
            const b = after.get(time);
            if (a && !b)
                out.push(`зник рейс ${time} ${part} (був ${a.price} грн)`);
            else if (!a && b)
                out.push(`новий рейс ${time} ${part}: ${b.price} грн (${b.carrier})`);
            else if (a && b && a.price !== b.price)
                out.push(`${time} ${part}: ${a.price} → ${b.price} грн (${b.carrier})`);
            else if (a && b && a.carrier !== b.carrier)
                out.push(`${time} ${part}: перевізник ${a.carrier} → ${b.carrier}`);
        }
    }
    if (out.length > MAX_CHANGE_LINES)
        return [...out.slice(0, MAX_CHANGE_LINES), `… ще ${out.length - MAX_CHANGE_LINES}`];
    return out;
}
/**
 * Звірка рейсів з кінцевою `toPlace` з рядками `Schedule` одного маршруту за часом відправлення. Нічого не пише: лише
 * каже, де табло й база розходяться. Рядки «Малин → …» сюди не входять — на табло стоїть час проходження через Житомир.
 */
function compareBoardWithSchedules(trips, schedules, toPlace = 'Малин') {
    const byTime = new Map(schedules.map((s) => [s.departureTime, s]));
    const rows = [];
    const matched = new Set();
    for (const t of trips.filter((x) => x.to === toPlace)) {
        const s = byTime.get(t.time);
        let verdict;
        if (!s)
            verdict = 'missing';
        else if (t.priceUah == null)
            verdict = 'no-board-price';
        else if (s.priceUah == null)
            verdict = 'no-db-price';
        else
            verdict = Math.round(t.priceUah) === s.priceUah ? 'same' : 'differs';
        if (s)
            matched.add(s.id);
        rows.push({
            time: t.time,
            from: t.from,
            to: t.to,
            arrival: t.arrival,
            boardPriceUah: t.priceUah,
            carrier: t.carrier,
            dbPriceUah: s?.priceUah ?? null,
            scheduleId: s?.id ?? null,
            verdict,
        });
    }
    for (const s of schedules) {
        if (matched.has(s.id))
            continue;
        rows.push({ time: s.departureTime, from: null, to: toPlace, arrival: null, boardPriceUah: null, carrier: null, dbPriceUah: s.priceUah, scheduleId: s.id, verdict: 'only-db' });
    }
    rows.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
}
/** Розходження для сповіщення: лише рядки, де табло й база не збігаються */
function describeBoardVsSchedules(rows) {
    const out = [];
    for (const r of rows) {
        const dir = r.from ? `${r.from} → ${r.to}` : `→ ${r.to}`;
        if (r.verdict === 'missing')
            out.push(`${r.time} ${dir}: нема в базі (табло ${formatBoardPrice(r.boardPriceUah)} грн)`);
        else if (r.verdict === 'differs')
            out.push(`${r.time} ${dir}: табло ${formatBoardPrice(r.boardPriceUah)}, у базі ${r.dbPriceUah} грн`);
        else if (r.verdict === 'no-db-price')
            out.push(`${r.time} ${dir}: у базі ціни нема (табло ${formatBoardPrice(r.boardPriceUah)} грн)`);
        else if (r.verdict === 'only-db')
            out.push(`${r.time} ${dir}: є в базі (${r.dbPriceUah ?? '—'} грн), на табло нема`);
    }
    return out;
}
