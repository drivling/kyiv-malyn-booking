/**
 * RSS «зміни розкладу» та iCal маршруту з того самого кешу, що й GTFS (Docs/transport-open-protocols-2026-10.md,
 * фаза 4). RSS — запис на кожну ревізію журналу `TransportRevision` (Docs/transport-revisions-2026-10.md) з людським
 * підсумком «що саме змінилось»; поки журнал порожній — один запис про поточну revision. iCal — подія на кожен
 * рейс маршруту з тижневим повтором за календарем сервісу, час у TZID=Europe/Kyiv з VTIMEZONE усередині.
 * Усе детерміновано для однієї revision (DTSTART — дата revision за Києвом), тож відповіді кешуються з її ETag.
 */
import { GTFS_FEED_CANONICAL_URL, type GtfsFeed, type GtfsFeedStats, type GtfsFeedTrip } from './gtfs-feed';
import { plural, type TransportRevisionRecord } from './transport-revisions';

export const SITE_URL = 'https://malin.kiev.ua';
export const CHANGES_RSS_URL = `${SITE_URL}/transport/changes.rss`;
export const REVISIONS_JSON_URL = `${SITE_URL}/transport/revisions`;
export const KYIV_TZ = 'Europe/Kyiv';

const xml = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Дата й час за Києвом як { y, m, d, hh, mm }, «14.10.2026» і «13:17» */
export function kyivDate(at: Date): { y: number; m: number; d: number; hh: number; mm: number; label: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const hh = get('hour') % 24; // en-GB віддає «24» для півночі
  const mm = get('minute');
  const pad = (n: number) => String(n).padStart(2, '0');
  return { y, m, d, hh, mm, label: `${pad(d)}.${pad(m)}.${y}`, time: `${pad(hh)}:${pad(mm)}` };
}

function revisionDate(feed: GtfsFeed, now: Date): Date {
  const d = new Date(feed.feedVersion);
  return Number.isNaN(d.getTime()) ? now : d;
}

const countsLine = (stats: GtfsFeedStats): string =>
  [plural(stats.routes, 'маршрут', 'маршрути', 'маршрутів'), plural(stats.trips, 'рейс', 'рейси', 'рейсів'), plural(stats.stops, 'зупинка', 'зупинки', 'зупинок')].join(', ');

const whereToGet = `GTFS: ${GTFS_FEED_CANONICAL_URL} (feed_version = revision), JSON: ${SITE_URL}/transport/dataset.json, журнал: ${REVISIONS_JSON_URL}, схема і кнопки: ${SITE_URL}/transport/scheme#open-data.`;

function rssItem(args: { revision: string; at: Date; title: string; description: string }): string[] {
  return [
    '<item>',
    `<title>${xml(args.title)}</title>`,
    `<link>${SITE_URL}/transport/scheme#open-data</link>`,
    `<guid isPermaLink="false">malyn-transport-revision:${xml(args.revision)}</guid>`,
    `<pubDate>${args.at.toUTCString()}</pubDate>`,
    `<description>${xml(args.description)}</description>`,
    '</item>',
  ];
}

/** Один запис про поточну revision із кешу GTFS — поки журнал порожній (стара БД до міграції, порожня таблиця) */
function feedOnlyItem(feed: GtfsFeed, at: Date): string[] {
  const { label } = kyivDate(at);
  const routesLine = feed.routes.map((r) => `№${r.shortName} ${r.longName}`).join('; ');
  return rssItem({
    revision: feed.feedVersion,
    at,
    title: `Розклад оновлено ${label}`,
    description: `Версія даних (revision) ${feed.feedVersion}: ${countsLine(feed.stats)}. Маршрути у фіді: ${routesLine}. ${whereToGet}`,
  });
}

function revisionItem(row: TransportRevisionRecord, latest: boolean): string[] {
  const at = new Date(row.revision);
  const { label, time } = kyivDate(at);
  return rssItem({
    revision: row.revision,
    at,
    title: `Розклад оновлено ${label} о ${time}`,
    description: `${row.summary}. У фіді: ${countsLine(row.stats)}. Версія даних (revision) ${row.revision}.${latest ? ` ${whereToGet}` : ''}`,
  });
}

/**
 * RSS 2.0: запис на кожну ревізію журналу (новіші першими, скільки передали — роутер бере останні 50), з людським
 * підсумком diff; без журналу — один запис про поточну revision фіду.
 */
