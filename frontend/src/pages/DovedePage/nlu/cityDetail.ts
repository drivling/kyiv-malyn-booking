/**
 * «Місце словами» в далекому місті (Київ, Житомир, Коростень): прийменники, межі назви й форма, у якій сторінка шле її серверу
 * («на Польову 12» → «Польова 12»). Цим користується `parseLocal`, а `detailForm` відповідає на питання «що надіслала
 * б сторінка» без повного розбору — для обходу, що наповнює базу доріг містом (`backend/src/dovede/crawl-core.ts`).
 * Побайтова копія — `backend/src/dovede/cityDetail.ts` (тест `cityDetail.test.ts` порівнює файли): міняйте обидва.
 */
import { findPlaceByToken } from './gazetteer';
import { matchMetro } from './kyivMetro';
import { matchRing } from './kyivRing';
import { tokenize, type Token } from './normalize';

export const FROM_PREPS = new Set(['з', 'із', 'зі', 'від', 'с', 'со', 'из', 'от']);
export const TO_PREPS = new Set(['до', 'в', 'у', 'на', 'к', 'во']);
/** Слова між прийменником і місцем: «до метро Житомирська», «на вул. Грушевського» */
export const FILLERS = new Set(['метро', 'м', 'ст', 'станції', 'станція', 'станции', 'станция', 'зупинки', 'зупинка', 'остановки', 'вул', 'вулиці', 'вулиця', 'улицы', 'район', 'мікрорайон', 'місто', 'міста', 'город', 'города', 'смт', 'платформи', 'платформа']);
export const HOUR_PREPS = new Set(['о', 'об', 'в', 'на', 'до', 'к', 'після', 'после']);

/** Прийменник перед словом i (з пропуском «метро», «вул.»…) — або null */
export function prepBefore(toks: Token[], i: number): Token | null {
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const t = toks[j];
    if (FROM_PREPS.has(t.n) || TO_PREPS.has(t.n)) return t;
    if (!FILLERS.has(t.n)) return null;
  }
  return null;
}

