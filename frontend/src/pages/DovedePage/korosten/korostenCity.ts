/**
 * «Доведе» в Коростені (Docs/dovede-roadmap.md, «Коростень»): питання про поїздку містом Коростенем — «з Пашин
 * до міськлікарні», «коли №4 на Грозине», «як від Гастелло до вокзалу». Той самий `parseLocal`, але місця — зупинки
 * датасету Коростеня й народні назви з них (`korostenPlaces.ts`, спільний із промптом Claude), а відповідь — та сама
 * поїздка містом (`intra` / `route_info` у складальнику) на планувальнику Коростеня. Коли словник не впевнений, сторінка
 * питає Claude з промптом Коростеня (етап 2).
 *
 * Спільні з бекендом файли (gazetteer, stopPlaces, промпт) не змінюються: місця Коростеня — це записи `StopPlace` з
 * містом `Korosten`; фрази зупинок `parseLocal` перевіряє раніше за кураторський словник Малина, тож «вокзал», «центр»,
 * «ринок» тут — коростенські. Що все ж дійшло з малинського словника, `remapForKorosten` переводить або відкидає.
 */
import type { GazetteerPlace } from '../nlu/gazetteer';
import type { StopLike, StopPlace } from '../nlu/stopPlaces';
import { resolvePlace } from '../nlu/places';
import { tokenize } from '../nlu/normalize';
import { DETAIL_FROM_PREPS, FROM_PREPS, NOT_DETAIL_RE, TO_PREPS, nominative } from '../nlu/cityDetail';
import type { ParseSpan, PlaceRef, TripIntent } from '../nlu/types';
import type { CityEndRef, TripShape } from '../compose/composeStories';
import { KOROSTEN_ALIASES, korostenStopGroups } from './korostenPlaces';
import { korostenSpot } from './korostenStreets';

export { KOROSTEN_ALIASES } from './korostenPlaces';

export const KOROSTEN = 'Korosten';

/**
 * Малинські місця кураторського словника, які в Коростені мають свою пару (слово без коростенської фрази — наприклад,
 * «лікарня» без «міська» / «районна» — означає міську лікарню). Решта малинських місць, вулиць і орієнтирів у
 * Коростені — невідомі слова.
 */
const MALYN_TO_KOROSTEN: Record<string, string> = {
  'malyn.vokzal': 'st_1001',
  'malyn.tsentr': 'st_1003',
  'malyn.likarnia': 'st_1079',
};

const NUMBER_RE = /^\d+$/;
const SKIP = new Set(['на', 'та', 'до', 'за', 'і', 'й', 'вул', 'вулиця', 'пров', 'провулок', 'ім']);

function phraseWords(text: string): string[] {
  return tokenize(text)
    .map((t) => t.n)
    .filter((w) => NUMBER_RE.test(w) || (w.length > 1 && !SKIP.has(w)));
}

/**
 * Місця Коростеня для `parseLocal`: кожна пасажирська зупинка (назва без уточнень у дужках) і народні назви з
 * `KOROSTEN_ALIASES`; довші фрази — першими, як у `buildStopPlaces`. Усі записи однієї зупинки ділять одне місце.
 */
export function buildKorostenPlaces(stops: StopLike[]): StopPlace[] {
  const places = new Map<string, GazetteerPlace>();
  const out: StopPlace[] = [];
  for (const g of korostenStopGroups(stops)) {
    const place: GazetteerPlace = { id: g.id, city: KOROSTEN, label: g.label, stems: [], stopIds: g.stopIds };
    for (const id of g.stopIds) places.set(id, place);
    const words = phraseWords(g.label);
    // номер у назві обовʼязковий («Київська, 1-А» — не просто «Київська», «Школа №8» — не будь-яка школа)
    if (words.some((w) => !NUMBER_RE.test(w))) out.push({ place, words, strictNumbers: words.some((w) => NUMBER_RE.test(w)) });
  }
  for (const alias of KOROSTEN_ALIASES) {
    const place = places.get(alias.stopId);
    if (!place) continue;
    for (const phrase of alias.phrases) {
      const words = phraseWords(phrase);
      if (words.length) out.push({ place, words, strictNumbers: false });
    }
  }
  return out.sort((a, b) => b.words.length - a.words.length || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0));
}

