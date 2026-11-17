"use strict";
/**
 * Розбір сторінок zt.rozklad.in.ua — сайту власника з графіками трамвая, тролейбуса й комунальних автобусів
 * Житомира (Docs/dovede-roadmap.md, «Житомир зі свого сайту»). Чисті функції: HTML → дані; мережі тут немає.
 *
 * Головна сторінка — список маршрутів за видом транспорту; сторінка напрямку (`/home/schedule/<id>`) — зупинки по
 * порядку з хвилинами від початку й таблиці відправлень від першої зупинки («Робочі дні», «Вихідні»).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEntities = decodeEntities;
exports.parseZtHome = parseZtHome;
exports.extractZtFragment = extractZtFragment;
exports.parseZtDirection = parseZtDirection;
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(s) {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}
const text = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Список маршрутів з головної сторінки */
function parseZtHome(html) {
    const out = [];
    const sections = html.split(/class="route js-route js-/).slice(1);
    for (const section of sections) {
        const mode = /^(bus|trolleybus|tram)\b/.exec(section)?.[1];
        if (!mode)
            continue;
        for (const m of section.matchAll(/<a href="\/home\/schedule\/(\d+)"[^>]*>\s*<span>([\s\S]*?)<\/span>([\s\S]*?)<\/a>/g)) {
            out.push({ mode, number: text(m[2]), name: text(m[3]), dirId: Number(m[1]) });
        }
    }
    return out;
}
/**
 * Частина сторінки напрямку, яку зберігаємо в репозиторії: шапка, зупинки, дата й перші таблиці. Без реклами,
 * іконок і службових атрибутів Cloudflare — щоб знімок не мінявся від запиту до запиту.
 */
function extractZtFragment(html) {
    const start = html.indexOf('<div class="schedule-top">');
    const weekend = html.indexOf('column weekend', start);
    const end = weekend >= 0 ? html.indexOf('</table>', weekend) : -1;
    if (start < 0 || end < 0)
        throw new Error('zt: на сторінці немає розкладу');
    // рядок «РОЗКЛАД ДІЄ З …» стоїть одразу під таблицями — беремо і його
    let stop = end + '</table>'.length;
    const date = /(?:РОЗКЛАД ДІЄ|&#x420;&#x41E;&#x417;&#x41A;&#x41B;&#x410;&#x414;)[^<]*<\/div>/.exec(html.slice(stop, stop + 8000));
    if (date)
        stop += date.index + date[0].length;
    return (html
        .slice(start, stop)
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/ data-cf-modified-[^=\s>]*=""/g, '')
        .replace(/if \(!window\.__cfRLUnblockHandlers\) return false; /g, '')
        .replace(/<ins[\s\S]*?<\/ins>/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n') + '\n');
}
function parseTable(table) {
    const out = [];
    for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row[1].matchAll(/<td(?: class='([^']*)')?>([\s\S]*?)<\/td>/g)];
        if (!cells.length)
            continue;
        const hour = Number(text(cells[0][2]));
        if (!Number.isInteger(hour) || hour < 0 || hour > 27)
            continue;
        for (const c of cells.slice(1)) {
            const minute = /^\d{1,2}/.exec(text(c[2]))?.[0];
            if (minute == null || Number(minute) > 59)
                continue;
            const cls = (c[1] ?? '').replace(/default-td/, '').trim();
            const mark = /<spam class='([^']*)'/.exec(c[2])?.[1].trim() ?? '';
            const note = [cls, mark].filter(Boolean).join(' ');
            out.push({ time: `${String(hour % 24).padStart(2, '0')}:${minute.padStart(2, '0')}`, ...(note ? { note } : {}) });
        }
    }
    return out;
}
/** Сторінка напрямку (ціла або фрагмент `extractZtFragment`) → зупинки й відправлення від першої зупинки */
function parseZtDirection(html, dirId) {
    const number = text(/<div class="number">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');
    const name = text(/class="name-route">([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '');
    const reverse = /js-sort-route"[^>]*GetSchedule\((\d+), null\)/.exec(html)?.[1];
    const stops = [];
    for (const m of html.matchAll(/<li[^>]*GetSchedule\((\d+), (\d+)\)[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<p>([\s\S]*?)<\/p>/g)) {
        if (Number(m[1]) !== dirId)
            continue;
        const minutes = Number(/\d+/.exec(text(m[3]))?.[0] ?? 0);
        stops.push({ id: Number(m[2]), name: text(m[4]), minutes });
    }
    if (!number || stops.length < 2)
        throw new Error(`zt ${dirId}: немає номера маршруту чи зупинок`);
    for (let i = 1; i < stops.length; i++) {
        if (stops[i].minutes < stops[i - 1].minutes)
            throw new Error(`zt ${dirId}: хвилини зупинок ідуть назад біля «${stops[i].name}»`);
    }
    const tableAfter = (marker) => {
        const at = html.indexOf(marker);
        const open = at >= 0 ? html.indexOf('<table>', at) : -1;
        const close = open >= 0 ? html.indexOf('</table>', open) : -1;
        return close >= 0 ? html.slice(open, close) : '';
    };
    const valid = /РОЗКЛАД ДІЄ З (\d{2})\.(\d{2})\.(\d{4})/i.exec(decodeEntities(html));
    return {
        dirId,
        reverseId: reverse && Number(reverse) !== dirId ? Number(reverse) : null,
        number,
        name,
        stops,
        workdays: parseTable(tableAfter('column working-days')),
        weekend: parseTable(tableAfter('column weekend')),
        validFrom: valid ? `${valid[3]}-${valid[2]}-${valid[1]}` : null,
    };
}
