/**
 * Підказки при наборі (Docs/dovede-roadmap.md, фаза 3): доповнюють слово під курсором місцем зі словника —
 * не готове питання, а один «аргумент» речення. Вставляється форма, що пасує до прийменника: «з Царського
 * села», «на автостанцію». Кожну форму розуміє parseLocal (тест `suggest.test.ts`).
 */
import { PLACES, placeLabel, type GazetteerPlace } from '../nlu/gazetteer';
import { normalizeWord } from '../nlu/normalize';

/** [родовий («з / до чого»), знахідний («в / на що»)]; немає — вставляється назва як є */
const FORMS: Record<string, [string, string]> = {
  'kyiv.sviatoshyn': ['Святошина', 'Святошин'],
  'kyiv.akadem': ['Академмістечка', 'Академмістечко'],
  'kyiv.borshch': ['Борщагівки', 'Борщагівку'],
  'kyiv.pas': ['вокзалу в Києві', 'вокзал у Києві'],
  'kyiv.zhytomyrska': ['метро Житомирська', 'метро Житомирська'],
  'malyn.malynivskyi-krug': ['Малинівського кругу', 'Малинівський круг'],
  'malyn.malynivka': ['Малинівки', 'Малинівку'],
  'malyn.avtostantsiya': ['автостанції', 'автостанцію'],
  'malyn.vokzal': ['вокзалу', 'вокзал'],
  'malyn.tsentr': ['центру', 'центр'],
  'malyn.ptl': ['ПТЛ', 'ПТЛ'],
  'malyn.likarnia': ['лікарні', 'лікарню'],
  'malyn.tsarske': ['Царського села', 'Царське село'],
  'malyn.yurivka': ['Юрівки', 'Юрівку'],
  'malyn.paperova': ['паперової фабрики', 'паперову фабрику'],
  'malyn.hrushevskoho': ['Грушевського', 'Грушевського'],
  'malyn.barmina': ['Барміна', 'Барміна'],
  'malyn.lisotekhnikum': ['Лісотехнікуму', 'Лісотехнікум'],
  'malyn.prozhektor': ['Прожектора', 'Прожектор'],
  'city.Zhytomyr': ['Житомира', 'Житомир'],
  'city.Korosten': ['Коростеня', 'Коростень'],
  'city.Bucha': ['Бучі', 'Бучу'],
  'city.Malyn': ['Малина', 'Малин'],
  'city.Kyiv': ['Києва', 'Київ'],
};

const GENITIVE_PREPS = new Set(['з', 'із', 'зі', 'від', 'до', 'с', 'со', 'из', 'от']);
const ACCUSATIVE_PREPS = new Set(['в', 'у', 'на', 'во']);
const WORD_CHAR = /[\p{L}'’ʼ]/u;
const MAX_SUGGESTIONS = 4;

export type PlaceCase = 'nom' | 'gen' | 'acc';

export function placeForm(place: GazetteerPlace, kase: PlaceCase): string {
  const f = FORMS[place.id];
  if (!f || kase === 'nom') return place.id === 'kyiv.pas' ? 'вокзал у Києві' : place.label;
  return kase === 'gen' ? f[0] : f[1];
}

export interface PlaceSuggestion {
  place: GazetteerPlace;
  /** «Київ · Святошин» */
  label: string;
  /** текст, що стане на місце слова */
  insert: string;
  /** межі слова під курсором у тексті */
  start: number;
  end: number;
}

/** Слово, у якому (або одразу після якого) стоїть курсор */
function wordAt(text: string, caret: number): { start: number; end: number } | null {
  let start = caret;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  return end > start ? { start, end } : null;
}

function prevWord(text: string, start: number): string {
  const m = /([\p{L}'’ʼ]+)[^\p{L}]*$/u.exec(text.slice(0, start));
  return m ? normalizeWord(m[1]) : '';
}

/** Місця, якими можна доповнити слово під курсором (≥ 2 літер); порожньо — підказувати нічого */
export function suggestPlaces(text: string, caret: number): PlaceSuggestion[] {
  const w = wordAt(text, caret);
  if (!w) return [];
  const typed = normalizeWord(text.slice(w.start, caret));
  if (typed.length < 2 || GENITIVE_PREPS.has(typed) || ACCUSATIVE_PREPS.has(typed)) return [];
  const prev = prevWord(text, w.start);
  const kase: PlaceCase = GENITIVE_PREPS.has(prev) ? 'gen' : ACCUSATIVE_PREPS.has(prev) ? 'acc' : 'nom';
  const whole = normalizeWord(text.slice(w.start, w.end));

  const out: PlaceSuggestion[] = [];
  for (const place of PLACES) {
    const hit =
      place.stems.some((s) => s.startsWith(typed) || typed.startsWith(s)) ||
      normalizeWord(place.label).startsWith(typed) ||
      (place.exact?.includes(typed) ?? false);
    if (!hit) continue;
    const insert = placeForm(place, kase);
    out.push({ place, label: placeLabel(place), insert, start: w.start, end: w.end });
  }
  // єдиний кандидат, який людина вже дописала сама, — підказувати нічого
  if (out.length === 1 && normalizeWord(out[0].insert) === whole) return [];
  return out.slice(0, MAX_SUGGESTIONS);
}

/** Текст із підставленим місцем і позиція курсора після нього */
export function applySuggestion(text: string, s: PlaceSuggestion): { text: string; caret: number } {
  const after = text.slice(s.end);
  const gap = after.startsWith(' ') || after === '' ? '' : ' ';
  const head = `${text.slice(0, s.start)}${s.insert}${after === '' ? ' ' : gap}`;
  return { text: head + after, caret: head.length };
}