/** Міста, де «Доведе» веде далі до місця, названого словами (сервер: dovede/city-route.ts) */
export type FarCityId = 'city.Kyiv' | 'city.Zhytomyr' | 'city.Korosten';
export const FAR_CITY_RE: Array<[RegExp, FarCityId]> = [
  [/^(київ|києва|києву|киев|киева|киеву)$/, 'city.Kyiv'],
  [/^(житомир|житомира|житомиру)$/, 'city.Zhytomyr'],
  [/^(коростень|коростеня|коростеню)$/, 'city.Korosten'],
];
export const DETAIL_TO_PREPS = new Set(['на', 'до', 'біля', 'коло', 'возле', 'около', 'к']);
export const DETAIL_FROM_PREPS = new Set(['з', 'із', 'зі', 'від', 'с', 'со', 'из', 'от']);
export const STREET_WORDS = new Set(['вул', 'вулиця', 'вулицю', 'вулиці', 'улица', 'улицу', 'улицы', 'проспект', 'просп', 'площа', 'площу', 'площі', 'провулок', 'бульвар']);
/** Слова, які після міста означають час, транспорт чи саме питання, а не місце в місті */
export const NOT_DETAIL_RE =
  /^(завтра|сьогодн|сегодн|післязавтр|послезавтр|зараз|сейчас|найближч|ближайш|понеділ|понедел|вівтор|вторн|серед|сред|четвер|п'ятниц|пятниц|субот|неділ|воскрес|ранок|ранку|зранку|вранц|утр|вечір|вечор|вечер|ввечер|обід|обед|вдень|днем|ноч|вихідн|выходн|годин|хвилин|минут|тижд|недел|маршрут|зубаст|електрич|електріч|электрич|кільцев|кольцев|експрес|экспресс|потяг|поїзд|поезд|автобус|попутк|попутн|блаблакар|машин|таксі|такси|коли|когда|скільки|сколько|кошту|стоит|ціна|цена|можна|можно|треба|надо|потрібно|нужно|доїхати|доехать|добратися|добраться|їхати|ехать|роботу|работу|навчання|учебу|гості|гости|справах|делам)|^(ніч|ночі|час|день|дня|авто|як|как|чим|чем|city|express|сіті|сити|міською|городской|малин[ауі]?|малине|київ|києв[аіу]|киев[ауе]?|житомир[ауі]?|житомире|коростен[ьяі])$/;
/** «на автовокзал» у Житомирі, «на вокзал» у Коростені — туди рейс і так приходить: це не окреме місце */
export const STATION_WORD_RE = /^(автовокзал|автостанц|вокзал)/;

/**
 * «на Польову» → «Польова», «до обласної лікарні» → «обласна лікарня»: назву показуємо й шукаємо в називному.
 * Лише найчастіші закінчення жіночого роду; решту лишаємо, як написано (Google відмінки розуміє).
 */
export function nominative(word: string): string {
  if (word.length < 5 || /^\d/.test(word)) return word;
  if (/(ої|ой)$/i.test(word)) return word.replace(/(ої|ой)$/i, 'а');
  if (/(ську|цьку|зьку|[вн]у)$/i.test(word)) return `${word.slice(0, -1)}а`;
  if (/[цн]ю$/i.test(word)) return `${word.slice(0, -1)}я`;
  if (/[цн]і$/i.test(word)) return `${word.slice(0, -1)}я`;
  // «на площу», «до площі» → «площа»
  if (/щ[уі]$/i.test(word)) return `${word.slice(0, -1)}а`;
  return word;
}

export interface FarDetail {
  role: 'from' | 'to';
  cityId: FarCityId;
  /** слова людини про місце; порожньо — «на автовокзал» (слова прибрано, місця немає) */
  text: string;
  start: number;
  end: number;
  /** індекси слів, які основний розбір не має бачити */
  skip: Set<number>;
}

/**
 * «в Житомир на Польову 12», «з Житомира з Покровської», «у Київ до Охматдиту»: слова одразу після назви
 * далекого міста, яких словник не знає, — місце всередині нього. Відоме місце (метро, вокзал Києва) лишається
 * звичайному розбору.
 */
export function farDetails(text: string, toks: Token[], known: (i: number, cityId: FarDetail['cityId']) => boolean): FarDetail[] {
  const out: FarDetail[] = [];
  for (let i = 0; i < toks.length; i++) {
    const cityId = FAR_CITY_RE.find(([re]) => re.test(toks[i].n))?.[1];
    if (!cityId) continue;
    const prep = prepBefore(toks, i);
    if (!prep) continue;
    const role: 'from' | 'to' = FROM_PREPS.has(prep.n) ? 'from' : 'to';
    let j = i + 1;
    const lead = toks[j];
    if (!lead) continue;
    const preps = role === 'to' ? DETAIL_TO_PREPS : DETAIL_FROM_PREPS;
    if (preps.has(lead.n)) j++;
    else if (!STREET_WORDS.has(lead.n)) continue;
    const first = j;
    let words = 0;
    while (j < toks.length && j - first < 5) {
      const t = toks[j];
      const isNumber = /^\d/.test(t.n);
      if (isNumber) {
        // номер будинку — одне число після назви; «на 8 ранку», «о 18:00» — це час
        if (!words || /[:.]/.test(t.n) || (toks[j + 1] && /^(ранку|вечора|годин|утра|вечера|дня|ночі|ночи)/.test(toks[j + 1].n))) break;
        j++;
        break;
      }
      if (FROM_PREPS.has(t.n) || TO_PREPS.has(t.n) || HOUR_PREPS.has(t.n)) break;
      if (NOT_DETAIL_RE.test(t.n)) break;
      if (!STREET_WORDS.has(t.n)) {
        if (known(j, cityId)) break;
        words++;
      }
      j++;
    }
    if (!words) continue;
    const skip = new Set<number>();
    for (let k = i + 1; k < j; k++) skip.add(k);
    // після прийменника слова стоять у непрямому відмінку; «вул. Київська 77» без нього — вже в називному
    const said = text.slice(toks[first].start, toks[j - 1].end).replace(/\s+/g, ' ').trim();
    const body = first > i + 1 ? said.replace(/[\p{L}'’ʼ]+/gu, nominative) : said;
    // у Коростені рейс приходить на залізничний вокзал; автостанція там — окреме місце
    const station = words === 1 && (cityId === 'city.Zhytomyr' ? STATION_WORD_RE.test(toks[j - 1].n) : cityId === 'city.Korosten' && /^вокзал/.test(toks[j - 1].n));
    out.push({ role, cityId, text: station ? '' : body, start: toks[i + 1].start, end: toks[j - 1].end, skip });
  }
  return out;
}

/**
 * Слово `i` — місце, яке словник Києва знає сам (місце словника, станція метро чи міської електрички; «вокзал» у
 * Києві — Київ-Пасажирський): на ньому «місце словами» закінчується. Синоніми з адмінки `parseLocal` додає окремо.
 */
export function kyivKnown(toks: Token[], i: number): boolean {
  const place = findPlaceByToken(toks[i].n);
  return Boolean(place && (place.city === 'Kyiv' || place.id === 'malyn.vokzal')) || Boolean(matchMetro(toks, i)) || Boolean(matchRing(toks, i));
}

export type DetailCity = 'Kyiv' | 'Zhytomyr' | 'Korosten';

const CITY_GENITIVE: Record<DetailCity, string> = { Kyiv: 'Києва', Zhytomyr: 'Житомира', Korosten: 'Коростеня' };

/**
 * Що сторінка надіслала б серверу як місце в місті на питання «з Малина до <міста> до <name>» (`detail` розбору);
 * null — такого місця словами немає: місце сторінка знає сама (метро, вокзал, електричка) або назва не читається.
 * Без синонімів з адмінки — як розбір без них. Рівність із `parseLocal` перевіряє `cityDetail.test.ts`.
 */
export function detailForm(city: DetailCity, name: string): string | null {
  const text = `з Малина до ${CITY_GENITIVE[city]} до ${name}`;
  const toks = tokenize(text);
  const cityId: FarCityId = `city.${city}`;
  const details = farDetails(text, toks, (i, id) => id === 'city.Kyiv' && kyivKnown(toks, i));
  const detail = details.find((d) => d.role === 'to' && d.text && d.cityId === cityId);
  if (!detail) return null;
  // Слова назви після «місця словами» (шосте слово, слово за номером будинку, відоме місце) розбір читає далі.
  // Місце з того самого міста чи місце після «до / в / на» стає новим «куди» — тоді сторінка місця словами не шле
  const hidden = new Set<number>();
  for (const d of details) d.skip.forEach((k) => hidden.add(k));
  const rest = toks.filter((_, k) => !hidden.has(k));
  for (let k = 4; k < rest.length; k++) {
    const place = findPlaceByToken(rest[k].n);
    const station = matchMetro(rest, k) != null || matchRing(rest, k) != null;
    if ((station && city === 'Kyiv') || (place && place.city === city && !place.isCity)) return null;
    const prep = prepBefore(rest, k);
    if ((place || station) && prep && TO_PREPS.has(prep.n)) return null;
  }
  return detail.text.trim() || null;
}
