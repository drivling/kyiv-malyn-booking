/**
 * Журнал ревізій датасету міського транспорту (Docs/transport-revisions-2026-10.md).
 *
 * Кожен запис, що бампає `TransportMeta.updatedAt` (PUT датасету, «Перерахувати час», редиректи зупинок, seed),
 * лишає рядок `TransportRevision(revision = ISO updatedAt, stats, diff)`. diff рахується чистою функцією проти
 * датасету, завантаженого **до** запису (`snapshotTransportDataset` → запис → `recordTransportRevision`); перший
 * рядок — із поточного стану без diff. Журнал ніколи не блокує сам запис: помилки лише в лог.
 * Читачі: `GET /transport/revisions` (JSON) і `GET /transport/changes.rss` (людський підсумок, transport-feeds.ts).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { buildGtfsFeed, type GtfsFeedStats } from './gtfs-feed';
import { loadTransportDataset, type TransportDataset } from './local-transport';
import { stopRedirectsOf } from './stop-redirects';

export type TransportRevisionSource = 'initial' | 'seed' | 'dataset' | 'recalculate' | 'stop-redirects';

export interface RevisionStopRef {
  id: string;
  name: string;
}
export interface RevisionRouteRef {
  id: string;
  /** Номер для людей (shortName або id) */
  no: string;
  name: string;
}
export interface RevisionTripRef {
  id: string;
  routeId: string;
  /** Номер маршруту для людей */
  routeNo: string;
  /** HH:MM; порожньо — рейс без часу */
  departureTime: string;
}
export interface RevisionRedirectRef {
  from: string;
  to: string;
}

/** Що змінилось між двома ревізіями. Порожні масиви / 0 — нічого; isEmptyDiff() перевіряє все разом. */
export interface TransportRevisionDiff {
  stops: {
    added: RevisionStopRef[];
    removed: RevisionStopRef[];
    renamed: Array<{ id: string; from: string; to: string }>;
  };
  routes: {
    added: RevisionRouteRef[];
    removed: RevisionRouteRef[];
  };
  trips: {
    added: RevisionTripRef[];
    removed: RevisionTripRef[];
    /** Той самий trip_id, інший час відправлення */
    moved: Array<RevisionTripRef & { from: string; to: string }>;
  };
  /** Сегменти маршрутів (час у дорозі між сусідніми зупинками), у яких змінились секунди або які з'явились/зникли */
  segments: { changed: number };
  redirects: {
    added: RevisionRedirectRef[];
    removed: RevisionRedirectRef[];
  };
}

/** Рядок журналу у відповіді API / для RSS */
export interface TransportRevisionRecord {
  revision: string;
  createdAt: string;
  source: TransportRevisionSource;
  stats: GtfsFeedStats;
  diff: TransportRevisionDiff | null;
  /** Людський підсумок diff українською (describeTransportRevision) */
  summary: string;
}

export const TRANSPORT_REVISIONS_DEFAULT_LIMIT = 50;
export const TRANSPORT_REVISIONS_MAX_LIMIT = 200;

const clock = (t: string | null | undefined): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

const routeNoOf = (routes: Map<string, { shortName?: string }>, routeId: string): string =>
  routes.get(routeId)?.shortName?.trim() || routeId;

const routeNameOf = (r: { fromName?: string; toName?: string }): string =>
  [r.fromName, r.toName].filter((s) => s && s.trim()).join(' — ');

const byId = <T extends { id: string }>(rows: T[]): Map<string, T> => new Map(rows.map((r) => [r.id, r]));