/** Слова, які бувають лише в Коростені (місто чи його райони), і міста, з якими питання вже не про місто Коростень */
const KOROSTEN_STEMS = ['коростен', 'пашин', 'грозин', 'чолівк', 'чигир', 'пролісков', 'білокоровиц', 'гастелл', 'міськлікарн', 'древлянськ'];
const OTHER_CITY_STEMS = ['малин', 'київ', 'києв', 'житомир', 'ірпін', 'буч'];

const hasStem = (text: string, stems: string[]) => tokenize(text).some((t) => stems.some((s) => t.n.startsWith(s)));

/**
 * Питання про Коростень: є коростенське слово й нема іншого міста («з Коростеня в Малин» — міжміська поїздка, її
 * «Доведе» поки не знає). Малин лишається рідним містом сторінки: без коростенських слів питання — про Малин.
 * «В Коростені» `parseLocal` сам не робить точкою поїздки (`remapForKorosten` відкидає `city.Korosten`).
 */
export function isKorostenQuestion(text: string): boolean {
  return hasStem(text, KOROSTEN_STEMS) && !hasStem(text, OTHER_CITY_STEMS);
}

/** Прийменники напрямку: «в Коростень», «до Коростеня», «з Коростеня» — Коростень як кінець поїздки, не уточнення міста */
const DIRECTION_PREPS = new Set(['з', 'із', 'зі', 'від', 'до', 'в', 'у', 'на']);

/**
 * Коростень — кінець поїздки: «в Коростень» / «з Коростеня» — так; «у Коростені» (де?), «центру Коростеня» (чого?) і
 * зупинка «до Коростеня-Подільського» — ні. Містом Коростенем так не питають, тож і в режимі Коростеня це питання
 * про поїздку з Малина чи в Малин.
 */
export function namesKorostenAsEnd(text: string): boolean {
  const toks = tokenize(text);
  return toks.some(
    (t, i) =>
      t.n.startsWith('коростен') &&
      t.n !== 'коростені' &&
      i > 0 &&
      DIRECTION_PREPS.has(toks[i - 1].n) &&
      !toks[i + 1]?.n.startsWith('подільськ'),
  );
}

/**
 * Малинський розбір питання — поїздка між Малином і Коростенем, а не містом Коростенем: Коростень названо як кінець
 * поїздки («в Коростень», «з Коростеня», не «у Коростені» й не «центр Коростеня»), другий кінець — місце в Малині, і
 * нерозпізнаних слів нема. Людина пише таке без слова «Малин» (сайт малинський: «з вокзалу в Коростень» — малинський
 * вокзал), тож `isKorostenQuestion` сама його не відрізнить. Таке питання лишається в Малині (коридор, етап 3).
 * Запас на випадок, коли датасет Коростеня не завантажився і `combineCorridor` нема з чим порівняти. Місця шукає
 * `resolvePlace`, тобто реєстр Малина.
 */
export function isMalynKorostenTrip(text: string, intent: TripIntent): boolean {
  if (intent.unknown.length || !intent.from || !intent.to || !namesKorostenAsEnd(text)) return false;
  const ends = [intent.from, intent.to];
  const k = ends.findIndex((r) => r.id === 'city.Korosten');
  if (k < 0) return false;
  return resolvePlace(ends[1 - k].id)?.city === 'Malyn';
}

/** Коростенські слова в питанні: сторінці Малина потрібен датасет Коростеня — для коридору чи перемикання */
export function mentionsKorosten(text: string): boolean {
  return hasStem(text, KOROSTEN_STEMS);
}

/** Місце Коростеня за назвою (`PlaceRef.detail` коридору) → id зупинки; null — такого нема */
export function korostenStopByLabel(index: StopPlace[], label: string): string | null {
  const want = label.trim().toLowerCase();
  const hit = index.find((e) => e.place.label.toLowerCase() === want);
  return hit ? (hit.place.stopIds?.[0] ?? hit.place.id) : null;
}

/**
 * Етап 3: поїздка Малин ↔ Коростень з двох розборів одного питання — малинським словником (`malyn`, сторінка Малина)
 * і коростенським (`korosten`, `parseLocal` з `buildKorostenPlaces`). Один кінець — місце Малина (чи «Малин»), другий —
 * «Коростень» чи зупинка Коростеня; зупинка стає `detail` кінця `city.Korosten` (назва, як у датасеті), її шлях
 * від вокзалу будує планувальник Коростеня. Обидва кінці в Коростені — це питання містом Коростенем (null), так само
 * як і коли Малина в питанні нема. «З вокзалу в Коростень»: «вокзал» тут той самий кінець, що й малинський, — не
 * коростенське місце.
 */
