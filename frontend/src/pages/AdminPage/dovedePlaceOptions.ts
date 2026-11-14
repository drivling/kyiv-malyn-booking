/**
 * Місця «Доведе» для вибору в адмінці (синонім → місце): кураторський словник, зупинки міста, орієнтири, вулиці.
 * Пошук — за всіма словами запиту в назві, без огляду на регістр.
 */
import { PLACES, placeLabel } from '@/pages/DovedePage/nlu/gazetteer';
import { LANDMARKS } from '@/pages/DovedePage/nlu/landmarks';
import { normalizeWord } from '@/pages/DovedePage/nlu/normalize';
import { buildStopPlaces, type StopLike } from '@/pages/DovedePage/nlu/stopPlaces';
import { STREETS } from '@/pages/DovedePage/nlu/streets';

export interface PlaceOption {
  id: string;
  label: string;
  /** що це: «район», «зупинка», «аптека», «вулиця» */
  hint: string;
  /** нормалізований рядок для пошуку */
  search: string;
}

const option = (id: string, label: string, hint: string, extra = ''): PlaceOption => ({ id, label, hint, search: normalizeWord(`${label} ${extra} ${id}`) });

export function placeOptions(stops: StopLike[]): PlaceOption[] {
  return [
    ...PLACES.map((p) => option(p.id, placeLabel(p), p.isCity ? 'місто' : 'місце', p.stems.join(' '))),
    ...buildStopPlaces(stops).map((e) => option(e.place.id, e.place.label, 'зупинка')),
    ...LANDMARKS.map((l) => option(l.id, l.label, l.address ? `${l.kind} · ${l.address}` : l.kind, l.said.join(' '))),
    ...STREETS.map((s) => option(s.id, s.label, s.kind, s.old.join(' '))),
  ];
}

/** Місця, у назві яких є всі слова запиту; порожній запит — нічого */
export function searchPlaceOptions(options: PlaceOption[], query: string, limit = 8): PlaceOption[] {
  const words = normalizeWord(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: PlaceOption[] = [];
  for (const o of options) {
    if (words.every((w) => o.search.includes(w))) out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}
