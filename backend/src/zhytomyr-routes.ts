/**
 * data/zhytomyr-transport/routes.json зі збережених сторінок zt.rozklad.in.ua. Окремо від скрипта, щоб тест міг
 * перевірити: закомічений файл дорівнює розбору закомічених сторінок.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseZtDirection, type ZtDirection, type ZtMode, type ZtRouteLink } from './zhytomyr-site-parser';
import { buildCheckReport, checkSpans, type SpanVerdict } from './zhytomyr-google-check';
import { locateZhytomyrStops, sameStopName, type OsmNamedStop, type ZhytomyrStop } from './zhytomyr-stops';

export interface ZhytomyrRoute {
  /** номер, який бачить людина */
  number: string;
  mode: ZtMode;
  name: string;
  directions: ZtDirection[];
}

export interface ZhytomyrRoutesFile {
  source: string;
  /** коли зроблено знімок сайту, 'YYYY-MM-DD' */
  fetchedAt: string;
  routes: ZhytomyrRoute[];
}

export function loadZhytomyrRoutes(root: string): ZhytomyrRoutesFile {
  const home = JSON.parse(fs.readFileSync(path.join(root, 'source/home.json'), 'utf8')) as { source: string; fetchedAt: string; routes: ZtRouteLink[] };
  const dir = (id: number): ZtDirection => parseZtDirection(fs.readFileSync(path.join(root, 'source/html', `${id}.html`), 'utf8'), id);
  const routes: ZhytomyrRoute[] = home.routes.map((link) => {
    const there = dir(link.dirId);
    const directions = [there];
    if (there.reverseId != null && fs.existsSync(path.join(root, 'source/html', `${there.reverseId}.html`))) directions.push(dir(there.reverseId));
    return { number: link.number, mode: link.mode, name: link.name, directions };
  });
  return { source: home.source, fetchedAt: home.fetchedAt, routes };
}

export function buildZhytomyrRoutes(root: string): string {
  return `${JSON.stringify(loadZhytomyrRoutes(root))}\n`;
}

const readJson = <T>(file: string, fallback: T): T => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback);

/** data/zhytomyr-transport/stops.json: координати зупинок із OSM, Google й ручних підказок */
const stopsMemo = new Map<string, string>();

export function buildZhytomyrStops(root: string): string {
  // звіт і дані сервера беруть ті самі зупинки — рахуємо їх раз на процес
  const cached = stopsMemo.get(root);
  if (cached) return cached;
  const built = computeZhytomyrStops(root);
  stopsMemo.set(root, built);
  return built;
}

function computeZhytomyrStops(root: string): string {
  const osm = readJson<{ stops: OsmNamedStop[] }>(path.join(root, 'osm/stops.json'), { stops: [] }).stops;
  const hints = readJson<Record<string, { lat: number; lng: number }>>(path.join(root, 'stops.hints.json'), {});
  const geocode = readJson<{ found: Record<string, Array<{ lat: number; lng: number; name: string }>>; asked: Record<string, string> }>(path.join(root, 'google/stop-geocode.json'), { found: {}, asked: {} });
  // Google на «зупинка Каракульна» повертає й сусідні зупинки — лишаємо лише ті, що звуться так само
  const google: Record<string, Array<{ lat: number; lng: number }>> = {};
  for (const [key, hits] of Object.entries(geocode.found)) {
    const same = hits.filter((h) => sameStopName(geocode.asked[key] ?? '', h.name));
    if (same.length) google[key] = same;
  }
  const { stops, missing } = locateZhytomyrStops(loadZhytomyrRoutes(root), osm, hints, google);
  return `${JSON.stringify({ stops, missing })}\n`;
}

/** data/zhytomyr-transport/REPORT.md: наші маршрути проти Google (google/checks.json) */
export function buildZhytomyrReport(root: string): string {
  const routes = loadZhytomyrRoutes(root);
  const stops = JSON.parse(buildZhytomyrStops(root)) as { stops: ZhytomyrStop[]; missing: unknown[] };
  const verdicts = readJson<{ checks: Record<string, SpanVerdict> }>(path.join(root, 'google/checks.json'), { checks: {} }).checks;
  const osm = readJson<{ stops: OsmNamedStop[] }>(path.join(root, 'osm/stops.json'), { stops: [] }).stops;
  return buildCheckReport(routes, stops, checkSpans(routes, stops.stops), verdicts, osm);
}

/**
 * backend/src/dovede/zhytomyr-own-data.ts — те, з чого сервер «Доведе» складає пряму поїздку Житомиром без Google:
 * зупинки з хвилинами (виправленими за Google) й координатами та відправлення від першої зупинки. Каталогу `data/`
 * на сервері немає, тому дані їдуть модулем. `checked` — три великі відрізки напрямку збіглися з Google або
 * виправлені за ним (REPORT.md); лише такі напрямки йдуть у відповідь людині. Рейси «у депо» сюди не потрапляють: вони не йдуть до кінцевої.
 */
