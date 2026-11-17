/**
 * Звірка маршрутів Житомира із zt.rozklad.in.ua з Google (Docs/dovede-roadmap.md, «Житомир зі свого сайту»;
 * вимога власника: «кожну циферку перевірити через Google»). Чисті функції: що спитати і як оцінити відповідь.
 *
 * Питаємо Google Routes (TRANSIT) дорогу між двома нашими зупинками одного напрямку й дивимось, чи є серед
 * варіантів наша лінія, і чи збігаються хвилини. Спершу — три великі відрізки кожного напрямку (вони й
 * вирішують, чи маршрут «звірено»), далі — кожен перегін між сусідніми зупинками.
 */
import { distanceM } from './korosten-osm';
import { normalizeLine } from './korosten-google';
import type { ZhytomyrRoutesFile } from './zhytomyr-routes';
import { sameStopName, stopKey as stopKeyOf, type ZhytomyrStop } from './zhytomyr-stops';

export interface CheckSpan {
  /** `<напрямок>:<зупинка звідки>:<зупинка куди>` */
  key: string;
  number: string;
  dirId: number;
  from: { id: number; name: string; lat: number; lng: number };
  to: { id: number; name: string; lat: number; lng: number };
  /** хвилин між зупинками за сайтом */
  minutes: number;
  /** скільки зупинок проїхати за сайтом */
  stops: number;
  /** thirds — великі відрізки (вирішують вердикт маршруту); hop — сусідні зупинки */
  level: 'thirds' | 'hop';
}

/** Крок громадського транспорту з відповіді Google */
export interface GoogleRide {
  line: string;
  minutes: number;
  stops: number | null;
  fromStop: string;
  toStop: string;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;
}

export interface SpanVerdict {
  /** match — Google знає нашу лінію тут і хвилини збігаються; differs — лінія є, цифри інші; unknown — Google нашої лінії тут не пропонує */
  verdict: 'match' | 'differs' | 'unknown';
  ours: { minutes: number; stops: number };
  google?: {
    minutes: number;
    stops: number | null;
    fromStop: string;
    toStop: string;
    fromOffM: number | null;
    toOffM: number | null;
    /** де саме Google садить і висаджує (зберігаємо за договором власника з Google) */
    from?: { lat: number; lng: number };
    to?: { lat: number; lng: number };
  };
  /**
   * Чому «розходиться»: our_stop — зупинка Google зветься як наша, але стоїть далеко (помилка нашої координати);
   * partial — Google везе нашою лінією не до нашої зупинки; minutes / stops — справді інші цифри.
   */
  cause?: 'our_stop' | 'partial' | 'minutes' | 'stops';
  /** partial: порівняли на коротшому відрізку — до нашої зупинки з назвою, як у зупинки Google */
  compared?: { from: string; to: string; minutes: number; stops: number };
  /** які лінії запропонував Google замість нашої */
  otherLines?: string[];
  checkedAt: string;
}

/** Допуск на хвилини: ± 2 хв або 30 % — що більше */
export function minutesAgree(ours: number, google: number): boolean {
  return Math.abs(ours - google) <= Math.max(2, Math.round(ours * 0.3));
}

/** Зупинки з надійною координатою (OSM, Google, підказка) — між ними є що питати */
const solid = (s: ZhytomyrStop | undefined): s is ZhytomyrStop => s != null && s.source !== 'interpolated';

