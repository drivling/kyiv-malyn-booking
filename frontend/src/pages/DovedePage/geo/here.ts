/**
 * «Доведе» · місце «де ви зараз» (Docs/dovede-geo-roadmap.md, Г1): одне динамічне місце з id `here`, яке
 * `resolvePlace` віддає як звичайне місце з точкою — тож `classify` і `composeStories` ведуть від нього так само, як від
 * адреси («з вулиці такої-то, 12»). Координати живуть лише тут, у памʼяті вкладки: не в адресі сторінки, не в
 * localStorage, не на сервері.
 */
import type { GazetteerPlace } from '../nlu/gazetteer';
import { STREETS, type Street } from '../nlu/streets';
import { nearestAddress } from './nearestAddress';
import { IMPRECISE_M, locateCity, type GeoCity } from './zones';

export const HERE_ID = 'here';
/**
 * Коридор Малин ↔ Коростень веде коростенську частину від місця словами (`city.Korosten` + `detail`). Людина в Коростені:
 * `detail` — ця мітка, а не її адреса (адреса пішла б у посилання як `fd=`); точку бере сторінка з `herePlace()`.
 */
export const HERE_DETAIL = 'де я зараз';

export interface HereFix {
  lat: number;
  lng: number;
  accuracyM: number;
  city: GeoCity | 'far';
  /** найближча адреса з наших даних або null */
  address: string | null;
  imprecise: boolean;
  /** Date.now() визначення */
  at: number;
}

/** Точка браузера → місто й адреса. Вулиці Коростеня — ті, що вже завантажила сторінка (`extraStreets`) */
export function makeHereFix(lat: number, lng: number, accuracyM: number, at: number, extraStreets: readonly Street[] = []): HereFix {
  const where = locateCity(lat, lng);
  const imprecise = accuracyM > IMPRECISE_M;
  const streets = where.city === 'Malyn' ? STREETS : where.city === 'Korosten' ? extraStreets : [];
  const address = imprecise ? null : (nearestAddress(lat, lng, streets)?.label ?? null);
  return { lat, lng, accuracyM, city: where.city, address, imprecise, at };
}

let current: HereFix | null = null;

export function setHere(fix: HereFix | null): void {
  current = fix;
}

export function getHere(): HereFix | null {
  return current;
}

/** Підпис для «Розумію…»: «вул. Шевченка, 12 (ви тут)» чи «де ви зараз» */
export function hereLabel(fix: HereFix): string {
  return fix.address ? `${fix.address} (ви тут)` : fix.imprecise ? 'де ви зараз (приблизно)' : 'де ви зараз';
}

/** Місце `here` — лише в Малині й Коростені, де свій планувальник веде від точки пішки */
export function herePlace(): GazetteerPlace | undefined {
  if (!current || (current.city !== 'Malyn' && current.city !== 'Korosten')) return undefined;
  return { id: HERE_ID, city: current.city, label: hereLabel(current), stems: [], latLng: [current.lat, current.lng] };
}