export function combineCorridor(malyn: TripIntent, korosten: TripIntent, index: StopPlace[]): TripIntent | null {
  const byId = new Map(index.map((e) => [e.place.id, e.place]));
  const kp = (r: PlaceRef | null) => (r ? (byId.get(r.id) ?? null) : null);
  const kFrom = kp(korosten.from);
  const kTo = kp(korosten.to);
  if (kFrom && kTo) return null;
  const isKorostenCity = (r: PlaceRef | null) => r?.id === 'city.Korosten';
  const isMalyn = (r: PlaceRef | null): r is PlaceRef => r != null && (r.id === 'city.Malyn' || resolvePlace(r.id)?.city === 'Malyn');
  const side: 'from' | 'to' | null = isKorostenCity(malyn.from) ? 'from' : isKorostenCity(malyn.to) ? 'to' : kFrom ? 'from' : kTo ? 'to' : null;
  if (!side) return null;
  const other = side === 'from' ? 'to' : 'from';
  const malynRef = malyn[other];
  if (!isMalyn(malynRef)) return null;
  const found = (
    [
      [korosten.from, kFrom],
      [korosten.to, kTo],
    ] as const
  ).find(([r, p]) => p && r && r.text.toLowerCase() !== malynRef.text.toLowerCase());
  const place = found?.[1] ?? null;
  const said = malyn[side] ?? korosten[side] ?? found?.[0] ?? null;
  // зупинка датасету має перевагу; без неї лишаються слова людини («на Грушевського 22») — дорогу дасть сервер
  const words = isKorostenCity(malyn[side]) ? malyn[side]?.detail : undefined;
  const detail = place?.label ?? words;
  const ref: PlaceRef = { id: 'city.Korosten', text: said?.text ?? 'Коростень', ...(detail ? { detail } : {}) };
  // слова, які малинський словник не впізнав, а коростенський — так («Пашин»), уже не невідомі
  const known = [korosten.from, korosten.to].filter((r): r is PlaceRef => Boolean(r && kp(r))).map((r) => r.text.toLowerCase()).join(' ');
  const unknown = malyn.unknown.filter((w) => !known.includes(w.toLowerCase()));
  return { ...malyn, [side]: ref, [other]: malynRef, unknown };
}

/**
 * Підсвічування поля на сторінці Малина, коли питання про Коростень: до малинських шматків додаються «звідки / куди»
 * коростенського розбору («Пашин», «міськлікарні»). Малинський шматок місця чи часу лишається; «невідоме» слово, яке
 * впізнав коростенський словник, стає місцем.
 */
export function mergeKorostenSpans(malyn: ParseSpan[], korosten: ParseSpan[]): ParseSpan[] {
  const overlaps = (a: ParseSpan, b: ParseSpan) => a.start < b.end && b.start < a.end;
  const places = korosten.filter((k) => k.kind === 'from' || k.kind === 'to');
  const added = places.filter((k) => !malyn.some((m) => m.kind !== 'unknown' && overlaps(m, k)));
  const kept = malyn.filter((m) => m.kind !== 'unknown' || !added.some((k) => overlaps(m, k)));
  return [...kept, ...added].sort((a, b) => a.start - b.start);
}

/**
 * Розбір питання в режимі Коростеня знайшов місце, яке є лише в Малині: кураторське місце Малина без коростенської пари
 * (Царське село, автостанція, Паперова фабрика), вулицю чи орієнтир Малина. Таке питання без коростенських слів —
 * про Малин, і сторінка повертається туди (окремої кнопки «до Малина» нема).
 */
export function hasMalynOnlyPlace(intent: TripIntent): boolean {
  return [intent.from, intent.to].some(
    (r) => r != null && !MALYN_TO_KOROSTEN[r.id] && (r.id.startsWith('malyn.') || r.id.startsWith('street.') || r.id.startsWith('lm.')),
  );
}

/**
 * «У Коростені з вокзалу до музичної школи» на сторінці Малина: Коростень тут — уточнення міста («де?»), а не кінець
 * поїздки, іншого міста й місця, яке є лише в Малині, нема — це питання містом Коростенем, а не коридор Малин ↔
 * Коростень (інакше «вокзал» ставав малинським, а «Сільпо» — малинською зупинкою). «З Паперової фабрики до Сільпо у
 * Коростені» лишається коридором: Паперова фабрика — лише в Малині.
 */
