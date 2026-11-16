/**
 * Орієнтири без зупинки (Docs/dovede-roadmap.md, фаза 4): «до АТБ», «в пенсійний», «на ринок», «до садка 8».
 * Як і адреса, орієнтир — точка на карті: планувальник сам доведе пішки до найближчих зупинок. Дані — знімок
 * OpenStreetMap і ручні назви (`data/malyn-landmarks.json`, генератор
 * `data/malyn-transport/dovede-landmarks/build.py`). Зупинка чи місце кураторського словника з такою самою
 * назвою має перевагу: туди їде автобус.
 */
import landmarksDoc from '../data/malyn-landmarks.json';
import { findPlaceByToken, type GazetteerPlace } from './gazetteer';
import { tokenize, type Token } from './normalize';
import { wordMatchesName } from './stopPlaces';

export interface Landmark {
  id: string;
  /** рід місця: «аптека», «установа» */
  kind: string;
  name: string;
  /** підпис для людини: «аптека Нікон 3» */
  label: string;
  /** як це місце кличуть; перша — повна назва */
  said: string[];
  lat: number;
  lng: number;
  address?: string;
  /** скільки ще місць у місті кличуть так само */
  twins?: number;
}

export const LANDMARKS = (landmarksDoc as unknown as { landmarks: Landmark[] }).landmarks;
const BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));

const NUMBER_RE = /^\d+$/;

interface NameVariant {
  landmark: Landmark;
  words: string[];
}

function nameWords(name: string): string[] {
  return tokenize(name).map((t) => t.n);
}

/** Слово назви проти слова питання; у назві з кількох слів коротке слово теж відмінюється («нової пошти») */
function wordFits(word: string, token: string, multi: boolean): boolean {
  if (multi && word.length === 4 && !NUMBER_RE.test(word)) return token.startsWith(word.slice(0, 3)) && token.length <= 6;
  return wordMatchesName(word, token);
}

/** Усі назви всіх орієнтирів; довші — першими, серед однакових — за id (ближчий до центру з однойменних) */
const VARIANTS: NameVariant[] = LANDMARKS.flatMap((landmark) => landmark.said.map((n) => ({ landmark, words: nameWords(n) })))
  .filter((v) => v.words.some((w) => !NUMBER_RE.test(w)))
  .sort((a, b) => b.words.length - a.words.length || (a.landmark.id < b.landmark.id ? -1 : a.landmark.id > b.landmark.id ? 1 : 0));

export interface LandmarkMatch {
  landmark: Landmark;
  /** індекс останнього слова питання, що належить назві */
  end: number;
  /** сказано дослівно, як у назві («дружба народів»), а не схожим словом («теремки» ↔ «Теремок») */
  exact: boolean;
}

/**
 * Орієнтир, назва якого починається зі слова `i` (усі слова назви поспіль, у будь-якому відмінку). Назву з одного
 * слова, яке вже означає місце кураторського словника («вокзал», «Малин»), не беремо.
 */
export function matchLandmark(toks: Token[], i: number): LandmarkMatch | null {
  let best: NameVariant | null = null;
  for (const v of VARIANTS) {
    if (best && v.words.length < best.words.length) break;
    if (!v.words.every((w, k) => toks[i + k] && wordFits(w, toks[i + k].n, v.words.length > 1))) continue;
    if (v.words.length === 1 && findPlaceByToken(toks[i].n)) continue;
    // серед назв однакової довжини — та, що сказана дослівно («Копійочка», а не «Копійка»)
    if (v.words.every((w, k) => toks[i + k].n === w)) return { landmark: v.landmark, end: i + v.words.length - 1, exact: true };
    best ??= v;
  }
  return best ? { landmark: best.landmark, end: i + best.words.length - 1, exact: false } : null;
}

export function landmarkById(id: string): Landmark | undefined {
  return BY_ID.get(id);
}

/** Місце словника для орієнтира (`lm.atb-market`): без зупинок, з точкою */
export function landmarkPlace(id: string): GazetteerPlace | undefined {
  const l = BY_ID.get(id);
  return l ? { id, city: 'Malyn', label: l.label, stems: [], latLng: [l.lat, l.lng] } : undefined;
}