/** Чистий diff двох датасетів: зупинки, маршрути, рейси, сегменти, редиректи. Порядок — за id, стабільний. */
export function diffTransportDatasets(prev: TransportDataset, next: TransportDataset): TransportRevisionDiff {
  const prevStops = byId(prev.stops);
  const nextStops = byId(next.stops);
  const prevRoutes = byId(prev.routes);
  const nextRoutes = byId(next.routes);
  const prevTrips = byId(prev.trips);
  const nextTrips = byId(next.trips);

  const stops: TransportRevisionDiff['stops'] = { added: [], removed: [], renamed: [] };
  for (const s of next.stops) {
    const was = prevStops.get(s.id);
    if (!was) stops.added.push({ id: s.id, name: s.name });
    else if (was.name !== s.name) stops.renamed.push({ id: s.id, from: was.name, to: s.name });
  }
  for (const s of prev.stops) if (!nextStops.has(s.id)) stops.removed.push({ id: s.id, name: s.name });

  const routes: TransportRevisionDiff['routes'] = { added: [], removed: [] };
  for (const r of next.routes) if (!prevRoutes.has(r.id)) routes.added.push({ id: r.id, no: routeNoOf(nextRoutes, r.id), name: routeNameOf(r) });
  for (const r of prev.routes) if (!nextRoutes.has(r.id)) routes.removed.push({ id: r.id, no: routeNoOf(prevRoutes, r.id), name: routeNameOf(r) });

  const trips: TransportRevisionDiff['trips'] = { added: [], removed: [], moved: [] };
  const tripRef = (t: TransportDataset['trips'][number], routesMap: Map<string, { shortName?: string }>): RevisionTripRef => ({
    id: t.id,
    routeId: t.routeId,
    routeNo: routeNoOf(routesMap, t.routeId),
    departureTime: clock(t.departureTime),
  });
  for (const t of next.trips) {
    const was = prevTrips.get(t.id);
    if (!was) {
      trips.added.push(tripRef(t, nextRoutes));
      continue;
    }
    const from = clock(was.departureTime);
    const to = clock(t.departureTime);
    if (from !== to) trips.moved.push({ ...tripRef(t, nextRoutes), from, to });
  }
  for (const t of prev.trips) if (!nextTrips.has(t.id)) trips.removed.push(tripRef(t, prevRoutes));

  const segKey = (s: TransportDataset['segments'][number]) => `${s.routeId}|${s.fromStopId}|${s.toStopId}`;
  const prevSeg = new Map(prev.segments.map((s) => [segKey(s), Math.round(s.seconds)]));
  const nextSeg = new Map(next.segments.map((s) => [segKey(s), Math.round(s.seconds)]));
  let changed = 0;
  for (const [k, sec] of nextSeg) if (prevSeg.get(k) !== sec) changed++;
  for (const k of prevSeg.keys()) if (!nextSeg.has(k)) changed++;

  const prevRedirects = stopRedirectsOf(prev);
  const nextRedirects = stopRedirectsOf(next);
  const redirects: TransportRevisionDiff['redirects'] = { added: [], removed: [] };
  for (const [from, to] of Object.entries(nextRedirects).sort()) if (prevRedirects[from] !== to) redirects.added.push({ from, to });
  for (const [from, to] of Object.entries(prevRedirects).sort()) if (nextRedirects[from] !== to) redirects.removed.push({ from, to });

  return { stops, routes, trips, segments: { changed }, redirects };
}

export function isEmptyDiff(diff: TransportRevisionDiff | null | undefined): boolean {
  if (!diff) return true;
  return (
    !diff.stops.added.length &&
    !diff.stops.removed.length &&
    !diff.stops.renamed.length &&
    !diff.routes.added.length &&
    !diff.routes.removed.length &&
    !diff.trips.added.length &&
    !diff.trips.removed.length &&
    !diff.trips.moved.length &&
    !diff.segments.changed &&
    !diff.redirects.added.length &&
    !diff.redirects.removed.length
  );
}

/** Лічильники фіду на поточний стан — ті самі, що пише GTFS (unreliable маршрути не рахуються) */
export function transportRevisionStats(dataset: TransportDataset): GtfsFeedStats {
  return buildGtfsFeed(dataset, { revision: dataset.revision ?? null }).stats;
}