export function asksInsideKorosten(text: string, malyn: TripIntent): boolean {
  return mentionsKorosten(text) && !namesKorostenAsEnd(text) && !mentionsOtherCity(text) && !hasMalynOnlyPlace(malyn);
}

/** Питання називає інше місто (Малин, Київ…) — у режимі Коростеня це вже не питання про місто Коростень */
export function mentionsOtherCity(text: string): boolean {
  return hasStem(text, OTHER_CITY_STEMS);
}

function remapRef(ref: PlaceRef | null, unknown: string[]): PlaceRef | null {
  if (!ref) return null;
  // місто Коростень саме по собі («у Коростені з вокзалу до …») — не точка поїздки; з місцем словами (`detail`) —
  // кінець, до якого дорогу дає сервер. Прикметник («Коростенська міська рада») — теж не місто: місце візьме
  // `withKorostenWords` з фрази, а там його знайде `korostenSpot`
  if (ref.id === 'city.Korosten') return ref.detail ? ref : null;
  if (resolvePlace(ref.id)?.city === KOROSTEN) return ref;
  const mapped = MALYN_TO_KOROSTEN[ref.id];
  if (mapped) return { ...ref, id: mapped };
  // решта (малинські місця, вулиці, Київ) — невідоме
  unknown.push(ref.text);
  return null;
}

/** Слова, що після прийменника означають транспорт, час чи мету, а не місце в місті */
const NOT_PLACE_RE = /^(маршрут|автобус|автобуc|електричк|электричк|попутк|таксі|такси|пішки|пешком|годин|хвилин|минут|роботу|работу|додому|домой|рейс|час|зупинк|остановк|місті|городе)/;
const MAX_PLACE_WORDS = 5;
/** Назва міста у відмінках (не прикметник «коростенський») */
const CITY_WORD_RE = /^коростен(ь|я|і|ю|ем)$/;

interface SaidPlace {
  role: 'from' | 'to';
  /** слова людини як є (для підсвітки й невідомих слів) */
  raw: string;
  /** те саме в називному відмінку — це йде серверу */
  words: string;
}

/**
 * Місця, названі словами після «з / від» і «до / на / в»: до пʼяти слів до наступного прийменника чи слова про час і
 * транспорт. Місто тут мається на увазі (режим Коростеня), тому назви міста не шукаємо.
 */
