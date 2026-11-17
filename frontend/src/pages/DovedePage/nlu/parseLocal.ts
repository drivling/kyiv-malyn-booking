/**
 * Місцевий розбір питання — миттєво, без мережі (Docs/dovede-roadmap.md, принцип 2).
 * Розуміє прийменники «з/до/в/на», місця словника, день і час, вид транспорту; решту лишає Claude (фаза 2).
 */
import { CITY_LABEL, findPlaceByToken, type GazetteerPlace, placeById } from './gazetteer';
import { tokenize, type Token } from './normalize';
import { matchMetro, type MetroMatch } from './kyivMetro';
import { resolvePlace } from './places';
import { findRouteMentions, type RouteLike } from './routes';
import { matchSynonym } from './synonyms';
import { matchStopPlace, type StopPlace } from './stopPlaces';
import { landmarkPlace, matchLandmark } from './landmarks';
import { matchStreet, streetPlace, streetPlaceId, streetWins } from './streets';
import type { KyivNow, LocalParse, ParseSpan, PlaceRef, TripIntent, TripMode, TripWhen } from './types';

const FROM_PREPS = new Set(['з', 'із', 'зі', 'від', 'с', 'со', 'из', 'от']);
const TO_PREPS = new Set(['до', 'в', 'у', 'на', 'к', 'во']);
/** Слова між прийменником і місцем: «до метро Житомирська», «на вул. Грушевського» */
const FILLERS = new Set(['метро', 'м', 'ст', 'станції', 'станція', 'станции', 'станция', 'зупинки', 'зупинка', 'остановки', 'вул', 'вулиці', 'вулиця', 'улицы', 'район', 'мікрорайон', 'місто', 'міста', 'город', 'города', 'смт', 'платформи', 'платформа']);
const HOUR_PREPS = new Set(['о', 'об', 'в', 'на', 'до', 'к', 'після', 'после']);

const MODE_STEMS: Array<[TripMode | 'bus', string[]]> = [
  ['elektrichka', ['електрич', 'електріч', 'электрич', 'потяг', 'поїзд', 'поезд']],
  ['marshrutka', ['маршрутк', 'маршрутой', 'зубаст']],
  ['poputka', ['попутк', 'попутн', 'блаблакар', 'blablacar']],
  ['bus', ['автобус']],
];

/** ISO-день тижня: пн = 1 … нд = 7 */
const WEEKDAYS: Array<[string, number]> = [
  ['понеділ', 1], ['понедел', 1], ['вівтор', 2], ['вторн', 2], ['серед', 3], ['сред', 3], ['четвер', 4],
  ["п'ятниц", 5], ['пятниц', 5], ['субот', 6], ['неділ', 7], ['воскрес', 7],
];

const PART_START: Record<NonNullable<TripWhen['part']>, number> = { morning: 5 * 60, day: 11 * 60, evening: 17 * 60 };
const PART_END: Record<NonNullable<TripWhen['part']>, number> = { morning: 11 * 60, day: 17 * 60, evening: 23 * 60 };

const ARRIVE_RE = /^(бути|буду|встигн|быть|успет)/;
const PRICE_RE = /^(кошту|коштує|стоит|стоимост|ціна|ціну|цена|вартіст|почем)/;
const CONTACT_RE = /^(телефон|номер|подзвон|позвон|дзвонит|звонит|контакт|диспетчер)/;
const OTHER_RE = /^(погод|курс|новин|температур|дощ|снiг|сніг|снег)/;
const CITY_WORD_RE = /^(київ|києв|киев|малин|житомир|коростен|kyiv|malyn)/;

const pad = (n: number) => String(n).padStart(2, '0');

function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function dayFromOffset(now: KyivNow, offset: number): string {
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return addDays(now.date, offset);
}

interface PlaceHit {
  place: GazetteerPlace;
  token: Token;
  spanStart: number;
  role: 'from' | 'to' | null;
}

