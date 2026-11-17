/**
 * Координати зупинок Житомира: назви з zt.rozklad.in.ua (сайт власника) зіставляємо зі знімком OpenStreetMap
 * (Docs/dovede-roadmap.md, «Житомир зі свого сайту»). Чисті функції. Чого в OSM немає — ставимо між сусідами в
 * ланцюжку пропорційно хвилинам (`interpolated`) і віддаємо на звірку з Google.
 */
import { distanceM } from './korosten-osm';
import type { ZhytomyrRoutesFile } from './zhytomyr-routes';

export interface OsmNamedStop {
  name: string;
  lat: number;
  lng: number;
}

export interface ZhytomyrStop {
  /** id зупинки на сайті */
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** osm — знайдено за назвою в OSM; google — знайшов Google за назвою; hint — ручна підказка; interpolated — між сусідами, приблизно */
  source: 'osm' | 'google' | 'hint' | 'interpolated';
  /** назва в OSM, якщо відрізняється */
  osmName?: string;
}

// `\b` у JS не знає кирилиці — межі слова задаємо самі
const word = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'gu');
const ABBR: Array<[RegExp, string]> = [
  [/\(на вимогу\)/g, ' '],
  [word('р-к'), 'ринок'],
  [word('пл\\.'), 'площа '],
  [word('пров\\.'), 'провулок '],
  [word('пр-д'), 'проїзд'],
  [word('п-д'), 'проїзд'],
  [word('вул\\.'), ' '],
  [word('вулиця'), ' '],
  [word('просп\\.'), 'проспект '],
  [word('с-ще'), 'селище'],
  // у Житомирі «м-н Перемоги», «м-н Польовий» — це майдани
  [word('м-н'), 'майдан'],
  [word('ім\\.'), ' '],
  [word('зупинка'), ' '],
];