/* ---------- людський підсумок ---------- */

export const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};

/** Скільки позицій перелічуємо поіменно в одній категорії; далі — «та ще N» */
const LIST_MAX = 6;

function listed<T>(items: T[], label: (count: number) => string, item: (x: T) => string): string {
  const shown = items.slice(0, LIST_MAX).map(item).join(', ');
  const rest = items.length - LIST_MAX;
  return `${label(items.length)}: ${shown}${rest > 0 ? ` та ще ${rest}` : ''}`;
}

const stopItem = (s: RevisionStopRef) => `«${s.name}» (${s.id})`;
const routeItem = (r: RevisionRouteRef) => `№${r.no}${r.name ? ` ${r.name}` : ''}`;
const tripItem = (t: RevisionTripRef) => `№${t.routeNo} ${t.departureTime ? `о ${t.departureTime}` : 'без часу'} (${t.id})`;

/** Підсумок diff українською; порожній diff → '' (що писати тоді — вирішує describeTransportRevision за source) */
export function describeTransportDiff(diff: TransportRevisionDiff): string {
  const parts: string[] = [];
  if (diff.stops.added.length) parts.push(listed(diff.stops.added, (n) => `додано ${plural(n, 'зупинку', 'зупинки', 'зупинок')}`, stopItem));
  if (diff.stops.renamed.length)
    parts.push(listed(diff.stops.renamed, (n) => `перейменовано ${plural(n, 'зупинку', 'зупинки', 'зупинок')}`, (r) => `«${r.from}» → «${r.to}» (${r.id})`));
  if (diff.stops.removed.length) parts.push(listed(diff.stops.removed, (n) => `знято ${plural(n, 'зупинку', 'зупинки', 'зупинок')}`, stopItem));
  if (diff.routes.added.length) parts.push(listed(diff.routes.added, (n) => `додано ${plural(n, 'маршрут', 'маршрути', 'маршрутів')}`, routeItem));
  if (diff.routes.removed.length) parts.push(listed(diff.routes.removed, (n) => `знято ${plural(n, 'маршрут', 'маршрути', 'маршрутів')}`, routeItem));
  if (diff.trips.added.length) parts.push(listed(diff.trips.added, (n) => `додано ${plural(n, 'рейс', 'рейси', 'рейсів')}`, tripItem));
  if (diff.trips.moved.length)
    parts.push(
      listed(
        diff.trips.moved,
        (n) => `зсунуто ${plural(n, 'рейс', 'рейси', 'рейсів')}`,
        (t) => `№${t.routeNo} ${t.from || '—'} → ${t.to || '—'} (${t.id})`
      )
    );
  if (diff.trips.removed.length) parts.push(listed(diff.trips.removed, (n) => `знято ${plural(n, 'рейс', 'рейси', 'рейсів')}`, tripItem));
  if (diff.segments.changed) parts.push(`змінено час у дорозі на ${plural(diff.segments.changed, 'перегоні', 'перегонах', 'перегонах')} між зупинками`);
  if (diff.redirects.added.length)
    parts.push(listed(diff.redirects.added, (n) => `${plural(n, 'зупинку', 'зупинки', 'зупинок')} перенесено`, (r) => `${r.from} → ${r.to}`));
  if (diff.redirects.removed.length)
    parts.push(listed(diff.redirects.removed, (n) => `знято ${plural(n, 'перенесення', 'перенесення', 'перенесень')}`, (r) => `${r.from} → ${r.to}`));
  if (!parts.length) return '';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Підсумок рядка журналу: diff, а коли його нема або він порожній — що це за запис за source */
export function describeTransportRevision(row: Pick<TransportRevisionRecord, 'source' | 'diff'>): string {
  if (!row.diff) {
    return row.source === 'seed' ? 'Дані завантажено з початкового набору' : 'Перша збережена версія даних — попереднього стану для порівняння немає';
  }
  const text = describeTransportDiff(row.diff);
  if (text) return text;
  if (row.source === 'recalculate') return 'Перераховано час у дорозі — секунди на перегонах не змінились';
  if (row.source === 'stop-redirects') return 'Перенесення зупинок збережено без змін';
  return 'Технічне оновлення без змін у зупинках, маршрутах, рейсах і часі в дорозі (опис, контакти чи схема)';
}

/* ---------- запис і читання ---------- */

type RevisionRow = { revision: string; createdAt: Date; source: string; stats: unknown; diff: unknown };

function toRecord(row: RevisionRow): TransportRevisionRecord {
  const diff = (row.diff ?? null) as TransportRevisionDiff | null;
  const source = row.source as TransportRevisionSource;
  return {
    revision: row.revision,
    createdAt: new Date(row.createdAt).toISOString(),
    source,
    stats: row.stats as GtfsFeedStats,
    diff,
    summary: describeTransportRevision({ source, diff }),
  };
}

/**
 * Датасет до запису — для diff. null, коли датасету ще нема (порожня БД) або його не вдалося прочитати:
 * журнал не має зірвати сам запис.
 */
export async function snapshotTransportDataset(prisma: PrismaClient): Promise<TransportDataset | null> {
  try {
    const ds = await loadTransportDataset(prisma);
    return ds.revision ? ds : null;
  } catch (e) {
    console.error('[transport-revisions] snapshot before write failed', e);
    return null;
  }
}

/**
 * Записати рядок про поточну revision (після запису в БД). previous — знімок до запису (snapshotTransportDataset);
 * без нього diff = null. Повторний виклик для тієї самої revision нічого не змінює (upsert без update).
 * Помилки лише в лог; повертає запис або null.
 */
export async function recordTransportRevision(
  prisma: PrismaClient,
  options: { source: TransportRevisionSource; previous: TransportDataset | null }
): Promise<TransportRevisionRecord | null> {
  try {
    const current = await loadTransportDataset(prisma);
    if (!current.revision) return null;
    if (options.previous?.revision === current.revision) return null;
    const diff = options.previous ? diffTransportDatasets(options.previous, current) : null;
    const stats = transportRevisionStats(current);
    const row = await prisma.transportRevision.upsert({
      where: { revision: current.revision },
      create: {
        revision: current.revision,
        source: options.source,
        stats: stats as unknown as Prisma.InputJsonValue,
        diff: diff === null ? undefined : (diff as unknown as Prisma.InputJsonValue),
      },
      update: {},
    });
    return toRecord(row);
  } catch (e) {
    console.error('[transport-revisions] record failed', e);
    return null;
  }
}

/** При старті: журнал порожній, а датасет є → перший рядок із поточного стану без diff */
export async function ensureInitialTransportRevision(prisma: PrismaClient): Promise<TransportRevisionRecord | null> {
  try {
    if ((await prisma.transportRevision.count()) > 0) return null;
  } catch (e) {
    console.error('[transport-revisions] count failed', e);
    return null;
  }
  return recordTransportRevision(prisma, { source: 'initial', previous: null });
}

/** Останні рядки журналу, новіші першими (revision — ISO, тож сортується як час) */
export async function listTransportRevisions(prisma: PrismaClient, limit = TRANSPORT_REVISIONS_DEFAULT_LIMIT): Promise<TransportRevisionRecord[]> {
  const take = Math.min(Math.max(1, Math.floor(limit)), TRANSPORT_REVISIONS_MAX_LIMIT);
  const rows = await prisma.transportRevision.findMany({ orderBy: { revision: 'desc' }, take });
  return rows.map(toRecord);
}

/** ?limit= з запиту → число в межах 1…200, типово 50 */
export function parseRevisionsLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return TRANSPORT_REVISIONS_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), TRANSPORT_REVISIONS_MAX_LIMIT);
}