export function saidPlaces(text: string): SaidPlace[] {
  const toks = tokenize(text);
  const out: SaidPlace[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const role = DETAIL_FROM_PREPS.has(toks[i].n) ? 'from' : TO_PREPS.has(toks[i].n) ? 'to' : null;
    if (!role) continue;
    let j = i + 1;
    while (j < toks.length && j - i <= MAX_PLACE_WORDS) {
      const n = toks[j].n;
      if (FROM_PREPS.has(n) || TO_PREPS.has(n) || NOT_DETAIL_RE.test(n) || NOT_PLACE_RE.test(n) || /^\d{1,2}[:.]\d{2}$/.test(n)) break;
      j++;
    }
    if (j === i + 1) continue;
    // «у Коростені», «до Коростеня» — саме місто, а не місце в ньому
    if (toks.slice(i + 1, j).every((t) => CITY_WORD_RE.test(t.n))) continue;
    const raw = text.slice(toks[i + 1].start, toks[j - 1].end).replace(/\s+/g, ' ').trim();
    // місце — це хоча б одне слово з літер (не «на 9», не «до 5»)
    if (!/\p{L}{3,}/u.test(raw)) continue;
    out.push({ role, raw, words: raw.replace(/[\p{L}'’ʼ]+/gu, nominative) });
    i = j - 1;
  }
  return out;
}

const covers = (ref: PlaceRef | null, raw: string): boolean => Boolean(ref) && ref!.text.toLowerCase().includes(raw.toLowerCase().split(' ')[0]);

/**
 * Кінець поїздки, якого словник Коростеня не знає (адреса, магазин), — місце словами: `city.Korosten` + `detail`.
 * Дорогу до нього дає сервер (`/dovede/city-route`, крок 3 плану навчання). Слова беремо з фрази після прийменника,
 * а коли її немає — єдине невідоме слово розбору (так його віддає і Claude). Кінці, які словник знає, не чіпаємо.
 */
export function withKorostenWords(intent: TripIntent, text: string): TripIntent {
  if (intent.from && intent.to) return intent;
  if (intent.intent === 'route' || intent.intent === 'price' || intent.intent === 'contact' || intent.intent === 'other') return intent;
  const said = saidPlaces(text).filter((p) => !covers(intent.from, p.raw) && !covers(intent.to, p.raw));
  let from = intent.from;
  let to = intent.to;
  const used: string[] = [];
  const take = (role: 'from' | 'to'): PlaceRef | null => {
    const p = said.find((x) => x.role === role);
    if (!p) return null;
    used.push(p.raw.toLowerCase());
    return { id: 'city.Korosten', text: p.raw, detail: p.words };
  };
  if (!from) from = take('from');
  if (!to) to = take('to');
  // фрази немає, а невідоме слово одне й порожній кінець один — це воно
  if (intent.unknown.length === 1 && !used.length && Boolean(from) !== Boolean(to)) {
    const word = intent.unknown[0].replace(/\s+/g, ' ').trim();
    const ref: PlaceRef = { id: 'city.Korosten', text: word, detail: word.replace(/[\p{L}'’ʼ]+/gu, nominative) };
    if (word.length >= 2) {
      used.push(word.toLowerCase());
      if (!from) from = ref;
      else to = ref;
    }
  }
  if (from === intent.from && to === intent.to) return intent;
  const unknown = intent.unknown.filter((w) => !used.some((u) => u.includes(w.toLowerCase()) || w.toLowerCase().includes(u)));
  return { ...intent, from, to, unknown };
}

/** Намір словника → намір у Коростені: місця лише коростенські, маршрути — номери Коростеня (їх `parseLocal` бере з `routes`) */
export function remapForKorosten(intent: TripIntent, text?: string): TripIntent {
  if (text != null) return withKorostenWords(remapForKorosten(intent), text);
  const unknown = [...intent.unknown];
  const from = remapRef(intent.from, unknown);
  const to = remapRef(intent.to, unknown);
  // «маршрутка», «автобус» у місті — міський автобус; електричка й попутка містом не їздять
  const modes = intent.modes.filter((m) => m === 'city_bus');
  return { ...intent, from, to, modes, unknown };
}

/** Форма відповіді для питання в Коростені: поїздка містом, картка маршруту або уточнення */
export function korostenShape(intent: TripIntent): TripShape {
  // місце словами (`city.Korosten` + `detail`) — не зупинка; адресу з наших даних (вулиця, будинок) планувальник
  // веде сам як точку, решту слів питаємо в сервера
  const stop = (ref: PlaceRef | null): GazetteerPlace | null => {
    const p = ref ? resolvePlace(ref.id) ?? null : null;
    if (p && !p.isCity) return p;
    const words = ref?.id === 'city.Korosten' ? (ref.detail ?? '').trim() : '';
    return words ? korostenSpot(words) : null;
  };
  const end = (ref: PlaceRef | null): CityEndRef | null => {
    const p = stop(ref);
    // адреса з наших даних серверу не потрібна: коли другий кінець — слова, вона теж іде словами
    if (p) return p.latLng && !p.stopIds?.length ? { words: (ref?.detail ?? p.label).trim() } : { id: p.id };
    const words = ref?.id === 'city.Korosten' ? (ref.detail ?? '').trim() : '';
    return words ? { words } : null;
  };
  const from = stop(intent.from);
  const to = stop(intent.to);
  const routeIds = intent.routes ?? [];
  if (routeIds.length && (intent.intent === 'route' || !(from && to))) {
    return { kind: 'route_info', routeIds, stop: from ?? to ?? null };
  }
  if (intent.intent === 'price' || intent.intent === 'contact' || intent.intent === 'other') return { kind: 'not_trip', intent: 'other' };
  // хоча б один кінець названо словами, яких немає в наших даних, — дорогу містом дає сервер
  const a = end(intent.from);
  const b = end(intent.to);
  if (a && b && ((!from && 'words' in a) || (!to && 'words' in b)) && !('words' in a && 'words' in b && a.words.toLowerCase() === b.words.toLowerCase())) {
    return { kind: 'city', far: 'Korosten', from: a, to: b };
  }
  if (intent.unknown.length && (!from || !to)) return { kind: 'unknown_place', words: intent.unknown };
  if (!to) return { kind: 'ask_to' };
  if (!from) return { kind: 'ask_from', dest: to };
  return { kind: 'intra', origin: from, dest: to };
}
