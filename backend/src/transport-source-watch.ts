/**
 * Стеження за зовнішніми джерелами розкладу (Docs/korosten-transport-2026-11.md, фаза 1).
 *
 * Раз на TRANSPORT_SOURCE_WATCH_INTERVAL_MIN бекенд робить по одному запиту на джерело, рахує відбиток
 * вмісту й порівнює з останнім збереженим (WatchedSource). Змінився — власник отримує одне повідомлення в
 * адмін-чат: яке джерело і які його частини (таблиці маршрутів, файли набору). Перший запуск лише запам'ятовує
 * стан. Відбиток — це вміст, а не дата зміни сторінки: пересохранення без правок сповіщення не дає.
 */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export type WatchedSourceKind = 'html-tables' | 'ckan';

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
}

const CKAN = 'https://data.gov.ua/api/3/action/package_show?id=';
const ckanSource = (key: string, id: string, label: string): WatchedSourceDef => ({
  key,
  kind: 'ckan',
  cityCode: 'Korosten',
  label,
  url: `https://data.gov.ua/dataset/${id}`,
  fetchUrl: CKAN + id,
});

const KOROSTEN_TIMETABLE_URL =
  'https://korosten-rada.gov.ua/miska-rada/upravlinnya-ta-viddily/upravlinnya-ekonomiky/viddil-misczevogo-ekonomichnogo-rozvytku/transport/miskyj-transport/rozklad-ruhu-miskogo-transportu-rozklad-ruhu-avtobusiv-na-period-vijskovogo-stanu/';

/** Джерела — у коді; опис кожного в data/korosten-transport/SOURCES.md */
export const WATCHED_SOURCES: WatchedSourceDef[] = [
  {
    key: 'korosten-rada-timetable',
    kind: 'html-tables',
    cityCode: 'Korosten',
    label: 'Коростень: розклад автобусів на сайті ради',
    url: KOROSTEN_TIMETABLE_URL,
    fetchUrl: KOROSTEN_TIMETABLE_URL,
  },
  ckanSource('korosten-routes', 'd8a2158e-5ee4-48cf-a2b7-1532336ce563', 'Коростень: перевізники й маршрути (data.gov.ua)'),
  ckanSource('korosten-stops', 'c8bfaca6-97d6-451a-9dbc-68d2b745ddd3', 'Коростень: зупинки (data.gov.ua)'),
  ckanSource('korosten-trips', '9b85050b-175b-4e51-a149-a6cb1fcb815e', 'Коростень: розклад руху (data.gov.ua)'),
  ckanSource('korosten-realtime', 'e8e28884-1158-4a01-b975-04f2b4e167e7', 'Коростень: транспорт у реальному часі (data.gov.ua)'),
];

/** Скільки невдалих перевірок поспіль до одного сповіщення «джерело не відповідає» */
export const SOURCE_FAIL_ALERT_AFTER = 4;
const FETCH_TIMEOUT_MS = 25_000;
const ADMIN_PAGE_URL = 'https://malin.kiev.ua/admin/route-schedule';

