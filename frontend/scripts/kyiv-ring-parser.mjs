/**
 * Kyiv City Express для «Доведе» (Docs/dovede-roadmap.md, «Міська електричка Києва»): чистий розбір сторінок
 * розкладу й збирання таблиці рейсів. Без мережі й диска — їх бере `kyiv-ring-snapshot.mjs`; тест
 * `src/pages/DovedePage/data/kyivRing.test.ts` перевіряє, що закомічений розклад дорівнює тому, що дає цей файл.
 */

const text = (html) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Сторінка «Рейси»: усі рейси в порядку таблиць і станції кільця з формою пошуку (у порядку руху за годинниковою) */
export function parseTrainList(html) {
  const trains = [...html.matchAll(/<a class="trips-clock__cell" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => ({ url: m[1], name: m[2].trim() }));
  const stations = [...html.matchAll(/<li class="station-selector__item" data-value="([^"]+)" data-slug="([^"]+)">([\s\S]*?)<\/li>/g)].map((m) => ({
    name: m[1].trim(),
    slug: m[2].trim(),
    badges: [...m[3].matchAll(/alt="([^"]+)"/g)].map((b) => b[1].replace(/M/g, 'М')),
  }));
  return { trains, stations };
}

/** Сторінка одного рейсу: номер, дні курсування і час відправлення з кожної станції (на останній — прибуття) */
export function parseTrainPage(html) {
  const name = html.match(/Рейс\s*<span class="route-info__highlight">([^<]+)<\/span>/)?.[1]?.trim();
  const schedule = html.match(/<div class="route-info__schedule">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const runsText = text(schedule);
  const runs = /пн\s*-\s*пт/i.test(runsText) ? 'weekdays' : /щоденно/i.test(runsText) ? 'daily' : null;
  const list = html.match(/Розклад відправлень<\/h3>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const stops = [...list.matchAll(/<li class="station-selector__item">([\s\S]*?)<\/li>/g)].map((m) => {
    const time = m[1].match(/station-selector__item-time-first">\s*<div>\s*(\d\d:\d\d)\s*<\/div>/)?.[1] ?? null;
    // назва станції — текст після блоку часу (останнього </div>), до значків пересадок
    const station = text(m[1].slice(m[1].lastIndexOf('</div>') + 6));
    return [station, time];
  });
  if (!name || !runs || stops.length < 2 || stops.some(([s, t]) => !s || !t)) throw new Error(`Сторінку рейсу не розібрано: ${name ?? '?'} (${runsText || 'без днів'}, зупинок ${stops.length})`);
  return { name, runs, stops };
}

const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Таблиця рейсів для браузера. `source` — знімок (`source/trains.json`), `config` — ручні рішення (`config.json`):
 *  - `extra[]` — рейси, що діють лише певні дні (додаткові «Д»): `match` — регулярний вираз номера, `from` / `to` —
 *    дати включно, `fromTime` — з якої години першого дня;
 *  - `arrivals` — час прибуття на станцію з довгою стоянкою, коли він відомий: `{ "Д10": { "darnicia": "17:26" } }`
 *    (у розкладі — лише відправлення).
 * Зупинка рейсу: `[індекс станції, відправлення хв]` або `[індекс, відправлення, прибуття]`. Напрямок — за порядком
 * станцій: `cw` — за годинниковою стрілкою (як у списку станцій), `ccw` — проти.
 */
export function buildTimetable(source, config) {
  const slugs = source.stations.map((s) => s.slug);
  const byName = new Map(source.stations.map((s, i) => [s.name, i]));
  const n = slugs.length;
  const trains = source.trains.map((t) => {
    const idx = t.stops.map(([name]) => {
      const i = byName.get(name);
      if (i == null) throw new Error(`Рейс ${t.name}: невідома станція «${name}»`);
      return i;
    });
    const step = (idx[1] - idx[0] + n) % n;
    if (step !== 1 && step !== n - 1) throw new Error(`Рейс ${t.name}: станції не сусідні (${t.stops[0][0]} → ${t.stops[1][0]})`);
    const dir = step === 1 ? 'cw' : 'ccw';
    idx.forEach((v, k) => {
      if (k && (v - idx[k - 1] + n) % n !== step) throw new Error(`Рейс ${t.name}: пропущено станцію перед «${t.stops[k][0]}»`);
    });
    const known = config.arrivals?.[t.name] ?? {};
    let prev = -1;
    const stops = t.stops.map(([, time], k) => {
      const dep = mins(time);
      if (dep < prev) throw new Error(`Рейс ${t.name}: час іде назад на «${t.stops[k][0]}»`);
      prev = dep;
      const arr = known[slugs[idx[k]]];
      if (arr && (mins(arr) > dep || mins(arr) < (k ? mins(t.stops[k - 1][1]) : 0))) throw new Error(`Рейс ${t.name}: прибуття ${arr} не між сусідніми відправленнями`);
      return arr && mins(arr) !== dep ? [idx[k], dep, mins(arr)] : [idx[k], dep];
    });
    const limit = (config.extra ?? []).find((e) => new RegExp(e.match).test(t.name));
    return {
      no: t.name,
      dir,
      days: t.runs,
      ...(limit ? { extra: true, from: limit.from, ...(limit.fromTime ? { fromMins: mins(limit.fromTime) } : {}), to: limit.to } : {}),
      stops,
    };
  });
  trains.sort((a, b) => a.stops[0][1] - b.stops[0][1] || (a.no < b.no ? -1 : 1));
  const names = new Set();
  for (const t of trains) {
    if (names.has(t.no)) throw new Error(`Рейс ${t.no} у знімку двічі`);
    names.add(t.no);
  }
  return { checkedAt: source.fetchedAt.slice(0, 10), stations: slugs, trains };
}

/** JSON таблиці: рейс на рядок — зручно читати диф */
export function timetableJson(tt) {
  const head = `{\n  "checkedAt": ${JSON.stringify(tt.checkedAt)},\n  "stations": ${JSON.stringify(tt.stations)},\n  "trains": [\n`;
  return `${head}${tt.trains.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]\n}\n`;
}
