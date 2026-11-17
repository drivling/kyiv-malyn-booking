import type { CSSProperties } from 'react';
import { routeColorStyle } from '@/pages/LocalTransportPage/routeColors';
import type { Story } from '../compose/types';
import { METRO_LINE } from '../data/kyivMetroService';

export interface Segment {
  start: number;
  end: number;
  cls: string;
  style?: CSSProperties;
}

/** Відрізки історії на осі часу: транспорт — кольором, пішки — пунктиром, очікування — порожньо */
export function stripSegments(story: Story): Segment[] {
  const out: Segment[] = [];
  let cursor = story.leaveMins;
  for (const leg of story.legs) {
    if (leg.kind === 'intercity') {
      out.push({ start: leg.boardMins, end: leg.alightMins, cls: leg.mode });
      cursor = leg.alightMins;
    } else if (leg.kind === 'metro') {
      if (!leg.closed) out.push({ start: leg.depMins, end: leg.arrMins, cls: 'metro', style: { background: METRO_LINE[leg.segments[0].line].color } });
      cursor = Math.max(cursor, leg.arrMins);
    } else if (leg.kind === 'ride') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'poputka' });
      cursor = leg.arrMins;
    } else if (leg.kind === 'bus') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'bus', style: routeColorStyle(leg.routeId) as CSSProperties });
      cursor = leg.arrMins;
    } else if (leg.kind === 'walk') {
      // пішка ділянка після останнього транспорту притискається до прибуття
      const start = Math.min(cursor, story.arriveMins - leg.minutes);
      out.push({ start: Math.max(start, cursor), end: Math.max(start, cursor) + leg.minutes, cls: 'walk' });
      cursor = Math.max(start, cursor) + leg.minutes;
    }
  }
  return out.filter((s) => s.end > s.start);
}
