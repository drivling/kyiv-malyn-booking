/**
 * Знімок EasyWay для Житомира (data/zhytomyr-transport/easyway/): що взято зі сторінок eway.in.ua руками через
 * браузер власника, з дозволу EasyWay (API в них нема; автоматично сайт не обходимо — Docs/zhytomyr-transport-2026-11.md).
 *
 * Чистий розбір файлів знімка, без мережі й файлової системи:
 * - routes.csv        — усі лінії міста зі списку EasyWay (тип, номер, кінцеві, години, інтервал, ціна);
 * - stop_sequence.csv — порядок зупинок за напрямками (ID зупинок EasyWay, де вони є);
 * - departures.csv    — відправлення з першої зупинки (будні / вихідні, позначка «в депо»);
 * - raw/**.txt        — сторінки маршрутів як знято (RI / TITLE / PANEL / F / B / S … WD / WE): звідси беремо те, чого
 *                       ще нема в CSV (електротранспорт збирається окремо й потрапляє спершу сюди).
 * Координат зупинок EasyWay не віддає (закодовані на карті) — їх дає zhytomyr-dataset.ts за назвами.
 */

export type EwMode = 'bus' | 'trolleybus' | 'tram' | 'suburban' | 'intercity' | 'train' | 'elektrichka' | 'other';
export type EwDirKey = 'forward' | 'backward';

export interface EwStop {
  /** ID зупинки EasyWay; null — у знімку його нема */
  id: string | null;
  name: string;
}

export interface EwDeparture {
  time: string;
  /** рейс «у депо» (не доходить до кінцевої) */
  depot: boolean;
}

export interface EwDirection {
  stops: EwStop[];
  /** зупинка, з якої знято розклад; null — розкладу нема */
  from: string | null;
  workdays: EwDeparture[];
  weekend: EwDeparture[];
}

export interface EwRoute {
  /** ID маршруту EasyWay (ri) */
  ri: string;
  mode: EwMode;
  /** номер, який бачить людина («2», «1А»; у трамвая — «Трамвай») */
  number: string;
  name: string;
  workHours: string;
  interval: string;
  priceUah: number | null;
  firstStop: string;
  lastStop: string;
  /** «Вартість 17 UAH | Відстань 12.89 км | Перевізник …» — як на сторінці маршруту */
  panel: string | null;
  /** electric_routes.csv: кільцева лінія (один напрямок) чи в дві сторони; null — невідомо */
  shape: 'loop' | 'two-way' | null;
  lengthKm: number | null;
  carrier: string | null;
  directions: Partial<Record<EwDirKey, EwDirection>>;
}

export interface EwSnapshot {
  routes: EwRoute[];
}

const MODES: Record<string, EwMode> = {
  bus: 'bus',
  trol: 'trolleybus',
  trolleybus: 'trolleybus',
  tram: 'tram',
  suburban: 'suburban',
  'bus-suburban': 'suburban',
  'train-suburban': 'elektrichka',
  intercity: 'intercity',
  train: 'train',
  elektrichka: 'elektrichka',
};

/** Тип із назви сторінки: «2 тролейбус (…)», «1 автобус (…)» */
function modeFromTitle(title: string): EwMode | null {
  const t = title.toLowerCase();
  if (t.includes('тролейбус')) return 'trolleybus';
  if (t.includes('трамвай')) return 'tram';
  if (t.includes('автобус')) return 'bus';
  return null;
}

