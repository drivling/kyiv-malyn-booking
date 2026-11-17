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
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { parseKorostenTimetable, timetableItems } from './korosten-source-parser';
import {
  boardItems,
  compareBoardWithSchedules,
  describeBoardChanges,
  describeBoardVsSchedules,
  parseZhytomyrBoard,
  type BoardTrip,
  type ScheduleRow,
} from './zhytomyr-board-parser';

export type WatchedSourceKind = 'html-tables' | 'ckan' | 'bus-board' | 'rss';

export interface WatchedSourceDef {
  key: string;
  kind: WatchedSourceKind;
  /** TripPoint.code міста, якого стосується джерело */
  cityCode: string;
  label: string;
  /** Сторінка для людини — посилання в сповіщенні й адмінці */
  url: string;
  /** Що запитує бекенд (для html-tables — та сама сторінка) */
  fetchUrl: string;
  /**
   * Парсер вмісту html-tables: дає рядки кожної частини, щоб сповіщення називало змінені рейси.
   * `korosten-timetable` — сторінка ради, `station-table` — будь-яка таблиця «час | маршрут» (стаття про автостанцію).
   */
  parser?: 'korosten-timetable' | 'station-table';
  /** Таймер: `board` — рідкий таймер табло (TRANSPORT_BOARD_WATCH_INTERVAL_MIN); без групи — звичайний */
  group?: 'board';
  /** Не запитувати частіше ніж раз на стільки хвилин — навіть кнопкою «Перевірити зараз» (статус `skipped`) */
  minGapMin?: number;
  /** rss: слова (нижній регістр), хоча б одне з яких має бути в заголовку чи описі запису */
  keywords?: string[];
  /** bus-board: місто, рейси якого беруться з табло («Малин» — кінцева або старт) */
  place?: string;
  /** bus-board: slug `Schedule.route`, з яким звіряються рейси до `place` (лише сигнал, без запису) */
  scheduleRoute?: string;
  /** Текст атрибуції для адмінки й документації */
  attribution?: string;
}

const CKAN = 'https://data.gov.ua/api/3/action/package_show?id=';
const ckanSource = (key: string, id: string, label: string, cityCode = 'Korosten'): WatchedSourceDef => ({
  key,
  kind: 'ckan',
  cityCode,
  label,
  url: `https://data.gov.ua/dataset/${id}`,
  fetchUrl: CKAN + id,
});

const KOROSTEN_TIMETABLE_URL =
  'https://korosten-rada.gov.ua/miska-rada/upravlinnya-ta-viddily/upravlinnya-ekonomiky/viddil-misczevogo-ekonomichnogo-rozvytku/transport/miskyj-transport/rozklad-ruhu-miskogo-transportu-rozklad-ruhu-avtobusiv-na-period-vijskovogo-stanu/';

/** Табло АС Житомир-1: лише HTTP (TLS у них нема); `bus.com.ua/cgi-bin/tablo.pl?as=180100` — запасний адрес для людини, не для робота */
export const ZHYTOMYR_BOARD_URL = 'http://tablo.bus-ua.info/zhytomyr';
export const ZHYTOMYR_BOARD_ATTRIBUTION = 'за даними табло автовокзалу Житомир-1 (МПП «ВПІ»)';
const MALYN_MEDIA_STATION_URL = 'https://malyn.media/statti/korysne/avtostantsiia-malyn-rozklad-avtobusiv-telefony-ta-rezhym-roboty/';
/** Так оголошують тариф «Зубастика»: слова шукаються в заголовку й описі запису стрічки */
export const MALYN_MEDIA_KEYWORDS = ['подорожча', 'маршрутк', 'тариф', 'зубастик'];

/** Джерела — у коді; опис кожного в data/korosten-transport/SOURCES.md і Docs/fare-source-watch-2026-11.md */
export const WATCHED_SOURCES: WatchedSourceDef[] = [
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
    url: ZHYTOMYR_BOARD_URL,
    fetchUrl: ZHYTOMYR_BOARD_URL,
    group: 'board',
    minGapMin: 60,
    place: 'Малин',
    scheduleRoute: 'Zhytomyr-Malyn',
    attribution: ZHYTOMYR_BOARD_ATTRIBUTION,
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
    keywords: MALYN_MEDIA_KEYWORDS,
  },
];

