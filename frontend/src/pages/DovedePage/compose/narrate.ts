/**
 * Текст історії — лише шаблони (Docs/dovede-roadmap.md, принцип 1): числа беруться з легів, не вигадуються.
 */
import { routeNo } from '@/utils/routeNames';
import { minsToClock } from './intercity';
import type { Story, StoryLeg } from './types';

export function clock(mins: number, approx = false): string {
  return `${approx ? '≈' : ''}${minsToClock(mins)}`;
}

const CITY_MODE: Record<string, string> = { BUS: 'автобус', TROLLEYBUS: 'тролейбус', TRAM: 'трамвай', SUBWAY: 'метро', SHARE_TAXI: 'маршрутка', COMMUTER_TRAIN: 'електричка' };

/** Вид міського транспорту словом; номер поруч пишемо без «№» — у метро це «1», у маршрутки «110» */
export function cityModeName(mode: string | undefined): string {
  return CITY_MODE[mode ?? ''] ?? 'транспорт';
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * «метро до «Позняки»» — але там, де поїзди не ходять і їде автобус-замінник, так і кажемо: «автобус №318 замість
 * метро до «Позняки»», а коли частину шляху все ж метро — «метро до «Видубичі», далі автобус №318 замість метро до…».
 */
export function metroPhrase(l: Pick<Extract<StoryLeg, { kind: 'metro' }>, 'segments'>): string {
  const last = l.segments[l.segments.length - 1];
  const firstBus = l.segments.findIndex((sg) => sg.bus);
  if (firstBus < 0) return `метро до «${last.to.name}»`;
  const bus = l.segments[firstBus];
  const tail = `автобус №${bus.bus} замість метро до «${last.bus ? last.to.name : bus.to.name}»`;
  const after = last.bus ? '' : `, далі метро до «${last.to.name}»`;
  return firstBus === 0 ? `${tail}${after}` : `метро до «${bus.from.name}», далі ${tail}${after}`;
}

function legPhrase(l: StoryLeg): string | null {
  if (l.kind === 'intercity') {
    const name = l.mode === 'elektrichka' ? `електричка${l.tripNumber ? ` ${l.tripNumber}` : ''}` : 'маршрутка';
    return `${name} о ${clock(l.boardMins, l.boardApprox)} ${l.boardLabel}`;
  }
  if (l.kind === 'bus') return `автобус №${routeNo(l.routeId)} о ${clock(l.depMins)}`;
  if (l.kind === 'metro') return l.closed ? null : metroPhrase(l);
  if (l.kind === 'ring') return `міська електричка ${l.ride.train} о ${clock(l.depMins)} з платформи «${l.ride.from.name}»`;
  if (l.kind === 'ride') return `попутка о ${clock(l.depMins)} ${l.boardLabel}`;
  if (l.kind === 'city' && l.route) {
    const rides = l.route.steps.filter((x) => x.kind === 'transit');
    return rides.length ? `${l.cityName === 'Київ' ? 'Києвом' : 'містом'} — ${rides.map((x) => `${cityModeName(x.mode)} ${x.line ?? ''}`.trim()).join(', ')}` : `пішки до «${l.toLabel}»`;
  }
  return null;
}

/** «Маршрутка о 15:00 від метро «Святошин», далі автобус №7 о 16:41. На місці о 16:46.» */
export function leadFor(story: Pick<Story, 'legs' | 'arriveMins' | 'arriveApprox' | 'endLabel'>): string {
  const parts = story.legs.map(legPhrase).filter((x): x is string => Boolean(x));
  const late = story.legs.some((l) => l.kind === 'walk' && l.late);
  const walkOnly = parts.length === 0;
  const first = walkOnly ? 'Пішки' : cap(parts.join(', далі '));
  const tail = late ? ' Міські автобуси вже не ходять, далі пішки.' : '';
  const at = `${story.arriveApprox ? 'приблизно ' : ''}о ${minsToClock(story.arriveMins)}`;
  return `${first}.${tail} ${cap(story.endLabel)} — ${at}.`;
}

/** Текст «Поділитися» — як старі друковані «як доїхати» (для Viber / SMS) */
export function shareText(story: Story, stopName: (id: string) => string, header: string): string {
  const lines = [header];
  for (const l of story.legs) {
    if (l.kind === 'intercity') {
      const name = l.mode === 'elektrichka' ? `електричка${l.tripNumber ? ` ${l.tripNumber}` : ''}` : `маршрутка${l.via ? ` ${l.via}` : ''}`;
      lines.push(`${clock(l.boardMins, l.boardApprox)} — ${name} ${l.boardLabel}${l.priceUah ? `, ${l.priceUah} ₴` : ''}`);
      lines.push(`${clock(l.alightMins, l.alightApprox)} — вийти ${l.alightLabel}`);
    } else if (l.kind === 'bus') {
      lines.push(`${clock(l.depMins)} — автобус №${routeNo(l.routeId)} від «${stopName(l.fromStopId)}» до «${stopName(l.toStopId)}»`);
    } else if (l.kind === 'metro') {
      const first = l.segments[0];
      const last = l.segments[l.segments.length - 1];
      const change = l.transfers.map((t) => `, пересадка «${t.from.name}» → «${t.to.name}»`).join('');
      // де поїзди не ходять — автобус-замінник: кажемо, звідки й яким номером
      const shuttle = l.segments.filter((sg) => sg.bus).map((sg) => `, від «${sg.from.name}» до «${sg.to.name}» — автобус №${sg.bus} замість метро`).join('');
      const name = l.segments.every((sg) => sg.bus) ? `автобус №${first.bus} замість метро` : 'метро';
      lines.push(
        l.closed
          ? `метро «${first.from.name}» → «${last.to.name}» — о цій порі не працює`
          : `${clock(l.depMins, true)} — ${name} «${first.from.name}» → «${last.to.name}»${change}${name === 'метро' ? shuttle : ''}, ≈ ${l.minutes} хв`,
      );
    } else if (l.kind === 'ring') {
      lines.push(`${clock(l.depMins)} — міська електричка ${l.ride.train} з платформи «${l.ride.from.name}», ${l.priceUah} ₴`);
      lines.push(`${clock(l.arrMins)} — вийти на «${l.ride.to.name}»`);
    } else if (l.kind === 'ride') {
      // телефону тут немає: номер людина відриває сама на сторінці
      lines.push(`${clock(l.depMins)} — попутка ${l.boardLabel}${l.ride.priceUah ? `, ${l.ride.priceUah} ₴` : ''} (місце уточніть у водія)`);
    } else if (l.kind === 'city') {
      if (!l.route) lines.push(`далі містом (${l.cityName}): ${l.fromLabel} → ${l.toLabel}`);
      else {
        for (const x of l.route.steps) {
          if (x.kind === 'walk') lines.push(`пішки${x.meters ? ` ${x.meters} м` : ''}, ≈ ${x.minutes} хв`);
          else lines.push(`${cityModeName(x.mode)} ${x.line ?? ''}`.trim() + `: «${x.fromStop ?? '?'}» → «${x.toStop ?? '?'}», ≈ ${x.minutes} хв`);
        }
      }
    } else if (l.kind === 'walk') {
      lines.push(`пішки ${l.meters} м${l.toLabel ? ` до «${l.toLabel}»` : ''}`);
    }
  }
  lines.push(`${clock(story.arriveMins, story.arriveApprox)} — ${story.endLabel}`);
  return lines.join('\n');
}
