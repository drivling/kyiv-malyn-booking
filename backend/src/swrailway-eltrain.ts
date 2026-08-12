/**
 * SW Railway suburban (eltrain) timetable parser.
 * Source pages: https://swrailway.gov.ua/timetable/eltrain/?...
 */

export type EltrainStationStop = {
  name: string;
  arrival: string | null;
  departure: string | null;
};

export type EltrainTrain = {
  tripNumber: string;
  daysNote: string;
  activeWeekdays: number[];
  destinationLabel: string;
  stops: EltrainStationStop[];
};

const HHMM = /^([0-1]?\d|2[0-3]):([0-5]\d)$/;

export function parseHhMmLoose(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().replace(',', '.');
  const m = t.match(HHMM);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

/** Map Ukrainian day notes from column headers to ISO weekdays 1=Mon … 7=Sun. */
export function mapDaysNoteToActiveWeekdays(note: string): number[] {
  const n = note.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n || n.includes('щоденно')) return [1, 2, 3, 4, 5, 6, 7];
  // «по сб., нд.» / «по сб. нд.» — only weekend
  if (/(?:^|[^а-яіїє])по\s+сб/.test(n) && n.includes('нд')) return [6, 7];
  if (n.includes('по сб') && !n.includes('нд')) return [6];
  if (n.includes('крім сб') && n.includes('нд')) return [1, 2, 3, 4, 5];
  if (n.includes('крім нд') || n.includes('крім нед')) return [1, 2, 3, 4, 5, 6];
  if (n.includes('по нд') || n.includes('по нед') || n === 'нд' || n.startsWith('нд.')) return [7];
  // «крім сб.» without Sunday → Mon–Fri + Sun
  if (n.includes('крім сб') && !n.includes('нд')) return [1, 2, 3, 4, 5, 7];
  // Unknown — assume daily so we do not wipe service by accident
  return [1, 2, 3, 4, 5, 6, 7];
}

