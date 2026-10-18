"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KYIV_TZ = exports.CHANGES_RSS_URL = exports.SITE_URL = void 0;
exports.kyivDate = kyivDate;
exports.buildChangesRss = buildChangesRss;
exports.icsText = icsText;
exports.foldIcsLine = foldIcsLine;
exports.buildRouteCalendar = buildRouteCalendar;
/**
 * RSS «зміни розкладу» та iCal маршруту з того самого кешу, що й GTFS (Docs/transport-open-protocols-2026-10.md,
 * фаза 4). Історії ревізій у БД немає (лише TransportMeta.updatedAt), тому RSS має один запис — про поточну revision;
 * читач RSS зберігає прочитані записи сам, тож для підписника це журнал «коли мінявся розклад». iCal — подія на кожен
 * рейс маршруту з тижневим повтором за календарем сервісу, час у TZID=Europe/Kyiv з VTIMEZONE усередині.
 * Усе детерміновано для однієї revision (DTSTART — дата revision за Києвом), тож відповіді кешуються з її ETag.
 */
const gtfs_feed_1 = require("./gtfs-feed");
exports.SITE_URL = 'https://malin.kiev.ua';
exports.CHANGES_RSS_URL = `${exports.SITE_URL}/transport/changes.rss`;
exports.KYIV_TZ = 'Europe/Kyiv';
const xml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Дата за Києвом як { y, m, d } і «14.10.2026» */
function kyivDate(at) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: exports.KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    return { y, m, d, label: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}` };
}
function revisionDate(feed, now) {
    const d = new Date(feed.feedVersion);
    return Number.isNaN(d.getTime()) ? now : d;
}
const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11)
        return `${n} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
        return `${n} ${few}`;
    return `${n} ${many}`;
};
/** RSS 2.0 з одним записом про поточну revision: що в фіді й де його взяти */
function buildChangesRss(feed, options = {}) {
    const now = options.now ?? new Date();
    const at = revisionDate(feed, now);
    const { label } = kyivDate(at);
    const { stats } = feed;
    const summary = [plural(stats.routes, 'маршрут', 'маршрути', 'маршрутів'), plural(stats.trips, 'рейс', 'рейси', 'рейсів'), plural(stats.stops, 'зупинка', 'зупинки', 'зупинок')].join(', ');
    const routesLine = feed.routes.map((r) => `№${r.shortName} ${r.longName}`).join('; ');
    const description = `Версія даних (revision) ${feed.feedVersion}: ${summary}. ` +
        `Маршрути у фіді: ${routesLine}. ` +
        `GTFS: ${gtfs_feed_1.GTFS_FEED_CANONICAL_URL} (feed_version = revision), JSON: ${exports.SITE_URL}/transport/dataset.json, ` +
        `схема і кнопки: ${exports.SITE_URL}/transport/scheme#open-data.`;
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        '<channel>',
        `<title>${xml('Транспорт Малина — зміни розкладу')}</title>`,
        `<link>${exports.SITE_URL}/transport/scheme</link>`,
        `<atom:link href="${exports.CHANGES_RSS_URL}" rel="self" type="application/rss+xml"/>`,
        `<description>${xml('Один запис на кожну нову версію (revision) даних міського транспорту Малина: скільки маршрутів, рейсів і зупинок у відкритому GTFS-фіді та де його взяти. Що саме змінилось — поки не рахуємо.')}</description>`,
        '<language>uk</language>',
        `<lastBuildDate>${at.toUTCString()}</lastBuildDate>`,
        '<ttl>1440</ttl>',
        '<item>',
        `<title>${xml(`Розклад оновлено ${label}`)}</title>`,
        `<link>${exports.SITE_URL}/transport/scheme#open-data</link>`,
        `<guid isPermaLink="false">malyn-transport-revision:${xml(feed.feedVersion)}</guid>`,
        `<pubDate>${at.toUTCString()}</pubDate>`,
        `<description>${xml(description)}</description>`,
        '</item>',
        '</channel>',
        '</rss>',
        '',
    ].join('\n');
}
/* ---------- iCal ---------- */
const VTIMEZONE_KYIV = [
    'BEGIN:VTIMEZONE',
    `TZID:${exports.KYIV_TZ}`,
    'X-LIC-LOCATION:Europe/Kyiv',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0300',
    'TZNAME:EEST',
    'DTSTART:19700329T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0200',
    'TZNAME:EET',
    'DTSTART:19701025T040000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
];
const RRULE_BY_SERVICE = {
    everyday: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
    weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
};
/** Екранування тексту iCal (RFC 5545 3.3.11) */
function icsText(v) {
    return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** Згортання рядків довших за 75 октетів (RFC 5545 3.1) — за байтами UTF-8, не за символами */
function foldIcsLine(line) {
    const out = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
        const len = Buffer.byteLength(ch, 'utf8');
        const limit = out.length === 0 ? 75 : 74; // продовження починається з пробілу
        if (bytes + len > limit) {
            out.push(current);
            current = '';
            bytes = 0;
        }
        current += ch;
        bytes += len;
    }
    out.push(current);
    return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n');
}
/** GTFS «HH:MM:SS» (може бути ≥ 24:00:00 — наступна доба) → { dayOffset, hh, mm, ss } */
function gtfsClock(t) {
    const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
    const total = m ? Number(m[1]) : 0;
    return { dayOffset: Math.floor(total / 24), hh: total % 24, mm: m ? Number(m[2]) : 0, ss: m ? Number(m[3]) : 0 };
}
/** Локальна (київська) дата + GTFS-час → «YYYYMMDDTHHMMSS» для DTSTART;TZID=… */
function localStamp(base, clock) {
    const c = gtfsClock(clock);
    // Зсув доби — через UTC-арифметику на календарній даті (без годин), щоб не чіпати DST
    const date = new Date(Date.UTC(base.y, base.m - 1, base.d + c.dayOffset));
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${mo}${d}T${String(c.hh).padStart(2, '0')}${String(c.mm).padStart(2, '0')}${String(c.ss).padStart(2, '0')}`;
}
function utcStamp(at) {
    return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function tripEvent(trip, routeShortName, base, dtstamp) {
    const first = trip.stops[0];
    const last = trip.stops[trip.stops.length - 1];
    const summary = `№${routeShortName} → ${trip.headsign || last.name}`;
    const description = [`Маршрут №${routeShortName}, рейс ${trip.id} (${trip.serviceId === 'weekdays' ? 'пн–пт' : 'щодня'}).`, ...trip.stops.map((s) => `${s.departure.slice(0, 5)} ${s.name}`), `Дані: ${exports.SITE_URL}/transport/route/${encodeURIComponent(trip.routeId)}`].join('\n');
    return [
        'BEGIN:VEVENT',
        `UID:${trip.id}@malin.kiev.ua`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${exports.KYIV_TZ}:${localStamp(base, first.departure)}`,
        `DTEND;TZID=${exports.KYIV_TZ}:${localStamp(base, last.arrival)}`,
        `RRULE:${RRULE_BY_SERVICE[trip.serviceId] ?? RRULE_BY_SERVICE.everyday}`,
        `SUMMARY:${icsText(summary)}`,
        `LOCATION:${icsText(first.name)}`,
        `DESCRIPTION:${icsText(description)}`,
        `URL:${exports.SITE_URL}/transport/route/${encodeURIComponent(trip.routeId)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
    ];
}
/**
 * iCalendar маршруту: null — маршруту немає у фіді (невідомий, прихований або без розкладу).
 * DTSTART — дата revision за Києвом (детерміновано для кешу), далі щотижневий повтор.
 */
function buildRouteCalendar(feed, routeId, options = {}) {
    const route = feed.routes.find((r) => r.id === routeId);
    if (!route)
        return null;
    const trips = feed.trips.filter((t) => t.routeId === routeId && t.stops.length >= 2);
    if (!trips.length)
        return null;
    const now = options.now ?? new Date();
    const at = revisionDate(feed, now);
    const base = kyivDate(at);
    const dtstamp = utcStamp(at);
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//malin.kiev.ua//Transport Malyn//UK',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${icsText(`Маршрут №${route.shortName} — Малин`)}`,
        `X-WR-CALDESC:${icsText(`${route.longName}. Рейси за розкладом malin.kiev.ua, версія даних ${feed.feedVersion}. Підпишіться за адресою — календар оновлюється разом із розкладом.`)}`,
        `X-WR-TIMEZONE:${exports.KYIV_TZ}`,
        'REFRESH-INTERVAL;VALUE=DURATION:P1D',
        'X-PUBLISHED-TTL:P1D',
        `URL:${exports.SITE_URL}/transport/route/${encodeURIComponent(routeId)}`,
        ...VTIMEZONE_KYIV,
        ...trips.flatMap((t) => tripEvent(t, route.shortName, base, dtstamp)),
        'END:VCALENDAR',
    ];
    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
