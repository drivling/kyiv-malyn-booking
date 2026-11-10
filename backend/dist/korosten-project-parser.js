"use strict";
/**
 * Проєкт власника 2025 року для Коростеня (data/korosten-transport/project-2025/): 16 HTML-сторінок, одна на
 * напрямок маршрутів №1–8. На кожній — послідовність зупинок із накопиченим часом у хвилинах і відправлення
 * від початкової зупинки окремо для робочих і вихідних днів. Чистий парсер: HTML → структура.
 * Docs/korosten-transport-2026-11.md, фаза 2б.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProjectDirection = parseProjectDirection;
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '–', mdash: '—', lt: '<', gt: '>' };
function text(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}
const ON_DEMAND_RE = /\s*\(на вимогу\)\s*/i;
function markOf(cls, letter, sup) {
    return letter?.trim() || sup?.trim() || cls || null;
}
// <span>30</span> · <span>00<span class="nt">Н</span></span> · <span><span class="depot">10</span></span> · 00<sup>*</sup>
const TIME_TOKEN_RE = /(?:<span class="(depot|und)">)?(\d\d)(?:<\/span>)?(?:<span class="nt">([^<]*)<\/span>|<sup>([^<]*)<\/sup>)?/g;
function parseDepartures(tableHtml) {
    const out = [];
    for (const row of tableHtml.matchAll(/<td class="h">(\d{1,2})<\/td><td class="m">([\s\S]*?)<\/td>/g)) {
        const hour = String(Number(row[1])).padStart(2, '0');
        for (const cell of row[2].matchAll(/<span>([\s\S]*?)<\/span>(?=<span>|$)/g)) {
            const token = [...cell[1].matchAll(TIME_TOKEN_RE)][0];
            if (token)
                out.push({ time: `${hour}:${token[2]}`, mark: markOf(token[1], token[3], token[4]) });
        }
    }
    return out;
}
function parseProjectDirection(html, code) {
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? '';
    const route = text(h1.match(/<span class="num">([\s\S]*?)<\/span>/)?.[1] ?? code[0]);
    const title = text(h1.replace(/<span class="num">[\s\S]*?<\/span>/, ''));
    const stops = [...html.matchAll(/<tr><td>\d+<\/td><td>([\s\S]*?)<\/td><td class="min">(\d+)<\/td><\/tr>/g)].map((m) => {
        const raw = text(m[1]);
        return { name: raw.replace(ON_DEMAND_RE, ' ').trim(), onDemand: ON_DEMAND_RE.test(raw), minute: Number(m[2]) };
    });
    if (stops.length < 2)
        throw new Error(`project ${code}: немає послідовності зупинок`);
    const from = text(html.match(/Розклад відправлення від зупинки\s*([\s\S]*?)<\/h2>/)?.[1] ?? '').replace(/^[«"]|[»"]$/g, '');
    const departures = { weekdays: [], weekends: [] };
    for (const block of html.matchAll(/<h2 style="margin-top:0">([\s\S]*?)<\/h2>\s*<table class="times">([\s\S]*?)<\/table>/g)) {
        const kind = /вихідн/i.test(text(block[1])) ? 'weekends' : 'weekdays';
        departures[kind] = parseDepartures(block[2]);
    }
    if (!departures.weekdays.length)
        throw new Error(`project ${code}: немає відправлень`);
    const notes = [...html.matchAll(/<li><span class="k">([\s\S]*?)<\/span>\s*[–-]\s*([\s\S]*?)<\/li>/g)].map((m) => {
        const token = [...m[1].matchAll(TIME_TOKEN_RE)][0];
        return { mark: (token && markOf(token[1], token[3], token[4])) || '?', text: text(m[2]) };
    });
    const date = html.match(/станом на\s*(\d{2})\.(\d{2})\.(\d{4})/);
    return {
        code,
        route,
        direction: code[1] === '2' ? 2 : 1,
        title,
        from,
        stops,
        departures,
        notes,
        asOf: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
    };
}