export function normalizeStationName(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aliases for matching TripPoint / alightingPlace against eltrain station labels. */
export function stationNameMatches(stationLabel: string, needle: string, opts?: { exactKyivTerminals?: boolean }): boolean {
  const a = normalizeStationName(stationLabel).toLowerCase();
  const b = normalizeStationName(needle).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Specific Kyiv-area terminals — do not collapse to generic «Київ»
  const kyivTerminals = ['святошин', 'борщагівка', 'борщаговка', 'київ-пас', 'киев-пас', 'північна', 'северн'];
  const needleIsSpecific = kyivTerminals.some((t) => b.includes(t));
  const labelIsSpecific = kyivTerminals.some((t) => a.includes(t));
  if (needleIsSpecific || labelIsSpecific) {
    // Borshchagivka variants
    if (a.includes('борщаг') && b.includes('борщаг')) return true;
    if (a.includes('святошин') && b.includes('святошин')) return true;
    if (a.includes('київ-пас') && b.includes('київ-пас')) return true;
    if (a.includes('киев-пас') && b.includes('киев-пас')) return true;
    if ((a.includes('північна') || a.includes('северн')) && (b.includes('північна') || b.includes('северн') || b.includes('київ-пас'))) {
      return a.includes('північна') || a.includes('северн') ? b.includes('північна') || b.includes('северн') : false;
    }
    return false;
  }

  // Generic Kyiv city point ↔ any Kyiv-Pas label (when boardingPlace empty)
  if (
    !opts?.exactKyivTerminals &&
    (a.includes('київ') || a.includes('киев')) &&
    (b === 'київ' || b === 'киев' || b === 'kyiv')
  ) {
    return true;
  }
  if (
    !opts?.exactKyivTerminals &&
    (b.includes('київ') || b.includes('киев') || b === 'kyiv') &&
    (a === 'київ' || a === 'киев')
  ) {
    return true;
  }
  return false;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCellTexts(rowHtml: string): string[] {
  const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
  return cells.map((m) => stripTags(m[1] ?? '').replace(/\u00a0/g, ' ').trim());
}

/**
 * Parse eltrain HTML into trains with per-station arrival/departure.
 */
export function parseEltrainTimetable(html: string): EltrainTrain[] {
  const rows = html.split(/<tr[^>]*>/i);

  // Destination labels row (Тетерів – Святошин, …)
  let destinations: string[] = [];
  for (const row of rows) {
    const texts = extractCellTexts(row).map(normalizeStationName).filter(Boolean);
    const destLike = texts.filter((t) => /[–—-]/.test(t) && /(київ|святошин|борщаг|тетерів|малин|коростень)/i.test(t));
    if (destLike.length >= 3) {
      destinations = destLike;
      break;
    }
  }

  // Train number + day note: prefer ordered tid= header cells (allows duplicate trip numbers, e.g. two 6621)
  const trainMeta: Array<{ tripNumber: string; daysNote: string }> = [];
  const dayNoteRe =
    /(щоденно|крім\s+сб\.\s*,\s*нд\.|крім\s+сб\.,\s*нд\.|крім\s+нд\.|крім\s+сб\.|по\s+сб\.\s*,\s*нд\.|по\s+сб\.,\s*нд\.|по\s+нд\.|по\s+сб\.)/i;

  for (const m of html.matchAll(
    /href="\.\?tid=\d+"[^>]*>\s*(\d{3,4})\s*,([\s\S]{0,280}?)<\/(?:font|a)>/gi
  )) {
    const tripNumber = m[1]!;
    const noteMatch = m[2]!.match(dayNoteRe);
    if (!noteMatch) continue;
    trainMeta.push({
      tripNumber,
      daysNote: stripTags(noteMatch[1]!).replace(/\s+/g, ' ').trim(),
    });
    // Header block is the first consecutive cluster; stop after a large gap of non-matches via count cap
    if (trainMeta.length >= 24) break;
  }

  // Fallback: richest TR row of number+note cells
  if (trainMeta.length < 3) {
    let bestMeta: Array<{ tripNumber: string; daysNote: string }> = [];
    for (const row of rows) {
      if (!/\d{3,4}\s*,/.test(row)) continue;
      if (!/(щоденно|крім|по\s+)/i.test(row)) continue;
      const cellHtmls = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1] ?? '');
      const rowMeta: Array<{ tripNumber: string; daysNote: string }> = [];
      for (const cell of cellHtmls) {
        const num = cell.match(/(\d{3,4})\s*,/);
        if (!num) continue;
        const noteMatch = cell.match(dayNoteRe);
        if (!noteMatch) continue;
        rowMeta.push({
          tripNumber: num[1]!,
          daysNote: stripTags(noteMatch[1]!).replace(/\s+/g, ' ').trim(),
        });
      }
      if (rowMeta.length > bestMeta.length) bestMeta = rowMeta;
    }
    trainMeta.push(...bestMeta);
  }

  // Station names from left catalog: <font>N</font> … <td>Name or <b>Name</b>
  const stations: string[] = [];
  const stationRe =
    /<font[^>]*>\s*(\d+)\s*<\/font>&nbsp;<\/td>\s*<td[^>]*>\s*(?:<a[^>]*>\s*)?(?:<b>)?([^<]+?)(?:<\/b>)?(?:\s*<\/a>)?\s*<\/td>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = stationRe.exec(html)) !== null) {
    const name = normalizeStationName(sm[2]!);
    if (name && !/^\d+$/.test(name)) stations.push(name);
  }

  // Time grid: only arrival/departure cells (width=46 / class=q0), skip spacer columns
  const timeRows: Array<Array<string | null>> = [];
  for (const row of rows) {
    const timeCells = [...row.matchAll(/<td[^>]*(?:width\s*=\s*46|class=q0)[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => stripTags(m[1] ?? '').replace(/\u00a0/g, ' ').trim()
    );
    if (timeCells.length < 4) continue;
    const onlyTimes = timeCells.every(
      (t) => !t || t === '–' || t === '—' || t === '-' || HHMM.test(t)
    );
    if (!onlyTimes) continue;
    const cleaned = timeCells.map((t) => {
      if (!t || t === '–' || t === '—' || t === '-') return null;
      return parseHhMmLoose(t);
    });
    if (cleaned.some((c) => c != null)) {
      timeRows.push(cleaned);
    }
  }

  const trainCount = trainMeta.length;
  if (trainCount === 0 || timeRows.length === 0) {
    return [];
  }

  // Align stations ↔ time rows: usually equal counts; if not, use min and prefer matching by order
  const nStops = Math.min(stations.length, timeRows.length);
  const trains: EltrainTrain[] = [];

  for (let ti = 0; ti < trainCount; ti++) {
    const meta = trainMeta[ti]!;
    const arrIdx = ti * 2;
    const depIdx = ti * 2 + 1;
    const stops: EltrainStationStop[] = [];
    for (let si = 0; si < nStops; si++) {
      const row = timeRows[si]!;
      stops.push({
        name: stations[si]!,
        arrival: row[arrIdx] ?? null,
        departure: row[depIdx] ?? null,
      });
    }
    // Skip trains with no times at all
    if (!stops.some((s) => s.arrival || s.departure)) continue;

    trains.push({
      tripNumber: meta.tripNumber,
      daysNote: meta.daysNote,
      activeWeekdays: mapDaysNoteToActiveWeekdays(meta.daysNote),
      destinationLabel: destinations[ti] ?? '',
      stops,
    });
  }

  return trains;
}

export async function fetchEltrainPage(url: string): Promise<string> {
  const u = url.trim();
  if (!/^https?:\/\/([a-z0-9.-]*\.)?swrailway\.gov\.ua\//i.test(u)) {
    throw new Error('timetableSourceUrl must be an swrailway.gov.ua eltrain URL');
  }
  const res = await fetch(u, {
    headers: {
      'User-Agent': 'malin.kiev.ua-timetable-parser/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch timetable (${res.status})`);
  }
  return await res.text();
}

export function findTrainByNumber(trains: EltrainTrain[], tripNumber: string): EltrainTrain[] {
  const want = tripNumber.trim().replace(/[^\d]/g, '');
  if (!want) return [];
  return trains.filter((t) => t.tripNumber.replace(/[^\d]/g, '') === want);
}

/**
 * Resolve a train column: by tripNumber, and if several share the number
 * (e.g. two 6621 with different day notes / origins), pick by boardingPlace
 * as the first station that has a departure (origin).
 */
export function resolveTrainForSchedule(
  trains: EltrainTrain[],
  tripNumber: string,
  boardNeedle: string
): { train: EltrainTrain | null; status: 'ok' | 'not_found' | 'ambiguous' } {
  const found = findTrainByNumber(trains, tripNumber);
  if (found.length === 0) return { train: null, status: 'not_found' };
  if (found.length === 1) return { train: found[0]!, status: 'ok' };

  const needle = boardNeedle.trim();
  if (!needle) return { train: null, status: 'ambiguous' };

  const originOf = (t: EltrainTrain) => t.stops.find((s) => s.departure) ?? null;

  const byExactOrigin = found.filter((t) => {
    const origin = originOf(t);
    return origin && stationNameMatches(origin.name, needle, { exactKyivTerminals: true });
  });
  if (byExactOrigin.length === 1) return { train: byExactOrigin[0]!, status: 'ok' };

  const bySoftOrigin = found.filter((t) => {
    const origin = originOf(t);
    return origin && stationNameMatches(origin.name, needle);
  });
  if (bySoftOrigin.length === 1) return { train: bySoftOrigin[0]!, status: 'ok' };

  return { train: null, status: 'ambiguous' };
}

export function pickStationTimes(
  train: EltrainTrain,
  boardNeedle: string,
  alightNeedle: string
): { departureTime: string | null; arrivalTime: string | null; alightStation: string | null; boardStation: string | null } {
  const exact = /святошин|борщаг|київ-пас|киев-пас|північна/i.test(boardNeedle);
  const boardStops = train.stops.filter((s) =>
    stationNameMatches(s.name, boardNeedle, exact ? { exactKyivTerminals: true } : undefined)
  );

  let departureTime: string | null = null;
  let boardStation: string | null = null;
  if (boardStops.length >= 1) {
    // First stop in route order that has a departure (origin for this OD)
    const withDep = boardStops.find((s) => s.departure) ?? boardStops[0]!;
    departureTime = withDep.departure || withDep.arrival;
    boardStation = withDep.name;
  }

  const alightStops = train.stops.filter((s) => stationNameMatches(s.name, alightNeedle));
  let arrivalTime: string | null = null;
  let alightStation: string | null = null;
  if (alightStops.length >= 1) {
    const stop = alightStops[alightStops.length - 1]!;
    arrivalTime = stop.arrival || stop.departure;
    alightStation = stop.name;
  }

  return { departureTime, arrivalTime, alightStation, boardStation };
}

export function durationMinutesBetween(dep: string | null, arr: string | null): number | null {
  if (!dep || !arr) return null;
  const d = parseHhMmLoose(dep);
  const a = parseHhMmLoose(arr);
  if (!d || !a) return null;
  const [dh, dm] = d.split(':').map(Number);
  const [ah, am] = a.split(':').map(Number);
  let mins = ah! * 60 + am! - (dh! * 60 + dm!);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