export function buildChangesRss(feed: GtfsFeed, options: { now?: Date; revisions?: TransportRevisionRecord[] } = {}): string {
  const now = options.now ?? new Date();
  const at = revisionDate(feed, now);
  const revisions = options.revisions ?? [];
  const items = revisions.length ? revisions.flatMap((row, i) => revisionItem(row, i === 0)) : feedOnlyItem(feed, at);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${xml('Транспорт Малина — зміни розкладу')}</title>`,
    `<link>${SITE_URL}/transport/scheme</link>`,
    `<atom:link href="${CHANGES_RSS_URL}" rel="self" type="application/rss+xml"/>`,
    `<description>${xml('Запис на кожну нову версію (revision) даних міського транспорту Малина: що саме змінилось — зупинки, маршрути, рейси, час у дорозі, перенесення зупинок — скільки чого у відкритому GTFS-фіді та де його взяти.')}</description>`,
    '<language>uk</language>',
    `<lastBuildDate>${at.toUTCString()}</lastBuildDate>`,
    '<ttl>1440</ttl>',
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

/* ---------- iCal ---------- */

const VTIMEZONE_KYIV = [
  'BEGIN:VTIMEZONE',
  `TZID:${KYIV_TZ}`,
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

const RRULE_BY_SERVICE: Record<string, string> = {
  everyday: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
};

/** Екранування тексту iCal (RFC 5545 3.3.11) */
export function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Згортання рядків довших за 75 октетів (RFC 5545 3.1) — за байтами UTF-8, не за символами */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
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
function gtfsClock(t: string): { dayOffset: number; hh: number; mm: number; ss: number } {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  const total = m ? Number(m[1]) : 0;
  return { dayOffset: Math.floor(total / 24), hh: total % 24, mm: m ? Number(m[2]) : 0, ss: m ? Number(m[3]) : 0 };
}

/** Локальна (київська) дата + GTFS-час → «YYYYMMDDTHHMMSS» для DTSTART;TZID=… */
function localStamp(base: { y: number; m: number; d: number }, clock: string): string {
  const c = gtfsClock(clock);
  // Зсув доби — через UTC-арифметику на календарній даті (без годин), щоб не чіпати DST
  const date = new Date(Date.UTC(base.y, base.m - 1, base.d + c.dayOffset));
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${mo}${d}T${String(c.hh).padStart(2, '0')}${String(c.mm).padStart(2, '0')}${String(c.ss).padStart(2, '0')}`;
}

function utcStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function tripEvent(trip: GtfsFeedTrip, routeShortName: string, base: { y: number; m: number; d: number }, dtstamp: string): string[] {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const summary = `№${routeShortName} → ${trip.headsign || last.name}`;
  const description = [`Маршрут №${routeShortName}, рейс ${trip.id} (${trip.serviceId === 'weekdays' ? 'пн–пт' : 'щодня'}).`, ...trip.stops.map((s) => `${s.departure.slice(0, 5)} ${s.name}`), `Дані: ${SITE_URL}/transport/route/${encodeURIComponent(trip.routeId)}`].join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${trip.id}@malin.kiev.ua`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${KYIV_TZ}:${localStamp(base, first.departure)}`,
    `DTEND;TZID=${KYIV_TZ}:${localStamp(base, last.arrival)}`,
    `RRULE:${RRULE_BY_SERVICE[trip.serviceId] ?? RRULE_BY_SERVICE.everyday}`,
    `SUMMARY:${icsText(summary)}`,
    `LOCATION:${icsText(first.name)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${SITE_URL}/transport/route/${encodeURIComponent(trip.routeId)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/**
 * iCalendar маршруту: null — маршруту немає у фіді (невідомий, прихований або без розкладу).
 * DTSTART — дата revision за Києвом (детерміновано для кешу), далі щотижневий повтор.
 */
export function buildRouteCalendar(feed: GtfsFeed, routeId: string, options: { now?: Date } = {}): string | null {
  const route = feed.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const trips = feed.trips.filter((t) => t.routeId === routeId && t.stops.length >= 2);
  if (!trips.length) return null;
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
    `X-WR-TIMEZONE:${KYIV_TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
    `URL:${SITE_URL}/transport/route/${encodeURIComponent(routeId)}`,
    ...VTIMEZONE_KYIV,
    ...trips.flatMap((t) => tripEvent(t, route.shortName, base, dtstamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
