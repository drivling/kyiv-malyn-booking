/**
 * «Доведе» в Коростені, етап 1 (Docs/dovede-roadmap.md, «Коростень»): питання про поїздку містом Коростенем — «з Пашин
 * до міськлікарні», «коли №4 на Грозине», «як від Гастелло до вокзалу». Лише словник (без Claude): той самий
 * `parseLocal`, але місця — зупинки датасету Коростеня й народні назви з них, а відповідь — та сама поїздка містом
 * (`intra` / `route_info` у складальнику) на планувальнику Коростеня.
 *
 * Спільні з бекендом файли (gazetteer, stopPlaces, промпт) не змінюються: місця Коростеня — це записи `StopPlace` з
 * містом `Korosten`; фрази зупинок `parseLocal` перевіряє раніше за кураторський словник Малина, тож «вокзал», «центр»,
 * «ринок» тут — коростенські. Що все ж дійшло з малинського словника, `remapForKorosten` переводить або відкидає.
 */
import type { GazetteerPlace } from '../nlu/gazetteer';
import { stopBaseName, type StopLike, type StopPlace } from '../nlu/stopPlaces';
import { resolvePlace } from '../nlu/places';
import { tokenize } from '../nlu/normalize';
import type { PlaceRef, TripIntent } from '../nlu/types';
import type { TripShape } from '../compose/composeStories';

export const KOROSTEN = 'Korosten';

/**
 * Народні й короткі назви зупинок Коростеня → id зупинки. Лише очевидні з назв зупинок і розкладу ради, без
 * вигаданих орієнтирів. Кожна фраза — слова назви в називному відмінку (відмінки ловить `wordMatchesName`: «пашини» →
 * «з Пашин», «грозине» → «на Грозиного»); слово до 4 літер порівнюється цілком, тому «суд» / «суду» — окремо.
 */
export const KOROSTEN_ALIASES: Array<{ stopId: string; phrases: string[] }> = [
  { stopId: 'st_1001', phrases: ['вокзал', 'залізничний вокзал', 'жд вокзал'] },
  { stopId: 'st_1002', phrases: ['ринок', 'ринку', 'ринка', 'базар', 'базару', 'базарі', 'центральний ринок'] },
  { stopId: 'st_1003', phrases: ['центр', 'центру', 'центрі'] },
  { stopId: 'st_1069', phrases: ['гастелло', 'шухевича'] },
  { stopId: 'st_1079', phrases: ['міськлікарня', 'міська лікарня'] },
  { stopId: 'st_1073', phrases: ['районна лікарня', 'залізнична лікарня'] },
  { stopId: 'st_1085', phrases: ['поліклініка'] },
  { stopId: 'st_1010', phrases: ['чолівка', 'переїзд'] },
  { stopId: 'st_1080', phrases: ['автопарк'] },
  { stopId: 'st_1049', phrases: ['житомирська станція', 'станція житомирська'] },
  { stopId: 'st_1031', phrases: ['подільський', 'коростень подільський'] },
  { stopId: 'st_1015', phrases: ['водосховище', 'поліське'] },
  { stopId: 'st_1048', phrases: ['білокоровицьке'] },
  { stopId: 'st_1061', phrases: ['цегельний', 'цегельня'] },
  { stopId: 'st_1037', phrases: ['швейна'] },
  { stopId: 'st_1016', phrases: ['парк', 'древлянський', 'островського'] },
  { stopId: 'st_1055', phrases: ['стадіон', 'локомотив'] },
  { stopId: 'st_1104', phrases: ['виконком', 'міськвиконком'] },
  { stopId: 'st_1038', phrases: ['суд', 'суду', 'суді', 'дім правосуддя'] },
  { stopId: 'st_1043', phrases: ['діагностичний'] },
];

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

/** Технічні точки геометрії маршруту («№5 т.3») — не зупинки для людей */
const isPassengerStop = (s: StopLike) => !s.name.trim().startsWith('№');
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
  const byBase = new Map<string, StopLike[]>();
  for (const s of [...stops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!isPassengerStop(s)) continue;
    const base = stopBaseName(s.name);
    if (!base) continue;
    byBase.set(base, [...(byBase.get(base) ?? []), s]);
  }
  for (const [base, list] of byBase) {
    const place: GazetteerPlace = { id: list[0].id, city: KOROSTEN, label: base, stems: [], stopIds: list.map((s) => s.id) };
    for (const s of list) places.set(s.id, place);
    const words = phraseWords(base);
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
  const ref: PlaceRef = { id: 'city.Korosten', text: said?.text ?? 'Коростень', ...(place ? { detail: place.label } : {}) };
  // слова, які малинський словник не впізнав, а коростенський — так («Пашин»), уже не невідомі
  const known = [korosten.from, korosten.to].filter((r): r is PlaceRef => Boolean(r && kp(r))).map((r) => r.text.toLowerCase()).join(' ');
  const unknown = malyn.unknown.filter((w) => !known.includes(w.toLowerCase()));
  return { ...malyn, [side]: ref, [other]: malynRef, unknown };
}

/** Питання називає інше місто (Малин, Київ…) — у режимі Коростеня це вже не питання про місто Коростень */
export function mentionsOtherCity(text: string): boolean {
  return hasStem(text, OTHER_CITY_STEMS);
}

function remapRef(ref: PlaceRef | null, unknown: string[]): PlaceRef | null {
  if (!ref) return null;
  if (resolvePlace(ref.id)?.city === KOROSTEN) return ref;
  const mapped = MALYN_TO_KOROSTEN[ref.id];
  if (mapped) return { ...ref, id: mapped };
  // місто Коростень саме по собі («в Коростені») — не точка поїздки; решта (малинські місця, вулиці, Київ) — невідоме
  if (ref.id !== 'city.Korosten') unknown.push(ref.text);
  return null;
}

/** Намір словника → намір у Коростені: місця лише коростенські, маршрути — номери Коростеня (їх `parseLocal` бере з `routes`) */
export function remapForKorosten(intent: TripIntent): TripIntent {
  const unknown = [...intent.unknown];
  const from = remapRef(intent.from, unknown);
  const to = remapRef(intent.to, unknown);
  // «маршрутка», «автобус» у місті — міський автобус; електричка й попутка містом не їздять
  const modes = intent.modes.filter((m) => m === 'city_bus');
  return { ...intent, from, to, modes, unknown };
}

/** Форма відповіді для питання в Коростені: поїздка містом, картка маршруту або уточнення */
export function korostenShape(intent: TripIntent): TripShape {
  const from = intent.from ? resolvePlace(intent.from.id) ?? null : null;
  const to = intent.to ? resolvePlace(intent.to.id) ?? null : null;
  const routeIds = intent.routes ?? [];
  if (routeIds.length && (intent.intent === 'route' || !(from && to))) {
    return { kind: 'route_info', routeIds, stop: from ?? to ?? null };
  }
  if (intent.intent === 'price' || intent.intent === 'contact' || intent.intent === 'other') return { kind: 'not_trip', intent: 'other' };
  if (intent.unknown.length && (!from || !to)) return { kind: 'unknown_place', words: intent.unknown };
  if (!to) return { kind: 'ask_to' };
  if (!from) return { kind: 'ask_from', dest: to };
  return { kind: 'intra', origin: from, dest: to };
}
