/**
 * Вулиці, будинки й орієнтири Коростеня (Docs/dovede-learning-roadmap.md, кроки 7а і 7б): адресу («Грушевського 22»)
 * чи заклад («АТБ», «школа 5»), названі словами, шукаємо у своїх даних і ведемо своїм планувальником — без запиту до
 * сервера. Дані — знімок OpenStreetMap (`data/korosten-streets.json`, `data/korosten-landmarks.json`; генератори в
 * `data/korosten-transport/dovede-streets/` і `dovede-landmarks/`); вантажаться окремим шматком, коли сторінці
 * потрібен Коростень. Орієнтири Коростеня мають id `klm.…`. Id вулиць Коростеня — `kstreet.…` (у Малина `street.…`: назви вулиць
 * у містах збігаються). У намірі й адресі сторінки кінець лишається `city.Korosten` + слова: точку шукаємо щоразу з
 * тих самих слів, тож номер будинку в адресу не потрапляє.
 */
import type { GazetteerPlace } from '../nlu/gazetteer';
import { tokenize, type Token } from '../nlu/normalize';
import { createLandmarkIndex, landmarkPlace, setExtraLandmarks, type Landmark } from '../nlu/landmarks';
import { createStreetIndex, setExtraStreets, streetPlace, streetPlaceId, type Street } from '../nlu/streets';

let index: ReturnType<typeof createStreetIndex> | null = null;
let landmarks: ReturnType<typeof createLandmarkIndex> | null = null;
let loading: Promise<void> | null = null;

/** Для тестів і завантажувача: вулиці як у файлі генератора (id `street.…` стають `kstreet.…`) */
export function setKorostenStreets(streets: Street[]): void {
  const own = streets.map((s) => ({ ...s, id: s.id.replace(/^street\./, 'kstreet.') }));
  setExtraStreets(own);
  index = own.length ? createStreetIndex(own) : null;
}

/** Для тестів і завантажувача: орієнтири як у файлі генератора (id `lm.…` стають `klm.…`) */
export function setKorostenLandmarks(list: Landmark[]): void {
  const own = list.map((l) => ({ ...l, id: l.id.replace(/^lm\./, 'klm.') }));
  setExtraLandmarks(own);
  landmarks = own.length ? createLandmarkIndex(own) : null;
}

/** Завантажити дані (один раз); без мережі чи з помилкою адреси просто не знаходяться — відповість сервер */
export function loadKorostenStreets(): Promise<void> {
  loading ??= Promise.all([import('../data/korosten-streets.json'), import('../data/korosten-landmarks.json')])
    .then(([s, l]) => {
      setKorostenStreets((s.default as unknown as { streets: Street[] }).streets);
      setKorostenLandmarks((l.default as unknown as { landmarks: Landmark[] }).landmarks);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

const STREET_LEAD = /^(вул|вулиц|улиц|ул|пров|переул|площ|просп|бульв|набережн|узвіз)/;

/**
 * Слова людини про місце → місце з точкою, або null — це не адреса з наших даних. Адреса має покривати всі слова:
 * «Грушевського 22», «вулиця Шевченка»; «магазин на Грушевського» — не адреса, таке питаємо в сервера.
 */
export function korostenSpot(words: string): GazetteerPlace | null {
  const toks = tokenize(words);
  if (!toks.length) return null;
  return addressSpot(toks) ?? landmarkSpot(toks);
}

function addressSpot(toks: Token[]): GazetteerPlace | null {
  if (!index) return null;
  let i = 0;
  // «вулиця Г. Сковороди», «вул. І. Франка»: ініціал перед назвою пропускаємо — у даних вулиця без нього
  while (i < toks.length - 1 && (STREET_LEAD.test(toks[i].n) || (i > 0 && /^\p{L}$/u.test(toks[i].n)))) i++;
  const m = index.match(toks, i);
  if (!m) return null;
  // після адреси можуть лишитись лише слова типу вулиці («Шевченка вулиця»)
  for (let k = m.end + 1; k < toks.length; k++) if (!STREET_LEAD.test(toks[k].n)) return null;
  return streetPlace(streetPlaceId(m)) ?? null;
}

/** Заклад: назва має покривати всі слова людини («АТБ», «школа 5»); «магазин біля АТБ» — не назва, таке питаємо в сервера */
function landmarkSpot(toks: Token[]): GazetteerPlace | null {
  const m = landmarks?.match(toks, 0);
  if (!m || m.end !== toks.length - 1) return null;
  return landmarkPlace(m.landmark.id) ?? null;
}
