/**
 * «Звідки забирають попутки» (Docs/dovede-roadmap.md): примітки водіїв з архіву → які місця в Малині й Києві
 * вони називають і як часто. Розбір — тим самим словником, що й на сторінці «Доведе» (nlu/notePlaces), тож цифри
 * показують рівно те, що побачить людина у варіанті-попутці. Чиста функція над відповіддю GET /admin/dovede/pickups.
 */
import { KYIV_POINTS } from '@/pages/DovedePage/data/kyiv';
import { placeLabel } from '@/pages/DovedePage/nlu/gazetteer';
import { noteDirOf, placesInNote } from '@/pages/DovedePage/nlu/notePlaces';
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
  /** «заберу по місту» */
  door: number;
  /** чи є в напрямку Малин / Київ — інакше колонку не показуємо */
  hasMalyn: boolean;
  hasKyiv: boolean;
  malyn: PickupCount[];
  kyiv: PickupCount[];
  /** примітки, де жодного місця не впізнано: найчастіші першими */
  unrecognised: Array<{ note: string; count: number }>;
}

/** Частини примітки, які нічого не кажуть про місце: «є місця», день тижня, «двоє позаду», «дзвоніть або пишіть» */
const NOISE = /^(є\s+місц[яе]|місц[яе]\s+є|понеділок|вівторок|серед[аиу]|четвер|п.?ятниц[яюі]|субот[аиу]|неділ[яюі]|сьогодні|завтра|післязавтра|двоє\s+позаду|дзвоніть(\s+(або|чи)\s+пишіть)?|пишіть|тільки\s+viber|лише\s+viber|telephone|test|від\s+метро)$/;

/** Примітка без шуму; порожня — у ній не було нічого, крім шуму */
export function meaningfulNote(note: string): string {
  return note
    .split(/[;,]/)
    .map((part) => part.replace(/[()«»".]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part && !NOISE.test(part.toLowerCase()))
    .join('; ');
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
    const unrecognised = new Map<string, number>();
    const dir = noteDirOf(r.route);
    let malynNamed = 0;
    let kyivNamed = 0;
    let door = 0;
    for (const n of data.notes) {
      if (n.route !== r.route) continue;
      const found = placesInNote(n.note, index, dir);
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
      const rest = !m && !k && !found.door ? meaningfulNote(n.note) : '';
      if (rest) bump(unrecognised, rest, n.count);
      if (found.door) door += n.count;
    }
    return {
      route: r.route,
      total: r.total,
      withNote: r.withNote,
      malynNamed,
      kyivNamed,
      hasMalyn: dir != null,
      hasKyiv: /(^|-)Kyiv(-|$)/.test(r.route),
      door,
      malyn: sorted(malyn),
      kyiv: sorted(kyiv),
      unrecognised: sorted(unrecognised).slice(0, unrecognisedShown).map((u) => ({ note: u.label, count: u.count })),
    };
  });
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—';
}
