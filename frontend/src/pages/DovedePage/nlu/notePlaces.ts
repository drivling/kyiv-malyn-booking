/**
 * Місця в примітці водія («заберу з вокзалу», «до Академмістечка») — тим самим словником, що й питання людини.
 * Потрібно попуткам серед варіантів «Доведе» (де сісти / де висадять) і підрахунку «Звідки забирають» в адмінці.
 *
 * Правила — з архіву приміток за 90 днів (2026-11-16, ≈ 2700 оголошень Київ ↔ Малин):
 *  - місце в Малині шукаємо лише коли відомий напрямок оголошення (в «Київ → Житомир» «автостанція» — не малинська);
 *  - вулиці не рахуємо: «Житомирська», «Київська» у примітках — це траса й метро, а не вулиці Малина;
 *  - «вокзал» без слова «Малин» — малинський лише з прийменником свого кінця дороги («з вокзалу» в Малин → Київ,
 *    «до вокзалу» в Київ → Малин); з прийменником іншого кінця це київський вокзал, без прийменника — невідомо;
 *  - «заберу по місту» — водій підʼїде сам, їхати до центру не треба.
 */
import { kyivNotePoint } from '../data/kyiv';
import { normalizeWord } from './normalize';
import { parseLocal } from './parseLocal';
import { resolvePlace } from './places';
import type { StopPlace } from './stopPlaces';

/** Напрямок оголошення відносно Малина */
export type NoteDir = 'from_malyn' | 'to_malyn';

export interface NotePlaces {
  /** id місця в Малині (не саме місто); null — не названо */
  malyn: string | null;
  /** id точки в Києві (`kyiv.*`); null — не названо */
  kyiv: string | null;
  /** «заберу по місту»: місце посадки в Малині — де домовитесь */
  door: boolean;
}

// розбору потрібен «сьогоднішній день» лише для дат — місцям він байдужий
const ANY_DAY = { date: '2026-01-01', mins: 0 };
const VOKZAL = 'malyn.vokzal';

/** Напрямок за ключем маршруту оголошення: «Malyn-Kyiv-Irpin» → from_malyn; маршрут без Малина на кінці → null */
export function noteDirOf(route: string | null | undefined): NoteDir | null {
  const r = route ?? '';
  if (r.startsWith('Malyn-')) return 'from_malyn';
  if (/^[A-Za-z]+-Malyn(-|$)/.test(r)) return 'to_malyn';
  return null;
}

export function placesInNote(note: string | null | undefined, stops: StopPlace[] = [], dir: NoteDir | null = null): NotePlaces {
  const text = (note ?? '').trim();
  if (!text) return { malyn: null, kyiv: null, door: false };
  const n = normalizeWord(text);
  const door = /по\s+місту/.test(n);
  let kyiv = kyivNotePoint(text);
  let malyn: string | null = null;
  if (dir) {
    const { intent } = parseLocal(text, ANY_DAY, stops);
    const places = [intent.from, intent.to].map((s) => (s ? resolvePlace(s.id) : null));
    malyn = places.find((p) => p && p.city === 'Malyn' && !p.isCity && !p.id.startsWith('street.'))?.id ?? null;
    if (malyn === VOKZAL && !n.includes('малин')) {
      const leaving = /(^|[^а-яіїєґ])(з|із|від)\s+вокзал/.test(n);
      const arriving = /(^|[^а-яіїєґ])(до|на)\s+вокзал/.test(n);
      const own = dir === 'from_malyn' ? leaving : arriving;
      const other = dir === 'from_malyn' ? arriving : leaving;
      if (!own) {
        malyn = null;
        if (other && !kyiv) kyiv = 'kyiv.pas';
      }
    }
  }
  return { malyn, kyiv, door };
}