/** Скільки невдалих перевірок поспіль до одного сповіщення «джерело не відповідає» */
export const SOURCE_FAIL_ALERT_AFTER = 4;
const FETCH_TIMEOUT_MS = 25_000;
const ADMIN_PAGE_URL = 'https://malin.kiev.ua/admin/route-schedule';
/** Запити нагляду називають сайт і де нас знайти — за правилами ввічливого робота */
export const SOURCE_WATCH_USER_AGENT = 'malin.kiev.ua transport-source-watch/1.1 (+https://malin.kiev.ua/about)';
/** Скільки раніше бачених записів стрічки пам'ятати (щоб запис, що випав з 20 останніх, не дав «зникло») */
const RSS_SEEN_LIMIT = 300;

export interface SourceSnapshot {
  fingerprint: string;
  /** назва частини → хеш її вмісту */
  parts: Record<string, string>;
  /** Дата зміни за даними самого джерела (для показу; у відбиток не входить) */
  modified: string | null;
  /** Назва частини → рядки її вмісту (рейси маршруту); у відбиток не входить, лише для опису зміни */
  items?: Record<string, string[]>;
  /** bus-board: рейси останнього знімка — для таблиці в адмінці й звірки з базою */
  board?: BoardTrip[];
  /** bus-board: заголовок дати на табло */
  boardDate?: string | null;
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

function fingerprintOf(parts: Record<string, string>): string {
  return sha(
    Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k]}`)
      .join('\n'),
  );
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '-', mdash: '-', lt: '<', gt: '>' };

/** Текст фрагмента HTML: курсив лишається позначкою «_» (у розкладі ради курсив = інший шлях рейсу) */
export function normalizeHtmlText(html: string): string {
  return html
    .replace(/<\s*\/?\s*(em|i)\b[^>]*>/gi, '_')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')
    .replace(/_\s*_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROUTE_HEADING_RE = /Маршрут\s*№\s*([0-9]+(?:\s*-\s*[А-ЯІЇЄҐа-яіїєґA-Za-z])?)/g;

/** Таблиці сторінки з назвою кожної: номер маршруту із заголовка перед таблицею («№2-Б») або «таблиця N» */
function htmlTables(html: string): Array<{ label: string; html: string; start: number; end: number }> {
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  const tables = [...html.matchAll(tableRe)];
  const used = new Set<string>();
  return tables.map((m, i) => {
    const start = m.index ?? 0;
    const prevEnd = i > 0 ? (tables[i - 1].index ?? 0) + tables[i - 1][0].length : 0;
    const before = normalizeHtmlText(html.slice(prevEnd, start));
    const headings = [...before.matchAll(ROUTE_HEADING_RE)];
    const no = headings.length ? headings[headings.length - 1][1].replace(/\s+/g, '') : '';
    let label = no ? `№${no}` : `таблиця ${i + 1}`;
    while (used.has(label)) label += '′';
    used.add(label);
    return { label, html: m[0], start, end: start + m[0].length };
  });
}

/**
 * Сторінка з таблицями розкладу: частина = таблиця + примітки «* …» під нею, назва — номер маршруту із
 * заголовка перед таблицею («№2-Б»). Сторінка без таблиць — помилка (заглушка, капча), а не «зміна».
 */
export function snapshotHtmlTables(html: string): SourceSnapshot {
  const parts: Record<string, string> = {};
  const tables = htmlTables(html);
  if (!tables.length) throw new Error('на сторінці немає таблиць');
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
export function stationTableItems(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of htmlTables(html)) {
    const rows = [...t.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => normalizeHtmlText(c[1])).filter(Boolean).join(' '))
      .filter((line) => line && /\d/.test(line));
    out[t.label] = rows;
  }
  return out;
}

/** Набір data.gov.ua (CKAN package_show): частина = файл набору, відбиток — дата зміни файлу й адреса */
export function snapshotCkanPackage(json: string): SourceSnapshot {
  const body = JSON.parse(json) as {
    success?: boolean;
    result?: { metadata_modified?: string; resources?: Array<{ id?: string; name?: string; url?: string; last_modified?: string | null; size?: number | null }> };
  };
  if (body?.success !== true || !body.result || !Array.isArray(body.result.resources)) {
    throw new Error('data.gov.ua: неочікувана відповідь');
  }
  const parts: Record<string, string> = {};
  for (const res of body.result.resources) {
    let label = String(res.name || res.id || 'файл').slice(0, 80);
    while (label in parts) label += '′';
    parts[label] = sha(`${res.last_modified ?? ''}|${res.url ?? ''}|${res.size ?? ''}`);
  }
  return { fingerprint: fingerprintOf(parts), parts, modified: body.result.metadata_modified ?? null };
}

/**
 * Табло автовокзалу: частина = напрямок («Житомир → Малин»), відбиток — набір (час, ціна, перевізник) його рейсів.
 * Місця, статус продажу й модель автобуса міняються щодня і у відбиток не входять.
 */
export function snapshotBusBoard(html: string, place?: string): SourceSnapshot {
  const board = parseZhytomyrBoard(html, place);
  const items = boardItems(board.trips);
  const parts: Record<string, string> = {};
  for (const [label, lines] of Object.entries(items)) parts[label] = sha([...lines].sort().join('\n'));
  return { fingerprint: fingerprintOf(parts), parts, modified: null, items, board: board.trips, boardDate: board.date };
}

const RSS_PART = 'записи';
const cdata = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
const tag = (xml: string, name: string): string => cdata(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '');

export interface RssEntry {
  title: string;
  link: string;
  pubDate: string;
}

/** Записи стрічки RSS 2.0 / Atom-подібної: заголовок, посилання, дата, і чи є в заголовку або описі одне зі слів */
export function parseRssEntries(xml: string, keywords: string[] = []): { all: RssEntry[]; matching: RssEntry[] } {
  const items = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  if (!items.length) throw new Error('у стрічці немає записів');
  const all: RssEntry[] = [];
  const matching: RssEntry[] = [];
  const words = keywords.map((w) => w.toLocaleLowerCase('uk-UA'));
  for (const m of items) {
    const body = m[1];
    const title = tag(body, 'title');
    const link = tag(body, 'link') || body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || tag(body, 'guid');
    if (!title && !link) continue;
    const entry = { title, link, pubDate: tag(body, 'pubDate') || tag(body, 'updated') || tag(body, 'published') };
    all.push(entry);
    const haystack = `${title} ${tag(body, 'description')} ${tag(body, 'summary')}`.toLocaleLowerCase('uk-UA');
    if (!words.length || words.some((w) => haystack.includes(w))) matching.push(entry);
  }
  return { all, matching };
}

/** Стрічка новин: частина = запис зі словами з фільтра (ключ — посилання), рядок — «заголовок · посилання» */
export function snapshotRssFeed(xml: string, keywords: string[] = []): SourceSnapshot {
  const { matching } = parseRssEntries(xml, keywords);
  const parts: Record<string, string> = {};
  const lines: string[] = [];
  for (const e of matching) {
    const key = (e.link || e.title).slice(0, 200);
    if (key in parts) continue;
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
export function mergeRssSnapshot(prev: { parts?: Record<string, string>; items?: Record<string, string[]> }, snap: SourceSnapshot): SourceSnapshot {
  const prevParts = prev.parts ?? {};
  const prevLines = prev.items?.[RSS_PART] ?? [];
  const parts = { ...prevParts, ...snap.parts };
  const keys = Object.keys(parts);
  for (const k of keys.slice(0, Math.max(0, keys.length - RSS_SEEN_LIMIT))) delete parts[k];
  const lines = [...prevLines, ...(snap.items?.[RSS_PART] ?? []).filter((l) => !prevLines.includes(l))].slice(-RSS_SEEN_LIMIT);
  return { ...snap, parts, fingerprint: fingerprintOf(parts), items: { [RSS_PART]: lines } };
}

/** Які частини відрізняються: змінені, нові («… (нове)») і зниклі («… (зникло)») */
export function changedParts(prev: Record<string, string>, next: Record<string, string>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(next)) {
    if (!(k in prev)) out.push(`${k} (нове)`);
    else if (prev[k] !== next[k]) out.push(k);
  }
  for (const k of Object.keys(prev)) if (!(k in next)) out.push(`${k} (зникло)`);
  return out;
}

export function takeSnapshot(def: WatchedSourceDef, body: string): SourceSnapshot {
  if (def.kind === 'ckan') return snapshotCkanPackage(body);
  if (def.kind === 'bus-board') return snapshotBusBoard(body, def.place);
  if (def.kind === 'rss') return snapshotRssFeed(body, def.keywords);
  const snap = snapshotHtmlTables(body);
  if (def.parser === 'korosten-timetable') {
    try {
      snap.items = timetableItems(parseKorostenTimetable(body));
    } catch {
      // Верстку змінили так, що парсер не впорався: стеження лишається на хешах таблиць
    }
  } else if (def.parser === 'station-table') {
    snap.items = stationTableItems(body);
  }
  return snap;
}

const CHANGE_LINES_PER_PART = 8;

/**
 * Що саме змінилось у частинах: «№6: − 07:00–07:25 …» / «№6: + 07:05–07:30 …». Частини без рядків
 * (не було парсера або це перше порівняння після його появи) пропускаються — їх називає changedParts.
 */
export function describeChanges(
  prev: Record<string, string[]> | undefined,
  next: Record<string, string[]> | undefined,
): string[] {
  if (!prev || !next) return [];
  const out: string[] = [];
  for (const part of Object.keys(next)) {
    const before = prev[part];
    if (!before) continue;
    const after = next[part];
    const removed = before.filter((line) => !after.includes(line)).map((line) => `− ${line}`);
    const added = after.filter((line) => !before.includes(line)).map((line) => `+ ${line}`);
    const lines = [...removed, ...added];
    if (!lines.length) continue;
    lines.slice(0, CHANGE_LINES_PER_PART).forEach((line) => out.push(`${part}: ${line}`));
    if (lines.length > CHANGE_LINES_PER_PART) out.push(`${part}: … ще ${lines.length - CHANGE_LINES_PER_PART}`);
  }
  return out;
}

/** Опис зміни за видом джерела: табло — по рейсах (ціна була → стала), решта — рядки «−/+» по частинах */
export function describeSourceChanges(def: WatchedSourceDef, prev: SourceSnapshotDetails, next: SourceSnapshot): string[] {
  if (def.kind === 'bus-board') return describeBoardChanges(prev.items, next.items);
  return describeChanges(prev.items, next.items);
}

export interface SourceWatchDeps {
  fetchText: (url: string) => Promise<string>;
  notify: (html: string) => Promise<unknown>;
  now: () => Date;
  sources: WatchedSourceDef[];
  /** Рядки `Schedule` маршруту для звірки табло з базою (лише читання); без нього блок «База:» не додається */
  loadSchedules?: (routeSlug: string) => Promise<ScheduleRow[]>;
}

/** Один звичайний GET із User-Agent, що називає сайт; не-200 — помилка */
export async function fetchSourceText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': SOURCE_WATCH_USER_AGENT, Accept: 'text/html,application/xml,application/rss+xml,application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Рядки `Schedule` одного маршруту (маршрутки) з Prisma — для звірки табло з базою */
export function prismaScheduleLoader(prisma: PrismaClient): SourceWatchDeps['loadSchedules'] {
  return async (routeSlug) =>
    prisma.schedule.findMany({
      where: { route: routeSlug, vehicleType: 'marshrutka' },
      select: { id: true, departureTime: true, priceUah: true },
      orderBy: { departureTime: 'asc' },
    });
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ALERT_TITLE: Record<WatchedSourceKind, string> = {
  'html-tables': '🚌 <b>Джерело розкладу змінилось</b>',
  ckan: '🚌 <b>Джерело розкладу змінилось</b>',
  'bus-board': '💸 <b>Табло автовокзалу змінилось</b>',
  rss: '📰 <b>Новина про маршрутки чи тариф</b>',
};

function changeAlertHtml(def: WatchedSourceDef, changed: string[], lines: string[] = [], dbLines: string[] = []): string {
  return (
    `${ALERT_TITLE[def.kind]}\n${esc(def.label)}\n` +
    (changed.length && def.kind !== 'rss' ? `Змінилось: ${esc(changed.join(', '))}\n` : '') +
    (lines.length ? `${esc(lines.join('\n')).slice(0, 2500)}\n` : '') +
    (dbLines.length ? `База (${esc(def.scheduleRoute ?? '')}):\n${esc(dbLines.join('\n')).slice(0, 1200)}\n` : '') +
    (def.attribution ? `${esc(def.attribution)}\n` : '') +
    `<a href="${esc(def.url)}">Відкрити джерело</a>\n` +
    `Після перевірки — «Переглянуто»: ${ADMIN_PAGE_URL}`
  );
}

function failAlertHtml(def: WatchedSourceDef, error: string): string {
  return (
    `⚠️ <b>Джерело розкладу не відповідає</b> (${SOURCE_FAIL_ALERT_AFTER} перевірки поспіль)\n${esc(def.label)}\n` +
    `Помилка: ${esc(error)}\n<a href="${esc(def.url)}">Відкрити джерело</a>`
  );
}

export type SourceSnapshotDetails = {
  parts?: Record<string, string>;
  modified?: string | null;
  changed?: string[];
  changeLines?: string[];
  items?: Record<string, string[]>;
  board?: BoardTrip[];
  boardDate?: string | null;
};
const detailsOf = (value: unknown): SourceSnapshotDetails => (value && typeof value === 'object' ? (value as SourceSnapshotDetails) : {});

const snapshotDetails = (snap: SourceSnapshot): SourceSnapshotDetails => ({
  parts: snap.parts,
  modified: snap.modified,
  items: snap.items,
  ...(snap.board ? { board: snap.board, boardDate: snap.boardDate ?? null } : {}),
});

export type SourceCheckStatus = 'baseline' | 'unchanged' | 'changed' | 'error' | 'skipped';
export interface SourceCheckResult {
  key: string;
  status: SourceCheckStatus;
  changed?: string[];
  notified?: boolean;
  error?: string;
}

/** Розходження табло з базою для сповіщення; без завантажувача або без маршруту — порожньо */
async function boardVsDbLines(def: WatchedSourceDef, snap: SourceSnapshot, deps: SourceWatchDeps): Promise<string[]> {
  if (def.kind !== 'bus-board' || !def.scheduleRoute || !deps.loadSchedules || !snap.board) return [];
  try {
    const schedules = await deps.loadSchedules(def.scheduleRoute);
    return describeBoardVsSchedules(compareBoardWithSchedules(snap.board, schedules, def.place));
  } catch (e) {
    console.error(`[source-watch] ${def.key}: schedules`, e);
    return [];
  }
}

/**
 * Одна перевірка всіх джерел. Сповіщення — не більше одного на зміну: рядок переводиться на новий відбиток
 * умовним updateMany за старим відбитком, тож таймер, ручний запуск і два контейнери під час деплою не дублюють.
 * Джерело з `minGapMin`, перевірене нещодавно, пропускається (`skipped`) — табло не запитується частіше ніж раз на годину.
 */
export async function runSourceWatch(prisma: PrismaClient, deps: SourceWatchDeps): Promise<SourceCheckResult[]> {
  const results: SourceCheckResult[] = [];
  for (const def of deps.sources) {
    const now = deps.now();
    const row = await prisma.watchedSource.findUnique({ where: { key: def.key } });
    if (def.minGapMin && row?.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < def.minGapMin * 60_000) {
      results.push({ key: def.key, status: 'skipped' });
      continue;
    }
    let snap: SourceSnapshot;
    try {
      snap = takeSnapshot(def, await deps.fetchText(def.fetchUrl));
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const prevFails = row?.failCount ?? 0;
      let claimed = false;
      if (row) {
        const r = await prisma.watchedSource.updateMany({
          where: { key: def.key, failCount: prevFails },
          data: { failCount: prevFails + 1, lastError: error, lastCheckedAt: now },
        });
        claimed = r.count === 1;
      } else {
        await prisma.watchedSource.upsert({
          where: { key: def.key },
          create: { key: def.key, failCount: 1, lastError: error, lastCheckedAt: now },
          update: { lastError: error, lastCheckedAt: now },
        });
      }
      let notified = false;
      if (claimed && prevFails + 1 === SOURCE_FAIL_ALERT_AFTER) {
        notified = Boolean(await deps.notify(failAlertHtml(def, error)));
      }
      results.push({ key: def.key, status: 'error', error, notified });
      continue;
    }

    const ok = { lastCheckedAt: now, failCount: 0, lastError: null };
    if (!row || row.fingerprint == null) {
      const details = snapshotDetails(snap) as unknown as Prisma.InputJsonValue;
      await prisma.watchedSource.upsert({
        where: { key: def.key },
        create: { key: def.key, fingerprint: snap.fingerprint, details, ...ok },
        update: { fingerprint: snap.fingerprint, details, ...ok },
      });
      results.push({ key: def.key, status: 'baseline' });
      continue;
    }

    const prev = detailsOf(row.details);
    if (def.kind === 'rss') snap = mergeRssSnapshot(prev, snap);
    if (row.fingerprint === snap.fingerprint) {
      await prisma.watchedSource.update({
        where: { key: def.key },
        data: { ...ok, details: { ...prev, ...snapshotDetails(snap), items: snap.items ?? prev.items } as unknown as Prisma.InputJsonValue },
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
        details: { ...snapshotDetails(snap), changed, changeLines } as unknown as Prisma.InputJsonValue,
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

export interface WatchedSourceView {
  key: string;
  kind: WatchedSourceKind;
  cityCode: string;
  label: string;
  url: string;
  group: 'board' | null;
  attribution: string | null;
  /** Дата зміни за даними джерела */
  modified: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  acknowledgedAt: string | null;
  /** Є зміна, яку власник ще не позначив переглянутою */
  pending: boolean;
  /** Що змінилось востаннє */
  changed: string[];
  /** Докладно, якщо джерело має парсер: «№6: − 07:00–07:25 …», «№6: + 07:05–07:30 …» */
  changeLines: string[];
  parts: number;
  failCount: number;
  lastError: string | null;
}

/** Адмінка: усі джерела з коду + їхній стан із бази */
export async function listWatchedSources(prisma: PrismaClient, sources: WatchedSourceDef[] = WATCHED_SOURCES): Promise<WatchedSourceView[]> {
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

export interface BoardSourceView {
  key: string;
  label: string;
  url: string;
  attribution: string | null;
  /** Заголовок дати на табло в момент знімка */
  boardDate: string | null;
  lastCheckedAt: string | null;
  /** Усі рейси через місто з останнього знімка (і до нього, і з нього) */
  trips: BoardTrip[];
  /** Рейси до міста проти `Schedule` маршруту `scheduleRoute` */
  scheduleRoute: string | null;
  comparison: ReturnType<typeof compareBoardWithSchedules>;
}

/** Адмінка: останній знімок табло таблицею рейсів і звірка з базою; null — джерело не табло або ще не перевірялось */
export async function boardSourceView(prisma: PrismaClient, def: WatchedSourceDef, loadSchedules?: SourceWatchDeps['loadSchedules']): Promise<BoardSourceView | null> {
  if (def.kind !== 'bus-board') return null;
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
    comparison: def.scheduleRoute ? compareBoardWithSchedules(trips, schedules, def.place) : [],
  };
}

/** «Переглянуто»: власник подивився зміну. false — джерела з таким ключем немає в базі */
export async function acknowledgeWatchedSource(prisma: PrismaClient, key: string, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.watchedSource.updateMany({ where: { key }, data: { acknowledgedAt: now } });
  return r.count > 0;
}