export function checkSpans(routes: ZhytomyrRoutesFile, stops: ZhytomyrStop[]): CheckSpan[] {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const thirds: CheckSpan[] = [];
  const hops: CheckSpan[] = [];
  for (const r of routes.routes) {
    for (const d of r.directions) {
      const chain = d.stops.map((s, i) => ({ ...s, i, at: byId.get(s.id) })).filter((s) => solid(s.at));
      const span = (a: (typeof chain)[number], b: (typeof chain)[number], level: CheckSpan['level']): CheckSpan => ({
        key: `${d.dirId}:${a.id}:${b.id}`,
        number: r.number,
        dirId: d.dirId,
        from: { id: a.id, name: a.name, lat: a.at!.lat, lng: a.at!.lng },
        to: { id: b.id, name: b.name, lat: b.at!.lat, lng: b.at!.lng },
        minutes: b.minutes - a.minutes,
        stops: b.i - a.i,
        level,
      });
      if (chain.length >= 4) {
        const cut = [0, Math.round((chain.length - 1) / 3), Math.round(((chain.length - 1) * 2) / 3), chain.length - 1];
        for (let k = 0; k < 3; k++) if (cut[k] < cut[k + 1]) thirds.push(span(chain[cut[k]], chain[cut[k + 1]], 'thirds'));
      }
      for (let k = 0; k + 1 < chain.length; k++) {
        // перегін лише між справді сусідніми зупинками: якщо між ними є зупинка без координати — це не перегін
        if (chain[k + 1].i === chain[k].i + 1) hops.push(span(chain[k], chain[k + 1], 'hop'));
      }
    }
  }
  return [...thirds, ...hops];
}

/** Номер із зірочкою на сайті («18*») — різновид того ж маршруту: у Google це «18» */
const sameLine = (ours: string, google: string): boolean => normalizeLine(ours.replace(/\*/g, '')) === normalizeLine(google.replace(/\*/g, ''));

/** Наш ланцюжок напрямку — щоб порівняти на коротшому відрізку, коли Google везе не до нашої зупинки */
export type ChainStop = { name: string; minutes: number };

const FAR_M = 250;

