/**
 * «Звідки забирають попутки» (Docs/dovede-roadmap.md): примітки водіїв з архіву → які місця в Малині й Києві
 * вони називають і як часто. Розбір — тим самим словником, що й на сторінці «Доведе» (nlu/notePlaces), тож цифри
 * показують рівно те, що побачить людина у варіанті-попутці. Чиста функція над відповіддю GET /admin/dovede/pickups.
 */
import { KYIV_POINTS } from '@/pages/DovedePage/data/kyiv';
import { placeLabel } from '@/pages/DovedePage/nlu/gazetteer';
import { placesInNote } from '@/pages/DovedePage/nlu/notePlaces';
import { resolvePlace, setStopPlaces } from '@/pages/DovedePage/nlu/places';
import { buildStopPlaces, type StopLike } from '@/pages/DovedePage/nlu/stopPlaces';
import type { DovedePickups } from '@/types';

export interface PickupCount {
  label: string;
  count: number;
}

export interface PickupTally {
  route: string;
  /** оголошень водіїв за період */
  total: number;
  /** з приміткою */
  withNote: number;
  /** з місцем у Малині / у Києві */
  malynNamed: number;
  kyivNamed: number;
  malyn: PickupCount[];
  kyiv: PickupCount[];
  /** примітки, де жодного місця не впізнано: найчастіші першими */
  unrecognised: Array<{ note: string; count: number }>;
}

function bump(map: Map<string, number>, label: string, by: number): void {
  map.set(label, (map.get(label) ?? 0) + by);
}

function sorted(map: Map<string, number>): PickupCount[] {
  return [...map].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'uk'));
}

export function tallyPickups(data: DovedePickups, stops: StopLike[], unrecognisedShown = 15): PickupTally[] {
  const index = buildStopPlaces(stops);
  setStopPlaces(index);
  return data.routes.map((r) => {
    const malyn = new Map<string, number>();
    const kyiv = new Map<string, number>();
    const unrecognised: Array<{ note: string; count: number }> = [];
    let malynNamed = 0;
    let kyivNamed = 0;
    for (const n of data.notes) {
      if (n.route !== r.route) continue;
      const found = placesInNote(n.note, index);
      const m = found.malyn ? resolvePlace(found.malyn) : undefined;
      if (m) {
        bump(malyn, placeLabel(m), n.count);
        malynNamed += n.count;
      }
      const k = found.kyiv ? KYIV_POINTS[found.kyiv] : undefined;
      if (k) {
        bump(kyiv, k.label, n.count);
        kyivNamed += n.count;
      }
      if (!m && !k) unrecognised.push({ note: n.note, count: n.count });
    }
    return {
      route: r.route,
      total: r.total,
      withNote: r.withNote,
      malynNamed,
      kyivNamed,
      malyn: sorted(malyn),
      kyiv: sorted(kyiv),
      unrecognised: unrecognised.sort((a, b) => b.count - a.count || a.note.localeCompare(b.note, 'uk')).slice(0, unrecognisedShown),
    };
  });
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—';
}
