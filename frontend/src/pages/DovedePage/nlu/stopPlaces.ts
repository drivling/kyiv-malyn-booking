/**
 * Зупинки міського транспорту як місця словника «Доведе» (Docs/dovede-roadmap.md, «Словник місць»: «зупинка
 * st_XXXX — будь-яка зупинка датасету, як є»). Кураторський словник (`gazetteer.ts`) знає райони й головні
 * орієнтири; решту назв — «Поворот на Коновальця», «Чорновола 36», «м-н "Сільпо"» — беремо з розкладу, тож
 * нова зупинка в адмінці одразу стає зрозумілою. Назва — кілька слів, тому збіг шукаємо фразою, а не словом.
 * Однакова копія на фронтенді й бекенді (тест звірки, як `gazetteer.ts`): Claude отримує ті самі id.
 */
import { PLACES, findPlaceByToken, type GazetteerPlace } from './gazetteer';
import { tokenize, type Token } from './normalize';

export interface StopLike {
  id: string;
  name: string;
}

export interface StopPlace {
  /** id — перша зупинка групи (st_XXXX); stopIds — усі зупинки з цією назвою (обидва боки дороги) */
  place: GazetteerPlace;
  /** значущі слова назви, нормалізовані: «поворот», «коновальця» */
  words: string[];
  /** номер будинку обовʼязковий: без нього те саме слово — місце кураторського словника («Грушевського») */
  strictNumbers: boolean;
}

/** Службові слова: у назві не значущі, у питанні між словами назви пропускаються («поворот НА Коновальця») */
const SKIP = new Set(['на', 'та', 'до', 'за', 'і', 'й', 'вул', 'вулиця', 'тов', 'перехр', 'перехрестя', 'прехр', 'тя', 'навпр', 'навпроти']);
const NUMBER_RE = /^\d+$/;

/** Технічні точки геометрії маршруту («№5 т.3») — не зупинки для людей */
function isPassengerStop(s: StopLike): boolean {
  return !s.name.trim().startsWith('№');
}

/** «Швейна фабрика (навпроти)» → «Швейна фабрика»: уточнення в дужках — той самий орієнтир */
export function stopBaseName(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function significantWords(name: string): string[] {
  return tokenize(name)
    .map((t) => t.n)
    .filter((w) => NUMBER_RE.test(w) || (w.length > 1 && !SKIP.has(w)));
}

/** Початок слова, спільний для відмінків: «коновальця» → «коноваль», «фабрика» → «фабрик»; короткі — цілком */
function stem(word: string): string {
  if (NUMBER_RE.test(word) || word.length <= 4) return word;
  return word.slice(0, word.length >= 7 ? -2 : -1);
}

function wordMatches(word: string, token: string): boolean {
  if (NUMBER_RE.test(word) || word.length <= 4) return token === word;
  return token.startsWith(stem(word));
}

/** Місця із зупинок датасету, яких немає в кураторському словнику; довші назви — першими */
export function buildStopPlaces(stops: StopLike[]): StopPlace[] {
  const covered = new Set(PLACES.flatMap((p) => p.stopIds ?? []));
  const groups = new Map<string, StopLike[]>();
  for (const s of [...stops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!isPassengerStop(s) || covered.has(s.id)) continue;
    const base = stopBaseName(s.name);
    if (!base) continue;
    const list = groups.get(base);
    if (list) list.push(s);
    else groups.set(base, [s]);
  }
  const out: StopPlace[] = [];
  for (const [base, list] of groups) {
    const words = significantWords(base);
    if (!words.some((w) => !NUMBER_RE.test(w))) continue;
    // назва — просто синонім місця кураторського словника («Вокзал», «Центр»): воно вже є, двох «вокзалів» не треба
    const curated = words.map((w) => (NUMBER_RE.test(w) ? null : findPlaceByToken(w)?.id ?? ''));
    if (curated.every((id) => id) && new Set(curated).size === 1) continue;
    out.push({
      place: { id: list[0].id, city: 'Malyn', label: base, stems: [], stopIds: list.map((s) => s.id) },
      words,
      strictNumbers: words.some((w) => !NUMBER_RE.test(w) && findPlaceByToken(w) != null),
    });
  }
  return out.sort((a, b) => b.words.length - a.words.length || (a.place.id < b.place.id ? -1 : 1));
}

export interface StopMatch {
  entry: StopPlace;
  /** індекс останнього слова питання, що належить назві */
  end: number;
}

function matchFrom(entry: StopPlace, toks: Token[], i: number): number | null {
  let pos = i;
  let last = -1;
  for (const word of entry.words) {
    while (pos < toks.length && last >= 0 && SKIP.has(toks[pos].n)) pos++;
    const tok = toks[pos];
    if (tok && wordMatches(word, tok.n)) {
      last = pos;
      pos++;
      continue;
    }
    // номер будинку можна не називати («з Приходька») — але не тоді, коли названо інший номер
    if (NUMBER_RE.test(word) && !entry.strictNumbers && last >= 0 && !(tok && NUMBER_RE.test(tok.n))) continue;
    return null;
  }
  return last >= 0 ? last : null;
}

/** Назва зупинки, що починається зі слова `i` питання; з кількох — та, що покриває найбільше слів */
export function matchStopPlace(index: StopPlace[], toks: Token[], i: number): StopMatch | null {
  let best: StopMatch | null = null;
  for (const entry of index) {
    const end = matchFrom(entry, toks, i);
    if (end != null && (!best || end > best.end)) best = { entry, end };
  }
  return best;
}