export function spanVerdict(span: CheckSpan, alternatives: GoogleRide[][], checkedAt: string, chain: ChainStop[] = []): SpanVerdict {
  const ours = { minutes: span.minutes, stops: span.stops };
  const rides = alternatives.flat();
  const mine = rides.filter((r) => sameLine(span.number, r.line));
  if (!mine.length) {
    const otherLines = [...new Set(rides.map((r) => r.line).filter(Boolean))].sort();
    return { verdict: 'unknown', ours, ...(otherLines.length ? { otherLines } : {}), checkedAt };
  }
  // серед поїздок нашою лінією — та, що найближча за хвилинами (Google може посадити на сусідній зупинці)
  const best = [...mine].sort((a, b) => Math.abs(a.minutes - span.minutes) - Math.abs(b.minutes - span.minutes))[0];
  const off = (lat: number | null, lng: number | null, p: { lat: number; lng: number }) => (lat == null || lng == null ? null : Math.round(distanceM({ lat, lng }, p)));
  const at = (lat: number | null, lng: number | null) => (lat == null || lng == null ? undefined : { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  const from = at(best.fromLat, best.fromLng);
  const to = at(best.toLat, best.toLng);
  const google = { minutes: best.minutes, stops: best.stops, fromStop: best.fromStop, toStop: best.toStop, fromOffM: off(best.fromLat, best.fromLng, span.from), toOffM: off(best.toLat, best.toLng, span.to), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  return { ...judgeRide(span, google, chain), checkedAt };
}

/**
 * Вердикт за тим, що Google відповів про нашу лінію на цьому відрізку. Окремо від запиту — щоб уже збережені
 * відповіді можна було оцінити наново без Google (`--reclassify`).
 */
export function judgeRide(span: CheckSpan, google: NonNullable<SpanVerdict['google']>, chain: ChainStop[] = []): Omit<SpanVerdict, 'checkedAt'> {
  const ours = { minutes: span.minutes, stops: span.stops };
  const stopsAgree = (a: number, b: number | null) => b == null || Math.abs(b - a) <= Math.max(1, Math.round(a * 0.2));
  const farFrom = (google.fromOffM ?? 0) > FAR_M;
  const farTo = (google.toOffM ?? 0) > FAR_M;
  if (!farFrom && !farTo) {
    const okMinutes = minutesAgree(span.minutes, google.minutes);
    const okStops = stopsAgree(span.stops, google.stops);
    if (okMinutes && okStops) return { verdict: 'match', ours, google };
    return { verdict: 'differs', ours, google, cause: okMinutes ? 'stops' : 'minutes' };
  }
  // Google посадив чи висадив далеко від нашої зупинки. Зветься так само — помилка нашої координати
  const sameFrom = !farFrom || sameStopName(span.from.name, google.fromStop);
  const sameTo = !farTo || sameStopName(span.to.name, google.toStop);
  if (sameFrom && sameTo) return { verdict: 'differs', ours, google, cause: 'our_stop' };
  // Інша назва — Google везе нашою лінією лише частину: шукаємо в ланцюжку зупинки з назвами, як у Google
  const i0 = chain.findIndex((c) => sameStopName(c.name, span.from.name));
  const i1 = chain.findIndex((c, i) => i > i0 && sameStopName(c.name, span.to.name));
  if (i0 >= 0 && i1 > i0) {
    const a = farFrom ? chain.findIndex((c, i) => i >= i0 && i < i1 && sameStopName(c.name, google.fromStop)) : i0;
    const b = farTo ? chain.findIndex((c, i) => i > Math.max(a, i0) && i <= i1 && sameStopName(c.name, google.toStop)) : i1;
    if (a >= 0 && b > a) {
      const compared = { from: chain[a].name, to: chain[b].name, minutes: chain[b].minutes - chain[a].minutes, stops: b - a };
      const agree = minutesAgree(compared.minutes, google.minutes) && stopsAgree(compared.stops, google.stops);
      return agree ? { verdict: 'match', ours, google, compared } : { verdict: 'differs', ours, google, cause: 'minutes', compared };
    }
  }
  return { verdict: 'differs', ours, google, cause: 'partial' };
}

/** Кроки транспорту з відповіді Google Routes (усі альтернативи) */
export function googleRides(body: unknown): GoogleRide[][] {
  type Stop = { name?: string; location?: { latLng?: { latitude?: number; longitude?: number } } };
  type Step = { staticDuration?: string; transitDetails?: { stopCount?: number; stopDetails?: { departureStop?: Stop; arrivalStop?: Stop }; transitLine?: { nameShort?: string; name?: string } } };
  const routes = (body as { routes?: Array<{ legs?: Array<{ steps?: Step[] }> }> })?.routes ?? [];
  return routes.map((r) =>
    (r.legs ?? [])
      .flatMap((l) => l.steps ?? [])
      .filter((s) => s.transitDetails)
      .map((s) => {
        const t = s.transitDetails!;
        const dep = t.stopDetails?.departureStop;
        const arr = t.stopDetails?.arrivalStop;
        return {
          line: (t.transitLine?.nameShort ?? t.transitLine?.name ?? '').trim(),
          minutes: Math.max(1, Math.round((Number(String(s.staticDuration ?? '').replace(/s$/, '')) || 0) / 60)),
          stops: t.stopCount ?? null,
          fromStop: dep?.name?.trim() ?? '',
          toStop: arr?.name?.trim() ?? '',
          fromLat: dep?.location?.latLng?.latitude ?? null,
          fromLng: dep?.location?.latLng?.longitude ?? null,
          toLat: arr?.location?.latLng?.latitude ?? null,
          toLng: arr?.location?.latLng?.longitude ?? null,
        };
      }),
  );
}

export type RouteStatus = 'checked' | 'differs' | 'unknown' | 'pending';

export interface DirectionCheck {
  dirId: number;
  number: string;
  name: string;
  status: RouteStatus;
  thirds: { match: number; differs: number; unknown: number; pending: number };
  hops: { match: number; differs: number; unknown: number; pending: number };
}

/**
 * Вердикт напрямку — за трьома великими відрізками: усі збігаються → checked; хоч один розходиться → differs;
 * Google не знає жодного → unknown; ще не питали — pending.
 */
export function directionChecks(routes: ZhytomyrRoutesFile, spans: CheckSpan[], verdicts: Record<string, SpanVerdict>): DirectionCheck[] {
  const out: DirectionCheck[] = [];
  for (const r of routes.routes) {
    for (const d of r.directions) {
      const count = (level: CheckSpan['level']) => {
        const c = { match: 0, differs: 0, unknown: 0, pending: 0 };
        for (const s of spans) if (s.dirId === d.dirId && s.level === level) c[verdicts[s.key]?.verdict ?? 'pending']++;
        return c;
      };
      const thirds = count('thirds');
      const total = thirds.match + thirds.differs + thirds.unknown + thirds.pending;
      const status: RouteStatus = !total || thirds.pending === total ? 'pending' : thirds.differs ? 'differs' : thirds.match && !thirds.unknown && !thirds.pending ? 'checked' : thirds.match ? 'differs' : thirds.pending ? 'pending' : 'unknown';
      out.push({ dirId: d.dirId, number: r.number, name: d.name, status, thirds, hops: count('hop') });
    }
  }
  return out;
}

const STATUS_UK: Record<RouteStatus, string> = { checked: 'збігається', differs: 'розходиться', unknown: 'Google не знає', pending: 'ще не звірено' };

export interface NameCheck {
  ours: string;
  google: string;
  /** найменша відстань між нашою зупинкою й зупинкою Google, м */
  offM: number;
  /** як зупинки поруч (до 200 м) звуться в OpenStreetMap — третє джерело */
  osm: string[];
  /** кого підтверджує OSM: site — нашу назву, google — назву Google, both — поруч є обидві (це сусідні зупинки), none — нікого */
  confirms: 'site' | 'google' | 'both' | 'none';
}

/**
 * Зупинки, які сайт і Google називають по-різному, хоча стоять вони поруч (до 250 м). Розклад сайту понад рік не
 * оновлювався (власник, 2026-11-17), тож назву Google не відкидаємо, а шукаємо підтвердження в третьому джерелі.
 */
export function nameChecks(spans: CheckSpan[], verdicts: Record<string, SpanVerdict>, osm: Array<{ name: string; lat: number; lng: number }>): NameCheck[] {
  const side = (name: string) => name.replace(/\s+\[?0\d{1,2}\]?\s*$/, '').trim();
  const out = new Map<string, NameCheck>();
  for (const span of spans) {
    const g = verdicts[span.key]?.google;
    if (!g) continue;
    for (const [stop, name, off] of [
      [span.from, g.fromStop, g.fromOffM],
      [span.to, g.toStop, g.toOffM],
    ] as const) {
      if (!name || off == null || off > FAR_M || sameStopName(stop.name, name)) continue;
      const key = `${stopKeyOf(stop.name)}|${stopKeyOf(name)}`;
      const near = [...new Set(osm.filter((o) => distanceM(o, stop) <= 200).map((o) => o.name))].sort();
      const site = near.some((n) => sameStopName(n, stop.name));
      const goog = near.some((n) => sameStopName(n, name));
      const prev = out.get(key);
      if (!prev || off < prev.offM) out.set(key, { ours: side(stop.name), google: name, offM: off, osm: near, confirms: site && goog ? 'both' : site ? 'site' : goog ? 'google' : 'none' });
    }
  }
  return [...out.values()].sort((a, b) => a.ours.localeCompare(b.ours, 'uk') || a.google.localeCompare(b.google, 'uk'));
}

const CONFIRMS_UK: Record<NameCheck['confirms'], string> = {
  site: 'OSM підтверджує назву сайту',
  google: 'OSM підтверджує назву Google',
  both: 'в OSM поруч обидві — це сусідні зупинки',
  none: 'в OSM немає жодної — перевірити на місці',
};

export function buildCheckReport(
  routes: ZhytomyrRoutesFile,
  stops: { stops: ZhytomyrStop[]; missing: unknown[] },
  spans: CheckSpan[],
  verdicts: Record<string, SpanVerdict>,
  osm: Array<{ name: string; lat: number; lng: number }> = [],
): string {
  const dirs = directionChecks(routes, spans, verdicts);
  const n = (s: RouteStatus) => dirs.filter((d) => d.status === s).length;
  const src = (s: ZhytomyrStop['source']) => stops.stops.filter((x) => x.source === s).length;
  const lines = [
    '# Житомир: маршрути із zt.rozklad.in.ua проти Google',
    '',
    'Файл згенеровано (`npm run zhytomyr:snapshot` у `backend/`) — руками не редагувати.',
    '',
    `Знімок сайту: ${routes.fetchedAt}. Маршрутів — ${routes.routes.length}, напрямків — ${dirs.length}.`,
    '',
    `Зупинки: з OpenStreetMap — ${src('osm')}, з Google — ${src('google')}, підказки — ${src('hint')}, приблизно між сусідами — ${src('interpolated')}, без координат — ${stops.missing.length}.`,
    '',
    `Напрямки: збігається — ${n('checked')}, розходиться — ${n('differs')}, Google не знає — ${n('unknown')}, ще не звірено — ${n('pending')}.`,
    '',
    'Вердикт напрямку — за трьома великими відрізками (третини маршруту): допуск ± 2 хв або 30 %, зупинки посадки й висадки Google — у межах 250 м від наших. Перегони — кожна пара сусідніх зупинок.',
    '',
    '| Маршрут | Напрямок | Вердикт | Третини: збіг / розх. / не знає / чекає | Перегони: збіг / розх. / не знає / чекає |',
    '|---|---|---|---|---|',
    ...dirs.map((d) => `| ${d.number} | ${d.name} | ${STATUS_UK[d.status]} | ${d.thirds.match} / ${d.thirds.differs} / ${d.thirds.unknown} / ${d.thirds.pending} | ${d.hops.match} / ${d.hops.differs} / ${d.hops.unknown} / ${d.hops.pending} |`),
    '',
    '## Де цифри розходяться (великі відрізки)',
    '',
  ];
  const diffs = spans.filter((s) => s.level === 'thirds' && verdicts[s.key]?.verdict === 'differs');
  if (!diffs.length) lines.push('Немає.');
  const CAUSE: Record<string, string> = {
    minutes: 'Справжні розбіжності в хвилинах (зупинки ті самі)',
    stops: 'Інша кількість зупинок',
    our_stop: 'Наша зупинка стоїть не там (у Google вона зветься так само, але далеко)',
    partial: 'Google везе нашою лінією не до нашої зупинки',
    '': 'Причину ще не розібрано',
  };
  for (const cause of ['minutes', 'stops', 'our_stop', 'partial', '']) {
    const list = diffs.filter((s) => (verdicts[s.key].cause ?? '') === cause);
    if (!list.length) continue;
    lines.push(`### ${CAUSE[cause]} — ${list.length}`, '');
    for (const s of list) {
      const v = verdicts[s.key];
      const g = v.google!;
      const ours = v.compared ? `наше («${v.compared.from}» → «${v.compared.to}») — ${v.compared.minutes} хв, ${v.compared.stops} зуп.` : `наше — ${s.minutes} хв, ${s.stops} зуп.`;
      lines.push(`- №${s.number}, «${s.from.name}» → «${s.to.name}»: ${ours}; Google — ${g.minutes} хв, ${g.stops ?? '?'} зуп. («${g.fromStop}» → «${g.toStop}», від наших зупинок ${g.fromOffM ?? '?'} м і ${g.toOffM ?? '?'} м)`);
    }
    lines.push('');
  }
  lines.push('', '## Де Google нашої лінії не пропонує (великі відрізки)', '');
  const unknown = spans.filter((s) => s.level === 'thirds' && verdicts[s.key]?.verdict === 'unknown');
  if (!unknown.length) lines.push('Немає.');
  for (const s of unknown) lines.push(`- №${s.number}, «${s.from.name}» → «${s.to.name}»: Google пропонує ${verdicts[s.key].otherLines?.join(', ') || 'лише пішки'}`);
  const names = nameChecks(spans, verdicts, osm);
  lines.push('', '## Назви зупинок: сайт і Google називають по-різному', '');
  lines.push('Зупинки стоять поруч (до 250 м), а звуться інакше. Третє джерело — OpenStreetMap (зупинки в межах 200 м).', '');
  if (!names.length) lines.push('Немає.');
  else {
    lines.push('| Сайт | Google | Між ними | OpenStreetMap поруч | Висновок |', '|---|---|---|---|---|');
    for (const n of names) lines.push(`| ${n.ours} | ${n.google} | ${n.offM} м | ${n.osm.join('; ') || '—'} | ${CONFIRMS_UK[n.confirms]} |`);
  }
  return `${lines.join('\n')}\n`;
}
