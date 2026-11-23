/**
 * Маршрути міських автобусів у питанні (Docs/dovede-roadmap.md, фаза 4): «автобус №5», «9-ка», «сімкою»,
 * «маршрут 11/1». Людина називає номер, який бачить на автобусі (`shortName`, інакше id); у намір іде id.
 * Число без жодної ознаки маршруту («о 5», «до 9») маршрутом не вважаємо — це час.
 */
import { normalizeWord } from './normalize';

export interface RouteLike {
  id: string;
  /** номер для показу: «11/1», «5» */
  no: string;
  fromName: string;
  toName: string;
}

export interface RouteMention {
  routeId: string;
  /** перед номером стояло «крім», «без», «тільки не» — цим маршрутом їхати не хочуть */
  avoid: boolean;
  start: number;
  end: number;
}

/** «№5», «номер 5», «маршрут 11/1», «автобус 9», «маршрутка 7» */
const MARKED_RE = /(?:№|#|(?:номер|маршрут|автобус)[\p{L}']*\s)\s*№?\s*(\d{1,2}(?:\/\d)?(?:-?[а-яіїєa-z])?)(?![\d:.\p{L}])/gu;
/** «2 маршрут», «5-й автобус», «12-го маршруту» */
const BEFORE_RE = /(?<![\d:.\p{L}])(\d{1,2}(?:\/\d)?)(?:-?(?:й|го|му|м|ий))?\s+(?:маршрут|автобус)/gu;
/** «9-ка», «5ку», «11-кою» */
const SUFFIX_RE = /(?<![\d:.\p{L}])(\d{1,2})\s?-?\s?(?:ка|ки|ку|кою|ці|кой|ке)(?![\p{L}'])/gu;
/** «сімка», «дев'яткою», «пятёрка» */
const WORD_STEMS: Array<[string[], string]> = [
  [['двійк', 'двойк'], '2'],
  [['трійк', 'тройк'], '3'],
  [["п'ятірк", 'пятірк', 'пятерк'], '5'],
  [['сімк', 'семерк'], '7'],
  [['вісімк', 'восьмерк'], '8'],
  [["дев'ятк", 'девятк'], '9'],
  [['десятк'], '10'],
  [['дванадцятк', 'двенадцатк'], '12'],
];
const WORD_RE = /[\p{L}][\p{L}']*/gu;

/**
 * «Дитячий садок №8», «ЗОШ №5», «гімназія №7», «Нова пошта №2»: номер закладу, а не маршрут. Слово перед «№» / «#» /
 * «номер» — з цього переліку (основи); «маршрут №5», «автобус №5» сюди не потрапляють.
 */
const PLACE_BEFORE_NO = /(?:^|[^\p{L}'])(садо?к\p{L}*|дитсад\p{L}*|днз|зош|нвк|школ\p{L}*|гімназ\p{L}*|гимназ\p{L}*|ліце\p{L}*|лице\p{L}*|колегіум\p{L}*|училищ\p{L}*|амбулатор\p{L}*|лікарн\p{L}*|больниц\p{L}*|поліклінік\p{L}*|поликлиник\p{L}*|пошт\p{L}*|почт\p{L}*|відділенн\p{L}*|отделени\p{L}*|магазин\p{L}*|аптек\p{L}*|гуртожит\p{L}*|общежит\p{L}*|будин\p{L}*|корпус\p{L}*|підʼїзд\p{L}*|під'їзд\p{L}*|кабінет\p{L}*|палат\p{L}*)\s*$/u;

/** «крім сімки», «окрім №5», «кроме девятки», «без 7-ки», «тільки не автобусом №3» — слова перед згадкою */
const AVOID_BEFORE_RE = /(?:^|[^\p{L}])(?:крім|окрім|кроме|опріч|без|не)(?:\s+(?:на|автобус\p{L}*|маршрут\p{L}*))?\s*$/u;

/** «2-Б», «2б», «2b» — той самий номер: без дефіса, латинська «b» як «б» (id маршруту Коростеня — «2b») */
const sameNo = (s: string) => s.toLowerCase().replace(/-/g, '').replace(/b/g, 'б');

function routeByNumber(routes: RouteLike[], shown: string): RouteLike | undefined {
  const n = sameNo(shown);
  return routes.find((r) => sameNo(r.no) === n) ?? routes.find((r) => sameNo(r.id) === n);
}

/** Усі згадки маршрутів у тексті, без перекриттів, у порядку появи */
export function findRouteMentions(text: string, routes: RouteLike[]): RouteMention[] {
  if (!routes.length) return [];
  // normalizeWord міняє символи один на один — позиції ті самі, що в тексті
  const t = normalizeWord(text);
  const found: RouteMention[] = [];
  const add = (shown: string, start: number, end: number) => {
    const route = routeByNumber(routes, shown);
    if (route && !found.some((m) => start < m.end && end > m.start)) found.push({ routeId: route.id, avoid: false, start, end });
  };
  for (const m of t.matchAll(MARKED_RE)) {
    // «школа №5» — номер закладу; «маршрут №5» починається словом-ознакою, тож сюди не потрапляє
    if (/^(?:№|#|номер)/u.test(m[0]) && PLACE_BEFORE_NO.test(t.slice(0, m.index ?? 0))) continue;
    add(m[1], m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of t.matchAll(BEFORE_RE)) add(m[1], m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const m of t.matchAll(SUFFIX_RE)) add(m[1], m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const m of t.matchAll(WORD_RE)) {
    const hit = WORD_STEMS.find(([stems]) => stems.some((s) => m[0].startsWith(s)));
    if (hit) add(hit[1], m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  found.sort((a, b) => a.start - b.start);
  // «крім 5 і 7»: заперечення стосується й наступного номера через «і», «та», кому
  found.forEach((m, i) => {
    const prev = found[i - 1];
    m.avoid = AVOID_BEFORE_RE.test(t.slice(0, m.start)) || (prev?.avoid === true && /^\s*(?:,|і|й|та|и|або|чи)?\s*$/u.test(t.slice(prev.end, m.start)));
  });
  return found;
}
