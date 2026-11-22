/**
 * Вулиці й будинки Коростеня (Docs/dovede-learning-roadmap.md, крок 7а): адресу, названу словами («Грушевського 22»),
 * шукаємо у своїх даних і ведемо своїм планувальником — без запиту до сервера. Дані — знімок OpenStreetMap
 * (`data/korosten-streets.json`, генератор `data/korosten-transport/dovede-streets/build.py`); вантажаться окремим
 * шматком, коли сторінці потрібен Коростень. Id вулиць Коростеня — `kstreet.…` (у Малина `street.…`: назви вулиць
 * у містах збігаються). У намірі й адресі сторінки кінець лишається `city.Korosten` + слова: точку шукаємо щоразу з
 * тих самих слів, тож номер будинку в адресу не потрапляє.
 */
import type { GazetteerPlace } from '../nlu/gazetteer';
import { tokenize } from '../nlu/normalize';
import { createStreetIndex, setExtraStreets, streetPlace, streetPlaceId, type Street } from '../nlu/streets';

let index: ReturnType<typeof createStreetIndex> | null = null;
let loading: Promise<void> | null = null;

/** Для тестів і завантажувача: вулиці як у файлі генератора (id `street.…` стають `kstreet.…`) */
export function setKorostenStreets(streets: Street[]): void {
  const own = streets.map((s) => ({ ...s, id: s.id.replace(/^street\./, 'kstreet.') }));
  setExtraStreets(own);
  index = own.length ? createStreetIndex(own) : null;
}

/** Завантажити дані (один раз); без мережі чи з помилкою адреси просто не знаходяться — відповість сервер */
export function loadKorostenStreets(): Promise<void> {
  loading ??= import('../data/korosten-streets.json')
    .then((m) => setKorostenStreets((m.default as unknown as { streets: Street[] }).streets))
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
  if (!index) return null;
  const toks = tokenize(words);
  let i = 0;
  while (i < toks.length - 1 && STREET_LEAD.test(toks[i].n)) i++;
  if (i >= toks.length) return null;
  const m = index.match(toks, i);
  if (!m) return null;
  // після адреси можуть лишитись лише слова типу вулиці («Шевченка вулиця»)
  for (let k = m.end + 1; k < toks.length; k++) if (!STREET_LEAD.test(toks[k].n)) return null;
  return streetPlace(streetPlaceId(m)) ?? null;
}