export interface SourceSnapshot {
  fingerprint: string;
  /** назва частини → хеш її вмісту */
  parts: Record<string, string>;
  /** Дата зміни за даними самого джерела (для показу; у відбиток не входить) */
  modified: string | null;
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
    .replace(/[‐-―−]/g, '-')
    .replace(/[  -​ ]/g, ' ')
    .replace(/_\s*_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROUTE_HEADING_RE = /Маршрут\s*№\s*([0-9]+(?:\s*-\s*[А-ЯІЇЄҐа-яіїєґA-Za-z])?)/g;

/**
 * Сторінка з таблицями розкладу: частина = таблиця + примітки «* …» під нею, назва — номер маршруту із
 * заголовка перед таблицею («№2-Б»). Сторінка без таблиць — помилка (заглушка, капча), а не «зміна».
 */
export function snapshotHtmlTables(html: string): SourceSnapshot {
  const parts: Record<string, string> = {};
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  const tables = [...html.matchAll(tableRe)];
  if (!tables.length) throw new Error('на сторінці немає таблиць');
  tables.forEach((m, i) => {
    const start = m.index ?? 0;
    const prevEnd = i > 0 ? (tables[i - 1].index ?? 0) + tables[i - 1][0].length : 0;
    const before = normalizeHtmlText(html.slice(prevEnd, start));
    const headings = [...before.matchAll(ROUTE_HEADING_RE)];
    const no = headings.length ? headings[headings.length - 1][1].replace(/\s+/g, '') : '';
    let label = no ? `№${no}` : `таблиця ${i + 1}`;
    while (label in parts) label += '′';
    // Примітки між цією таблицею й наступним заголовком; після останньої — лише найближчий текст
    const end = start + m[0].length;
    const nextStart = i + 1 < tables.length ? (tables[i + 1].index ?? html.length) : Math.min(html.length, end + 600);
    const after = normalizeHtmlText(html.slice(end, nextStart)).split(/Маршрут\s*№/)[0];
    const notes = (after.match(/\*[^*]{3,300}/g) ?? []).map((s) => s.trim()).join(' ');
    parts[label] = sha(`${normalizeHtmlText(m[0])}\n${notes}`);
  });
  const modified = html.match(/article:modified_time"\s+content="([^"]+)"/)?.[1] ?? null;
  return { fingerprint: fingerprintOf(parts), parts, modified };
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
  return def.kind === 'ckan' ? snapshotCkanPackage(body) : snapshotHtmlTables(body);
}

export interface SourceWatchDeps {
  fetchText: (url: string) => Promise<string>;
  notify: (html: string) => Promise<unknown>;
  now: () => Date;
  sources: WatchedSourceDef[];
}

/** Один звичайний GET із загальним User-Agent; не-200 — помилка */
export async function fetchSourceText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'transport-source-watch/1.0', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function changeAlertHtml(def: WatchedSourceDef, changed: string[]): string {
  return (
    `🚌 <b>Джерело розкладу змінилось</b>\n${esc(def.label)}\n` +
    (changed.length ? `Змінилось: ${esc(changed.join(', '))}\n` : '') +
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

type Details = { parts?: Record<string, string>; modified?: string | null; changed?: string[] };
const detailsOf = (value: unknown): Details => (value && typeof value === 'object' ? (value as Details) : {});

export type SourceCheckStatus = 'baseline' | 'unchanged' | 'changed' | 'error';
export interface SourceCheckResult {
  key: string;
  status: SourceCheckStatus;
  changed?: string[];
  notified?: boolean;
  error?: string;
}

/**
 * Одна перевірка всіх джерел. Сповіщення — не більше одного на зміну: рядок переводиться на новий відбиток
 * умовним updateMany за старим відбитком, тож таймер, ручний запуск і два контейнери під час деплою не дублюють.
 */
export async function runSourceWatch(prisma: PrismaClient, deps: SourceWatchDeps): Promise<SourceCheckResult[]> {
  const results: SourceCheckResult[] = [];
  for (const def of deps.sources) {
    const now = deps.now();
    const row = await prisma.watchedSource.findUnique({ where: { key: def.key } });
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
      const details = { parts: snap.parts, modified: snap.modified } as Prisma.InputJsonValue;
      await prisma.watchedSource.upsert({
        where: { key: def.key },
        create: { key: def.key, fingerprint: snap.fingerprint, details, ...ok },
        update: { fingerprint: snap.fingerprint, details, ...ok },
      });
      results.push({ key: def.key, status: 'baseline' });
      continue;
    }

    const prev = detailsOf(row.details);
    if (row.fingerprint === snap.fingerprint) {
      await prisma.watchedSource.update({
        where: { key: def.key },
        data: { ...ok, details: { ...prev, parts: snap.parts, modified: snap.modified } as Prisma.InputJsonValue },
      });
      results.push({ key: def.key, status: 'unchanged' });
      continue;
    }

    const changed = changedParts(prev.parts ?? {}, snap.parts);
    const claim = await prisma.watchedSource.updateMany({
      where: { key: def.key, fingerprint: row.fingerprint },
      data: {
        ...ok,
        fingerprint: snap.fingerprint,
        details: { parts: snap.parts, modified: snap.modified, changed } as Prisma.InputJsonValue,
        lastChangedAt: now,
        acknowledgedAt: null,
      },
    });
    const notified = claim.count === 1 ? Boolean(await deps.notify(changeAlertHtml(def, changed))) : false;
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
  /** Дата зміни за даними джерела */
  modified: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  acknowledgedAt: string | null;
  /** Є зміна, яку власник ще не позначив переглянутою */
  pending: boolean;
  /** Що змінилось востаннє */
  changed: string[];
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
      modified: details.modified ?? null,
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastChangedAt: changedAt?.toISOString() ?? null,
      acknowledgedAt: ackAt?.toISOString() ?? null,
      pending: Boolean(changedAt && (!ackAt || ackAt < changedAt)),
      changed: Array.isArray(details.changed) ? details.changed : [],
      parts: Object.keys(details.parts ?? {}).length,
      failCount: row?.failCount ?? 0,
      lastError: row?.lastError ?? null,
    };
  });
}

/** «Переглянуто»: власник подивився зміну. false — джерела з таким ключем немає в базі */
export async function acknowledgeWatchedSource(prisma: PrismaClient, key: string, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.watchedSource.updateMany({ where: { key }, data: { acknowledgedAt: now } });
  return r.count > 0;
}
