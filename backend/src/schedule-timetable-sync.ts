import { createHash, randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import {
  durationMinutesBetween,
  fetchEltrainPage,
  parseEltrainTimetable,
  pickStationTimes,
  resolveTrainForSchedule,
  type EltrainTrain,
} from './swrailway-eltrain';
import { normalizeActiveWeekdays } from './schedule-trip';

export type TimetableChangeStatus = 'changed' | 'unchanged' | 'not_found' | 'ambiguous' | 'no_board_time';

export type TimetablePatchFields = {
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  activeWeekdays: number[];
  alightingPlace: string | null;
  daysNote: string | null;
};

export type TimetableChangeRow = {
  scheduleId: number;
  tripNumber: string;
  route: string;
  timetableSourceUrl: string;
  status: TimetableChangeStatus;
  before: TimetablePatchFields;
  after: TimetablePatchFields;
};

export type TimetablePreviewResult = {
  previewToken: string;
  changes: TimetableChangeRow[];
  pageTrainsUnmatched: Array<{ url: string; tripNumber: string; daysNote: string; destinationLabel: string }>;
  errors: Array<{ url: string; error: string }>;
  summary: { changed: number; unchanged: number; notFound: number; ambiguous: number; errors: number };
};

type PreviewStoreEntry = {
  expiresAt: number;
  patches: Map<number, TimetablePatchFields & { route: string; tripRouteId: number }>;
};

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const previewStore = new Map<string, PreviewStoreEntry>();

function prunePreviewStore(now = Date.now()): void {
  for (const [k, v] of previewStore) {
    if (v.expiresAt <= now) previewStore.delete(k);
  }
}

function weekdaysEqual(a: unknown, b: number[]): boolean {
  const na = normalizeActiveWeekdays(a);
  if (na.length !== b.length) return false;
  return na.every((d, i) => d === b[i]);
}

function buildBefore(s: {
  departureTime: string;
  arrivalTime: string | null;
  durationMinutes: number | null;
  activeWeekdays: unknown;
  alightingPlace: string | null;
}): TimetablePatchFields {
  return {
    departureTime: s.departureTime,
    arrivalTime: s.arrivalTime,
    durationMinutes: s.durationMinutes,
    activeWeekdays: normalizeActiveWeekdays(s.activeWeekdays),
    alightingPlace: s.alightingPlace,
    daysNote: null,
  };
}

function diffStatus(before: TimetablePatchFields, after: TimetablePatchFields): 'changed' | 'unchanged' {
  const same =
    before.departureTime === after.departureTime &&
    (before.arrivalTime || null) === (after.arrivalTime || null) &&
    (before.durationMinutes ?? null) === (after.durationMinutes ?? null) &&
    weekdaysEqual(before.activeWeekdays, after.activeWeekdays) &&
    (before.alightingPlace || null) === (after.alightingPlace || null);
  return same ? 'unchanged' : 'changed';
}

const MAX_ELTRAIN_HTML_CHARS = 1_500_000;

export function parseTimetablePages(raw: unknown): Array<{ url: string; html: string }> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw Object.assign(new Error('pages must be an array of { url, html }'), { status: 400 });
  }
  const pages: Array<{ url: string; html: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const url = String((item as { url?: unknown }).url || '').trim();
    const html = String((item as { html?: unknown }).html || '');
    if (!url || !html) continue;
    if (html.length > MAX_ELTRAIN_HTML_CHARS) {
      throw Object.assign(new Error(`HTML too large for ${url}`), { status: 400 });
    }
    pages.push({ url, html });
  }
  return pages;
}