export function buildZhytomyrOwnData(root: string): string {
  const routes = loadZhytomyrRoutes(root);
  const stops = (JSON.parse(buildZhytomyrStops(root)) as { stops: ZhytomyrStop[] }).stops;
  const byId = new Map(stops.map((s) => [s.id, s]));
  const verdicts = readJson<{ checks: Record<string, SpanVerdict> }>(path.join(root, 'google/checks.json'), { checks: {} }).checks;
  const thirds = checkSpans(routes, stops).filter((sp) => sp.level === 'thirds');
  const side = (name: string) => name.replace(/\s+\[?0\d{1,2}\]?\s*$/, '').trim();
  const times = (list: Array<{ time: string; note?: string }>) => list.filter((d) => !d.note?.includes('depot')).map((d) => d.time);
  const dirs = routes.routes.flatMap((r) =>
    r.directions.map((d) => {
      // Хвилини між зупинками — за Google там, де він їх знає (рішення власника 2026-11-17: розклад сайту давній,
      // «Google точно знає краще»). Відрізок із справді іншими хвилинами розтягуємо чи стискаємо до часу Google,
      // решту ланцюжка зсуваємо. Напрямок «звірено», коли всі три великі відрізки збіглись або виправлені.
      const minutes = d.stops.map((x) => x.minutes);
      const mine = thirds.filter((sp) => sp.dirId === d.dirId);
      let checked = mine.length > 0;
      for (const sp of mine) {
        const v = verdicts[sp.key];
        if (v?.verdict === 'match') continue;
        if (v?.verdict !== 'differs' || v.cause !== 'minutes' || !v.google) {
          checked = false;
          continue;
        }
        const i0 = d.stops.findIndex((x) => x.id === sp.from.id);
        const i1 = d.stops.findIndex((x) => x.id === sp.to.id);
        const a = v.compared ? d.stops.findIndex((x, i) => i >= i0 && i <= i1 && sameStopName(x.name, v.compared!.from)) : i0;
        const b = v.compared ? d.stops.findIndex((x, i) => i > a && i <= i1 && sameStopName(x.name, v.compared!.to)) : i1;
        const span = a >= 0 && b > a ? minutes[b] - minutes[a] : 0;
        if (span <= 0) {
          checked = false;
          continue;
        }
        const k = v.google.minutes / span;
        const shift = v.google.minutes - span;
        const base = minutes[a];
        for (let i = a + 1; i < minutes.length; i++) minutes[i] = i <= b ? base + (minutes[i] - base) * k : minutes[i] + shift;
      }
      // цілі хвилини, що не йдуть назад
      const whole = minutes.map((m) => Math.round(m));
      for (let i = 1; i < whole.length; i++) whole[i] = Math.max(whole[i], whole[i - 1]);
      return {
        id: d.dirId,
        no: r.number,
        name: d.name,
        checked,
        stops: d.stops.map((x, i) => {
          const at = byId.get(x.id);
          // приблизна координата (між сусідами) для пошуку «поруч» не годиться
          return at && at.source !== 'interpolated' ? [side(x.name), whole[i], at.lat, at.lng] : [side(x.name), whole[i], null, null];
        }),
        wd: times(d.workdays),
        we: times(d.weekend),
      };
    }),
  );
  const validFrom = routes.routes.flatMap((r) => r.directions.map((d) => d.validFrom)).find(Boolean) ?? null;
  return [
    '/**',
    ' * ЗГЕНЕРОВАНО: `npm run zhytomyr:snapshot` у backend/ (zhytomyr-routes.ts → buildZhytomyrOwnData). Руками не редагувати.',
    ' * Маршрути Житомира із zt.rozklad.in.ua (сайт власника): зупинки [назва, хвилин від початку, lat, lng] і',
    ' * відправлення від першої зупинки (wd — робочі дні, we — вихідні). Хвилини виправлено за Google; checked —',
    ' * напрямок звірено.',
    ' */',
    'export interface ZtOwnDir {',
    '  id: number;',
    '  no: string;',
    '  name: string;',
    '  checked: boolean;',
    '  stops: Array<[string, number, number | null, number | null]>;',
    '  wd: string[];',
    '  we: string[];',
    '}',
    '',
    'export interface ZtOwnData {',
    '  fetchedAt: string;',
    '  validFrom: string | null;',
    '  dirs: ZtOwnDir[];',
    '}',
    '',
    '// prettier-ignore',
    `export const ZT_OWN: ZtOwnData = ${JSON.stringify({ fetchedAt: routes.fetchedAt, validFrom, dirs })} as unknown as ZtOwnData;`,
    '',
  ].join('\n');
}
