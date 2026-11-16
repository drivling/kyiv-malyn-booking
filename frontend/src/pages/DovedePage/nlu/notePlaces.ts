/**
 * Місця в примітці водія («заберу з вокзалу», «до Академмістечка») — тим самим словником, що й питання людини.
 * Потрібно попуткам серед варіантів «Доведе» (де сісти / де висадять) і підрахунку «Звідки забирають» в адмінці.
 */
import { kyivPointForPlace } from '../data/kyiv';
import { parseLocal } from './parseLocal';
import { resolvePlace } from './places';
import type { StopPlace } from './stopPlaces';

export interface NotePlaces {
  /** id місця в Малині (не саме місто); null — не названо */
  malyn: string | null;
  /** id точки в Києві (`kyiv.*`); null — не названо */
  kyiv: string | null;
}

// розбору потрібен «сьогоднішній день» лише для дат — місцям він байдужий
const ANY_DAY = { date: '2026-01-01', mins: 0 };

export function placesInNote(note: string | null | undefined, stops: StopPlace[] = []): NotePlaces {
  const text = (note ?? '').trim();
  if (!text) return { malyn: null, kyiv: null };
  const { intent } = parseLocal(text, ANY_DAY, stops);
  const places = [intent.from, intent.to].map((s) => (s ? resolvePlace(s.id) : null));
  const malyn = places.find((p) => p && p.city === 'Malyn' && !p.isCity)?.id ?? null;
  const kyiv = places.find((p) => p && p.city === 'Kyiv' && !p.isCity)?.id ?? kyivPointForPlace(text);
  return { malyn, kyiv };
}
