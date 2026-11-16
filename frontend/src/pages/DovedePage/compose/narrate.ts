/**
 * Текст історії — лише шаблони (Docs/dovede-roadmap.md, принцип 1): числа беруться з легів, не вигадуються.
 */
import { routeNo } from '@/utils/routeNames';
import { minsToClock } from './intercity';
import type { Story, StoryLeg } from './types';

export function clock(mins: number, approx = false): string {
  return `${approx ? '≈' : ''}${minsToClock(mins)}`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function legPhrase(l: StoryLeg): string | null {
  if (l.kind === 'intercity') {
    const name = l.mode === 'elektrichka' ? `електричка${l.tripNumber ? ` ${l.tripNumber}` : ''}` : 'маршрутка';
    return `${name} о ${clock(l.boardMins, l.boardApprox)} ${l.boardLabel}`;
  }
  if (l.kind === 'bus') return `автобус №${routeNo(l.routeId)} о ${clock(l.depMins)}`;
  if (l.kind === 'ride') return `попутка о ${clock(l.depMins)} ${l.boardLabel}`;
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
    } else if (l.kind === 'ride') {
      // телефону тут немає: номер людина відриває сама на сторінці
      lines.push(`${clock(l.depMins)} — попутка ${l.boardLabel}${l.ride.priceUah ? `, ${l.ride.priceUah} ₴` : ''} (місце уточніть у водія)`);
    } else if (l.kind === 'walk') {
      lines.push(`пішки ${l.meters} м${l.toLabel ? ` до «${l.toLabel}»` : ''}`);
    }
  }
  lines.push(`${clock(story.arriveMins, story.arriveApprox)} — ${story.endLabel}`);
  return lines.join('\n');
}