/** «р-к "Хмільники" 01» → «ринок хмільники»: без лапок, скорочень і номера боку дороги */
export function stopKey(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[’ʼ`']/g, "'")
    .replace(/ё/g, 'е')
    // латинські i / a / o / e / c / p / x серед кирилиці — часта помилка в назвах OSM
    .replace(/i/g, 'і')
    .replace(/[«»"“”„]/g, ' ')
    .replace(/\[0\d\]/g, ' ');
  for (const [re, to] of ABBR) s = s.replace(re, to);
  // номер боку дороги наприкінці: «Панчішна фабрика 01», «Івана Мазепи 010»
  s = s.replace(/\s+0\d{1,2}\s*$/, ' ');
  // порядок слів неважливий: «майдан Польовий» і «Польовий майдан» — одна зупинка
  return s
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Назви OSM, які нічого не кажуть про місце */
const GENERIC = new Set(['на вимогу', 'зупинка', 'автобусна зупинка', 'кінцева']);

const tokens = (key: string): string[] => key.split(' ').filter((t) => t.length > 1);

/** Те саме для вже порахованих ключів `stopKey` — щоб не рахувати їх на кожну пару */
export function sameStopKey(ka: string, kb: string): boolean {
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = tokens(ka);
  const tb = tokens(kb);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!short.length || !short.some((t) => t.length >= 5)) return false;
  return short.every((t) => long.includes(t));
}

/** Чи це одна зупинка: однакові ключі або всі слова коротшої назви є в довшій (і серед них є змістовне) */
export function sameStopName(a: string, b: string): boolean {
  return sameStopKey(stopKey(a), stopKey(b));
}

interface Pt {
  lat: number;
  lng: number;
}

/**
 * Координата кожної зупинки сайту. Однойменних зупинок у місті буває кілька (і кожна — з двох боків дороги), тож
 * серед кандидатів беремо найближчого до вже відомих сусідів у ланцюжку; перше коло — лише однозначні назви.
 */
export function locateZhytomyrStops(
  routes: ZhytomyrRoutesFile,
  osm: OsmNamedStop[],
  hints: Record<string, Pt> = {},
  /** що знайшов Google за назвами зупинок, яких немає в OSM: ключ `stopKey(назва)` → точки */
  google: Record<string, Pt[]> = {},
): { stops: ZhytomyrStop[]; missing: Array<{ id: number; name: string }> } {
  const names = new Map<number, string>();
  const chains: Array<Array<{ id: number; minutes: number }>> = [];
  for (const r of routes.routes) {
    for (const d of r.directions) {
      chains.push(d.stops.map((s) => ({ id: s.id, minutes: s.minutes })));
      for (const s of d.stops) if (!names.has(s.id)) names.set(s.id, s.name);
    }
  }
  const byKey = new Map<string, OsmNamedStop[]>();
  osm = osm.filter((o) => !GENERIC.has(o.name.trim().toLowerCase()));
  for (const o of osm) {
    const k = stopKey(o.name);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), o]);
  }
  // однакових назв серед зупинок сайту багато (кожен маршрут — свої id): кандидатів шукаємо раз на назву
  const byName = new Map<string, OsmNamedStop[]>();
  const candidates = new Map<number, OsmNamedStop[]>();
  for (const [id, name] of names) {
    const key = stopKey(name);
    if (!byName.has(key)) byName.set(key, byKey.get(key) ?? [...byKey].filter(([k]) => sameStopKey(key, k)).flatMap(([, list]) => list));
    candidates.set(id, byName.get(key)!);
  }
  const found = new Map<number, ZhytomyrStop>();
  const put = (id: number, p: Pt, source: ZhytomyrStop['source'], osmName?: string) => {
    const name = names.get(id)!;
    found.set(id, { id, name, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6, source, ...(osmName && osmName !== name ? { osmName } : {}) });
  };
  for (const [id] of names) {
    const h = hints[String(id)];
    if (h) put(id, h, 'hint');
  }
  // коло 1: назва вказує на одне місце (усі кандидати в межах 250 м)
  for (const [id, list] of candidates) {
    if (found.has(id) || !list.length) continue;
    if (list.every((c) => distanceM(c, list[0]) <= 250)) put(id, list[0], 'osm', list[0].name);
  }
  const neighbours = (id: number): Pt[] => {
    const out: Pt[] = [];
    for (const chain of chains) {
      const i = chain.findIndex((s) => s.id === id);
      if (i < 0) continue;
      for (let j = i - 1; j >= 0; j--) if (found.has(chain[j].id)) { out.push(found.get(chain[j].id)!); break; }
      for (let j = i + 1; j < chain.length; j++) if (found.has(chain[j].id)) { out.push(found.get(chain[j].id)!); break; }
    }
    return out;
  };
  // кола 2–3: серед кількох місць з такою назвою — найближче до сусідів; заодно уточнюємо бік дороги
  for (let round = 0; round < 2; round++) {
    for (const [id, list] of candidates) {
      if (!list.length) continue;
      const near = neighbours(id);
      if (!near.length) continue;
      if (found.get(id)?.source === 'hint' || (found.has(id) && round === 0)) continue;
      const score = (c: OsmNamedStop) => near.reduce((sum, n) => sum + distanceM(c, n), 0) / near.length;
      const best = [...list].sort((a, b) => score(a) - score(b))[0];
      // сусідня зупинка не буває за 4 км: така «знахідка» — інше місце з тією самою назвою
      if (score(best) <= 4000) put(id, best, 'osm', best.name);
    }
  }
  // чого немає в OSM — точки Google за назвою: одна — беремо її, кілька — найближчу до сусідів
  for (const [id, name] of names) {
    if (found.has(id)) continue;
    const list = google[stopKey(name)] ?? [];
    if (!list.length) continue;
    const near = neighbours(id);
    const score = (c: Pt) => (near.length ? near.reduce((sum, n) => sum + distanceM(c, n), 0) / near.length : 0);
    const best = [...list].sort((a, b) => score(a) - score(b))[0];
    if (near.length ? score(best) <= 2500 : list.length === 1) put(id, best, 'google');
  }
  // решта — між сусідами в ланцюжку, пропорційно хвилинам
  for (const chain of chains) {
    chain.forEach((s, i) => {
      if (found.has(s.id)) return;
      let a = -1;
      let b = -1;
      for (let j = i - 1; j >= 0; j--) if (found.get(chain[j].id)?.source !== 'interpolated' && found.has(chain[j].id)) { a = j; break; }
      for (let j = i + 1; j < chain.length; j++) if (found.get(chain[j].id)?.source !== 'interpolated' && found.has(chain[j].id)) { b = j; break; }
      if (a < 0 || b < 0) return;
      const pa = found.get(chain[a].id)!;
      const pb = found.get(chain[b].id)!;
      const span = chain[b].minutes - chain[a].minutes;
      const t = span > 0 ? (s.minutes - chain[a].minutes) / span : (i - a) / (b - a);
      put(s.id, { lat: pa.lat + (pb.lat - pa.lat) * t, lng: pa.lng + (pb.lng - pa.lng) * t }, 'interpolated');
    });
  }
  const stops = [...found.values()].sort((x, y) => x.id - y.id);
  // зупинка, що вийшла далі ніж за 3 км від обох сусідів, — помилка зіставлення: краще чесно «немає»
  const missing = [...names].filter(([id]) => !found.has(id)).map(([id, name]) => ({ id, name }));
  return { stops, missing };
}