export async function buildTimetablePreview(
  prisma: PrismaClient,
  opts?: { pages?: Array<{ url: string; html: string }> }
): Promise<TimetablePreviewResult> {
  prunePreviewStore();

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: [
        { timetableSourceUrl: { not: null } },
        { NOT: { timetableSourceUrl: '' } },
        { tripNumber: { not: null } },
        { NOT: { tripNumber: '' } },
      ],
    },
    include: { startPoint: true, endPoint: true },
    orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
  });

  const byUrl = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const url = (s.timetableSourceUrl || '').trim();
    if (!url) continue;
    const list = byUrl.get(url) ?? [];
    list.push(s);
    byUrl.set(url, list);
  }

  const errors: Array<{ url: string; error: string }> = [];
  const trainsByUrl = new Map<string, EltrainTrain[]>();
  const htmlByUrl = new Map((opts?.pages ?? []).map((p) => [p.url.trim(), p.html]));

  for (const url of byUrl.keys()) {
    try {
      const provided = htmlByUrl.get(url);
      const html = provided ?? (await fetchEltrainPage(url));
      trainsByUrl.set(url, parseEltrainTimetable(html));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch/parse failed';
      errors.push({
        url,
        error: htmlByUrl.has(url)
          ? msg
          : `${msg} — likely geo-blocked from EU hosting; upload the saved HTML page`,
      });
      trainsByUrl.set(url, []);
    }
  }

  const matchedTripKeys = new Set<string>();
  const changes: TimetableChangeRow[] = [];
  const patches = new Map<number, TimetablePatchFields & { route: string; tripRouteId: number }>();

  for (const s of schedules) {
    const url = (s.timetableSourceUrl || '').trim();
    const tripNumber = (s.tripNumber || '').trim();
    const before = buildBefore(s);
    const emptyAfter: TimetablePatchFields = {
      departureTime: null,
      arrivalTime: null,
      durationMinutes: null,
      activeWeekdays: before.activeWeekdays,
      alightingPlace: before.alightingPlace,
      daysNote: null,
    };

    if (errors.some((e) => e.url === url)) {
      changes.push({
        scheduleId: s.id,
        tripNumber,
        route: s.route,
        timetableSourceUrl: url,
        status: 'not_found',
        before,
        after: emptyAfter,
      });
      continue;
    }

    const trains = trainsByUrl.get(url) ?? [];
    const boardNeedle = (s.boardingPlace || s.startPoint?.nameUk || '').trim();
    const alightNeedle = (s.alightingPlace || s.endPoint?.nameUk || '').trim();
    const resolved = resolveTrainForSchedule(trains, tripNumber, boardNeedle);

    if (resolved.status !== 'ok' || !resolved.train) {
      changes.push({
        scheduleId: s.id,
        tripNumber,
        route: s.route,
        timetableSourceUrl: url,
        status: resolved.status === 'ambiguous' ? 'ambiguous' : 'not_found',
        before,
        after: emptyAfter,
      });
      continue;
    }

    const train = resolved.train;
    matchedTripKeys.add(`${url}::${train.tripNumber}::${boardNeedle || train.destinationLabel}`);

    const picked = pickStationTimes(train, boardNeedle || 'Київ', alightNeedle || 'Малин');

    if (!picked.departureTime) {
      changes.push({
        scheduleId: s.id,
        tripNumber,
        route: s.route,
        timetableSourceUrl: url,
        status: 'no_board_time',
        before,
        after: { ...emptyAfter, daysNote: train.daysNote },
      });
      continue;
    }

    const after: TimetablePatchFields = {
      departureTime: picked.departureTime,
      arrivalTime: picked.arrivalTime,
      durationMinutes: durationMinutesBetween(picked.departureTime, picked.arrivalTime),
      activeWeekdays: train.activeWeekdays,
      alightingPlace: before.alightingPlace || picked.alightStation,
      daysNote: train.daysNote,
    };

    const status = diffStatus(before, after);
    changes.push({
      scheduleId: s.id,
      tripNumber,
      route: s.route,
      timetableSourceUrl: url,
      status,
      before,
      after,
    });

    if (status === 'changed') {
      patches.set(s.id, {
        ...after,
        route: s.route,
        tripRouteId: s.tripRouteId,
      });
    }
  }

  const pageTrainsUnmatched: TimetablePreviewResult['pageTrainsUnmatched'] = [];
  for (const [url, trains] of trainsByUrl) {
    for (const t of trains) {
      const key = `${url}::${t.tripNumber}`;
      if (!matchedTripKeys.has(key)) {
        pageTrainsUnmatched.push({
          url,
          tripNumber: t.tripNumber,
          daysNote: t.daysNote,
          destinationLabel: t.destinationLabel,
        });
      }
    }
  }

  const previewToken = randomBytes(16).toString('hex');
  previewStore.set(previewToken, {
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    patches,
  });

  const summary = {
    changed: changes.filter((c) => c.status === 'changed').length,
    unchanged: changes.filter((c) => c.status === 'unchanged').length,
    notFound: changes.filter((c) => c.status === 'not_found' || c.status === 'no_board_time').length,
    ambiguous: changes.filter((c) => c.status === 'ambiguous').length,
    errors: errors.length,
  };

  return { previewToken, changes, pageTrainsUnmatched, errors, summary };
}

export async function applyTimetablePreview(
  prisma: PrismaClient,
  previewToken: string,
  scheduleIds: number[]
): Promise<{ updated: number; conflicts: Array<{ scheduleId: number; error: string }> }> {
  prunePreviewStore();
  const entry = previewStore.get(previewToken);
  if (!entry) {
    throw Object.assign(new Error('Preview expired or invalid — run preview again'), { status: 400 });
  }

  const selected = scheduleIds.filter((id) => entry.patches.has(id));
  if (selected.length === 0) {
    return { updated: 0, conflicts: [] };
  }

  // Fail-all on unique conflicts
  const conflicts: Array<{ scheduleId: number; error: string }> = [];
  for (const id of selected) {
    const patch = entry.patches.get(id)!;
    if (!patch.departureTime) {
      conflicts.push({ scheduleId: id, error: 'Missing departureTime in patch' });
      continue;
    }
    const clash = await prisma.schedule.findFirst({
      where: {
        id: { not: id },
        OR: [
          { route: patch.route, departureTime: patch.departureTime },
          { tripRouteId: patch.tripRouteId, departureTime: patch.departureTime },
        ],
      },
      select: { id: true, tripNumber: true },
    });
    if (clash) {
      conflicts.push({
        scheduleId: id,
        error: `Time ${patch.departureTime} already used by schedule #${clash.id}${clash.tripNumber ? ` (${clash.tripNumber})` : ''}`,
      });
    }
  }

  if (conflicts.length > 0) {
    return { updated: 0, conflicts };
  }

  await prisma.$transaction(
    selected.map((id) => {
      const patch = entry.patches.get(id)!;
      return prisma.schedule.update({
        where: { id },
        data: {
          departureTime: patch.departureTime!,
          arrivalTime: patch.arrivalTime,
          durationMinutes: patch.durationMinutes,
          activeWeekdays: patch.activeWeekdays,
          alightingPlace: patch.alightingPlace,
        },
      });
    })
  );

  previewStore.delete(previewToken);
  return { updated: selected.length, conflicts: [] };
}

/** Test helper */
export function _previewStoreSizeForTests(): number {
  return previewStore.size;
}

export function fingerprintUrlList(urls: string[]): string {
  return createHash('sha1').update(urls.slice().sort().join('|')).digest('hex');
}