/** Рядок CSV з лапками ("a ""b""") */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const emptyDir = (): EwDirection => ({ stops: [], from: null, workdays: [], weekend: [] });
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const normTime = (t: string): string | null => {
  const m = TIME_RE.exec(t.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/** «19:56d» — рейс у депо (так у raw/*.json) */
function departure(raw: string, mark = ''): EwDeparture | null {
  const depot = /d$/i.test(raw.trim()) || /депо|depot/i.test(mark);
  const time = normTime(raw.trim().replace(/d$/i, ''));
  return time ? { time, depot } : null;
}

/**
 * Сторінка маршруту в текстовому вигляді (raw/route-N.txt, raw/electric/route-N.txt):
 *   RI 3 · TITLE … · PANEL … · F a; b; c (або «82=a; 80=b») · B … · S forward @зупинка · WD 05:36 06:25 … · WE …
 */
export type EwRawPage = Pick<EwRoute, 'ri' | 'mode' | 'number' | 'panel' | 'directions'> & { title: string };

export function parseEwRawText(text: string): EwRawPage | null {
  let ri = '';
  let title = '';
  let panel: string | null = null;
  const directions: Partial<Record<EwDirKey, EwDirection>> = {};
  let current: EwDirKey | null = null;
  const stopsOf = (list: string): EwStop[] =>
    list
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = /^(\d+)=(.+)$/.exec(s);
        return m ? { id: m[1], name: m[2].trim() } : { id: null, name: s };
      });
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const head = /^\s*(RI|TITLE|PANEL|F|B|S|WD|WE|NOTE)\b\s?(.*)$/.exec(line);
    if (!head) continue;
    const [, key, rest] = head;
    if (key === 'RI') ri = rest.trim();
    else if (key === 'TITLE') title = rest.trim();
    else if (key === 'PANEL') panel = rest.trim() || null;
    else if (key === 'F' || key === 'B') {
      const stops = stopsOf(rest);
      if (stops.length) (directions[key === 'F' ? 'forward' : 'backward'] ??= emptyDir()).stops = stops;
    } else if (key === 'S') {
      const m = /^(forward|backward)\s*(?:@(.*))?$/.exec(rest.trim());
      current = m ? (m[1] as EwDirKey) : null;
      if (current) (directions[current] ??= emptyDir()).from = m?.[2]?.trim() || null;
    } else if ((key === 'WD' || key === 'WE') && current) {
      const list = rest
        .split(/\s+/)
        .map((t) => departure(t))
        .filter((d): d is EwDeparture => d !== null);
      directions[current]![key === 'WD' ? 'workdays' : 'weekend'] = list;
    }
  }
  if (!ri) return null;
  return { ri, title, panel, mode: modeFromTitle(title) ?? 'other', number: title.split(/\s+/)[0] ?? '', directions };
}

/** Сторінка маршруту в JSON (raw/route-N.json): stops.forward = [[id, назва]…], sched.<dir>.times = [будні, вихідні] */
export function parseEwRawJson(text: string): EwRawPage | null {
  const d = JSON.parse(text) as {
    ri?: string;
    title?: string;
    panel?: string;
    stops?: Partial<Record<EwDirKey, Array<[string, string]>>>;
    sched?: Partial<Record<EwDirKey, { stop?: string; times?: string[][] }>>;
  };
  if (!d.ri) return null;
  const directions: Partial<Record<EwDirKey, EwDirection>> = {};
  for (const key of ['forward', 'backward'] as const) {
    const stops = d.stops?.[key];
    const sched = d.sched?.[key];
    if (!stops?.length && !sched) continue;
    const dir = emptyDir();
    dir.stops = (stops ?? []).map(([id, name]) => ({ id: id || null, name }));
    dir.from = sched?.stop ?? null;
    const [wd = [], we = []] = sched?.times ?? [];
    dir.workdays = wd.map((t) => departure(t)).filter((x): x is EwDeparture => x !== null);
    dir.weekend = we.map((t) => departure(t)).filter((x): x is EwDeparture => x !== null);
    directions[key] = dir;
  }
  const title = d.title ?? '';
  return { ri: String(d.ri), title, panel: d.panel ?? null, mode: modeFromTitle(title) ?? 'other', number: title.split(/\s+/)[0] ?? '', directions };
}

export interface EwFiles {
  routesCsv: string | null;
  stopSequenceCsv: string | null;
  departuresCsv: string | null;
  /** electric_routes.csv: довжина, перевізник, кільцева чи ні */
  electricRoutesCsv?: string | null;
  /** шлях у знімку → вміст (raw/route-3.txt, raw/electric/route-1.txt, raw/route-17.json) */
  raw: Record<string, string>;
}

const dirCount = (d: EwDirection | undefined): number => (d ? d.stops.length + d.workdays.length + d.weekend.length : 0);

/**
 * Знімок EasyWay з файлів. CSV — основа (їх зводить людина, що знімає); сторінка з raw/ доповнює напрямок, коли в ній
 * більше (зупинки з ID, розклад, якого в CSV ще нема). Лінії без запису в routes.csv, але зі сторінкою — теж беремо.
 */
