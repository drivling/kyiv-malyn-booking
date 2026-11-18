import type { CSSProperties } from 'react';
import { routeColorStyleIn } from '@/pages/LocalTransportPage/routeColors';
import type { Story } from '../compose/types';
import { METRO_LINE } from '../data/kyivMetroService';
import { RING_COLOR } from '../data/kyivRing';
import { RIDE_COLOR, rideLook } from '../compose/cityTransit';

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
    } else if (leg.kind === 'ring') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'ring', style: { background: leg.ride.extra ? RING_COLOR.extra : RING_COLOR.main } });
      cursor = leg.arrMins;
    } else if (leg.kind === 'city') {
      if (leg.route && leg.depMins != null && leg.arrMins != null) {
        out.push({ start: leg.depMins, end: leg.arrMins, cls: leg.route.steps.some((x) => x.kind === 'transit') ? 'city' : 'walk' });
        cursor = Math.max(cursor, leg.arrMins);
      }
    } else if (leg.kind === 'cityRide') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'cityRide', style: { background: RIDE_COLOR[rideLook(leg.step)] } });
      cursor = leg.arrMins;
    } else if (leg.kind === 'ride') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'poputka' });
      cursor = leg.arrMins;
    } else if (leg.kind === 'bus') {
      out.push({ start: leg.depMins, end: leg.arrMins, cls: 'bus', style: routeColorStyleIn(leg.city, leg.routeId) as CSSProperties });
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