/** Прийменник перед словом i (з пропуском «метро», «вул.»…) — або null */
function prepBefore(toks: Token[], i: number): Token | null {
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const t = toks[j];
    if (FROM_PREPS.has(t.n) || TO_PREPS.has(t.n)) return t;
    if (!FILLERS.has(t.n)) return null;
  }
  return null;
}

/** `stops` — зупинки з розкладу міста (`buildStopPlaces`): «Поворот на Коновальця», «Чорновола 36»… */
export function parseLocal(text: string, now: KyivNow, stops: StopPlace[] = [], routes: RouteLike[] = []): LocalParse {
  const toks = tokenize(text);
  // «автобус №5», «9-ка» — раніше за все інше: цифра маршруту не має стати часом, а «маршрутка 7» — маршруткою на Київ
  const routeMentions = findRouteMentions(text, routes);
  const spans: ParseSpan[] = [];
  const hits: PlaceHit[] = [];
  const modes: Array<TripMode | 'bus'> = [];
  const unknown: string[] = [];
  let unknownRole: 'from' | 'to' | null = null;
  // обʼєкт, а не let: присвоєння в assign() TypeScript інакше «звужує» до null
  const st: { from: GazetteerPlace | null; to: GazetteerPlace | null; lastRole: 'from' | 'to' | null } = { from: null, to: null, lastRole: null };
  let dayOffset: number | null = null;
  let explicitDate: string | null = null;
  let time: string | null = null;
  let timeByDeadline = false;
  let part: TripWhen['part'] | undefined;
  const wantsArrive = toks.some((t) => ARRIVE_RE.test(t.n));

  const assign = (role: 'from' | 'to', place: GazetteerPlace, hit: PlaceHit) => {
    const cur = st[role];
    let p = place;
    // «до Києва на вокзал» — вокзал київський
    if (p.id === 'malyn.vokzal' && cur?.city === 'Kyiv') p = placeById('kyiv.pas') ?? p;
    hit.place = p;
    // конкретніше місце того самого міста не замінюємо загальним «Малин»
    // «з Малина до Видубичів на автостанцію»: їдуть з Малина до точки в Києві — «автостанція» вже київська, не наша
    const kyivDetail = role === 'to' && cur != null && cur.city === 'Kyiv' && !cur.isCity && p.city === 'Malyn' && st.from?.city === 'Malyn';
    const keep = kyivDetail || (cur && cur.city === p.city && !cur.isCity && p.isCity);
    if (!keep) st[role] = p;
    hit.role = role;
    st.lastRole = role;
  };

  /** Станція метро як місце: роль за прийменником, без нього — розставимо після циклу, як і міста */
  const takeMetro = (m: MetroMatch, i: number): boolean => {
    const place = resolvePlace(m.station.id);
    if (!place) return false;
    const first = toks[i];
    const lastTok = toks[m.end];
    const whole: Token = { raw: text.slice(first.start, lastTok.end), n: first.n, start: first.start, end: lastTok.end };
    const hit: PlaceHit = { place, token: whole, spanStart: m.marked ? toks[i - 1].start : first.start, role: null };
    hits.push(hit);
    const prep = prepBefore(toks, i);
    if (prep && FROM_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('from', place, hit); }
    else if (prep && TO_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('to', place, hit); }
    else {
      // «з Києва (Позняки)» — те саме місто без прийменника → уточнення
      const cur = st.lastRole ? st[st.lastRole] : null;
      if (st.lastRole && cur && cur.city === 'Kyiv') assign(st.lastRole, place, hit);
    }
    return true;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];
    const n = t.n;
    if (routeMentions.some((m) => t.start >= m.start && t.end <= m.end)) continue;

    // Синонім з адмінки («епіцентр» → місце): власник навчив саме так, тому він сильніший за решту словників
    const taught = matchSynonym(toks, i);
    if (taught) {
      const lastTok = toks[taught.end];
      const whole: Token = { raw: text.slice(t.start, lastTok.end), n, start: t.start, end: lastTok.end };
      const hit: PlaceHit = { place: taught.place, token: whole, spanStart: t.start, role: null };
      hits.push(hit);
      const prep = prepBefore(toks, i);
      if (prep && FROM_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('from', hit.place, hit); }
      else if (prep && TO_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('to', hit.place, hit); }
      i = taught.end;
      continue;
    }

    // Станція київського метро зі словом «метро / м. / ст.» попереду — раніше за зупинки й вулиці Малина:
    // «до метро Лісова» — це Київ, навіть якщо в Малині є вулиця Лісова
    const marked = matchMetro(toks, i);
    if (marked?.marked && takeMetro(marked, i)) {
      i = marked.end;
      continue;
    }

    // Назва зупинки з розкладу — кілька слів, тому раніше за час («до 14 ОМБ») і за прийменники («поворот на…»)
    const stop = stops.length ? matchStopPlace(stops, toks, i) : null;
    if (stop) {
      const lastTok = toks[stop.end];
      const whole: Token = { raw: text.slice(t.start, lastTok.end), n, start: t.start, end: lastTok.end };
      const hit: PlaceHit = { place: stop.entry.place, token: whole, spanStart: t.start, role: null };
      hits.push(hit);
      const prep = prepBefore(toks, i);
      if (prep && FROM_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('from', hit.place, hit); }
      else if (prep && TO_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('to', hit.place, hit); }
      i = stop.end;
      continue;
    }

    // Вулиця чи адреса без зупинки («з Городищанської 20», «до вул. Чапаєва») — лише після прийменника, слова
    // «вулиця» чи з номером будинку: прикметник посеред речення («нова маршрутка») вулицею не вважаємо
    // «з Малина на Теремки», «з Малина до Олімпійської»: людина вже сказала, що їде з міста, тож схожа назва —
    // станція метро, а не садок «Теремок» чи вулиця в Малині. Дослівна назва малинського місця лишається за Малином
    const leaving = st.from?.id === 'city.Malyn' && matchMetro(toks, i) != null;
    if (stops.length) {
      const street = leaving ? null : matchStreet(toks, i);
      const prep = street ? prepBefore(toks, i) : null;
      // орієнтир — лише після прийменника: назви крамниць — звичайні слова
      const lmFound = prepBefore(toks, i) ? matchLandmark(toks, i) : null;
      const lm = lmFound && (lmFound.exact || !leaving) ? lmFound : null;
      // довша назва закладу сильніша за вулицю з того самого слова: «до Слобідської гімназії»
      const lmLonger = lm != null && street != null && lm.end > street.end;
      const place = street && !lmLonger && (prep || street.explicit || street.house) && streetWins(street, n) ? streetPlace(streetPlaceId(street)) : undefined;
      if (street && place) {
        const lastTok = toks[street.end];
        const whole: Token = { raw: text.slice(t.start, lastTok.end), n, start: t.start, end: lastTok.end };
        const hit: PlaceHit = { place, token: whole, spanStart: t.start, role: null };
        hits.push(hit);
        if (prep && FROM_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('from', place, hit); }
        else if (prep && TO_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('to', place, hit); }
        i = street.end;
        continue;
      }
      // Орієнтир без зупинки («до АТБ», «в пенсійний фонд»)
      const lmPlace = lm ? landmarkPlace(lm.landmark.id) : undefined;
      if (lm && lmPlace) {
        const lmPrep = prepBefore(toks, i)!;
        const lastTok = toks[lm.end];
        const whole: Token = { raw: text.slice(t.start, lastTok.end), n, start: t.start, end: lastTok.end };
        const hit: PlaceHit = { place: lmPlace, token: whole, spanStart: lmPrep.start, role: null };
        hits.push(hit);
        assign(FROM_PREPS.has(lmPrep.n) ? 'from' : 'to', lmPlace, hit);
        i = lm.end;
        continue;
      }
    }

    // Час: «18:00», «о 7», «до 9 ранку», «після 18», «о 7 вечора»
    const hourByPrep = /^\d{1,2}$/.test(n) && prev && HOUR_PREPS.has(prev.n);
    if (/^\d{1,2}:\d{2}$/.test(n) || hourByPrep) {
      const [hRaw, mRaw] = n.split(':');
      let h = Number(hRaw);
      const m = mRaw ? Number(mRaw) : 0;
      if (h > 23 || m > 59) continue;
      // «ранку / вечора / дня» після години — частина самого часу, а не окрема частина доби
      const qualifier = next && /^(ранку|утра|вечора|вечера|дня|ночі|ночи)$/.test(next.n) ? next : null;
      if (qualifier && /^(вечор|вечер)/.test(qualifier.n) && h < 12) h += 12;
      if (qualifier?.n === 'дня' && h >= 1 && h <= 6) h += 12;
      time = `${pad(h)}:${pad(m)}`;
      if (prev?.n === 'до') timeByDeadline = true;
      const startsAtPrep = prev && HOUR_PREPS.has(prev.n);
      spans.push({ start: startsAtPrep ? prev.start : t.start, end: (qualifier ?? t).end, kind: 'when' });
      if (qualifier) i++;
      continue;
    }
    // Дата «20.11»
    if (/^\d{1,2}\.\d{2}$/.test(n)) {
      const [d, mo] = n.split('.').map(Number);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const [y] = now.date.split('-').map(Number);
        let iso = `${y}-${pad(mo)}-${pad(d)}`;
        if (iso < now.date) iso = `${y + 1}-${pad(mo)}-${pad(d)}`;
        explicitDate = iso;
        spans.push({ start: t.start, end: t.end, kind: 'when' });
      }
      continue;
    }
    if (/^(післязавтр|послезавтр)/.test(n)) { dayOffset = 2; spans.push({ start: t.start, end: t.end, kind: 'when' }); continue; }
    if (/^завтра/.test(n)) { dayOffset = 1; spans.push({ start: t.start, end: t.end, kind: 'when' }); continue; }
    if (/^(сьогодн|сегодн|зараз|сейчас|найближч|ближайш)/.test(n)) { dayOffset = 0; spans.push({ start: t.start, end: t.end, kind: 'when' }); continue; }
    const wd = WEEKDAYS.find(([stem]) => n.startsWith(stem));
    if (wd) {
      dayOffset = (wd[1] - isoWeekday(now.date) + 7) % 7;
      const withPrep = prev && TO_PREPS.has(prev.n);
      spans.push({ start: withPrep ? prev.start : t.start, end: t.end, kind: 'when' });
      continue;
    }
    if (/^(зранку|вранці|вранци|утром|утра|ранку|зрання|рано)$/.test(n)) { part = 'morning'; spans.push({ start: t.start, end: t.end, kind: 'when' }); continue; }
    if (/^(ввечері|ввечери|вечером|вечора|вечера|ввечер|вечір)$/.test(n)) { part = 'evening'; spans.push({ start: t.start, end: t.end, kind: 'when' }); continue; }
    if (n.startsWith('робот') && prev && /^(після|после)$/.test(prev.n)) { part = 'evening'; spans.push({ start: prev.start, end: t.end, kind: 'when' }); continue; }
    if (/^(вдень|днем|удень)$/.test(n) || (n.startsWith('обід') && prev && /^(після|после)$/.test(prev.n))) {
      part = 'day';
      spans.push({ start: n.startsWith('обід') ? prev.start : t.start, end: t.end, kind: 'when' });
      continue;
    }
    const mode = MODE_STEMS.find(([, stems]) => stems.some((s) => n.startsWith(s)));
    if (mode) {
      if (!modes.includes(mode[0])) modes.push(mode[0]);
      spans.push({ start: t.start, end: t.end, kind: 'mode' });
      continue;
    }

    // Станція метро без слова «метро» («на Позняки», «з Лівобережної»). Місце кураторського словника з того ж
    // слова лишається за словником: у нього старі id («Святошин», «Академмістечко»)
    // Так само місце з Малина: «Дружба народів» там — крамниця, а не стара назва станції
    const sameInMalyn = matchLandmark(toks, i);
    const metro = !findPlaceByToken(n) && (!sameInMalyn || (leaving && !sameInMalyn.exact)) ? matchMetro(toks, i) : null;
    if (metro && takeMetro(metro, i)) {
      i = metro.end;
      continue;
    }

    // Місця
    let place = findPlaceByToken(n);
    if (place) {
      if (place.id === 'malyn.vokzal' && toks.slice(i + 1, i + 3).some((x) => /^(києві|киеве|київськ|киевск|києва|киева)/.test(x.n))) {
        place = placeById('kyiv.pas') ?? place;
      }
      // «з автовокзалу Житомира», «вокзал у Житомирі» — це Житомир, а місць усередині нього словник не має
      if ((place.id === 'malyn.avtostantsiya' || place.id === 'malyn.vokzal') && toks.slice(i + 1, i + 3).some((x) => /^(житомир[аіу]?|житомире)$/.test(x.n))) {
        place = placeById('city.Zhytomyr') ?? place;
      }
      const hit: PlaceHit = { place, token: t, spanStart: t.start, role: null };
      hits.push(hit);
      const isLocative = place.locative?.some((l) => n.startsWith(l)) ?? false;
      const lastRole = st.lastRole;
      const cur = lastRole ? st[lastRole] : null;
      // «з вокзалу в Києві», «до автостанції в Малині» — місцевий відмінок уточнює вже назване
      if (isLocative && lastRole && cur && cur.city === place.city) {
        hit.role = lastRole;
        continue;
      }
      // «вокзал у Києві» без прийменника перед місцем: «у Києві» уточнює щойно назване, а не задає «куди»
      const before = hits[hits.length - 2];
      if (isLocative && before && before.role === null && !before.place.isCity && before.place.city === place.city) {
        hits.pop();
        continue;
      }
      const prep = prepBefore(toks, i);
      if (prep && FROM_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('from', place, hit); continue; }
      if (prep && TO_PREPS.has(prep.n)) { hit.spanStart = prep.start; assign('to', place, hit); continue; }
      // «з Києва (Святошин)» — без прийменника, те саме місто → уточнення
      if (lastRole && cur && cur.city === place.city) { assign(lastRole, place, hit); continue; }
      continue; // розставимо після циклу
    }

    // Незнайоме місце: слово з великої літери одразу після «з/до»
    const prep = prepBefore(toks, i);
    if (prep && /^\p{Lu}/u.test(t.raw) && !FILLERS.has(n)) {
      unknown.push(t.raw);
      if (!unknownRole) unknownRole = FROM_PREPS.has(prep.n) ? 'from' : 'to';
      spans.push({ start: t.start, end: t.end, kind: 'unknown' });
    }
  }

  // Місця без прийменника: «Київ Малин» — перше звідки, друге куди; одне — куди
  // Сусідні «місто + місце в ньому» («вокзал у Києві», «Малин вокзал») — одне місце, конкретніше
  const pending: PlaceHit[][] = [];
  for (const h of hits.filter((x) => x.role === null)) {
    const last = pending[pending.length - 1];
    const head = last?.find((x) => !x.place.isCity) ?? last?.[0];
    if (last && head && head.place.city === h.place.city && head.place.isCity !== h.place.isCity) last.push(h);
    else pending.push([h]);
  }
  pending.forEach((group, idx) => {
    const place = (group.find((x) => !x.place.isCity) ?? group[0]).place;
    const give = (role: 'from' | 'to') => {
      st[role] = place;
      group.forEach((x) => { x.role = role; });
    };
    if (pending.length >= 2 && idx === 0 && !st.from) { give('from'); return; }
    if (!st.to) { give('to'); return; }
    if (!st.from) give('from');
  });
  for (const h of hits) if (h.role) spans.push({ start: h.spanStart, end: h.token.end, kind: h.role });
  for (const m of routeMentions) spans.push({ start: m.start, end: m.end, kind: 'mode' });
  const avoidIds = [...new Set(routeMentions.filter((m) => m.avoid).map((m) => m.routeId))];
  const routeIds = [...new Set(routeMentions.filter((m) => !m.avoid).map((m) => m.routeId))].filter((id) => !avoidIds.includes(id));
  if (unknownRole === 'from' && st.from) unknownRole = null;
  if (unknownRole === 'to' && st.to) unknownRole = null;

  // Вид транспорту: «автобус» між двома місцями Малина — міський, інакше — маршрутка
  const fromP = st.from;
  const toP = st.to;
  const tripModes: TripMode[] = [];
  for (const m of modes) {
    const resolved: TripMode = m === 'bus' ? ((fromP?.city ?? 'Malyn') === 'Malyn' && toP?.city === 'Malyn' ? 'city_bus' : 'marshrutka') : m;
    if (!tripModes.includes(resolved)) tripModes.push(resolved);
  }

  // День: явна дата → зсув → «сьогодні»; час або частина дня вже минули → завтра
  const dayGiven = explicitDate != null || dayOffset != null;
  let day: string;
  if (explicitDate) day = explicitDate === now.date ? 'today' : explicitDate === addDays(now.date, 1) ? 'tomorrow' : explicitDate;
  else day = dayFromOffset(now, dayOffset ?? 0);
  if (!dayGiven) {
    const [th, tm] = time ? time.split(':').map(Number) : [NaN, NaN];
    const timePassed = time != null && th * 60 + tm < now.mins;
    const partPassed = time == null && part != null && PART_END[part] <= now.mins;
    if (timePassed || partPassed) day = 'tomorrow';
  }
  const when: TripWhen = { day, kind: time && (timeByDeadline || wantsArrive) ? 'arrive' : 'depart' };
  if (time) when.time = time;
  if (part) when.part = part;

  // Маршрут міського автобуса — це завжди міський транспорт
  if ((routeIds.length || avoidIds.length) && !tripModes.includes('city_bus')) tripModes.push('city_bus');

  // Намір
  const words = toks.map((t) => t.n);
  let intent: TripIntent['intent'] = 'trip';
  // назвали маршрут, але не пару «звідки — куди» — питають про сам маршрут: куди їде, коли наступний
  if (routeIds.length && !(fromP && toP)) intent = 'route';
  else if (words.some((w) => PRICE_RE.test(w))) intent = 'price';
  else if (words.some((w) => CONTACT_RE.test(w))) intent = 'contact';
  else if (words.some((w) => OTHER_RE.test(w))) intent = 'other';

  const ref = (p: GazetteerPlace | null, role: 'from' | 'to'): PlaceRef | null => {
    if (!p) return null;
    const own = hits.filter((h) => h.role === role).map((h) => h.token.raw);
    return { id: p.id, text: own.join(' ') || p.label };
  };

  const hasCityWord = words.some((w) => CITY_WORD_RE.test(w));
  let confidence: TripIntent['confidence'] = fromP && toP && unknown.length === 0 ? 'high' : fromP || toP ? 'medium' : 'low';
  if (!fromP && toP && !toP.isCity && !hasCityWord && tripModes.length === 0) confidence = 'low';
  if (intent === 'route' && unknown.length === 0) confidence = 'high';

  return {
    intent: {
      intent,
      from: ref(fromP, 'from'),
      to: ref(toP, 'to'),
      when,
      modes: tripModes,
      ...(routeIds.length ? { routes: routeIds } : {}),
      ...(avoidIds.length ? { avoidRoutes: avoidIds } : {}),
      unknown,
      confidence,
    },
    spans: spans.sort((a, b) => a.start - b.start),
    dayGiven,
    unknownRole,
  };
}

/** Початок вікна пошуку для частини дня (хв від півночі) */
export function partStartMins(part: TripWhen['part']): number | null {
  return part ? PART_START[part] : null;
}

export function partEndMins(part: TripWhen['part']): number | null {
  return part ? PART_END[part] : null;
}

/** «Київ · Святошин» для id зі словника */
export function placeIdLabel(id: string): string {
  const p = resolvePlace(id);
  if (!p) return id;
  return p.isCity ? p.label : `${CITY_LABEL[p.city]} · ${p.label}`;
}