export function parseEasywaySnapshot(files: EwFiles): EwSnapshot {
  const byRi = new Map<string, EwRoute>();
  for (const row of files.routesCsv ? parseCsv(files.routesCsv) : []) {
    const ri = row.easyway_id;
    if (!ri) continue;
    const price = Number(row.price_uah);
    byRi.set(ri, {
      ri,
      mode: MODES[row.type] ?? 'other',
      number: row.number,
      name: row.name,
      workHours: row.work_hours,
      interval: row.interval_min,
      priceUah: Number.isFinite(price) && row.price_uah !== '' ? price : null,
      firstStop: row.first_stop,
      lastStop: row.last_stop,
      panel: null,
      shape: null,
      lengthKm: null,
      carrier: null,
      directions: {},
    });
  }
  const route = (ri: string, number: string, mode: EwMode): EwRoute => {
    let r = byRi.get(ri);
    if (!r) {
      r = { ri, mode, number, name: '', workHours: '', interval: '', priceUah: null, firstStop: '', lastStop: '', panel: null, shape: null, lengthKm: null, carrier: null, directions: {} };
      byRi.set(ri, r);
    }
    return r;
  };
  for (const row of files.electricRoutesCsv ? parseCsv(files.electricRoutesCsv) : []) {
    const r = byRi.get(row.easyway_route_id) ?? route(row.easyway_route_id, row.number, MODES[row.type] ?? 'other');
    if (row.shape === 'loop' || row.shape === 'two-way') r.shape = row.shape;
    const km = Number(row.length_km);
    if (row.length_km && Number.isFinite(km)) r.lengthKm = km;
    if (row.carrier) r.carrier = row.carrier;
  }
  for (const row of files.stopSequenceCsv ? parseCsv(files.stopSequenceCsv) : []) {
    const key = row.direction as EwDirKey;
    if (key !== 'forward' && key !== 'backward') continue;
    const r = route(row.easyway_route_id, row.number, MODES[row.type] ?? 'other');
    const dir = (r.directions[key] ??= emptyDir());
    const seq = Number(row.seq);
    dir.stops[seq - 1] = { id: row.easyway_stop_id || null, name: row.stop_name };
  }
  for (const r of byRi.values()) for (const d of Object.values(r.directions)) if (d) d.stops = d.stops.filter(Boolean);
  for (const row of files.departuresCsv ? parseCsv(files.departuresCsv) : []) {
    const key = row.direction as EwDirKey;
    if (key !== 'forward' && key !== 'backward') continue;
    const r = byRi.get(row.easyway_route_id);
    if (!r) continue;
    const dir = (r.directions[key] ??= emptyDir());
    dir.from ??= row.stop || null;
    const dep = departure(row.time, row.mark);
    if (!dep) continue;
    if (row.day_type === 'workdays') dir.workdays.push(dep);
    else if (row.day_type === 'weekend') dir.weekend.push(dep);
  }
  // сторінки маршрутів: доповнюють напрямки, де в них більше
  for (const [file, text] of Object.entries(files.raw).sort(([a], [b]) => a.localeCompare(b))) {
    let page: ReturnType<typeof parseEwRawText> = null;
    try {
      page = file.endsWith('.json') ? parseEwRawJson(text) : file.endsWith('.txt') ? parseEwRawText(text) : null;
    } catch {
      page = null;
    }
    if (!page) continue;
    const r = route(page.ri, page.number, page.mode);
    if (r.mode === 'other' && page.mode !== 'other') r.mode = page.mode;
    r.panel ??= page.panel;
    for (const key of ['forward', 'backward'] as const) {
      const fromPage = page.directions[key];
      if (!fromPage) continue;
      const mine = r.directions[key];
      if (!mine) {
        r.directions[key] = fromPage;
        continue;
      }
      if (fromPage.stops.length && (fromPage.stops.length > mine.stops.length || (!mine.stops.some((s) => s.id) && fromPage.stops.some((s) => s.id)))) {
        mine.stops = fromPage.stops;
      }
      if (fromPage.workdays.length + fromPage.weekend.length > mine.workdays.length + mine.weekend.length) {
        mine.workdays = fromPage.workdays;
        mine.weekend = fromPage.weekend;
        mine.from = fromPage.from ?? mine.from;
      }
    }
  }
  for (const r of byRi.values()) {
    for (const d of Object.values(r.directions)) {
      if (!d) continue;
      const uniq = (xs: EwDeparture[]): EwDeparture[] => {
        const seen = new Map<string, EwDeparture>();
        for (const x of xs) if (!seen.has(x.time)) seen.set(x.time, x);
        return [...seen.values()].sort((a, b) => a.time.localeCompare(b.time));
      };
      d.workdays = uniq(d.workdays);
      d.weekend = uniq(d.weekend);
    }
  }
  const routes = [...byRi.values()]
    .filter((r) => r.number || dirCount(r.directions.forward) || dirCount(r.directions.backward))
    .sort((a, b) => Number(a.ri) - Number(b.ri) || a.ri.localeCompare(b.ri));
  return { routes };
}
